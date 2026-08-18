import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OwnershipService } from '../auth/authorization/ownership.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  toVendorOrderDetailView,
  type VendorOrderDetailView,
} from './utils/order-view';

// Same generic message as elsewhere in this codebase for "no vendor
// profile" — indistinguishable from every other ownership failure.
const NO_VENDOR_PROFILE_MESSAGE =
  'You do not have permission to perform this action.';
const VENDOR_ORDER_NOT_FOUND_MESSAGE = 'Vendor order not found';

const VENDOR_ORDER_INCLUDE = { items: true } as const;

/**
 * Order viewing (Phase 14) — the vendor's own perspective.
 *
 * Ownership for `GET /vendor-orders/:vendorOrderId` is enforced entirely
 * by `VendorOrderOwnershipGuard` before `findById` runs — this service
 * does not re-check ownership there. The *list* endpoint has no existing
 * resource to check ownership of (it's a collection), so it resolves the
 * caller's own vendor id via `OwnershipService` and scopes the query to
 * it — the same pattern already established by `ShopsService`/
 * `ProductsService` for their own creation flows.
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
}
