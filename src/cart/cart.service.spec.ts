import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { CartService } from './cart.service';

describe('CartService', () => {
  let service: CartService;

  const tx = {
    cart: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    cartItem: {
      upsert: jest.fn(),
    },
  };

  const prisma = {
    cart: {
      findFirst: jest.fn(),
    },
    cartItem: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };

  const activeVariant = {
    id: 'variant-uuid',
    price: new Prisma.Decimal('2500.00'),
    currency: 'BDT',
    attributes: { color: 'Black' },
    status: 'ACTIVE',
    deletedAt: null,
    product: {
      status: 'ACTIVE',
      deletedAt: null,
      vendor: { status: 'ACTIVE', deletedAt: null },
    },
  };

  const makeCartItem = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'item-uuid',
    cartId: 'cart-uuid',
    variantId: 'variant-uuid',
    quantity: 1,
    unitPriceSnapshot: new Prisma.Decimal('2500.00'),
    currency: 'BDT',
    selectedAttributes: { color: 'Black' },
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
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback(tx),
    );
    service = new CartService(prisma as any);
  });

  describe('getCart', () => {
    it("returns the user's active cart with computed item subtotals and cart total", async () => {
      const cart = makeCart({ items: [makeCartItem({ quantity: 2 })] });
      prisma.cart.findFirst.mockResolvedValue(cart);

      const result = await service.getCart('user-uuid');

      expect(prisma.cart.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-uuid', status: 'ACTIVE' },
        include: { items: true },
      });
      expect(result.id).toBe('cart-uuid');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].subtotal).toBe('5000.00');
      expect(result.total).toBe('5000.00');
    });

    it('returns a synthesized empty view (200, not 404) when the user has no active cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      const result = await service.getCart('user-uuid');

      expect(result).toEqual({
        id: null,
        status: null,
        currency: null,
        expiresAt: null,
        items: [],
        total: '0.00',
      });
    });
  });

  describe('addItem', () => {
    it('creates a new active cart and item when the user has none yet', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(null); // pre-transaction currency check
      tx.cart.findFirst.mockResolvedValue(null); // inside transaction
      const newCart = makeCart();
      tx.cart.create.mockResolvedValue(newCart);
      tx.cartItem.upsert.mockResolvedValue(makeCartItem());
      tx.cart.findUniqueOrThrow.mockResolvedValue({
        ...newCart,
        items: [makeCartItem()],
      });

      const result = await service.addItem('user-uuid', {
        variantId: 'variant-uuid',
        quantity: 1,
      });

      expect(tx.cart.create).toHaveBeenCalledWith({
        data: { userId: 'user-uuid', currency: 'BDT' },
      });
      expect(tx.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            cartId_variantId: {
              cartId: 'cart-uuid',
              variantId: 'variant-uuid',
            },
          },
          create: expect.objectContaining({ quantity: 1 }),
        }),
      );
      expect(result.id).toBe('cart-uuid');
    });

    it('increments quantity, refreshing the price snapshot, when the variant is already in the cart', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      const existingCart = makeCart();
      prisma.cart.findFirst.mockResolvedValue(existingCart);
      tx.cart.findFirst.mockResolvedValue(existingCart);
      tx.cartItem.upsert.mockResolvedValue(makeCartItem({ quantity: 3 }));
      tx.cart.findUniqueOrThrow.mockResolvedValue({
        ...existingCart,
        items: [makeCartItem({ quantity: 3 })],
      });

      await service.addItem('user-uuid', {
        variantId: 'variant-uuid',
        quantity: 2,
      });

      expect(tx.cart.create).not.toHaveBeenCalled();
      expect(tx.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            quantity: { increment: 2 },
            unitPriceSnapshot: activeVariant.price,
          }),
        }),
      );
    });

    it('defaults quantity to 1 when omitted', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(null);
      tx.cart.findFirst.mockResolvedValue(null);
      tx.cart.create.mockResolvedValue(makeCart());
      tx.cartItem.upsert.mockResolvedValue(makeCartItem());
      tx.cart.findUniqueOrThrow.mockResolvedValue({ ...makeCart(), items: [] });

      await service.addItem('user-uuid', { variantId: 'variant-uuid' });

      expect(tx.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ quantity: 1 }),
        }),
      );
    });

    it('a client-supplied userId on the dto is never used — identity is always resolved from the authenticated userId parameter', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(null);
      tx.cart.findFirst.mockResolvedValue(null);
      tx.cart.create.mockResolvedValue(makeCart());
      tx.cartItem.upsert.mockResolvedValue(makeCartItem());
      tx.cart.findUniqueOrThrow.mockResolvedValue({ ...makeCart(), items: [] });

      await service.addItem('authenticated-user-uuid', {
        variantId: 'variant-uuid',
        // @ts-expect-error intentionally simulating a spoofed field
        userId: 'spoofed-user-uuid',
      });

      expect(tx.cart.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'authenticated-user-uuid' }),
        }),
      );
    });

    it('rejects (400) a nonexistent variant', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem('user-uuid', { variantId: 'unknown-uuid' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects (400) a variant whose product is not ACTIVE', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        ...activeVariant,
        product: { ...activeVariant.product, status: 'DRAFT' },
      });

      await expect(
        service.addItem('user-uuid', { variantId: 'variant-uuid' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects (400) a variant whose vendor is not ACTIVE', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        ...activeVariant,
        product: {
          ...activeVariant.product,
          vendor: { status: 'FROZEN', deletedAt: null },
        },
      });

      await expect(
        service.addItem('user-uuid', { variantId: 'variant-uuid' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the query itself excludes non-ACTIVE and soft-deleted variants', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem('user-uuid', { variantId: 'variant-uuid' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: { id: 'variant-uuid', deletedAt: null, status: 'ACTIVE' },
        include: { product: { include: { vendor: true } } },
      });
    });

    it("rejects (409) a variant whose currency does not match the cart's existing currency", async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(makeCart({ currency: 'USD' }));

      await expect(
        service.addItem('user-uuid', { variantId: 'variant-uuid' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('handles a concurrent cart-creation race by re-fetching the winner instead of failing', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(null);
      tx.cart.findFirst
        .mockResolvedValueOnce(null) // initial check inside transaction
        .mockResolvedValueOnce(makeCart()); // re-fetch after losing the race
      tx.cart.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      tx.cartItem.upsert.mockResolvedValue(makeCartItem());
      tx.cart.findUniqueOrThrow.mockResolvedValue({ ...makeCart(), items: [] });

      const result = await service.addItem('user-uuid', {
        variantId: 'variant-uuid',
      });

      expect(result.id).toBe('cart-uuid');
      expect(tx.cartItem.upsert).toHaveBeenCalled();
    });

    it('propagates a cart-creation database error that is not the expected race', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(activeVariant);
      prisma.cart.findFirst.mockResolvedValue(null);
      tx.cart.findFirst.mockResolvedValue(null);
      tx.cart.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.addItem('user-uuid', { variantId: 'variant-uuid' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('updateItemQuantity', () => {
    it("updates the quantity of the caller's own item", async () => {
      prisma.cartItem.findFirst.mockResolvedValue(makeCartItem());
      prisma.cartItem.update.mockResolvedValue(makeCartItem({ quantity: 5 }));
      prisma.cart.findFirst.mockResolvedValue({
        ...makeCart(),
        items: [makeCartItem({ quantity: 5 })],
      });

      const result = await service.updateItemQuantity(
        'user-uuid',
        'item-uuid',
        {
          quantity: 5,
        },
      );

      expect(prisma.cartItem.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'item-uuid',
          cart: { userId: 'user-uuid', status: 'ACTIVE' },
        },
      });
      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-uuid' },
        data: { quantity: 5 },
      });
      expect(result.items[0].quantity).toBe(5);
    });

    it('never touches unitPriceSnapshot/currency on a quantity update', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(makeCartItem());
      prisma.cartItem.update.mockResolvedValue(makeCartItem({ quantity: 5 }));
      prisma.cart.findFirst.mockResolvedValue({ ...makeCart(), items: [] });

      await service.updateItemQuantity('user-uuid', 'item-uuid', {
        quantity: 5,
      });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-uuid' },
        data: { quantity: 5 },
      });
    });

    it("rejects (403) an item that belongs to another user's cart", async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItemQuantity('user-uuid', 'someone-elses-item', {
          quantity: 5,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(makeCartItem());
      prisma.cartItem.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.updateItemQuantity('user-uuid', 'item-uuid', { quantity: 5 }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('removeItem', () => {
    it("removes the caller's own item", async () => {
      prisma.cartItem.findFirst.mockResolvedValue(makeCartItem());
      prisma.cartItem.delete.mockResolvedValue(makeCartItem());
      prisma.cart.findFirst.mockResolvedValue({ ...makeCart(), items: [] });

      const result = await service.removeItem('user-uuid', 'item-uuid');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'item-uuid' },
      });
      expect(result.items).toEqual([]);
    });

    it("rejects (403) an item that belongs to another user's cart", async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeItem('user-uuid', 'someone-elses-item'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cartItem.delete).not.toHaveBeenCalled();
    });

    it('propagates unrelated database errors', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(makeCartItem());
      prisma.cartItem.delete.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.removeItem('user-uuid', 'item-uuid'),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('clearCart', () => {
    it("deletes every item in the caller's active cart", async () => {
      prisma.cart.findFirst
        .mockResolvedValueOnce(makeCart()) // existence lookup
        .mockResolvedValueOnce({ ...makeCart(), items: [] }); // getCart() at the end
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.clearCart('user-uuid');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-uuid' },
      });
      expect(result.items).toEqual([]);
    });

    it('is a no-op (still succeeds) when the user has no active cart', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      const result = await service.clearCart('user-uuid');

      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
    });

    it('propagates unrelated database errors', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.cartItem.deleteMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.clearCart('user-uuid')).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });
});
