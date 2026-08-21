import { VendorsController } from './vendors.controller';
import type { CreateVendorDto } from './dto/create-vendor.dto';
import type { SafeUser } from '../auth/utils/safe-user';

describe('VendorsController', () => {
  let controller: VendorsController;

  const vendorsService = {
    createForUser: jest.fn(),
    findForUser: jest.fn(),
    verify: jest.fn(),
    activate: jest.fn(),
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
    controller = new VendorsController(vendorsService as any);
  });

  describe('create', () => {
    it("delegates to VendorsService.createForUser with the guard-resolved user's id, never a body-supplied one", async () => {
      const dto: CreateVendorDto = { businessName: 'Taijul Electronics' };
      vendorsService.createForUser.mockResolvedValue({ id: 'vendor-uuid' });

      await controller.create(user, dto);

      expect(vendorsService.createForUser).toHaveBeenCalledWith(user.id, dto);
      expect(vendorsService.createForUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('me', () => {
    it("delegates to VendorsService.findForUser with the guard-resolved user's id", async () => {
      const vendor = { id: 'vendor-uuid', userId: user.id };
      vendorsService.findForUser.mockResolvedValue(vendor);

      await expect(controller.me(user)).resolves.toEqual(vendor);
      expect(vendorsService.findForUser).toHaveBeenCalledWith(user.id);
    });
  });

  describe('verify', () => {
    it('delegates to VendorsService.verify with the vendorId param and DTO, unaffected by any body-supplied identity field', async () => {
      const dto = { verificationStatus: 'VERIFIED' as const };
      const updated = {
        id: 'target-vendor-uuid',
        verificationStatus: 'VERIFIED',
      };
      vendorsService.verify.mockResolvedValue(updated);

      await expect(
        controller.verify('target-vendor-uuid', dto),
      ).resolves.toEqual(updated);

      expect(vendorsService.verify).toHaveBeenCalledWith(
        'target-vendor-uuid',
        dto,
      );
      expect(vendorsService.verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('activate', () => {
    it('delegates to VendorsService.activate with the vendorId param, taking no request body', async () => {
      const updated = { id: 'target-vendor-uuid', status: 'ACTIVE' };
      vendorsService.activate.mockResolvedValue(updated);

      await expect(controller.activate('target-vendor-uuid')).resolves.toEqual(
        updated,
      );

      expect(vendorsService.activate).toHaveBeenCalledWith(
        'target-vendor-uuid',
      );
      expect(vendorsService.activate).toHaveBeenCalledTimes(1);
    });
  });
});
