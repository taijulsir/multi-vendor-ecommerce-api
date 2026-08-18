import { VendorOrdersController } from './vendor-orders.controller';
import type { SafeUser } from '../auth/utils/safe-user';

describe('VendorOrdersController', () => {
  let controller: VendorOrdersController;

  const vendorOrdersService = {
    findMyVendorOrders: jest.fn(),
    findById: jest.fn(),
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
    controller = new VendorOrdersController(vendorOrdersService as any);
  });

  it("findMyVendorOrders delegates to VendorOrdersService.findMyVendorOrders with the guard-resolved user's id", async () => {
    const orders = [{ id: 'vendor-order-uuid' }];
    vendorOrdersService.findMyVendorOrders.mockResolvedValue(orders);

    await expect(controller.findMyVendorOrders(user)).resolves.toEqual(orders);
    expect(vendorOrdersService.findMyVendorOrders).toHaveBeenCalledWith(
      user.id,
    );
  });

  it('findById delegates to VendorOrdersService.findById with the route param (ownership already enforced by the guard chain)', async () => {
    const order = { id: 'vendor-order-uuid' };
    vendorOrdersService.findById.mockResolvedValue(order);

    await expect(controller.findById('vendor-order-uuid')).resolves.toEqual(
      order,
    );
    expect(vendorOrdersService.findById).toHaveBeenCalledWith(
      'vendor-order-uuid',
    );
  });
});
