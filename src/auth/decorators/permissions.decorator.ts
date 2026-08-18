import { SetMetadata } from '@nestjs/common';

import type { PermissionKey } from '../types/permission-key';

export const PERMISSIONS_KEY = 'rbac:permissions';

/**
 * Declares which permission(s) a route requires, using the exact
 * `{ resource, action }` shape the `Permission` model already stores —
 * no colon-joined string syntax is introduced. Attaches metadata only;
 * enforcement happens in `AuthorizationGuard`.
 *
 * Multiple permissions are AND'd: the caller needs every one of them
 * (see AuthorizationGuard's doc-comment and this phase's final report for
 * the documented ambiguity/decision — the architecture docs don't state
 * this explicitly).
 *
 * @example
 * @Permissions({ resource: 'products', action: 'read' })
 * @example
 * @Permissions(
 *   { resource: 'products', action: 'read' },
 *   { resource: 'inventory', action: 'adjust' },
 * ) // both permissions are required
 */
export const Permissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
