import { ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  let service: VendorsService;

  const prisma = {
    vendor: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VendorsService(prisma as any, ownershipService as any);
  });

  describe('createForUser', () => {
    const dto = {
      businessName: 'Taijul Electronics',
      businessEmail: 'contact@taijul-electronics.example',
      businessPhone: '+8801XXXXXXXXX',
    };

    it('creates a vendor profile for a user with none yet', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);
      const created = { id: 'vendor-uuid', userId: 'user-uuid', ...dto };
      prisma.vendor.create.mockResolvedValue(created);

      await expect(
        service.createForUser('user-uuid', dto),
      ).resolves.toEqual(created);

      expect(prisma.vendor.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-uuid',
          businessName: dto.businessName,
          businessEmail: dto.businessEmail,
          businessPhone: dto.businessPhone,
        },
      });
    });

    it('never lets a client-relevant userId other than the authenticated one reach persistence', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);
      prisma.vendor.create.mockResolvedValue({ id: 'vendor-uuid' });

      await service.createForUser('authenticated-user-uuid', dto);

      expect(prisma.vendor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'authenticated-user-uuid' }),
        }),
      );
    });

    it('rejects (409) a second application when the user already has a vendor profile (pre-check)', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('existing-vendor-uuid');

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vendor.create).not.toHaveBeenCalled();
    });

    it('rejects (409) a race that reaches the database unique constraint on userId', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);
      prisma.vendor.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['user_id'] },
        }),
      );

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates unrelated database errors', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);
      prisma.vendor.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.createForUser('user-uuid', dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('findForUser', () => {
    it("returns the caller's vendor profile", async () => {
      const vendor = { id: 'vendor-uuid', userId: 'user-uuid' };
      prisma.vendor.findFirst.mockResolvedValue(vendor);

      await expect(service.findForUser('user-uuid')).resolves.toEqual(vendor);
      expect(prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-uuid', deletedAt: null },
      });
    });

    it('throws NotFoundException when the user has no vendor profile', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        service.findForUser('user-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
