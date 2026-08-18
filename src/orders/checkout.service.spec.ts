import { BadRequestException, ConflictException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  let service: CheckoutService;

  const tx = {
    cart: { updateMany: jest.fn() },
    masterOrder: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    orderStatusHistory: { create: jest.fn() },
    vendorOrder: {
      count: jest.fn(),
      create: jest.fn(),
    },
    vendorOrderStatusHistory: { create: jest.fn() },
    orderItem: { create: jest.fn() },
    inventoryTransaction: { create: jest.fn() },
    $executeRaw: jest.fn(),
  };

  const prisma = {
    cart: { findFirst: jest.fn() },
    productVariant: { findMany: jest.fn() },
    masterOrder: { count: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const dto = {
    shippingAddress: {
      fullName: 'Jane Doe',
      phone: '+8801XXXXXXXXX',
      addressLine1: 'House 10, Road 5',
      city: 'Dhaka',
      postalCode: '1207',
      country: 'BD',
    },
  };

  const makeCartItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'item-uuid',
    cartId: 'cart-uuid',
    variantId: 'variant-uuid',
    quantity: 2,
    unitPriceSnapshot: new Prisma.Decimal('2500.00'),
    currency: 'BDT',
    selectedAttributes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const makeCart = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'cart-uuid',
    userId: 'user-uuid',
    status: 'ACTIVE',
    currency: 'BDT',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    items: [makeCartItem()],
    ...overrides,
  });

  const makeVariant = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'variant-uuid',
    productId: 'product-uuid',
    sku: 'SKU-1',
    name: 'Black / M',
    price: new Prisma.Decimal('2500.00'),
    compareAtPrice: null,
    costPrice: null,
    currency: 'BDT',
    attributes: { color: 'Black' },
    isDefault: true,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    product: {
      id: 'product-uuid',
      name: 'Nike T-Shirt',
      vendorId: 'vendor-uuid',
      status: 'ACTIVE',
      deletedAt: null,
      vendor: { id: 'vendor-uuid', status: 'ACTIVE', deletedAt: null },
    },
    inventory: { id: 'inventory-uuid', onHand: 100, reserved: 0 },
    ...overrides,
  });

  const makeMasterOrder = (overrides: Partial<Record<string, unknown>> = {}) => ({
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
    shippingAddressSnapshot: dto.shippingAddress,
    billingAddressSnapshot: dto.shippingAddress,
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
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    tx.cart.updateMany.mockResolvedValue({ count: 1 });
    tx.$executeRaw.mockResolvedValue(1);
    tx.vendorOrder.count.mockResolvedValue(0);
    prisma.masterOrder.count.mockResolvedValue(0);
    service = new CheckoutService(prisma as any);
  });

  describe('successful checkout', () => {
    it('creates a MasterOrder with one VendorOrder and one OrderItem for a single-vendor cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.masterOrder.create.mockResolvedValue(makeMasterOrder());
      tx.vendorOrder.create.mockResolvedValue({
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
      });
      tx.orderItem.create.mockResolvedValue({
        id: 'order-item-uuid',
        vendorOrderId: 'vendor-order-uuid',
        productId: 'product-uuid',
        variantId: 'variant-uuid',
        productName: 'Nike T-Shirt',
        variantName: 'Black / M',
        sku: 'SKU-1',
        attributes: { color: 'Black' },
        unitPrice: new Prisma.Decimal('2500.00'),
        quantity: 2,
        discountAmount: new Prisma.Decimal('0'),
        taxAmount: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal('5000.00'),
        currency: 'BDT',
      });
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(
        makeMasterOrder({
          vendorOrders: [
            {
              id: 'vendor-order-uuid',
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
              items: [
                {
                  id: 'order-item-uuid',
                  productId: 'product-uuid',
                  variantId: 'variant-uuid',
                  productName: 'Nike T-Shirt',
                  variantName: 'Black / M',
                  sku: 'SKU-1',
                  attributes: { color: 'Black' },
                  unitPrice: new Prisma.Decimal('2500.00'),
                  quantity: 2,
                  discountAmount: new Prisma.Decimal('0'),
                  taxAmount: new Prisma.Decimal('0'),
                  totalAmount: new Prisma.Decimal('5000.00'),
                  currency: 'BDT',
                },
              ],
            },
          ],
        }),
      );

      const result = await service.checkout('user-uuid', dto as any);

      expect(tx.cart.updateMany).toHaveBeenCalledWith({
        where: { id: 'cart-uuid', status: 'ACTIVE' },
        data: { status: 'CONVERTED' },
      });
      expect(tx.masterOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-uuid',
            currency: 'BDT',
            subtotal: expect.any(Prisma.Decimal),
          }),
        }),
      );
      expect(tx.vendorOrder.create).toHaveBeenCalledTimes(1);
      expect(tx.orderItem.create).toHaveBeenCalledTimes(1);
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inventoryId: 'inventory-uuid',
          type: 'RESERVATION',
          quantity: 2,
          referenceType: 'ORDER_ITEM',
          referenceId: 'order-item-uuid',
        }),
      });
      expect(result.id).toBe('master-order-uuid');
      expect(result.vendorOrders).toHaveLength(1);
      expect(result.vendorOrders[0].items).toHaveLength(1);
      // Commission/vendorNetAmount are deliberately not exposed.
      expect(result.vendorOrders[0]).not.toHaveProperty('commissionAmount');
      expect(result.vendorOrders[0]).not.toHaveProperty('vendorNetAmount');
    });

    it('groups items into one VendorOrder per distinct vendor for a multi-vendor cart', async () => {
      const itemA = makeCartItem({ id: 'item-a', variantId: 'variant-a', quantity: 1 });
      const itemB = makeCartItem({ id: 'item-b', variantId: 'variant-b', quantity: 3 });
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [itemA, itemB] }));

      const variantA = makeVariant({
        id: 'variant-a',
        productId: 'product-a',
        product: {
          id: 'product-a',
          name: 'Product A',
          vendorId: 'vendor-a',
          status: 'ACTIVE',
          deletedAt: null,
          vendor: { id: 'vendor-a', status: 'ACTIVE', deletedAt: null },
        },
        inventory: { id: 'inventory-a', onHand: 100, reserved: 0 },
      });
      const variantB = makeVariant({
        id: 'variant-b',
        productId: 'product-b',
        product: {
          id: 'product-b',
          name: 'Product B',
          vendorId: 'vendor-b',
          status: 'ACTIVE',
          deletedAt: null,
          vendor: { id: 'vendor-b', status: 'ACTIVE', deletedAt: null },
        },
        inventory: { id: 'inventory-b', onHand: 100, reserved: 0 },
      });
      prisma.productVariant.findMany.mockResolvedValue([variantA, variantB]);

      tx.masterOrder.create.mockResolvedValue(makeMasterOrder());
      tx.vendorOrder.create.mockResolvedValue({ id: 'vendor-order-uuid' });
      tx.orderItem.create.mockResolvedValue({ id: 'order-item-uuid' });
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(makeMasterOrder());

      await service.checkout('user-uuid', dto as any);

      expect(tx.vendorOrder.create).toHaveBeenCalledTimes(2);
      expect(tx.orderItem.create).toHaveBeenCalledTimes(2);
    });

    it('defaults billingAddressSnapshot to shippingAddress when billingAddress is omitted', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.masterOrder.create.mockResolvedValue(makeMasterOrder());
      tx.vendorOrder.create.mockResolvedValue({ id: 'vendor-order-uuid' });
      tx.orderItem.create.mockResolvedValue({ id: 'order-item-uuid' });
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(makeMasterOrder());

      await service.checkout('user-uuid', dto as any);

      expect(tx.masterOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shippingAddressSnapshot: expect.objectContaining({
              fullName: 'Jane Doe',
            }),
            billingAddressSnapshot: expect.objectContaining({
              fullName: 'Jane Doe',
            }),
          }),
        }),
      );
    });

    it("never uses anything but the authenticated userId parameter as order ownership, even if the dto carried a spoofed field", async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.masterOrder.create.mockResolvedValue(makeMasterOrder());
      tx.vendorOrder.create.mockResolvedValue({ id: 'vendor-order-uuid' });
      tx.orderItem.create.mockResolvedValue({ id: 'order-item-uuid' });
      tx.masterOrder.findUniqueOrThrow.mockResolvedValue(makeMasterOrder());

      await service.checkout('authenticated-user-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating a spoofed field
        userId: 'spoofed-user-uuid',
      } as any);

      expect(prisma.cart.findFirst).toHaveBeenCalledWith({
        where: { userId: 'authenticated-user-uuid', status: 'ACTIVE' },
        include: { items: true },
      });
      expect(tx.masterOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'authenticated-user-uuid' }),
        }),
      );
    });
  });

  describe('cart validation', () => {
    it('rejects (400) when the user has no active cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (400) when the active cart has no items', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart({ items: [] }));

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('product/variant/vendor validation', () => {
    it('rejects (400) a variant that no longer exists', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (400) an INACTIVE variant', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({ status: 'INACTIVE' }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects (400) a variant whose product is not ACTIVE', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({
          product: {
            id: 'product-uuid',
            name: 'Nike T-Shirt',
            vendorId: 'vendor-uuid',
            status: 'DRAFT',
            deletedAt: null,
            vendor: { id: 'vendor-uuid', status: 'ACTIVE', deletedAt: null },
          },
        }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects (400) a variant whose vendor is not ACTIVE', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({
          product: {
            id: 'product-uuid',
            name: 'Nike T-Shirt',
            vendorId: 'vendor-uuid',
            status: 'ACTIVE',
            deletedAt: null,
            vendor: { id: 'vendor-uuid', status: 'FROZEN', deletedAt: null },
          },
        }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('currency and inventory validation', () => {
    it("rejects (409) a variant whose currency no longer matches the cart's currency", async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart({ currency: 'BDT' }));
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({ currency: 'USD' }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (409) when the variant has no Inventory row at all', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({ inventory: null }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (409) when requested quantity exceeds available stock', async () => {
      prisma.cart.findFirst.mockResolvedValue(
        makeCart({ items: [makeCartItem({ quantity: 10 })] }),
      );
      prisma.productVariant.findMany.mockResolvedValue([
        makeVariant({ inventory: { id: 'inventory-uuid', onHand: 10, reserved: 5 } }),
      ]);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (409) when the atomic reservation UPDATE affects zero rows inside the transaction (concurrent race)', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.$executeRaw.mockResolvedValue(0);

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.masterOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('cart conversion concurrency', () => {
    it('rejects (409) when the cart is no longer ACTIVE at the moment of conversion (concurrent/retried checkout)', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.cart.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.masterOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('order number collisions', () => {
    it('translates a P2002 on MasterOrder creation into a 409 rather than a raw database error', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.masterOrder.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.checkout('user-uuid', dto as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('database error propagation', () => {
    it('propagates an unrelated database error from the initial cart lookup', async () => {
      prisma.cart.findFirst.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.checkout('user-uuid', dto as any)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });

    it('propagates an unrelated database error from within the transaction', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findMany.mockResolvedValue([makeVariant()]);
      tx.masterOrder.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.checkout('user-uuid', dto as any)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });
});
