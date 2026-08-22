import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Same Passport JWT strategy as `JwtAuthGuard`, but never throws: a
 * missing, malformed, or invalid/expired token simply leaves `req.user`
 * undefined instead of producing a 401. Passport's `AuthGuard.canActivate`
 * always returns `true` as long as `handleRequest` does not throw
 * (@nestjs/passport's `auth.guard.js`), so overriding only `handleRequest`
 * is sufficient to make authentication optional.
 *
 * Exists for exactly one route shape: the Product Image streaming
 * endpoint (Phase 22), whose visibility is "mixed" — a public/`ACTIVE`
 * product's images are publicly streamable, a non-`ACTIVE` product's
 * images require the caller to be its owner or an ADMIN
 * (docs/remaining-architecture-plan.md Section 8). `ProductOwnershipGuard`
 * cannot express this: it requires an authenticated `req.user`
 * unconditionally. This guard only resolves *identity*, optionally — the
 * actual visibility decision is made in `ProductImagesService`, which
 * reuses `OwnershipService`/`AuthorizationService` directly (the same
 * building blocks `ProductOwnershipGuard` itself is built from) rather
 * than duplicating that logic in a guard.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
