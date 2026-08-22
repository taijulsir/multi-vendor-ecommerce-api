import { ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { ProductVariantsService } from './product-variants.service';

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;

  const tx = {
    productVariant: { create: jest.fn() },
    inventory: { create: jest.fn() },
  };

  const prisma = {
    product: { findFirst: jest.fn() },
    productVariant: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const dto = {
    sku: 'NIKE-TSHIRT-BLK-M',
    price: '2500.00',
    currency: 'BDT',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    service = new ProductVariantsService(prisma as any);
  });

  describe('createForProduct', () => {
    it('creates the first variant of a product as its default, with a 1:1 Inventory row defaulting onHand: 0', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.count.mockResolvedValue(0);
      const created = { id: 'variant-uuid', ...dto, isDefault: true };
      tx.productVariant.create.mockResolvedValue(created);
      tx.inventory.create.mockResolvedValue({ id: 'inventory-uuid' });

      await expect(
        service.createForProduct('product-uuid', dto),
      ).resolves.toEqual(created);

      expect(tx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: 'product-uuid',
          sku: dto.sku,
          price: dto.price,
          currency: dto.currency,
          isDefault: true,
        }) as unknown,
      });
      expect(tx.inventory.create).toHaveBeenCalledWith({
        data: { variantId: 'variant-uuid', onHand: 0, reserved: 0 },
      });
    });

    it('does not mark the second variant of a product as default', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.count.mockResolvedValue(1);
      tx.productVariant.create.mockResolvedValue({
        id: 'variant-2-uuid',
        isDefault: false,
      });
      tx.inventory.create.mockResolvedValue({ id: 'inventory-2-uuid' });

      await service.createForProduct('product-uuid', dto);

      expect(tx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: false }) as unknown,
      });
    });

    it('never lets a client-supplied isDefault reach persistence', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.count.mockResolvedValue(1);
      tx.productVariant.create.mockResolvedValue({ id: 'variant-uuid' });
      tx.inventory.create.mockResolvedValue({ id: 'inventory-uuid' });

      await service.createForProduct('product-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating a spoofed field
        isDefault: true,
      });

      expect(tx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: false }) as unknown,
      });
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.createForProduct('unknown-uuid', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (409) a duplicate SKU', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createForProduct('product-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.count.mockResolvedValue(0);
      prisma.$transaction.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.createForProduct('product-uuid', dto),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('findAllForProduct', () => {
    it('returns every variant of the product, any status', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'variant-uuid', status: 'INACTIVE' },
      ]);

      const result = await service.findAllForProduct('product-uuid');

      expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
        where: { productId: 'product-uuid', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.findAllForProduct('unknown-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns the variant scoped to the given productId', async () => {
      const variant = { id: 'variant-uuid', productId: 'product-uuid' };
      prisma.productVariant.findFirst.mockResolvedValue(variant);

      await expect(
        service.findOne('product-uuid', 'variant-uuid'),
      ).resolves.toEqual(variant);
      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'variant-uuid',
          productId: 'product-uuid',
          deletedAt: null,
        },
      });
    });

    it('throws NotFoundException for a variant belonging to a different product', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('product-uuid', 'other-products-variant-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates only the documented, DTO-carried fields', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        productId: 'product-uuid',
      });
      const updated = { id: 'variant-uuid', name: 'New Name' };
      prisma.productVariant.update.mockResolvedValue(updated);

      await expect(
        service.update('product-uuid', 'variant-uuid', { name: 'New Name' }),
      ).resolves.toEqual(updated);

      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-uuid', deletedAt: null },
        data: {
          sku: undefined,
          name: 'New Name',
          price: undefined,
          compareAtPrice: undefined,
          costPrice: undefined,
          currency: undefined,
          attributes: undefined,
          status: undefined,
        },
      });
    });

    it('rejects (404) updating a variant that does not belong to the given product', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.update('product-uuid', 'other-products-variant-uuid', {
          name: 'New Name',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('rejects (409) a slug/SKU already in use', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        productId: 'product-uuid',
      });
      prisma.productVariant.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('product-uuid', 'variant-uuid', { sku: 'TAKEN' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (404) when the row disappeared between the existence check and the update (race)', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        productId: 'product-uuid',
      });
      prisma.productVariant.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('product-uuid', 'variant-uuid', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'variant-uuid',
        productId: 'product-uuid',
      });
      prisma.productVariant.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.update('product-uuid', 'variant-uuid', { name: 'X' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
