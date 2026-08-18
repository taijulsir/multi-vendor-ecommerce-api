/**
 * Mirrors the exact `resource` + `action` representation already defined
 * by `prisma/schema/identity-access.prisma`'s `Permission` model
 * (`@@unique([resource, action])`) — see docs/database/identity-access.md
 * §3. No second permission syntax (e.g. a colon-joined `"resource:action"`
 * string) is introduced; this is the same shape the database itself uses.
 */
export interface PermissionKey {
  resource: string;
  action: string;
}
