import { ConflictException, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  let service: VendorsService;

  const prisma = {
    vendor: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
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

      await expect(service.createForUser('user-uuid', dto)).resolves.toEqual(
        created,
      );

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
      ownershipService.getVendorIdForUser.mockResolvedValue(
        'existing-vendor-uuid',
      );

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

      await expect(service.findForUser('user-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('verify', () => {
    const vendorId = 'vendor-uuid';

    it('allows PENDING → UNDER_REVIEW', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'PENDING',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      const updated = { id: vendorId, verificationStatus: 'UNDER_REVIEW' };
      prisma.vendor.findUniqueOrThrow.mockResolvedValue(updated);

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).resolves.toEqual(updated);

      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: { id: vendorId, verificationStatus: 'PENDING' },
        data: { verificationStatus: 'UNDER_REVIEW' },
      });
    });

    it('allows UNDER_REVIEW → VERIFIED', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'UNDER_REVIEW',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendor.findUniqueOrThrow.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'VERIFIED',
      });

      await expect(
        service.verify(vendorId, { verificationStatus: 'VERIFIED' }),
      ).resolves.toEqual({ id: vendorId, verificationStatus: 'VERIFIED' });
    });

    it.each([
      ['PENDING', 'REJECTED'],
      ['UNDER_REVIEW', 'REJECTED'],
    ])('allows %s → %s', async (from, to) => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: from,
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendor.findUniqueOrThrow.mockResolvedValue({
        id: vendorId,
        verificationStatus: to,
      });

      await expect(
        service.verify(vendorId, {
          verificationStatus: to as 'REJECTED',
        }),
      ).resolves.toEqual({ id: vendorId, verificationStatus: to });
    });

    it('rejects (409) PENDING → VERIFIED (skipping UNDER_REVIEW is not documented)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'PENDING',
      });

      await expect(
        service.verify(vendorId, { verificationStatus: 'VERIFIED' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
    });

    it('rejects (409) re-applying VERIFIED to an already-VERIFIED vendor (no documented self-transition)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'VERIFIED',
      });

      await expect(
        service.verify(vendorId, { verificationStatus: 'VERIFIED' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (409) any transition out of REJECTED (terminal — no re-application path is documented)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'REJECTED',
      });

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException for a nonexistent vendor', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a soft-deleted vendor (findFirst already filters deletedAt: null)', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: vendorId, deletedAt: null },
      });
    });

    it('rejects (409) when a concurrent request already changed the state (updateMany affects 0 rows)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'PENDING',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.vendor.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('never passes any field other than verificationStatus to the update', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        verificationStatus: 'PENDING',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendor.findUniqueOrThrow.mockResolvedValue({ id: vendorId });

      await service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' });

      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: vendorId }) as unknown,
        data: { verificationStatus: 'UNDER_REVIEW' },
      });
    });

    it('propagates unrelated database errors', async () => {
      prisma.vendor.findFirst.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.verify(vendorId, { verificationStatus: 'UNDER_REVIEW' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });

  describe('activate', () => {
    const vendorId = 'vendor-uuid';

    it('activates a PENDING + VERIFIED vendor', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'PENDING',
        verificationStatus: 'VERIFIED',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      const updated = { id: vendorId, status: 'ACTIVE' };
      prisma.vendor.findUniqueOrThrow.mockResolvedValue(updated);

      await expect(service.activate(vendorId)).resolves.toEqual(updated);

      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: {
          id: vendorId,
          status: 'PENDING',
          verificationStatus: 'VERIFIED',
        },
        data: { status: 'ACTIVE' },
      });
    });

    it('rejects (409) a vendor that is not yet VERIFIED', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'PENDING',
        verificationStatus: 'PENDING',
      });

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
    });

    it('rejects (409) an already-ACTIVE vendor (no documented re-activation path)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      });

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("rejects (409) a FROZEN vendor (reactivation from FROZEN/SUSPENDED is out of this phase's scope)", async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'FROZEN',
        verificationStatus: 'VERIFIED',
      });

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws NotFoundException for a nonexistent vendor', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.vendor.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a soft-deleted vendor', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: vendorId, deletedAt: null },
      });
    });

    it('rejects (409) when a concurrent request already changed the state (updateMany affects 0 rows)', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'PENDING',
        verificationStatus: 'VERIFIED',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.activate(vendorId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.vendor.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('never passes any field other than status to the update', async () => {
      prisma.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        status: 'PENDING',
        verificationStatus: 'VERIFIED',
      });
      prisma.vendor.updateMany.mockResolvedValue({ count: 1 });
      prisma.vendor.findUniqueOrThrow.mockResolvedValue({ id: vendorId });

      await service.activate(vendorId);

      expect(prisma.vendor.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: vendorId }) as unknown,
        data: { status: 'ACTIVE' },
      });
    });

    it('propagates unrelated database errors', async () => {
      prisma.vendor.findFirst.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.activate(vendorId)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });
});
