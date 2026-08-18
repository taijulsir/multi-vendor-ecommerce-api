import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { ShopsService } from './shops.service';

describe('ShopsService', () => {
  let service: ShopsService;

  const prisma = {
    shop: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShopsService(prisma as any, ownershipService as any);
  });

  describe('createForUser', () => {
    const dto = {
      name: 'Taijul Electronics',
      slug: 'taijul-electronics',
      description: 'Consumer electronics.',
    };

    it("creates the shop for the caller's own vendor id", async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue(null);
      const created = { id: 'shop-uuid', vendorId: 'vendor-uuid', ...dto };
      prisma.shop.create.mockResolvedValue(created);

      await expect(
        service.createForUser('user-uuid', dto),
      ).resolves.toEqual(created);

      expect(ownershipService.getVendorIdForUser).toHaveBeenCalledWith(
        'user-uuid',
      );
      expect(prisma.shop.create).toHaveBeenCalledWith({
        data: {
          vendorId: 'vendor-uuid',
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          logoUrl: undefined,
          bannerUrl: undefined,
        },
      });
    });

    it('a client-supplied vendorId/userId on the dto is never used — identity is always resolved server-side', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('real-vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue(null);
      prisma.shop.create.mockResolvedValue({ id: 'shop-uuid' });

      // Even if a caller somehow smuggled these onto the dto object
      // (bypassing DTO whitelisting), the service only ever reads the
      // resolved vendorId — never fields off the dto other than the
      // documented ones.
      await service.createForUser('user-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating a spoofed field
        vendorId: 'spoofed-vendor-uuid',
      });

      expect(prisma.shop.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ vendorId: 'real-vendor-uuid' }),
        }),
      );
    });

    it('rejects (403) a caller with no vendor profile', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue(null);

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.shop.create).not.toHaveBeenCalled();
    });

    it('rejects (409) when the vendor already has a shop (pre-check)', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue({ id: 'existing-shop-uuid' });

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.shop.create).not.toHaveBeenCalled();
    });

    it('rejects (409) a race on the vendorId unique constraint', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue(null);
      prisma.shop.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['vendor_id'] },
        }),
      );

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (409) a duplicate slug', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue(null);
      prisma.shop.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['slug'] },
        }),
      );

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates unrelated database errors', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.shop.findUnique.mockResolvedValue(null);
      prisma.shop.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.createForUser('user-uuid', dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('findById', () => {
    it('returns the full shop record', async () => {
      const shop = { id: 'shop-uuid', vendorId: 'vendor-uuid' };
      prisma.shop.findFirst.mockResolvedValue(shop);

      await expect(service.findById('shop-uuid')).resolves.toEqual(shop);
      expect(prisma.shop.findFirst).toHaveBeenCalledWith({
        where: { id: 'shop-uuid', deletedAt: null },
      });
    });

    it('throws NotFoundException when the shop does not exist (e.g. ADMIN bypass, no prior existence check)', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('unknown-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findPublicBySlug', () => {
    it('returns only the storefront-safe fields for an ACTIVE shop', async () => {
      prisma.shop.findFirst.mockResolvedValue({
        id: 'shop-uuid',
        vendorId: 'vendor-uuid',
        name: 'Taijul Electronics',
        slug: 'taijul-electronics',
        description: null,
        logoUrl: null,
        bannerUrl: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const result = await service.findPublicBySlug('taijul-electronics');

      expect(prisma.shop.findFirst).toHaveBeenCalledWith({
        where: { slug: 'taijul-electronics', status: 'ACTIVE', deletedAt: null },
      });
      expect(result).toEqual({
        id: 'shop-uuid',
        name: 'Taijul Electronics',
        slug: 'taijul-electronics',
        description: null,
        logoUrl: null,
        bannerUrl: null,
        status: 'ACTIVE',
      });
      expect(result).not.toHaveProperty('vendorId');
      expect(result).not.toHaveProperty('createdAt');
    });

    it('throws NotFoundException for a nonexistent slug', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);

      await expect(
        service.findPublicBySlug('nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the query itself excludes non-ACTIVE and soft-deleted shops (never relies on filtering after the fact)', async () => {
      prisma.shop.findFirst.mockResolvedValue(null);

      await expect(
        service.findPublicBySlug('inactive-shop'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shop.findFirst).toHaveBeenCalledWith({
        where: { slug: 'inactive-shop', status: 'ACTIVE', deletedAt: null },
      });
    });
  });

  describe('update', () => {
    it('updates only the documented, DTO-carried fields', async () => {
      const updated = { id: 'shop-uuid', name: 'New Name' };
      prisma.shop.update.mockResolvedValue(updated);

      await expect(
        service.update('shop-uuid', { name: 'New Name' }),
      ).resolves.toEqual(updated);

      expect(prisma.shop.update).toHaveBeenCalledWith({
        where: { id: 'shop-uuid', deletedAt: null },
        data: {
          name: 'New Name',
          slug: undefined,
          description: undefined,
          logoUrl: undefined,
          bannerUrl: undefined,
          status: undefined,
        },
      });
    });

    it('rejects (409) a slug already in use', async () => {
      prisma.shop.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['slug'] },
        }),
      );

      await expect(
        service.update('shop-uuid', { slug: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (404) when the row disappeared between the ownership check and the update (race)', async () => {
      prisma.shop.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('shop-uuid', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.shop.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.update('shop-uuid', { name: 'New Name' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
