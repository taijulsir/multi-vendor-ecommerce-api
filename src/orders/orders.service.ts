import { ForbiddenException, Injectable } from '@nestjs/common';

import { AuthorizationService } from '../auth/authorization/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { toMasterOrderView, type MasterOrderView } from './utils/order-view';

// Deliberately identical in shape/generality to the ownership-denial
// messages used elsewhere (VendorShopOwnershipGuard, ProductOwnershipGuard,
// VendorOrderOwnershipGuard) — never states whether the order exists or
// belongs to someone else. Both are indistinguishable to the caller.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

const ORDER_INCLUDE = { vendorOrders: { include: { items: true } } } as const;

/**
 * Order viewing (Phase 14) — the customer's own perspective.
 *
 * **Ownership model (deliberately not a guard, not a route-param
 * pattern):** `MasterOrder` is user-owned (`User → MasterOrder`, a
 * direct `userId` match — docs/database/order.md §48: "Customers may
 * view their own MasterOrders"), the same shape as `Cart` (Phase 12),
 * not the `User → Vendor → <resource>` chain `OwnershipService`'s
 * `isXOwnedByVendor` methods exist for. Every method here scopes its own
 * Prisma query directly to the authenticated `userId`, mirroring
 * `CartService`'s established pattern — no new guard, no ownership
 * service involvement for the userId comparison itself.
 *
 * §48 also says "Admins may have broader access according to RBAC
 * permissions" — applied here the same way the ADMIN bypass is applied
 * everywhere else in this codebase: reusing
 * `AuthorizationService.hasRole`, not a second role-resolution
 * implementation.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async findMyOrders(userId: string): Promise<MasterOrderView[]> {
    const orders = await this.prisma.masterOrder.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return orders.map(toMasterOrderView);
  }

  /**
   * A `masterOrderId` that doesn't exist at all and one that belongs to
   * another user are reported identically (403) — never discloses which
   * applies, matching this codebase's established non-disclosure
   * convention for ownership failures.
   */
  async findMyOrderById(
    userId: string,
    masterOrderId: string,
  ): Promise<MasterOrderView> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      include: ORDER_INCLUDE,
    });

    if (!order) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    if (order.userId !== userId) {
      const isAdmin = await this.authorizationService.hasRole(
        userId,
        'ADMIN',
      );

      if (!isAdmin) {
        throw new ForbiddenException(FORBIDDEN_MESSAGE);
      }
    }

    return toMasterOrderView(order);
  }
}
