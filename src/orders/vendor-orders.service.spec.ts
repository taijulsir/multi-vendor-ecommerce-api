import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { deriveMasterOrderStatus } from './utils/master-order-status';
import { VendorOrdersService } from './vendor-orders.service';

describe('VendorOrdersService', () => {
  let service: VendorOrdersService;

  const tx = {
    vendorOrder: {
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
    },
    vendorOrderStatusHistory: { create: jest.fn() },
    masterOrder: {
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    orderStatusHistory: { create: jest.fn() },
  };

  const prisma = {
    vendorOrder: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
  };

  const makeVendorOrder = (
    overrides: Partial<Record<string, unknown>> = {},
  ) => ({
    id: 'vendor-order-uuid',
    masterOrderId: 'master-order-uuid',
    vendorId: 'vendor-uuid',
    orderNumber: 'VO-2026-ABCDEF012345',
    status: 'PENDING',
    subtotal: new Prisma.Decimal('5000.00'),
    discountAmount: new Prisma.Decimal('0'),
    shippingAmount: new Prisma.Decimal('0'),
    taxAmount: new Prisma.Decimal('0'),
    commissionAmount: new Prisma.Decimal('0'),
    vendorNetAmount: new Prisma.Decimal('0'),
    totalAmount: new Prisma.Decimal('5000.00'),
    trackingNumber: null,
    shippingProvider: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    ...overrides,
  });

  const makeMasterOrder = (
    overrides: Partial<Record<string, unknown>> = {},
  ) => ({
    id: 'master-order-uuid',
    status: 'PENDING',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    service = new VendorOrdersService(prisma as any, ownershipService as any);
  });

  describe('findMyVendorOrders', () => {
    it("returns the caller's own vendor orders, including commission/vendorNet fields", async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.vendorOrder.findMany.mockResolvedValue([makeVendorOrder()]);

      const result = await service.findMyVendorOrders('user-uuid');

      expect(prisma.vendorOrder.findMany).toHaveBeenCalledWith({
        where: { vendorId: 'vendor-uuid' },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].commissionAmount).toBe('0.00');
      expect(result[0].vendorNetAmount).toBe('0.00');
      expect(result[0].masterOrderId).toBe('master-order-uuid');
    });

    it('rejects (403) a caller with no vendor profile', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);

      await expect(
        service.findMyVendorOrders('user-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.vendorOrder.findMany).not.toHaveBeenCalled();
    });

    it('propagates database errors', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.vendorOrder.findMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.findMyVendorOrders('user-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('findById', () => {
    it('returns the full vendor order (ownership already enforced by the guard chain)', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(makeVendorOrder());

      const result = await service.findById('vendor-order-uuid');

      expect(result.id).toBe('vendor-order-uuid');
      expect(result.commissionAmount).toBe('0.00');
    });

    it('throws NotFoundException when the vendor order does not exist (e.g. ADMIN bypass, no prior existence check)', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(null);

      await expect(service.findById('unknown-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('propagates database errors', async () => {
      prisma.vendorOrder.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.findById('vendor-order-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('updateStatus', () => {
    const vendorOrderId = 'vendor-order-uuid';
    const actorUserId = 'vendor-user-uuid';

    // Single-sibling VendorOrder scenarios throughout this describe block:
    // the sibling-list read inside recomputeMasterOrderStatus returns just
    // the one VendorOrder being updated, at its *new* status (the update
    // already committed by the time this read runs, in the same
    // transaction). Priming the mocked MasterOrder's *current* status to
    // already equal `deriveMasterOrderStatus([to])` makes recomputation a
    // genuine no-op for tests that aren't specifically about derivation,
    // instead of an accidental, unmocked `masterOrder.updateMany` call.
    const setupNoOpMasterOrderRecompute = (to: string) => {
      tx.vendorOrder.findMany.mockResolvedValue([{ status: to }]);
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({ status: deriveMasterOrderStatus([to as never]) }),
      );
    };

    it.each([
      ['PENDING', 'CONFIRMED'],
      ['CONFIRMED', 'PROCESSING'],
      ['PROCESSING', 'READY_TO_SHIP'],
      ['READY_TO_SHIP', 'SHIPPED'],
      ['SHIPPED', 'DELIVERED'],
      ['PENDING', 'CANCELLED'],
      ['CONFIRMED', 'CANCELLED'],
    ])('allows %s → %s', async (from, to) => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: from }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: to }),
      );
      setupNoOpMasterOrderRecompute(to);

      const result = await service.updateStatus(
        vendorOrderId,
        { status: to as any },
        actorUserId,
      );

      expect(result.status).toBe(to);
      expect(tx.vendorOrder.updateMany).toHaveBeenCalledWith({
        where: { id: vendorOrderId, status: from },
        data: expect.objectContaining({ status: to }) as unknown,
      });
      expect(tx.vendorOrderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          vendorOrderId,
          fromStatus: from,
          toStatus: to,
          changedBy: actorUserId,
        },
      });
    });

    it.each([
      ['PENDING', 'PROCESSING'],
      ['PENDING', 'DELIVERED'],
      ['CONFIRMED', 'READY_TO_SHIP'],
      ['PROCESSING', 'CANCELLED'],
      ['SHIPPED', 'CANCELLED'],
      ['DELIVERED', 'CONFIRMED'],
      ['CANCELLED', 'CONFIRMED'],
      ['DELIVERED', 'DELIVERED'],
      ['CANCELLED', 'CANCELLED'],
    ])(
      'rejects (409) the undocumented transition %s → %s',
      async (from, to) => {
        prisma.vendorOrder.findUnique.mockResolvedValue(
          makeVendorOrder({ status: from }),
        );

        await expect(
          service.updateStatus(
            vendorOrderId,
            { status: to as any },
            actorUserId,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(tx.vendorOrder.updateMany).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException for a nonexistent vendor order', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          vendorOrderId,
          { status: 'CONFIRMED' },
          actorUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (409) when a concurrent request already changed the VendorOrder status (updateMany affects 0 rows)', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'PENDING' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateStatus(
          vendorOrderId,
          { status: 'CONFIRMED' },
          actorUserId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.vendorOrderStatusHistory.create).not.toHaveBeenCalled();
    });

    it('sets shippedAt when transitioning to SHIPPED', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'READY_TO_SHIP' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: 'SHIPPED' }),
      );
      setupNoOpMasterOrderRecompute('SHIPPED');

      await service.updateStatus(
        vendorOrderId,
        { status: 'SHIPPED' },
        actorUserId,
      );

      expect(tx.vendorOrder.updateMany).toHaveBeenCalledWith({
        where: { id: vendorOrderId, status: 'READY_TO_SHIP' },
        data: { status: 'SHIPPED', shippedAt: expect.any(Date) as unknown },
      });
    });

    it('sets deliveredAt when transitioning to DELIVERED and derives MasterOrder to FULFILLED for a single-vendor order', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'SHIPPED' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: 'DELIVERED' }),
      );
      tx.vendorOrder.findMany.mockResolvedValue([{ status: 'DELIVERED' }]);
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({ status: 'PROCESSING' }),
      );
      tx.masterOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.updateStatus(
        vendorOrderId,
        { status: 'DELIVERED' },
        actorUserId,
      );

      expect(tx.vendorOrder.updateMany).toHaveBeenCalledWith({
        where: { id: vendorOrderId, status: 'SHIPPED' },
        data: { status: 'DELIVERED', deliveredAt: expect.any(Date) as unknown },
      });
      expect(tx.masterOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid', status: 'PROCESSING' },
        data: { status: 'FULFILLED' },
      });
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          masterOrderId: 'master-order-uuid',
          fromStatus: 'PROCESSING',
          toStatus: 'FULFILLED',
          changedBy: actorUserId,
        },
      });
    });

    it('sets cancelledAt on both VendorOrder and MasterOrder when derivation reaches CANCELLED', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'PENDING' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: 'CANCELLED' }),
      );
      tx.vendorOrder.findMany.mockResolvedValue([{ status: 'CANCELLED' }]);
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({ status: 'PENDING' }),
      );
      tx.masterOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.updateStatus(
        vendorOrderId,
        { status: 'CANCELLED' },
        actorUserId,
      );

      expect(tx.masterOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'master-order-uuid', status: 'PENDING' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) as unknown },
      });
    });

    it('does not write a MasterOrder update or OrderStatusHistory row when the derived status is unchanged', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'PENDING' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: 'CONFIRMED' }),
      );
      tx.vendorOrder.findMany.mockResolvedValue([{ status: 'CONFIRMED' }]);
      // Already CONFIRMED — derivation of a single CONFIRMED sibling is
      // also CONFIRMED, so nothing changes.
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({ status: 'CONFIRMED' }),
      );

      await service.updateStatus(
        vendorOrderId,
        { status: 'CONFIRMED' },
        actorUserId,
      );

      expect(tx.masterOrder.updateMany).not.toHaveBeenCalled();
      expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    });

    it('retries MasterOrder recomputation when a sibling VendorOrder concurrently changed it first (updateMany affects 0 rows once, then succeeds)', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue(
        makeVendorOrder({ status: 'SHIPPED' }),
      );
      tx.vendorOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.vendorOrder.findUniqueOrThrow.mockResolvedValue(
        makeVendorOrder({ status: 'DELIVERED' }),
      );
      tx.vendorOrder.findMany.mockResolvedValue([{ status: 'DELIVERED' }]);
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({ status: 'PROCESSING' }),
      );
      // First attempt loses the race (a sibling's own concurrent update
      // already changed MasterOrder.status), second attempt succeeds.
      tx.masterOrder.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      await service.updateStatus(
        vendorOrderId,
        { status: 'DELIVERED' },
        actorUserId,
      );

      expect(tx.masterOrder.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
    });

    it('propagates unrelated database errors', async () => {
      prisma.vendorOrder.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.updateStatus(
          vendorOrderId,
          { status: 'CONFIRMED' },
          actorUserId,
        ),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
