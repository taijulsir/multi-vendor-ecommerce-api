import { randomBytes } from 'node:crypto';

/**
 * Generates a human-readable, collision-safe payment/refund number
 * (`PAY-2026-A1B2C3D4E5F6`, `REF-2026-A1B2C3D4E5F6`).
 *
 * Deliberately a small, separate copy of
 * `src/orders/utils/order-number.ts`'s `generateOrderNumber` rather than
 * a shared/generalized import — this phase's rules forbid modifying
 * Phase 1–14 code unnecessarily, and broadening that function's
 * `'ORD' | 'VO'` type or moving it would touch tested Phase 13 code for
 * no functional benefit. Same reasoning/precedent, same collision-safety
 * argument (see that file's doc-comment): 48 bits of entropy plus the
 * existing `paymentNumber`/`refundNumber` `@unique` constraints as the
 * final backstop, per docs/database/payment-refund.md §5/§30's identical
 * "not COUNT(*)+1" requirement.
 */
export function generateIdentifier(prefix: 'PAY' | 'REF'): string {
  const year = new Date().getUTCFullYear();
  const suffix = randomBytes(6).toString('hex').toUpperCase();

  return `${prefix}-${year}-${suffix}`;
}

/**
 * Generates an internal placeholder "gateway reference" — the value a
 * real payment gateway would normally assign when a transaction is
 * initiated (docs/database/payment-refund.md §16: "External gateways
 * typically provide transaction identifiers... stored for
 * reconciliation, refund requests, customer support, webhook
 * correlation"). No real gateway integration exists in this phase (see
 * PaymentsService's doc-comment), so this stands in for that value and
 * is what the webhook foundation correlates incoming events against.
 */
export function generateProviderReference(): string {
  return `ref_${randomBytes(16).toString('hex')}`;
}
