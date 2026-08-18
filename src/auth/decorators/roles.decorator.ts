import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'rbac:roles';

/**
 * Declares which role(s) a route requires. Attaches metadata only — all
 * enforcement happens in `AuthorizationGuard`, which reads this key via
 * `Reflector`.
 *
 * Multiple roles are OR'd: the caller needs at least one of them (see
 * AuthorizationGuard's doc-comment and this phase's final report for the
 * documented ambiguity/decision — the architecture docs don't state this
 * explicitly).
 *
 * @example
 * @Roles('ADMIN')
 * @example
 * @Roles('ADMIN', 'VENDOR') // either role is sufficient
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
