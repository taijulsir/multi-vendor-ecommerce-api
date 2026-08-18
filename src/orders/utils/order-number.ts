import { randomBytes } from 'node:crypto';

/**
 * Generates a human-readable, collision-safe order number
 * (`ORD-2026-A1B2C3D4E5F6`) without a database round-trip.
 *
 * docs/database/order.md §36 explicitly forbids `COUNT(*) + 1` and asks
 * for "a database-backed sequence, atomic counter, or equivalent
 * collision-safe strategy". A Postgres sequence would work but requires
 * a schema/migration change purely to generate a display string; this
 * codebase already has a strong, existing precedent for the alternative
 * the doc itself allows ("or equivalent collision-safe strategy") —
 * cryptographically random values backed by a database `UNIQUE`
 * constraint as the final collision authority (see
 * `RefreshTokenService` (Phase 5) and every catalog/vendor slug). 12 hex
 * characters is 48 bits of entropy — collision probability is
 * negligible at any realistic order volume, and `MasterOrder.orderNumber`
 * / `VendorOrder.orderNumber` remain `@unique` as the authoritative
 * backstop regardless.
 */
export function generateOrderNumber(prefix: 'ORD' | 'VO'): string {
  const year = new Date().getUTCFullYear();
  const suffix = randomBytes(6).toString('hex').toUpperCase();

  return `${prefix}-${year}-${suffix}`;
}
