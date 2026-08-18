import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { VendorOrdersService } from './vendor-orders.service';

describe('VendorOrdersService', () => {
  let service: VendorOrdersService;

  const prisma = {
    vendorOrder: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
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

  beforeEach(() => {
    jest.clearAllMocks();
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

      await expect(
        service.findMyVendorOrders('user-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
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

      await expect(
        service.findById('unknown-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
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
});
