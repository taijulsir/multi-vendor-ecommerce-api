import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;

  const prisma = {
    product: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    category: {
      findFirst: jest.fn(),
    },
  };

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductsService(prisma as any, ownershipService as any);
  });

  describe('createForUser', () => {
    const dto = {
      name: 'Apple iPhone 17 Pro Max',
      slug: 'apple-iphone-17-pro-max',
      categoryId: 'category-uuid',
    };

    it("creates the product for the caller's own vendor id", async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.category.findFirst.mockResolvedValue({ id: 'category-uuid' });
      const created = { id: 'product-uuid', vendorId: 'vendor-uuid', ...dto };
      prisma.product.create.mockResolvedValue(created);

      await expect(service.createForUser('user-uuid', dto)).resolves.toEqual(
        created,
      );

      expect(ownershipService.getVendorIdForUser).toHaveBeenCalledWith(
        'user-uuid',
      );
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          vendorId: 'vendor-uuid',
          categoryId: dto.categoryId,
          name: dto.name,
          slug: dto.slug,
          description: undefined,
          productType: undefined,
        },
      });
    });

    it('a client-supplied vendorId/userId on the dto is never used — identity is always resolved server-side', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('real-vendor-uuid');
      prisma.category.findFirst.mockResolvedValue({ id: 'category-uuid' });
      prisma.product.create.mockResolvedValue({ id: 'product-uuid' });

      await service.createForUser('user-uuid', {
        ...dto,
        // @ts-expect-error intentionally simulating a spoofed field
        vendorId: 'spoofed-vendor-uuid',
      });

      expect(prisma.product.create).toHaveBeenCalledWith(
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
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects (400) a categoryId that does not reference an existing category', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects (409) a duplicate slug', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.category.findFirst.mockResolvedValue({ id: 'category-uuid' });
      prisma.product.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.createForUser('user-uuid', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates unrelated database errors', async () => {
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      prisma.category.findFirst.mockResolvedValue({ id: 'category-uuid' });
      prisma.product.create.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(service.createForUser('user-uuid', dto)).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('findById', () => {
    it('returns the full product record', async () => {
      const product = { id: 'product-uuid', vendorId: 'vendor-uuid' };
      prisma.product.findFirst.mockResolvedValue(product);

      await expect(service.findById('product-uuid')).resolves.toEqual(product);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'product-uuid', deletedAt: null },
      });
    });

    it('throws NotFoundException when the product does not exist (e.g. ADMIN bypass, no prior existence check)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findById('unknown-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findPublicBySlug', () => {
    it('returns only the storefront-safe fields for an ACTIVE product', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        vendorId: 'vendor-uuid',
        categoryId: 'category-uuid',
        name: 'Apple iPhone 17 Pro Max',
        slug: 'apple-iphone-17-pro-max',
        description: null,
        status: 'ACTIVE',
        productType: 'SIMPLE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const result = await service.findPublicBySlug('apple-iphone-17-pro-max');

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          slug: 'apple-iphone-17-pro-max',
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      expect(result).toEqual({
        id: 'product-uuid',
        categoryId: 'category-uuid',
        name: 'Apple iPhone 17 Pro Max',
        slug: 'apple-iphone-17-pro-max',
        description: null,
        status: 'ACTIVE',
        productType: 'SIMPLE',
      });
      expect(result).not.toHaveProperty('vendorId');
      expect(result).not.toHaveProperty('createdAt');
    });

    it('throws NotFoundException for a nonexistent slug', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.findPublicBySlug('nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the query itself excludes non-ACTIVE and soft-deleted products', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.findPublicBySlug('draft-product'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { slug: 'draft-product', status: 'ACTIVE', deletedAt: null },
      });
    });
  });

  describe('findPublicList', () => {
    const makeProduct = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'product-uuid',
      vendorId: 'vendor-uuid',
      categoryId: 'category-uuid',
      name: 'Apple iPhone 17 Pro Max',
      slug: 'apple-iphone-17-pro-max',
      description: null,
      status: 'ACTIVE',
      productType: 'SIMPLE',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    });

    it('returns a page of public-safe products with default pagination', async () => {
      prisma.product.findMany.mockResolvedValue([makeProduct()]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findPublicList({});

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', deletedAt: null },
      });
      expect(result).toEqual({
        data: [
          {
            id: 'product-uuid',
            categoryId: 'category-uuid',
            name: 'Apple iPhone 17 Pro Max',
            slug: 'apple-iphone-17-pro-max',
            description: null,
            status: 'ACTIVE',
            productType: 'SIMPLE',
          },
        ],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(result.data[0]).not.toHaveProperty('vendorId');
    });

    it('applies the requested page/limit as skip/take', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(45);

      const result = await service.findPublicList({ page: 3, limit: 10 });

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 10,
      });
      expect(result.meta).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    it('returns an empty page with totalPages 0 when there are no ACTIVE products', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      const result = await service.findPublicList({});

      expect(result).toEqual({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('propagates unrelated database errors', async () => {
      prisma.product.findMany.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );
      prisma.product.count.mockResolvedValue(0);

      await expect(service.findPublicList({})).rejects.toThrow(
        'connection terminated unexpectedly',
      );
    });
  });

  describe('update', () => {
    it('updates only the documented, DTO-carried fields', async () => {
      const updated = { id: 'product-uuid', name: 'New Name' };
      prisma.product.update.mockResolvedValue(updated);

      await expect(
        service.update('product-uuid', { name: 'New Name' }),
      ).resolves.toEqual(updated);

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-uuid', deletedAt: null },
        data: {
          name: 'New Name',
          slug: undefined,
          description: undefined,
          categoryId: undefined,
          status: undefined,
        },
      });
      expect(prisma.category.findFirst).not.toHaveBeenCalled();
    });

    it('validates categoryId when changing it', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.update('product-uuid', { categoryId: 'nonexistent' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('rejects (409) a slug already in use', async () => {
      prisma.product.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('product-uuid', { slug: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects (404) when the row disappeared between the ownership check and the update (race)', async () => {
      prisma.product.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.update('product-uuid', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates unrelated database errors', async () => {
      prisma.product.update.mockRejectedValue(
        new Error('connection terminated unexpectedly'),
      );

      await expect(
        service.update('product-uuid', { name: 'New Name' }),
      ).rejects.toThrow('connection terminated unexpectedly');
    });
  });
});
