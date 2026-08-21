import type {
  MasterOrderStatus,
  VendorOrderStatus,
} from '../../generated/prisma/client';

/**
 * `MasterOrder.status` derivation from its child `VendorOrder` statuses
 * (Phase 19, ADR-3 — docs/remaining-architecture-plan.md's Architecture
 * Decision Register). ADR-3 approves the *principle* (derived, never
 * client-settable) and the two clearly-defined aggregate cases
 * ("all relevant children DELIVERED → FULFILLED", "some but not all →
 * PARTIALLY_FULFILLED") verbatim, but explicitly leaves the precise
 * bucket-by-bucket mapping for every other combination as "an
 * implementation detail for Phase 19 to define consistently with this
 * approved principle" — this function is that implementation, and every
 * rule below is written out explicitly so the choice is reviewable.
 *
 * Rules, in order:
 *
 * 1. Every VendorOrder is CANCELLED → CANCELLED. (ADR-3: "MasterOrder →
 *    CANCELLED remains scoped to the case where every child VendorOrder"
 *    has reached that state — never derived from only some being
 *    cancelled.)
 * 2. Otherwise, CANCELLED siblings are excluded from the remaining
 *    computation — they are the "relevant" filter ADR-3's own wording
 *    implies ("all *relevant* child VendorOrders at DELIVERED"): a
 *    cancelled line shouldn't prevent the rest of a multi-vendor order
 *    from being considered fulfilled once every *active* vendor has
 *    delivered. (At least one non-cancelled sibling always remains here,
 *    since rule 1 already handled the all-cancelled case.)
 * 3. Every remaining (active) VendorOrder is DELIVERED → FULFILLED.
 * 4. At least one active VendorOrder is DELIVERED, but not all →
 *    PARTIALLY_FULFILLED.
 * 5. No active VendorOrder has reached DELIVERED yet → the *least*
 *    advanced active VendorOrder determines the aggregate ("weakest
 *    link": the complete order isn't considered to have moved to a
 *    stage until every vendor has), using the same PENDING < CONFIRMED <
 *    {PROCESSING, READY_TO_SHIP, SHIPPED} ordering ADR-3 names — the
 *    three intermediate VendorOrderStatus values collapse into
 *    MasterOrderStatus.PROCESSING because MasterOrderStatus has no
 *    separate "ready to ship"/"shipped" bucket of its own.
 *
 * `RETURN_REQUESTED`/`RETURNED` never appear here — Phase 19 does not
 * implement any transition that reaches them (ADR-2 explicitly excludes
 * them from this MVP), so they are not given a case; if one is ever
 * present it is treated the same as CANCELLED (excluded from the active
 * set) rather than crashing, since it is equally "not delivered and not
 * still progressing" from this function's point of view.
 */
export function deriveMasterOrderStatus(
  vendorOrderStatuses: VendorOrderStatus[],
): MasterOrderStatus {
  const isTerminalInactive = (status: VendorOrderStatus): boolean =>
    status === 'CANCELLED' ||
    status === 'RETURN_REQUESTED' ||
    status === 'RETURNED';

  if (vendorOrderStatuses.every(isTerminalInactive)) {
    return 'CANCELLED';
  }

  const active = vendorOrderStatuses.filter(
    (status) => !isTerminalInactive(status),
  );

  if (active.every((status) => status === 'DELIVERED')) {
    return 'FULFILLED';
  }

  if (active.some((status) => status === 'DELIVERED')) {
    return 'PARTIALLY_FULFILLED';
  }

  const rank: Record<
    Exclude<
      VendorOrderStatus,
      'DELIVERED' | 'CANCELLED' | 'RETURN_REQUESTED' | 'RETURNED'
    >,
    number
  > = {
    PENDING: 0,
    CONFIRMED: 1,
    PROCESSING: 2,
    READY_TO_SHIP: 2,
    SHIPPED: 2,
  };

  const minRank = Math.min(
    ...active.map(
      (status) =>
        rank[
          status as Exclude<
            VendorOrderStatus,
            'DELIVERED' | 'CANCELLED' | 'RETURN_REQUESTED' | 'RETURNED'
          >
        ],
    ),
  );

  if (minRank === 0) return 'PENDING';
  if (minRank === 1) return 'CONFIRMED';
  return 'PROCESSING';
}
