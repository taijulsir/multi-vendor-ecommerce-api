/**
 * Access-token payload. Deliberately minimal: a stable user identity claim
 * only.
 *
 * docs/architecture.md §20 sketches a broader "conceptual payload"
 * (`jti`, `roles`), but both are intentionally omitted here: `roles` needs
 * RBAC (a later phase) to resolve correctly and would duplicate
 * authorization data that can change independently of the token; `jti`
 * only has meaning once a token-tracking/revocation mechanism (refresh
 * rotation, logout) exists. Neither is implemented in this phase, so
 * neither claim is added ahead of the infrastructure that would give it
 * meaning.
 */
export interface JwtPayload {
  sub: string;
}
