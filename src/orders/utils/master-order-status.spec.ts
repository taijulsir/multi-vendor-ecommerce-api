import { deriveMasterOrderStatus } from './master-order-status';

describe('deriveMasterOrderStatus', () => {
  describe('single-vendor orders', () => {
    it('PENDING → PENDING', () => {
      expect(deriveMasterOrderStatus(['PENDING'])).toBe('PENDING');
    });

    it('CONFIRMED → CONFIRMED', () => {
      expect(deriveMasterOrderStatus(['CONFIRMED'])).toBe('CONFIRMED');
    });

    it.each(['PROCESSING', 'READY_TO_SHIP', 'SHIPPED'] as const)(
      '%s → PROCESSING',
      (status) => {
        expect(deriveMasterOrderStatus([status])).toBe('PROCESSING');
      },
    );

    it('DELIVERED → FULFILLED', () => {
      expect(deriveMasterOrderStatus(['DELIVERED'])).toBe('FULFILLED');
    });

    it('CANCELLED → CANCELLED', () => {
      expect(deriveMasterOrderStatus(['CANCELLED'])).toBe('CANCELLED');
    });
  });

  describe('multi-vendor orders', () => {
    it('all DELIVERED → FULFILLED', () => {
      expect(
        deriveMasterOrderStatus(['DELIVERED', 'DELIVERED', 'DELIVERED']),
      ).toBe('FULFILLED');
    });

    it('some DELIVERED, some not → PARTIALLY_FULFILLED', () => {
      expect(deriveMasterOrderStatus(['DELIVERED', 'PROCESSING'])).toBe(
        'PARTIALLY_FULFILLED',
      );
    });

    it('some DELIVERED, some still PENDING → PARTIALLY_FULFILLED', () => {
      expect(deriveMasterOrderStatus(['DELIVERED', 'PENDING'])).toBe(
        'PARTIALLY_FULFILLED',
      );
    });

    it('all CANCELLED → CANCELLED', () => {
      expect(deriveMasterOrderStatus(['CANCELLED', 'CANCELLED'])).toBe(
        'CANCELLED',
      );
    });

    it('one DELIVERED and one CANCELLED (cancelled sibling excluded as "relevant") → PARTIALLY_FULFILLED, not FULFILLED', () => {
      // Only one *active* (non-cancelled) sibling and it is DELIVERED, but
      // per this function's documented assumption a cancelled sibling
      // still counts as "not delivered" for the PARTIALLY_FULFILLED vs.
      // FULFILLED distinction — see its doc-comment rule 2.
      // With exactly one active sibling and it being DELIVERED, rule 3
      // ("every active is DELIVERED") applies: FULFILLED.
      expect(deriveMasterOrderStatus(['DELIVERED', 'CANCELLED'])).toBe(
        'FULFILLED',
      );
    });

    it('one DELIVERED, one CANCELLED, one still PROCESSING → PARTIALLY_FULFILLED', () => {
      expect(
        deriveMasterOrderStatus(['DELIVERED', 'CANCELLED', 'PROCESSING']),
      ).toBe('PARTIALLY_FULFILLED');
    });

    it('mixed PENDING + CONFIRMED, none delivered → CONFIRMED is not reached; least-advanced (PENDING) wins', () => {
      expect(deriveMasterOrderStatus(['PENDING', 'CONFIRMED'])).toBe('PENDING');
    });

    it('mixed CONFIRMED + PROCESSING, none delivered → least-advanced (CONFIRMED) wins', () => {
      expect(deriveMasterOrderStatus(['CONFIRMED', 'PROCESSING'])).toBe(
        'CONFIRMED',
      );
    });

    it('mixed PROCESSING + SHIPPED, none delivered → PROCESSING (both collapse to the same rank)', () => {
      expect(deriveMasterOrderStatus(['PROCESSING', 'SHIPPED'])).toBe(
        'PROCESSING',
      );
    });

    it('one CANCELLED, one still PENDING (none delivered) → PENDING, derived only from the active sibling', () => {
      expect(deriveMasterOrderStatus(['CANCELLED', 'PENDING'])).toBe('PENDING');
    });

    it('three vendors: PENDING, CONFIRMED, DELIVERED → PARTIALLY_FULFILLED (at least one delivered, not all)', () => {
      expect(
        deriveMasterOrderStatus(['PENDING', 'CONFIRMED', 'DELIVERED']),
      ).toBe('PARTIALLY_FULFILLED');
    });
  });
});
