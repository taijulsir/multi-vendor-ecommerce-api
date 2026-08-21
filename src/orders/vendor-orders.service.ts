import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../auth/authorization/ownership.service';
import type { VendorOrderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateVendorOrderStatusDto } from './dto/update-vendor-order-status.dto';
import { deriveMasterOrderStatus } from './utils/master-order-status';
import {
  toVendorOrderDetailView,
  type VendorOrderDetailView,
} from './utils/order-view';

// Same generic message as elsewhere in this codebase for "no vendor
// profile" — indistinguishable from every other ownership failure.
const NO_VENDOR_PROFILE_MESSAGE =
  'You do not have permission to perform this action.';
const VENDOR_ORDER_NOT_FOUND_MESSAGE = 'Vendor order not found';
const INVALID_TRANSITION_MESSAGE =
  "The vendor order's current status does not allow this transition";

const VENDOR_ORDER_INCLUDE = { items: true } as const;

// Only the transitions docs/database/order.md §10/§31 explicitly draws
// are implemented (ADR-2, docs/remaining-architecture-plan.md's
// Architecture Decision Register): the narrow progression
// PENDING→CONFIRMED→PROCESSING→READY_TO_SHIP→SHIPPED→DELIVERED, plus
// PENDING/CONFIRMED→CANCELLED. DELIVERED and CANCELLED are terminal — no
// re-opening, no PROCESSING/SHIPPED→CANCELLED, no RETURN_REQUESTED/
// RETURNED — ADR-2 explicitly marks those DEFERRED, not merely
// unimplemented.
const ALLOWED_VENDOR_ORDER_TRANSITIONS: Record<
  VendorOrderStatus,
  VendorOrderStatus[]
> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_TO_SHIP'],
  READY_TO_SHIP: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  RETURN_REQUESTED: [],
  RETURNED: [],
};

// Mechanical consequence of reaching a given status — not a separate
// business rule, just recording when the schema's own timestamp field
// (docs/database/order.md §9) was actually reached.
const STATUS_TIMESTAMP_FIELD: Partial<
  Record<VendorOrderStatus, 'shippedAt' | 'deliveredAt' | 'cancelledAt'>
> = {
  SHIPPED: 'shippedAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};

const MASTER_ORDER_RECOMPUTE_MAX_ATTEMPTS = 5;

/**
 * Order viewing (Phase 14) — the vendor's own perspective — extended
 * with vendor-initiated fulfillment status transitions (Phase 19,
 * ADR-2/ADR-3).
 *
 * Ownership for both `GET` and `PATCH /vendor-orders/:vendorOrderId*`
 * routes is enforced entirely by `VendorOrderOwnershipGuard` before any
 * method here runs — this service does not re-check ownership. The
 * *list* endpoint has no existing resource to check ownership of (it's a
 * collection), so it resolves the caller's own vendor id via
 * `OwnershipService` and scopes the query to it — the same pattern
 * already established by `ShopsService`/`ProductsService` for their own
 * creation flows.
 *
 * **Customer-initiated cancellation is deliberately NOT implemented in
 * this phase.** docs/database/order.md §48 ("Security and Authorization")
 * lists only "View their own MasterOrders/VendorOrders/OrderItems" under
 * what customers may do — fulfillment-state mutation ("Update
 * fulfillment-related state according to permissions") is listed only
 * under vendors. A prior planning pass's ADR-2 implementation-constraints
 * note speculated a customer-facing cancel path might also exist, citing
 * §48 — re-reading §48 directly during this phase found no textual basis
 * for that in the actual source document, only for the vendor-initiated
 * path implemented here. Per this task's explicit rule not to invent an
 * actor-permission/cancellation rule beyond what the source documents
 * support, no separate customer cancellation endpoint was built — see
 * this phase's final report.
 */
@Injectable()
export class VendorOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: OwnershipService,
  ) {}

  async findMyVendorOrders(userId: string): Promise<VendorOrderDetailView[]> {
    const vendorId = await this.ownershipService.getVendorIdForUser(userId);

    if (!vendorId) {
      throw new ForbiddenException(NO_VENDOR_PROFILE_MESSAGE);
    }

    const vendorOrders = await this.prisma.vendorOrder.findMany({
      where: { vendorId },
      include: VENDOR_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return vendorOrders.map(toVendorOrderDetailView);
  }

  /**
   * Existence is the only remaining concern here (ownership/ADMIN bypass
   * already enforced by the guard) — the guard's ADMIN bypass returns
   * before any existence check, so a nonexistent id reaching this method
   * as an ADMIN must still be handled.
   */
  async findById(vendorOrderId: string): Promise<VendorOrderDetailView> {
    const vendorOrder = await this.prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      include: VENDOR_ORDER_INCLUDE,
    });

    if (!vendorOrder) {
      throw new NotFoundException(VENDOR_ORDER_NOT_FOUND_MESSAGE);
    }

    return toVendorOrderDetailView(vendorOrder);
  }

  /**
   * Transitions a VendorOrder's status (ADR-2) and, in the same
   * transaction, recomputes and — if it actually changed — updates the
   * derived `MasterOrder.status` (ADR-3). Both writes and both history
   * rows succeed or fail together; nothing here uses a distributed lock
   * or Redis, only the atomic-conditional-`UPDATE` pattern already
   * established in `CheckoutService` (read current state → validate →
   * `updateMany` with that exact prior state still in the `WHERE` clause
   * → 0 affected rows means a concurrent request won the race).
   */
  async updateStatus(
    vendorOrderId: string,
    dto: UpdateVendorOrderStatusDto,
    actorUserId: string,
  ): Promise<VendorOrderDetailView> {
    const vendorOrder = await this.prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
    });

    if (!vendorOrder) {
      throw new NotFoundException(VENDOR_ORDER_NOT_FOUND_MESSAGE);
    }

    const allowedTargets = ALLOWED_VENDOR_ORDER_TRANSITIONS[vendorOrder.status];

    if (!allowedTargets.includes(dto.status)) {
      throw new ConflictException(INVALID_TRANSITION_MESSAGE);
    }

    const timestampField = STATUS_TIMESTAMP_FIELD[dto.status];
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.vendorOrder.updateMany({
        where: { id: vendorOrderId, status: vendorOrder.status },
        data: {
          status: dto.status,
          ...(timestampField ? { [timestampField]: now } : {}),
        },
      });

      if (result.count === 0) {
        // A concurrent request already changed this VendorOrder's status
        // between the read above and this write.
        throw new ConflictException(INVALID_TRANSITION_MESSAGE);
      }

      await tx.vendorOrderStatusHistory.create({
        data: {
          vendorOrderId,
          fromStatus: vendorOrder.status,
          toStatus: dto.status,
          changedBy: actorUserId,
        },
      });

      await this.recomputeMasterOrderStatus(
        tx,
        vendorOrder.masterOrderId,
        actorUserId,
      );

      return tx.vendorOrder.findUniqueOrThrow({
        where: { id: vendorOrderId },
        include: VENDOR_ORDER_INCLUDE,
      });
    });

    return toVendorOrderDetailView(updated);
  }

  /**
   * ADR-3: `MasterOrder.status` is derived from its `VendorOrder`s, never
   * client-settable, and this recomputation always runs inside the same
   * transaction as the `VendorOrder` write that may have changed it.
   * Different `VendorOrder`s under the same `MasterOrder` can be updated
   * concurrently by two different vendors (two different rows — the
   * `VendorOrder`-level row lock above does not protect this), so this
   * step needs its own atomic conditional update; a small bounded retry
   * (re-read → recompute → conditional write), the same pattern already
   * used for order-number generation in `CheckoutService`, handles the
   * rare case where a sibling's own concurrent recompute wins first.
   */
  private async recomputeMasterOrderStatus(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    masterOrderId: string,
    actorUserId: string,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < MASTER_ORDER_RECOMPUTE_MAX_ATTEMPTS;
      attempt++
    ) {
      const siblings = await tx.vendorOrder.findMany({
        where: { masterOrderId },
        select: { status: true },
      });
      const derived = deriveMasterOrderStatus(siblings.map((s) => s.status));

      const masterOrder = await tx.masterOrder.findUniqueOrThrow({
        where: { id: masterOrderId },
      });

      if (masterOrder.status === derived) {
        return;
      }

      const result = await tx.masterOrder.updateMany({
        where: { id: masterOrderId, status: masterOrder.status },
        data: {
          status: derived,
          ...(derived === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });

      if (result.count > 0) {
        await tx.orderStatusHistory.create({
          data: {
            masterOrderId,
            fromStatus: masterOrder.status,
            toStatus: derived,
            changedBy: actorUserId,
          },
        });
        return;
      }

      // A sibling VendorOrder's own concurrent status change already
      // recomputed and wrote MasterOrder.status between the read above
      // and this write — retry with fresh state.
    }

    throw new Error(
      `Failed to recompute MasterOrder ${masterOrderId} status after ${MASTER_ORDER_RECOMPUTE_MAX_ATTEMPTS} attempts`,
    );
  }
}
