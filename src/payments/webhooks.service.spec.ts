import { Prisma } from '../generated/prisma/client';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const tx = {
    paymentAttempt: { update: jest.fn() },
    payment: { update: jest.fn() },
    masterOrder: { update: jest.fn() },
    paymentWebhookEvent: { update: jest.fn() },
    refund: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const prisma = {
    paymentWebhookEvent: {
      create: jest.fn(),
      update: jest.fn(),
    },
    paymentAttempt: { findFirst: jest.fn() },
    refund: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const baseDto = {
    provider: 'MANUAL',
    eventId: 'evt-1',
    eventType: 'payment.succeeded',
    providerReference: 'ref_abc123',
    payload: { note: 'test' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    prisma.paymentWebhookEvent.create.mockResolvedValue({
      id: 'webhook-event-uuid',
    });
    tx.refund.updateMany.mockResolvedValue({ count: 1 });
    tx.$queryRaw.mockResolvedValue([
      { id: 'payment-uuid', status: 'PARTIALLY_REFUNDED' },
    ]);
    service = new WebhooksService(prisma as any);
  });

  describe('idempotency', () => {
    it('returns duplicate and skips all processing when the (provider, eventId) already exists', async () => {
      prisma.paymentWebhookEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.processEvent(baseDto);

      expect(result).toEqual({ status: 'duplicate' });
      expect(prisma.paymentAttempt.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors from event creation', async () => {
      prisma.paymentWebhookEvent.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.processEvent(baseDto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('unrecognized event types', () => {
    it('marks the event IGNORED and does not touch any Payment/Refund state', async () => {
      const result = await service.processEvent({
        ...baseDto,
        eventType: 'charge.dispute.created',
      });

      expect(result).toEqual({ status: 'ignored' });
      expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: { status: 'IGNORED', processedAt: expect.any(Date) },
      });
      expect(prisma.paymentAttempt.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('payment.succeeded', () => {
    const attempt = {
      id: 'attempt-uuid',
      paymentId: 'payment-uuid',
      providerReference: 'ref_abc123',
      status: 'INITIATED',
      payment: {
        amount: new Prisma.Decimal('5000.00'),
        masterOrderId: 'master-order-uuid',
      },
    };

    it('marks the attempt SUCCEEDED, the payment PAID, and syncs MasterOrder.paymentStatus', async () => {
      prisma.paymentAttempt.findFirst.mockResolvedValue(attempt);

      const result = await service.processEvent(baseDto);

      expect(tx.paymentAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-uuid' },
        data: { status: 'SUCCEEDED', completedAt: expect.any(Date) },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-uuid' },
        data: expect.objectContaining({
          status: 'PAID',
          paidAmount: attempt.payment.amount,
        }),
      });
      expect(tx.masterOrder.update).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid' },
        data: { paymentStatus: 'PAID' },
      });
      expect(tx.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date) },
      });
      expect(result).toEqual({ status: 'processed' });
    });

    it('never touches MasterOrder.status, only paymentStatus', async () => {
      prisma.paymentAttempt.findFirst.mockResolvedValue(attempt);

      await service.processEvent(baseDto);

      const call = tx.masterOrder.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('status');
      expect(Object.keys(call.data)).toEqual(['paymentStatus']);
    });

    it('marks the event FAILED with a reason and returns unmatched when no attempt correlates', async () => {
      prisma.paymentAttempt.findFirst.mockResolvedValue(null);

      const result = await service.processEvent(baseDto);

      expect(result).toEqual({ status: 'unmatched' });
      expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: expect.any(String),
        }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns unmatched when providerReference is missing', async () => {
      const result = await service.processEvent({
        ...baseDto,
        providerReference: undefined,
      });

      expect(result).toEqual({ status: 'unmatched' });
      expect(prisma.paymentAttempt.findFirst).not.toHaveBeenCalled();
    });

    it('never re-applies the financial effect when the attempt was already resolved (idempotency by value, Phase 16)', async () => {
      prisma.paymentAttempt.findFirst.mockResolvedValue({
        ...attempt,
        status: 'SUCCEEDED',
      });

      const result = await service.processEvent(baseDto);

      expect(result).toEqual({ status: 'duplicate' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: expect.objectContaining({ status: 'IGNORED' }),
      });
    });
  });

  describe('payment.failed', () => {
    it('marks the attempt FAILED and the payment FAILED, syncing MasterOrder.paymentStatus', async () => {
      prisma.paymentAttempt.findFirst.mockResolvedValue({
        id: 'attempt-uuid',
        paymentId: 'payment-uuid',
        providerReference: 'ref_abc123',
        status: 'INITIATED',
        payment: {
          amount: new Prisma.Decimal('5000.00'),
          masterOrderId: 'master-order-uuid',
        },
      });

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'payment.failed',
      });

      expect(tx.paymentAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-uuid' },
        data: { status: 'FAILED', completedAt: expect.any(Date) },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-uuid' },
        data: { status: 'FAILED' },
      });
      expect(tx.masterOrder.update).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid' },
        data: { paymentStatus: 'FAILED' },
      });
      expect(result).toEqual({ status: 'processed' });
    });
  });

  describe('refund.succeeded', () => {
    const refund = {
      id: 'refund-uuid',
      paymentId: 'payment-uuid',
      amount: new Prisma.Decimal('500.00'),
      providerReference: 'ref_abc123',
      status: 'PENDING',
      payment: {
        masterOrderId: 'master-order-uuid',
      },
    };

    it('atomically transitions the refund via a conditional updateMany (docs/final-system-audit.md M-1)', async () => {
      prisma.refund.findFirst.mockResolvedValue(refund);

      await service.processEvent({ ...baseDto, eventType: 'refund.succeeded' });

      expect(tx.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-uuid', status: 'PENDING' },
        data: { status: 'SUCCEEDED', processedAt: expect.any(Date) },
      });
    });

    it('accumulates refundedAmount via an atomic SQL increment, never a read-then-absolute-set (M-1 fix)', async () => {
      prisma.refund.findFirst.mockResolvedValue(refund);
      tx.$queryRaw.mockResolvedValue([
        { id: 'payment-uuid', status: 'PARTIALLY_REFUNDED' },
      ]);

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.succeeded',
      });

      // The raw query is a tagged-template call: first arg is the
      // strings array, remaining args are the interpolated values in
      // order — asserting on those values (not the SQL text) proves the
      // increment uses the refund's own amount and targets the right
      // payment, without coupling the test to incidental formatting.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const interpolatedValues = tx.$queryRaw.mock.calls[0].slice(1);
      expect(interpolatedValues).toContain(refund.amount);
      expect(interpolatedValues).toContain(refund.paymentId);

      expect(tx.masterOrder.update).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid' },
        data: { paymentStatus: 'PARTIALLY_REFUNDED' },
      });
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'processed' });
    });

    it('syncs MasterOrder.paymentStatus to REFUNDED when the atomic update reports the cumulative refund reached paidAmount', async () => {
      prisma.refund.findFirst.mockResolvedValue(refund);
      tx.$queryRaw.mockResolvedValue([
        { id: 'payment-uuid', status: 'REFUNDED' },
      ]);

      await service.processEvent({ ...baseDto, eventType: 'refund.succeeded' });

      expect(tx.masterOrder.update).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid' },
        data: { paymentStatus: 'REFUNDED' },
      });
    });

    it('returns unmatched when no refund correlates', async () => {
      prisma.refund.findFirst.mockResolvedValue(null);

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.succeeded',
      });

      expect(result).toEqual({ status: 'unmatched' });
    });

    it('never re-applies the financial effect when the refund was already resolved (fast-path idempotency by value, Phase 16)', async () => {
      prisma.refund.findFirst.mockResolvedValue({
        ...refund,
        status: 'SUCCEEDED',
      });

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.succeeded',
      });

      expect(result).toEqual({ status: 'duplicate' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: expect.objectContaining({ status: 'IGNORED' }),
      });
    });

    it('never re-applies the financial effect when the atomic conditional transition affects 0 rows (M-1: the true concurrency guard, not just the fast-path check)', async () => {
      // Simulates the exact race this fix closes: the fast-path
      // `refund.status !== 'PENDING'` check (based on a pre-transaction
      // read) sees PENDING, but a concurrent transaction already flipped
      // it by the time this transaction's own conditional updateMany
      // runs — affecting 0 rows.
      prisma.refund.findFirst.mockResolvedValue(refund);
      tx.refund.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.succeeded',
      });

      expect(result).toEqual({ status: 'duplicate' });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.masterOrder.update).not.toHaveBeenCalled();
      expect(prisma.paymentWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'webhook-event-uuid' },
        data: expect.objectContaining({
          status: 'IGNORED',
          errorMessage: expect.stringContaining('already resolved'),
        }),
      });
    });
  });

  describe('refund.failed', () => {
    it('marks the refund FAILED without touching Payment/MasterOrder state', async () => {
      prisma.refund.findFirst.mockResolvedValue({
        id: 'refund-uuid',
        paymentId: 'payment-uuid',
        amount: new Prisma.Decimal('500.00'),
        providerReference: 'ref_abc123',
        status: 'PENDING',
        payment: {
          masterOrderId: 'master-order-uuid',
        },
      });

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.failed',
      });

      expect(tx.refund.updateMany).toHaveBeenCalledWith({
        where: { id: 'refund-uuid', status: 'PENDING' },
        data: { status: 'FAILED', processedAt: expect.any(Date) },
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.masterOrder.update).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'processed' });
    });
  });
});
