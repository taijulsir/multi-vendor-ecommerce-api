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

// Deliberately identical in shape/generality to AuthorizationGuard's
// forbidden message (Phase 8) — same non-disclosure principle applied to
// ownership instead of RBAC: never states whether the shop exists, who
// owns it, or that the caller isn't a vendor at all. "Not owned" and
// "doesn't exist" and "you have no vendor profile" are all
// indistinguishable to the caller.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

/**
 * Enforces the `User → Vendor → Shop` ownership chain documented in
 * docs/database/vendor-shop.md §19 ("a vendor should not be able to
 * modify another vendor's shop by simply providing another shopId") for
 * any route with a `:shopId` route parameter.
 *
 * A **separate concern from AuthorizationGuard** (Phase 8): RBAC answers
 * "is this identity allowed to perform this class of action at all?";
 * this guard answers "does *this specific* shop belong to *this*
 * authenticated identity?" A route may use either, both (in sequence, via
 * `@UseGuards(JwtAuthGuard, AuthorizationGuard, VendorShopOwnershipGuard)`),
 * or neither — they don't know about each other. The one place they touch
 * is the ADMIN bypass below, which reuses `AuthorizationService.hasRole`
 * (Phase 8) rather than re-implementing role resolution — see
 * docs/database/vendor-shop.md §20: "unless an elevated role such as
 * ADMIN explicitly has access."
 *
 * The vendor identity used for the comparison is always resolved from
 * the authenticated `req.user.id` — never from any client-supplied
 * vendor/user id in the body, query, or params (task rule: never trust
 * client-supplied identity when the authenticated one is available).
 */
@Injectable()
export class VendorShopOwnershipGuard implements CanActivate {
  constructor(
    private readonly ownershipService: OwnershipService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: SafeUser; params: Record<string, string> }>();

    const user = request.user;

    // Defensive fallback: JwtAuthGuard is expected to run first in the
    // guard chain and already reject an unauthenticated request with
    // 401. "No identity to check ownership for" is an authentication
    // failure, not an authorization one.
    if (!user) {
      throw new UnauthorizedException();
    }

    // ADMIN bypasses ownership entirely, per
    // docs/database/vendor-shop.md §20 — explicitly documented, not an
    // assumption. No other role is granted this bypass.
    const isAdmin = await this.authorizationService.hasRole(user.id, 'ADMIN');
    if (isAdmin) {
      return true;
    }

    const shopId = request.params.shopId;

    // Fail closed: a route wired to this guard without a :shopId param is
    // a configuration error, not something to silently allow.
    if (!shopId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const vendorId = await this.ownershipService.getVendorIdForUser(user.id);

    // Not a vendor at all -> cannot own any shop. Same generic outcome as
    // every other failure branch here.
    if (!vendorId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const owns = await this.ownershipService.isShopOwnedByVendor(
      shopId,
      vendorId,
    );

    if (!owns) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return true;
  }
}
