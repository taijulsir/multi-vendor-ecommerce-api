import { PaymentsController } from './payments.controller';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { CreateRefundDto } from './dto/create-refund.dto';
import type { SafeUser } from '../auth/utils/safe-user';

describe('PaymentsController', () => {
  let controller: PaymentsController;

  const paymentsService = {
    createForUser: jest.fn(),
    retry: jest.fn(),
    findById: jest.fn(),
    createRefund: jest.fn(),
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
    controller = new PaymentsController(paymentsService as any);
  });

  it("create delegates to PaymentsService.createForUser with the guard-resolved user's id", async () => {
    const dto: CreatePaymentDto = {
      masterOrderId: 'master-order-uuid',
      method: 'CASH_ON_DELIVERY',
    };
    paymentsService.createForUser.mockResolvedValue({ id: 'payment-uuid' });

    await controller.create(user, dto);

    expect(paymentsService.createForUser).toHaveBeenCalledWith(user.id, dto);
  });

  it("retry delegates to PaymentsService.retry with the guard-resolved user's id and route param", async () => {
    paymentsService.retry.mockResolvedValue({ id: 'payment-uuid' });

    await controller.retry(user, 'payment-uuid');

    expect(paymentsService.retry).toHaveBeenCalledWith(user.id, 'payment-uuid');
  });

  it("findById delegates to PaymentsService.findById with the guard-resolved user's id and route param", async () => {
    paymentsService.findById.mockResolvedValue({ id: 'payment-uuid' });

    await controller.findById(user, 'payment-uuid');

    expect(paymentsService.findById).toHaveBeenCalledWith(
      user.id,
      'payment-uuid',
    );
  });

  it('createRefund delegates to PaymentsService.createRefund with the RBAC-resolved user, route param, and dto', async () => {
    const dto: CreateRefundDto = { amount: '500.00', reason: 'CUSTOMER_RETURN' };
    paymentsService.createRefund.mockResolvedValue({ id: 'refund-uuid' });

    await controller.createRefund(user, 'payment-uuid', dto);

    expect(paymentsService.createRefund).toHaveBeenCalledWith(
      user.id,
      'payment-uuid',
      dto,
    );
  });
});
