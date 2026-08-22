import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;

  const tx = {
    inventory: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    $executeRaw: jest.fn(),
  };

  const prisma = {
    productVariant: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const makeInventory = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'inventory-uuid',
    variantId: 'variant-uuid',
    onHand: 100,
    reserved: 20,
    lowStockThreshold: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    service = new InventoryService(prisma as any);
  });

  describe('findForVariant', () => {
    it('returns the inventory with a computed available field', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory(),
      });

      const result = await service.findForVariant(
        'product-uuid',
        'variant-uuid',
      );

      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'variant-uuid',
          productId: 'product-uuid',
          deletedAt: null,
        },
        include: { inventory: true },
      });
      expect(result.available).toBe(80);
      expect(result.onHand).toBe(100);
      expect(result.reserved).toBe(20);
    });

    it('throws NotFoundException when the variant does not exist', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.findForVariant('product-uuid', 'unknown-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the variant has no Inventory row (should not happen, but handled)', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: null,
      });

      await expect(
        service.findForVariant('product-uuid', 'variant-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('restock', () => {
    it('increments onHand and records a RESTOCK transaction', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory({ onHand: 100 }),
      });
      tx.inventory.update.mockResolvedValue(makeInventory({ onHand: 120 }));

      const result = await service.restock(
        'product-uuid',
        'variant-uuid',
        { quantity: 20, note: 'Received shipment' },
        'vendor-user-uuid',
      );

      expect(tx.inventory.update).toHaveBeenCalledWith({
        where: { id: 'inventory-uuid' },
        data: { onHand: { increment: 20 } },
      });
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
        data: {
          inventoryId: 'inventory-uuid',
          type: 'RESTOCK',
          quantity: 20,
          note: 'Received shipment',
          createdBy: 'vendor-user-uuid',
        },
      });
      expect(result.onHand).toBe(120);
    });

    it('throws NotFoundException for a variant belonging to a different product', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.restock(
          'product-uuid',
          'other-products-variant-uuid',
          { quantity: 10 },
          'vendor-user-uuid',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory(),
      });
      prisma.$transaction.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.restock(
          'product-uuid',
          'variant-uuid',
          { quantity: 10 },
          'vendor-user-uuid',
        ),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('adjust', () => {
    it('applies a positive delta and records an ADJUSTMENT transaction', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory({ onHand: 100, reserved: 20 }),
      });
      tx.$executeRaw.mockResolvedValue(1);
      tx.inventory.findUniqueOrThrow.mockResolvedValue(
        makeInventory({ onHand: 105 }),
      );

      const result = await service.adjust(
        'product-uuid',
        'variant-uuid',
        { delta: 5, note: 'Recount' },
        'vendor-user-uuid',
      );

      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
        data: {
          inventoryId: 'inventory-uuid',
          type: 'ADJUSTMENT',
          quantity: 5,
          note: 'Recount',
          createdBy: 'vendor-user-uuid',
        },
      });
      expect(result.onHand).toBe(105);
    });

    it('applies a negative delta when it keeps onHand >= 0 and >= reserved', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory({ onHand: 100, reserved: 20 }),
      });
      tx.$executeRaw.mockResolvedValue(1);
      tx.inventory.findUniqueOrThrow.mockResolvedValue(
        makeInventory({ onHand: 97 }),
      );

      const result = await service.adjust(
        'product-uuid',
        'variant-uuid',
        { delta: -3, note: 'Damaged units removed' },
        'vendor-user-uuid',
      );

      expect(result.onHand).toBe(97);
    });

    it('rejects (400) a delta of 0', async () => {
      await expect(
        service.adjust(
          'product-uuid',
          'variant-uuid',
          { delta: 0 },
          'vendor-user-uuid',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
    });

    it('rejects (409) when the delta would make onHand negative or fall below reserved (atomic UPDATE affects 0 rows)', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory({ onHand: 5, reserved: 3 }),
      });
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.adjust(
          'product-uuid',
          'variant-uuid',
          { delta: -4 },
          'vendor-user-uuid',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a variant belonging to a different product', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.adjust(
          'product-uuid',
          'other-products-variant-uuid',
          { delta: 1 },
          'vendor-user-uuid',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        inventory: makeInventory(),
      });
      prisma.$transaction.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.adjust(
          'product-uuid',
          'variant-uuid',
          { delta: 1 },
          'vendor-user-uuid',
        ),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
