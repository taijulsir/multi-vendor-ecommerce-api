import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const tx = {
    payment: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    paymentAttempt: { create: jest.fn() },
  };

  const prisma = {
    masterOrder: { findUnique: jest.fn() },
    payment: {
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    refund: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const authorizationService = { hasRole: jest.fn() };

  const makeOrder = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'master-order-uuid',
    userId: 'user-uuid',
    currency: 'BDT',
    totalAmount: new Prisma.Decimal('5000.00'),
    ...overrides,
  });

  const makePayment = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'payment-uuid',
    masterOrderId: 'master-order-uuid',
    paymentNumber: 'PAY-2026-ABCDEF012345',
    status: 'PENDING',
    method: 'CASH_ON_DELIVERY',
    currency: 'BDT',
    amount: new Prisma.Decimal('5000.00'),
    paidAmount: new Prisma.Decimal('0'),
    refundedAmount: new Prisma.Decimal('0'),
    provider: 'MANUAL',
    providerReference: null,
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: [],
    refunds: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    service = new PaymentsService(prisma as any, authorizationService as any);
  });

  describe('createForUser', () => {
    const dto = {
      masterOrderId: 'master-order-uuid',
      method: 'CASH_ON_DELIVERY' as const,
    };

    it('creates a payment and its first attempt, with amount/currency from the order', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(makeOrder());
      prisma.payment.count.mockResolvedValue(0);
      tx.payment.create.mockResolvedValue({ id: 'payment-uuid' });
      tx.paymentAttempt.create.mockResolvedValue({ id: 'attempt-uuid' });
      tx.payment.findUniqueOrThrow.mockResolvedValue(makePayment());

      const result = await service.createForUser('user-uuid', dto);

      expect(tx.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          masterOrderId: 'master-order-uuid',
          currency: 'BDT',
          amount: expect.any(Prisma.Decimal),
          method: 'CASH_ON_DELIVERY',
          provider: 'MANUAL',
        }),
      });
      expect(tx.paymentAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: 'payment-uuid',
          attemptNumber: 1,
          amount: expect.any(Prisma.Decimal),
          currency: 'BDT',
        }),
      });
      expect(result.id).toBe('payment-uuid');
    });

    it('never trusts a client-supplied amount/currency — both always come from the order', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(
        makeOrder({
          totalAmount: new Prisma.Decimal('9999.00'),
          currency: 'USD',
        }),
      );
      prisma.payment.count.mockResolvedValue(0);
      tx.payment.create.mockResolvedValue({ id: 'payment-uuid' });
      tx.paymentAttempt.create.mockResolvedValue({ id: 'attempt-uuid' });
      tx.payment.findUniqueOrThrow.mockResolvedValue(makePayment());

      await service.createForUser('user-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating spoofed fields
        amount: '1.00',
        currency: 'EUR',
      });

      const createCall = tx.payment.create.mock.calls[0][0];
      expect(createCall.data.amount.toFixed(2)).toBe('9999.00');
      expect(createCall.data.currency).toBe('USD');
    });

    it('rejects (403) an order belonging to another user', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(
        makeOrder({ userId: 'someone-else-uuid' }),
      );

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (403) a nonexistent order, identically to a real cross-user order', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects (409) when the order already has a payment', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(makeOrder());
      prisma.payment.count.mockResolvedValue(1);

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
      prisma.masterOrder.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.createForUser('user-uuid', dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('retry', () => {
    it('creates a new attempt on a FAILED payment and resets its status to PENDING', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: 'FAILED', masterOrder: { userId: 'user-uuid' } }),
      );
      tx.payment.findUniqueOrThrow
        .mockResolvedValueOnce({
          ...makePayment({ status: 'FAILED' }),
          attempts: [{ attemptNumber: 1 }],
        })
        .mockResolvedValueOnce(makePayment({ status: 'PENDING' }));
      tx.paymentAttempt.create.mockResolvedValue({ id: 'attempt-2-uuid' });
      tx.payment.update.mockResolvedValue({});

      const result = await service.retry('user-uuid', 'payment-uuid');

      expect(tx.paymentAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attemptNumber: 2 }),
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-uuid' },
        data: { status: 'PENDING' },
      });
      expect(result.status).toBe('PENDING');
    });

    it("rejects (403) another user's payment", async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          status: 'FAILED',
          masterOrder: { userId: 'someone-else-uuid' },
        }),
      );

      await expect(
        service.retry('user-uuid', 'payment-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (409) a payment that is not FAILED', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: 'PAID', masterOrder: { userId: 'user-uuid' } }),
      );

      await expect(
        service.retry('user-uuid', 'payment-uuid'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (409) a concurrent race that already moved the payment out of FAILED', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: 'FAILED', masterOrder: { userId: 'user-uuid' } }),
      );
      tx.payment.findUniqueOrThrow.mockResolvedValueOnce({
        ...makePayment({ status: 'PENDING' }),
        attempts: [],
      });

      await expect(
        service.retry('user-uuid', 'payment-uuid'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
      prisma.payment.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.retry('user-uuid', 'payment-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('findById', () => {
    it('returns the payment for its owner', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...makePayment(),
        masterOrder: { userId: 'user-uuid' },
      });

      const result = await service.findById('user-uuid', 'payment-uuid');

      expect(result.id).toBe('payment-uuid');
      expect(authorizationService.hasRole).not.toHaveBeenCalled();
    });

    it("rejects (403) another user's payment", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...makePayment(),
        masterOrder: { userId: 'someone-else-uuid' },
      });
      authorizationService.hasRole.mockResolvedValue(false);

      await expect(
        service.findById('user-uuid', 'payment-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("allows an ADMIN to view another user's payment", async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...makePayment(),
        masterOrder: { userId: 'someone-else-uuid' },
      });
      authorizationService.hasRole.mockResolvedValue(true);

      const result = await service.findById('admin-uuid', 'payment-uuid');

      expect(result.id).toBe('payment-uuid');
    });

    it('rejects (403) a nonexistent payment id', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.findById('user-uuid', 'nonexistent-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createRefund', () => {
    const dto = { amount: '500.00', reason: 'CUSTOMER_RETURN' as const };

    it('creates a refund when the amount is within the refundable balance', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          status: 'PAID',
          paidAmount: new Prisma.Decimal('5000.00'),
          refundedAmount: new Prisma.Decimal('0'),
        }),
      );
      prisma.refund.create.mockResolvedValue({
        id: 'refund-uuid',
        paymentId: 'payment-uuid',
        refundNumber: 'REF-2026-ABCDEF012345',
        status: 'PENDING',
        amount: new Prisma.Decimal('500.00'),
        currency: 'BDT',
        reason: 'CUSTOMER_RETURN',
        providerReference: 'ref_abc',
        processedAt: null,
        createdAt: new Date(),
      });

      const result = await service.createRefund(
        'admin-uuid',
        'payment-uuid',
        dto,
      );

      expect(prisma.refund.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: 'payment-uuid',
          currency: 'BDT',
          requestedBy: 'admin-uuid',
          reason: 'CUSTOMER_RETURN',
        }),
      });
      expect(result.id).toBe('refund-uuid');
    });

    it('never trusts a client-supplied currency — it always comes from the payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          currency: 'USD',
          paidAmount: new Prisma.Decimal('5000.00'),
        }),
      );
      prisma.refund.create.mockResolvedValue({
        id: 'refund-uuid',
        currency: 'USD',
        amount: new Prisma.Decimal('500.00'),
        refundNumber: 'REF-1',
        status: 'PENDING',
        reason: 'CUSTOMER_RETURN',
        providerReference: null,
        processedAt: null,
        createdAt: new Date(),
      });

      await service.createRefund('admin-uuid', 'payment-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating a spoofed field
        currency: 'EUR',
      });

      expect(prisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'USD' }),
        }),
      );
    });

    it('rejects (409) a refund amount exceeding the refundable balance', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          paidAmount: new Prisma.Decimal('400.00'),
          refundedAmount: new Prisma.Decimal('0'),
        }),
      );

      await expect(
        service.createRefund('admin-uuid', 'payment-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('rejects (409) a second refund that would push cumulative refunds past paidAmount', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          paidAmount: new Prisma.Decimal('600.00'),
          refundedAmount: new Prisma.Decimal('400.00'),
        }),
      );

      await expect(
        service.createRefund('admin-uuid', 'payment-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (400) a zero or negative refund amount', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ paidAmount: new Prisma.Decimal('5000.00') }),
      );

      await expect(
        service.createRefund('admin-uuid', 'payment-uuid', {
          ...dto,
          amount: '0',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.createRefund('admin-uuid', 'payment-uuid', {
          ...dto,
          amount: '-100',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a nonexistent payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.createRefund('admin-uuid', 'nonexistent-uuid', dto),
      ).rejects.toThrow();
    });

    it('propagates unrelated database errors', async () => {
      prisma.payment.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.createRefund('admin-uuid', 'payment-uuid', dto),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
