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
 * entity" service): only the `User → Vendor → Shop` chain that
 * docs/database/vendor-shop.md §19–20 explicitly documents an ownership
 * rule for. Every other entity in the schema that has a `vendorId` (or a
 * `userId`) column — Product, VendorOrder, Wallet, Cart, MasterOrder,
 * Review, Notification, ... — has no application-layer controller yet in
 * this codebase, so there is no real route to protect and therefore
 * nothing concrete to test an ownership check against. Adding those
 * checks now would be speculative rather than grounded in an actual
 * protected endpoint, which this phase's task explicitly warns against
 * ("do not implement ownership checks for entities where the source
 * documents do not establish an ownership rule" combined with "do not
 * expand the business domain"). The intended pattern — resolve the
 * trusted owner id from the authenticated user, then check it against the
 * resource server-side — extends directly to those entities once they
 * get real endpoints; see this phase's final report.
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
   */
  async getVendorIdForUser(userId: string): Promise<string | null> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
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
  async isShopOwnedByVendor(shopId: string, vendorId: string): Promise<boolean> {
    const count = await this.prisma.shop.count({
      where: { id: shopId, vendorId },
    });

    return count > 0;
  }
}
