import type { UserStatus } from '../../generated/prisma/client';

/**
 * Single source of truth for which `User.status` values may authenticate,
 * per docs/database/identity-access.md "User Status":
 *  - ACTIVE: explicitly documented as able to authenticate.
 *  - SUSPENDED / BLOCKED: not granted that ability (see
 *    AuthService.assertCanAuthenticate for the full ambiguity note — the
 *    source documents don't explicitly say whether the restriction applies
 *    to the authentication step itself, so the conservative reading is
 *    used here too, kept consistent across every call site).
 *
 * Both the login flow (`AuthService.login`) and ongoing JWT verification
 * (`JwtStrategy.validate`) must agree on this policy so a suspended/blocked
 * account can neither log in nor continue using an already-issued token.
 * Only the HTTP-error presentation differs between those two call sites
 * (login: 403 with a specific reason, matching Phase 2; JWT verification:
 * uniform 401, per this phase's explicit requirements) — the underlying
 * "is this status allowed to authenticate" decision lives here, once.
 */
export function isAuthenticatable(status: UserStatus): boolean {
  return status === 'ACTIVE';
}
