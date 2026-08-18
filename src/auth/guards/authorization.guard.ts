import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthorizationService } from '../authorization/authorization.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { PermissionKey } from '../types/permission-key';
import type { SafeUser } from '../utils/safe-user';

// Deliberately generic — never states which role/permission was missing,
// matching the same non-disclosure principle used throughout the rest of
// this auth system (see docs/architecture.md §18's login/refresh/logout
// sections). No role ID, permission ID, or DB detail is ever included.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

/**
 * Enforces `@Roles()` / `@Permissions()` metadata. Authorization only —
 * it never verifies a token or looks up a user by ID; it trusts
 * `req.user` exactly as JwtAuthGuard (which must run first in the guard
 * chain — see AuthModule/AuthController's `@UseGuards(JwtAuthGuard,
 * AuthorizationGuard)` ordering) already established it, and asks
 * AuthorizationService whether *that* user satisfies the declared
 * requirement(s). This is the "Role / Permission Guard" step in
 * docs/architecture.md §21's authentication flow diagram.
 *
 * Combination semantics (all ambiguities not settled by the architecture
 * docs, decided here and reported in this phase's final report):
 *  - No `@Roles()`/`@Permissions()` on the route at all → authentication
 *    alone is sufficient; this guard allows the request through.
 *  - Multiple roles in one `@Roles(...)` → OR (any one suffices).
 *  - Multiple permissions in one `@Permissions(...)` → AND (all required).
 *  - Both `@Roles()` AND `@Permissions()` present on the same route → AND
 *    (both the role check and the permission check must independently
 *    pass). Decorators are additive constraints, not alternatives.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<
      string[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionKey[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    const hasRoleRequirement = !!requiredRoles && requiredRoles.length > 0;
    const hasPermissionRequirement =
      !!requiredPermissions && requiredPermissions.length > 0;

    if (!hasRoleRequirement && !hasPermissionRequirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: SafeUser }>();
    const user = request.user;

    // Defensive fallback only: JwtAuthGuard is expected to have already
    // rejected an unauthenticated request with 401 before this guard
    // runs. If it somehow didn't (e.g. misconfigured guard order), "no
    // identity to authorize" is correctly an authentication failure, not
    // an authorization one.
    if (!user) {
      throw new UnauthorizedException();
    }

    if (hasRoleRequirement) {
      const results = await Promise.all(
        requiredRoles.map((role) =>
          this.authorizationService.hasRole(user.id, role),
        ),
      );

      if (!results.some(Boolean)) {
        throw new ForbiddenException(FORBIDDEN_MESSAGE);
      }
    }

    if (hasPermissionRequirement) {
      const results = await Promise.all(
        requiredPermissions.map(({ resource, action }) =>
          this.authorizationService.hasPermission(user.id, resource, action),
        ),
      );

      if (!results.every(Boolean)) {
        throw new ForbiddenException(FORBIDDEN_MESSAGE);
      }
    }

    return true;
  }
}
