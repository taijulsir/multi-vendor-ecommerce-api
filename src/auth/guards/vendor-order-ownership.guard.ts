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

// Deliberately identical in shape/generality to ProductOwnershipGuard's
// and VendorShopOwnershipGuard's forbidden message — same non-disclosure
// principle: never states whether the VendorOrder exists, who owns it,
// or that the caller isn't a vendor at all.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

/**
 * Enforces the `User → Vendor → VendorOrder` ownership chain documented
 * in docs/database/order.md §11 ("A vendor must never be able to access
 * another vendor's VendorOrder by guessing or submitting its ID") for
 * any route with a `:vendorOrderId` route parameter.
 *
 * This is a third, mirrored instance of the exact same shape as
 * `VendorShopOwnershipGuard` (Phase 9) and `ProductOwnershipGuard`
 * (Phase 11) — `ProductOwnershipGuard`'s doc-comment explicitly named
 * "a third entity needing this exact shape" as the point where
 * extracting a shared base would become justified by real reuse. That
 * point has now been reached, but the extraction is deliberately **not**
 * done in this phase: this task's own rules forbid rewriting Phase 1–13
 * functionality, and retrofitting a generic base onto the two existing,
 * already-tested guards is exactly that — a refactor of stable prior
 * work, not "Order viewing" work. Flagged here as a legitimate candidate
 * for a dedicated future refactor, not silently deferred.
 *
 * What is reused, not duplicated: vendor resolution
 * (`OwnershipService.getVendorIdForUser`), the ADMIN bypass
 * (`AuthorizationService.hasRole`), and the ownership-count query
 * pattern — only `OwnershipService.isVendorOrderOwnedByVendor` and this
 * guard's thin `:vendorOrderId` wiring are new.
 */
@Injectable()
export class VendorOrderOwnershipGuard implements CanActivate {
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
    // VendorShopOwnershipGuard/ProductOwnershipGuard.
    const isAdmin = await this.authorizationService.hasRole(user.id, 'ADMIN');
    if (isAdmin) {
      return true;
    }

    const vendorOrderId = request.params.vendorOrderId;

    if (!vendorOrderId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const vendorId = await this.ownershipService.getVendorIdForUser(user.id);

    if (!vendorId) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    const owns = await this.ownershipService.isVendorOrderOwnedByVendor(
      vendorOrderId,
      vendorId,
    );

    if (!owns) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return true;
  }
}
