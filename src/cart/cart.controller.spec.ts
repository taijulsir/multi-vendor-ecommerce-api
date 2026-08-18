import { CartController } from './cart.controller';
import type { AddCartItemDto } from './dto/add-cart-item.dto';
import type { UpdateCartItemDto } from './dto/update-cart-item.dto';
import type { SafeUser } from '../auth/utils/safe-user';

describe('CartController', () => {
  let controller: CartController;

  const cartService = {
    getCart: jest.fn(),
    addItem: jest.fn(),
    updateItemQuantity: jest.fn(),
    removeItem: jest.fn(),
    clearCart: jest.fn(),
  };

  const user: SafeUser = {
    id: 'user-uuid',
    email: 'jane.doe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    status: 'ACTIVE',
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CartController(cartService as any);
  });

  it("getCart delegates to CartService.getCart with the guard-resolved user's id", async () => {
    const view = { id: 'cart-uuid', items: [] };
    cartService.getCart.mockResolvedValue(view);

    await expect(controller.getCart(user)).resolves.toEqual(view);
    expect(cartService.getCart).toHaveBeenCalledWith(user.id);
  });

  it("addItem delegates to CartService.addItem with the guard-resolved user's id, never a body-supplied one", async () => {
    const dto: AddCartItemDto = { variantId: 'variant-uuid', quantity: 2 };
    cartService.addItem.mockResolvedValue({ id: 'cart-uuid' });

    await controller.addItem(user, dto);

    expect(cartService.addItem).toHaveBeenCalledWith(user.id, dto);
  });

  it('updateItemQuantity delegates to CartService.updateItemQuantity with the route param and dto', async () => {
    const dto: UpdateCartItemDto = { quantity: 5 };
    cartService.updateItemQuantity.mockResolvedValue({ id: 'cart-uuid' });

    await controller.updateItemQuantity(user, 'item-uuid', dto);

    expect(cartService.updateItemQuantity).toHaveBeenCalledWith(
      user.id,
      'item-uuid',
      dto,
    );
  });

  it('removeItem delegates to CartService.removeItem with the route param', async () => {
    cartService.removeItem.mockResolvedValue({ id: 'cart-uuid' });

    await controller.removeItem(user, 'item-uuid');

    expect(cartService.removeItem).toHaveBeenCalledWith(user.id, 'item-uuid');
  });

  it("clearCart delegates to CartService.clearCart with the guard-resolved user's id", async () => {
    cartService.clearCart.mockResolvedValue({ id: null, items: [] });

    await controller.clearCart(user);

    expect(cartService.clearCart).toHaveBeenCalledWith(user.id);
  });
});
