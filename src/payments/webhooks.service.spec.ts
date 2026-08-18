import { Prisma } from '../generated/prisma/client';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const tx = {
    paymentAttempt: { update: jest.fn() },
    payment: { update: jest.fn() },
    masterOrder: { update: jest.fn() },
    paymentWebhookEvent: { update: jest.fn() },
    refund: { update: jest.fn() },
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
    prisma.paymentWebhookEvent.create.mockResolvedValue({ id: 'webhook-event-uuid' });
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
        payment: { amount: new Prisma.Decimal('5000.00'), masterOrderId: 'master-order-uuid' },
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
        paidAmount: new Prisma.Decimal('5000.00'),
        refundedAmount: new Prisma.Decimal('0'),
        masterOrderId: 'master-order-uuid',
      },
    };

    it('marks PARTIALLY_REFUNDED when the cumulative refund is less than paidAmount', async () => {
      prisma.refund.findFirst.mockResolvedValue(refund);

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.succeeded',
      });

      expect(tx.refund.update).toHaveBeenCalledWith({
        where: { id: 'refund-uuid' },
        data: { status: 'SUCCEEDED', processedAt: expect.any(Date) },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-uuid' },
        data: expect.objectContaining({ status: 'PARTIALLY_REFUNDED' }),
      });
      expect(tx.masterOrder.update).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid' },
        data: { paymentStatus: 'PARTIALLY_REFUNDED' },
      });
      expect(result).toEqual({ status: 'processed' });
    });

    it('marks REFUNDED when the cumulative refund reaches paidAmount', async () => {
      prisma.refund.findFirst.mockResolvedValue({
        ...refund,
        amount: new Prisma.Decimal('5000.00'),
      });

      await service.processEvent({ ...baseDto, eventType: 'refund.succeeded' });

      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-uuid' },
        data: expect.objectContaining({ status: 'REFUNDED' }),
      });
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

    it('never re-increments refundedAmount when the refund was already resolved (idempotency by value, Phase 16)', async () => {
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
          paidAmount: new Prisma.Decimal('5000.00'),
          refundedAmount: new Prisma.Decimal('0'),
          masterOrderId: 'master-order-uuid',
        },
      });

      const result = await service.processEvent({
        ...baseDto,
        eventType: 'refund.failed',
      });

      expect(tx.refund.update).toHaveBeenCalledWith({
        where: { id: 'refund-uuid' },
        data: { status: 'FAILED', processedAt: expect.any(Date) },
      });
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.masterOrder.update).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'processed' });
    });
  });
});
