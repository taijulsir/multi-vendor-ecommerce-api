import { CheckoutController } from './checkout.controller';
import type { CheckoutDto } from './dto/checkout.dto';
import type { SafeUser } from '../auth/utils/safe-user';

describe('CheckoutController', () => {
  let controller: CheckoutController;

  const checkoutService = {
    checkout: jest.fn(),
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
    controller = new CheckoutController(checkoutService as any);
  });

  it("delegates to CheckoutService.checkout with the guard-resolved user's id, never a body-supplied one", async () => {
    const dto: CheckoutDto = {
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '+8801XXXXXXXXX',
        addressLine1: 'House 10, Road 5',
        city: 'Dhaka',
        postalCode: '1207',
        country: 'BD',
      },
    };
    checkoutService.checkout.mockResolvedValue({ id: 'master-order-uuid' });

    await controller.checkout(user, dto);

    expect(checkoutService.checkout).toHaveBeenCalledWith(user.id, dto);
    expect(checkoutService.checkout).toHaveBeenCalledTimes(1);
  });
});
