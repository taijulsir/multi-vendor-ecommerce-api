import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { StorageFileNotFoundError } from '../../storage/storage.service';
import { ProductImagesService } from './product-images.service';

// A real, minimal 1x1 PNG — needed so `validateImageFile`'s magic-byte
// sniffing (via the real `file-type` package, not mocked: this is the
// exact security behavior this phase must not mock away) genuinely
// detects `image/png`.
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const HTML_BUFFER = Buffer.from('<html><script>alert(1)</script></html>');

describe('ProductImagesService', () => {
  let service: ProductImagesService;

  const prisma = {
    product: { findFirst: jest.fn() },
    productVariant: { findFirst: jest.fn() },
    productImage: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };

  const storage = {
    generateFilename: jest.fn(),
    writeFile: jest.fn(),
    createReadStream: jest.fn(),
    deleteFile: jest.fn(),
  };

  const ownershipService = {
    getVendorIdForUser: jest.fn(),
    isProductOwnedByVendor: jest.fn(),
  };

  const authorizationService = {
    hasRole: jest.fn(),
  };

  const user = { id: 'user-uuid' } as any;

  const file = {
    buffer: PNG_BUFFER,
    originalname: 'client-supplied-name.png',
  } as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
    storage.generateFilename.mockReturnValue('generated-uuid.png');
    service = new ProductImagesService(
      prisma as any,
      storage as any,
      ownershipService as any,
      authorizationService as any,
    );
  });

  describe('upload', () => {
    it('validates content, writes the file under a server-generated name, and creates the ProductImage row', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productImage.create.mockResolvedValue({
        id: 'image-uuid',
        productId: 'product-uuid',
        variantId: null,
        url: '/api/products/product-uuid/images/image-uuid',
        altText: null,
        sortOrder: 0,
        isPrimary: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      });

      const result = await service.upload('product-uuid', file, {});

      expect(storage.writeFile).toHaveBeenCalledWith(
        'generated-uuid.png',
        PNG_BUFFER,
      );
      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: 'product-uuid',
          storageKey: 'generated-uuid.png',
          isPrimary: false,
        }) as unknown,
      });
      // The client's original filename must never reach the stored
      // filename or the DB row.
      const createCall = prisma.productImage.create.mock.calls[0][0];
      expect(JSON.stringify(createCall)).not.toContain(
        'client-supplied-name',
      );
      expect(result).not.toHaveProperty('storageKey');
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('rejects a missing file', async () => {
      await expect(
        service.upload('product-uuid', undefined, {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.writeFile).not.toHaveBeenCalled();
    });

    it('rejects content that is not one of the allowed image types, without ever writing to disk', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });

      await expect(
        service.upload(
          'product-uuid',
          { buffer: HTML_BUFFER } as Express.Multer.File,
          {},
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.writeFile).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent product before writing anything (covers the ADMIN-bypass existence gap)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.upload('missing-product-uuid', file, {}),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(storage.writeFile).not.toHaveBeenCalled();
    });

    it('rejects a variantId that does not belong to this product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.upload('product-uuid', file, {
          variantId: 'other-products-variant-uuid',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'other-products-variant-uuid',
          productId: 'product-uuid',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(storage.writeFile).not.toHaveBeenCalled();
    });

    it('deletes the just-written orphan file when the DB write fails', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      const dbError = new Prisma.PrismaClientKnownRequestError('fail', {
        code: 'P2003',
        clientVersion: 'test',
      });
      prisma.productImage.create.mockRejectedValue(dbError);

      await expect(
        service.upload('product-uuid', file, {}),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(storage.deleteFile).toHaveBeenCalledWith('generated-uuid.png');
    });

    it('propagates an unrecognized DB error after cleaning up the orphan file', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'product-uuid' });
      const unexpected = new Error('unexpected');
      prisma.productImage.create.mockRejectedValue(unexpected);

      await expect(service.upload('product-uuid', file, {})).rejects.toBe(
        unexpected,
      );

      expect(storage.deleteFile).toHaveBeenCalledWith('generated-uuid.png');
    });
  });

  describe('resolveStreamable', () => {
    it('streams an ACTIVE product image with no authentication required', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'ACTIVE',
      });
      prisma.productImage.findFirst.mockResolvedValue({
        storageKey: 'generated-uuid.jpg',
      });
      storage.createReadStream.mockResolvedValue('the-stream');

      const result = await service.resolveStreamable(
        'product-uuid',
        'image-uuid',
        undefined,
      );

      expect(result).toEqual({ stream: 'the-stream', mimeType: 'image/jpeg' });
      expect(authorizationService.hasRole).not.toHaveBeenCalled();
    });

    it('reports not-found (never discloses existence) for an unauthenticated caller of a non-ACTIVE product', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'DRAFT',
      });

      await expect(
        service.resolveStreamable('product-uuid', 'image-uuid', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.productImage.findFirst).not.toHaveBeenCalled();
    });

    it('streams a DRAFT product image for its owning vendor', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'DRAFT',
      });
      authorizationService.hasRole.mockResolvedValue(false);
      ownershipService.getVendorIdForUser.mockResolvedValue('vendor-uuid');
      ownershipService.isProductOwnedByVendor.mockResolvedValue(true);
      prisma.productImage.findFirst.mockResolvedValue({
        storageKey: 'generated-uuid.webp',
      });
      storage.createReadStream.mockResolvedValue('the-stream');

      const result = await service.resolveStreamable(
        'product-uuid',
        'image-uuid',
        user,
      );

      expect(result.mimeType).toBe('image/webp');
    });

    it('rejects an authenticated non-owner, non-ADMIN caller of a DRAFT product with 403', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'DRAFT',
      });
      authorizationService.hasRole.mockResolvedValue(false);
      ownershipService.getVendorIdForUser.mockResolvedValue('other-vendor-uuid');
      ownershipService.isProductOwnedByVendor.mockResolvedValue(false);

      await expect(
        service.resolveStreamable('product-uuid', 'image-uuid', user),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an ADMIN to stream a DRAFT product image regardless of ownership', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'DRAFT',
      });
      authorizationService.hasRole.mockResolvedValue(true);
      prisma.productImage.findFirst.mockResolvedValue({
        storageKey: 'generated-uuid.png',
      });
      storage.createReadStream.mockResolvedValue('the-stream');

      const result = await service.resolveStreamable(
        'product-uuid',
        'image-uuid',
        user,
      );

      expect(result.mimeType).toBe('image/png');
      expect(ownershipService.getVendorIdForUser).not.toHaveBeenCalled();
    });

    it('reports not-found for a nonexistent product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveStreamable('missing-uuid', 'image-uuid', user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports not-found when the image row does not exist under this product', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'ACTIVE',
      });
      prisma.productImage.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveStreamable('product-uuid', 'missing-image-uuid', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports not-found (not a 500) when the DB row exists but the physical file is missing', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'product-uuid',
        status: 'ACTIVE',
      });
      prisma.productImage.findFirst.mockResolvedValue({
        storageKey: 'generated-uuid.jpg',
      });
      storage.createReadStream.mockRejectedValue(
        new StorageFileNotFoundError('gone'),
      );

      await expect(
        service.resolveStreamable('product-uuid', 'image-uuid', undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the DB row first, then best-effort deletes the on-disk file', async () => {
      prisma.productImage.findFirst.mockResolvedValue({
        id: 'image-uuid',
        storageKey: 'generated-uuid.jpg',
      });

      const calls: string[] = [];
      prisma.productImage.delete.mockImplementation(async () => {
        calls.push('db-delete');
      });
      storage.deleteFile.mockImplementation(async () => {
        calls.push('file-delete');
      });

      await service.remove('product-uuid', 'image-uuid');

      expect(calls).toEqual(['db-delete', 'file-delete']);
      expect(prisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: 'image-uuid' },
      });
      expect(storage.deleteFile).toHaveBeenCalledWith('generated-uuid.jpg');
    });

    it('rejects deleting an image that does not exist under this product', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('product-uuid', 'missing-image-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.productImage.delete).not.toHaveBeenCalled();
    });
  });
});
