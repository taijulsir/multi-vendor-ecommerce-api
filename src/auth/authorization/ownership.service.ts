import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves resource-*ownership* — a deliberately separate concern from
 * `AuthorizationService` (which resolves RBAC: roles/permissions).
 * Ownership answers "does this specific resource belong to this
 * authenticated identity?", not "is this identity allowed to perform
 * this class of action at all?" — see docs/architecture.md's new
 * "Ownership vs. RBAC" note (Phase 9).
 *
 * Scope, deliberately narrow (not a generic "check ownership of any
 * entity" service): only the `User → Vendor → {Shop, Product,
 * VendorOrder}` chains that have both (a) an explicitly documented
 * ownership rule and (b) a real application-layer controller. `Shop` was
 * added in Phase 9; `Product` in Phase 11
 * (docs/database/catalog.md §8); `VendorOrder` in Phase 14
 * (docs/database/order.md §11: "A vendor must only be able to access
 * VendorOrders belonging to that vendor... never access another vendor's
 * VendorOrder by guessing or submitting its ID"). Every other entity in
 * the schema that has a `vendorId` (or a `userId`) column — Wallet, Cart,
 * MasterOrder, Review, Notification, ... — has no application-layer
 * controller yet in this codebase, so there is no real route to protect
 * and therefore nothing concrete to test an ownership check against
 * (Cart and MasterOrder are user-owned, not vendor-owned, and
 * deliberately do *not* use this service — see CartService's and
 * OrdersService's doc-comments). The intended pattern — resolve the
 * trusted owner id from the authenticated user, then check it against the
 * resource server-side — extends directly to those entities once they
 * get real endpoints.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The authenticated user's own Vendor id, or `null` if the user has no
   * vendor profile (`User → Vendor` is `1 : 0..1` per
   * docs/database/vendor-shop.md §1 — not every user is a vendor). Never
   * takes a vendor id as input: the vendor identity is always derived
   * from the trusted, JWT-authenticated user id, never from client input.
   *
   * Excludes soft-deleted Vendor rows (`deletedAt: null`), per
   * `docs/plans/database-implementation-plan.md` §1.3's application-layer
   * rule ("every read query on a soft-deletable model must filter
   * `deletedAt: null`") — matching the filter every other Vendor-adjacent
   * read in this codebase already applies. Currently dormant (no
   * endpoint ever sets `Vendor.deletedAt`) but fixed here for
   * consistency (Phase 16 audit).
   */
  async getVendorIdForUser(userId: string): Promise<string | null> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId, deletedAt: null },
      select: { id: true },
    });

    return vendor?.id ?? null;
  }

  /**
   * Whether the given shop is owned by the given vendor. A shop id that
   * doesn't exist at all matches zero rows — same fail-closed shape as
   * "not owned," so this method (and therefore anything built on it)
   * cannot be used to probe for a shop's existence.
   */
  async isShopOwnedByVendor(
    shopId: string,
    vendorId: string,
  ): Promise<boolean> {
    const count = await this.prisma.shop.count({
      where: { id: shopId, vendorId },
    });

    return count > 0;
  }

  /**
   * Whether the given product is owned by the given vendor
   * (docs/database/catalog.md §8: `Authenticated User → Vendor →
   * Product`). Same fail-closed shape as `isShopOwnedByVendor` — a
   * nonexistent product id matches zero rows, indistinguishable from
   * "not owned."
   */
  async isProductOwnedByVendor(
    productId: string,
    vendorId: string,
  ): Promise<boolean> {
    const count = await this.prisma.product.count({
      where: { id: productId, vendorId },
    });

    return count > 0;
  }

  /**
   * Whether the given VendorOrder is owned by the given vendor
   * (docs/database/order.md §11). Same fail-closed shape as the other
   * `isXOwnedByVendor` methods.
   */
  async isVendorOrderOwnedByVendor(
    vendorOrderId: string,
    vendorId: string,
  ): Promise<boolean> {
    const count = await this.prisma.vendorOrder.count({
      where: { id: vendorOrderId, vendorId },
    });

    return count > 0;
  }
}
