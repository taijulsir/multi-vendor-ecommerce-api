import { ForbiddenException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const prisma = {
    masterOrder: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const authorizationService = {
    hasRole: jest.fn(),
  };

  const makeOrder = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'master-order-uuid',
    orderNumber: 'ORD-2026-ABCDEF012345',
    userId: 'user-uuid',
    status: 'PENDING',
    currency: 'BDT',
    subtotal: new Prisma.Decimal('5000.00'),
    discountAmount: new Prisma.Decimal('0'),
    shippingAmount: new Prisma.Decimal('0'),
    taxAmount: new Prisma.Decimal('0'),
    serviceFee: new Prisma.Decimal('0'),
    totalAmount: new Prisma.Decimal('5000.00'),
    paymentStatus: 'PENDING',
    shippingAddressSnapshot: { fullName: 'Jane Doe' },
    billingAddressSnapshot: { fullName: 'Jane Doe' },
    customerNote: null,
    placedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    cancelledAt: null,
    vendorOrders: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrdersService(prisma as any, authorizationService as any);
  });

  describe('findMyOrders', () => {
    it("returns the caller's own orders, newest first, mapped to the view shape", async () => {
      prisma.masterOrder.findMany.mockResolvedValue([makeOrder()]);

      const result = await service.findMyOrders('user-uuid');

      expect(prisma.masterOrder.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid' },
        include: { vendorOrders: { include: { items: true } } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('master-order-uuid');
      expect(result[0].totalAmount).toBe('5000.00');
    });

    it('never uses anything but the passed userId parameter to scope the query', async () => {
      prisma.masterOrder.findMany.mockResolvedValue([]);

      await service.findMyOrders('authenticated-user-uuid');

      expect(prisma.masterOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'authenticated-user-uuid' },
        }),
      );
    });
  });

  describe('findMyOrderById', () => {
    it('returns the order when it belongs to the caller', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(makeOrder());

      const result = await service.findMyOrderById(
        'user-uuid',
        'master-order-uuid',
      );

      expect(result.id).toBe('master-order-uuid');
      expect(authorizationService.hasRole).not.toHaveBeenCalled();
    });

    it("rejects (403) an order belonging to another user", async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(
        makeOrder({ userId: 'someone-else-uuid' }),
      );
      authorizationService.hasRole.mockResolvedValue(false);

      await expect(
        service.findMyOrderById('user-uuid', 'master-order-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects (403) a nonexistent order id, identically to a real cross-user order', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.findMyOrderById('user-uuid', 'nonexistent-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Never even asks about ADMIN for a nonexistent order.
      expect(authorizationService.hasRole).not.toHaveBeenCalled();
    });

    it('allows an ADMIN to view an order belonging to another user (documented bypass)', async () => {
      prisma.masterOrder.findUnique.mockResolvedValue(
        makeOrder({ userId: 'someone-else-uuid' }),
      );
      authorizationService.hasRole.mockResolvedValue(true);

      const result = await service.findMyOrderById(
        'admin-uuid',
        'master-order-uuid',
      );

      expect(result.id).toBe('master-order-uuid');
      expect(authorizationService.hasRole).toHaveBeenCalledWith(
        'admin-uuid',
        'ADMIN',
      );
    });

    it('propagates database errors', async () => {
      prisma.masterOrder.findUnique.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.findMyOrderById('user-uuid', 'master-order-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
