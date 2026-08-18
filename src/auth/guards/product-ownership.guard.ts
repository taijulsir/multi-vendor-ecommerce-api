import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import { OwnershipService } from '../authorization/ownership.service';
import type { SafeUser } from '../utils/safe-user';

// Deliberately identical in shape/generality to
// VendorShopOwnershipGuard's forbidden message — same non-disclosure
// principle: never states whether the product exists, who owns it, or
// that the caller isn't a vendor at all.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

/**
 * Enforces the `User → Vendor → Product` ownership chain documented in
 * docs/database/catalog.md §8 ("Vendor A must not be able to update
 * Product B by supplying Product B's ID") for any route with a
 * `:productId` route parameter.
 *
 * Architectural decision (Phase 11): `Product` has the same ownership
 * *shape* as `Shop` (`User → Vendor → <resource>`, resource carries a
 * direct `vendorId`), but it is a genuinely different Prisma model with
 * its own route param (`:productId`, not `:shopId`). Rather than
 * generalizing `VendorShopOwnershipGuard` into a parameterized/generic
 * `OwnershipGuard<T>` (speculative reuse for a "shape" that has exactly
 * two concrete cases so far, and would need a config mechanism — model
 * name + param name — that adds indirection without a second real
 * consumer justifying it yet), this is a small, separate guard that
 * mirrors the same structure. What *is* reused, not duplicated: vendor
 * resolution (`OwnershipService.getVendorIdForUser`), the ADMIN bypass
 * (`AuthorizationService.hasRole`), and the ownership-count query pattern
 * — the only new code is `OwnershipService.isProductOwnedByVendor` and
 * this guard's thin `:productId` wiring. If a third entity needs this
 * exact shape, that is the point at which extracting a shared base
 * becomes justified by real reuse rather than anticipated reuse.
 */
@Injectable()
export class ProductOwnershipGuard implements CanActivate {
  constructor(
    private readonly ownershipService: OwnershipService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: SafeUser; params: Record<string, string> }>();

    const user = request.user;

    if (!user) {
      throw new UnauthorizedException();
    }

    // ADMIN bypasses ownership entirely, same documented bypass as
    // VendorShopOwnershipGuard (docs/database/vendor-shop.md §20) applied
    // consistently to vendor-owned resources generally.
    const isAdmin = await this.authorizationService.hasRole(user.id, 'ADMIN');
    if (isAdmin) {
      return true;
    }

    const productId = request.params.productId;

    if (!productId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const vendorId = await this.ownershipService.getVendorIdForUser(user.id);

    if (!vendorId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const owns = await this.ownershipService.isProductOwnedByVendor(
      productId,
      vendorId,
    );

    if (!owns) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return true;
  }
}
