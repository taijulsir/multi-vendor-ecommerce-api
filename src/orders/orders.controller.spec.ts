import { OrdersController } from './orders.controller';
import type { SafeUser } from '../auth/utils/safe-user';

describe('OrdersController', () => {
  let controller: OrdersController;

  const ordersService = {
    findMyOrders: jest.fn(),
    findMyOrderById: jest.fn(),
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
    controller = new OrdersController(ordersService as any);
  });

  it("findMyOrders delegates to OrdersService.findMyOrders with the guard-resolved user's id", async () => {
    const orders = [{ id: 'master-order-uuid' }];
    ordersService.findMyOrders.mockResolvedValue(orders);

    await expect(controller.findMyOrders(user)).resolves.toEqual(orders);
    expect(ordersService.findMyOrders).toHaveBeenCalledWith(user.id);
  });

  it("findMyOrderById delegates to OrdersService.findMyOrderById with the guard-resolved user's id and the route param", async () => {
    const order = { id: 'master-order-uuid' };
    ordersService.findMyOrderById.mockResolvedValue(order);

    await expect(
      controller.findMyOrderById(user, 'master-order-uuid'),
    ).resolves.toEqual(order);
    expect(ordersService.findMyOrderById).toHaveBeenCalledWith(
      user.id,
      'master-order-uuid',
    );
  });
});
