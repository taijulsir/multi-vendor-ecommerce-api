import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionKey } from '../types/permission-key';

/**
 * Resolves a user's RBAC state (roles, permissions) from the existing
 * User → UserRole → Role → RolePermission → Permission tables — see
 * docs/database/identity-access.md §6/§7. No new schema, no caching, no
 * JWT-embedded claims: every call reads live database state, so a
 * role/permission change (or removal) takes effect on the very next
 * request without requiring the user to log in again (see
 * docs/architecture.md §22 and this phase's final report).
 *
 * Deliberately the single place authorization queries live —
 * AuthorizationGuard and any future consumer call into this service
 * rather than querying Prisma directly, so the RBAC query shape exists in
 * exactly one place.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** All role names currently assigned to the user (possibly empty). */
  async getUserRoles(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { name: true } } },
    });

    return userRoles.map((userRole) => userRole.role.name);
  }

  /**
   * Every permission granted to the user through any of their roles,
   * de-duplicated (the same permission can be reachable via more than one
   * role).
   */
  async getUserPermissions(userId: string): Promise<PermissionKey[]> {
    const roles = await this.prisma.role.findMany({
      where: { users: { some: { userId } } },
      select: {
        permissions: {
          select: {
            permission: { select: { resource: true, action: true } },
          },
        },
      },
    });

    const seen = new Set<string>();
    const permissions: PermissionKey[] = [];

    for (const role of roles) {
      for (const rolePermission of role.permissions) {
        const { resource, action } = rolePermission.permission;
        const key = `${resource}:${action}`;

        if (!seen.has(key)) {
          seen.add(key);
          permissions.push({ resource, action });
        }
      }
    }

    return permissions;
  }

  /**
   * Whether the user currently has the named role. An unknown user (or a
   * user with no roles) simply matches zero rows — this is not an error
   * condition, it fails closed (no role) by construction, with no special
   * casing required.
   */
  async hasRole(userId: string, roleName: string): Promise<boolean> {
    const count = await this.prisma.userRole.count({
      where: { userId, role: { name: roleName } },
    });

    return count > 0;
  }

  /**
   * Whether the user has the given permission through at least one of
   * their roles. Same fail-closed behavior as `hasRole` for an unknown
   * user or a permission that doesn't exist.
   */
  async hasPermission(
    userId: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    const count = await this.prisma.role.count({
      where: {
        users: { some: { userId } },
        permissions: { some: { permission: { resource, action } } },
      },
    });

    return count > 0;
  }
}
