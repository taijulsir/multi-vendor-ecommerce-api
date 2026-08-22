import { randomUUID } from 'node:crypto';
import type { ReadStream } from 'node:fs';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthorizationService } from '../../auth/authorization/authorization.service';
import { OwnershipService } from '../../auth/authorization/ownership.service';
import type { SafeUser } from '../../auth/utils/safe-user';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LocalFileStorageService,
  StorageFileNotFoundError,
} from '../../storage/storage.service';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import {
  mimeTypeForExtension,
  validateImageFile,
} from './utils/image-validation';
import {
  toPublicProductImage,
  type PublicProductImage,
} from './utils/public-product-image';

const PRODUCT_NOT_FOUND_MESSAGE = 'Product not found';
const IMAGE_NOT_FOUND_MESSAGE = 'Image not found';
const INVALID_VARIANT_MESSAGE =
  'variantId does not reference a variant of this product';
// Deliberately identical in shape to ProductOwnershipGuard's own
// message — same non-disclosure principle for the streaming endpoint's
// authenticated-but-not-owner branch.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

export interface StreamableImage {
  stream: ReadStream;
  mimeType: string;
}

/**
 * ProductImage upload/stream/delete (Phase 22,
 * docs/remaining-architecture-plan.md Section 8/11).
 *
 * Upload ownership is enforced entirely by `ProductOwnershipGuard` on the
 * controller (reused unchanged, same pattern as ProductVariants) — this
 * service does not re-check it. The one route this service *does* its
 * own authorization for is `resolveStreamable`: its "mixed" auth model
 * (public for an ACTIVE product, owner/ADMIN-only otherwise) doesn't fit
 * `ProductOwnershipGuard`'s unconditional-auth shape, so it composes the
 * same underlying building blocks (`OwnershipService`,
 * `AuthorizationService`) the guard itself uses, rather than duplicating
 * ownership logic in a new guard.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalFileStorageService,
    private readonly ownershipService: OwnershipService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /**
   * Validate → write file → create DB row referencing it (docs/
   * remaining-architecture-plan.md Section 8's "Transaction
   * considerations"). The filesystem write and the Postgres write cannot
   * share a transaction, so on DB failure the just-written file is
   * deleted (best-effort) to avoid an orphan — the file write happens
   * first specifically so that a DB failure has a cheap, safe rollback,
   * unlike the reverse ordering.
   */
  async upload(
    productId: string,
    file: Express.Multer.File | undefined,
    dto: CreateProductImageDto,
  ): Promise<PublicProductImage> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('An image file is required');
    }

    // ProductOwnershipGuard's ADMIN bypass returns before checking
    // existence at all (see its doc-comment), so a nonexistent productId
    // can still reach here for an ADMIN caller — checked explicitly
    // rather than discovered via a Prisma FK-violation after the file
    // has already been written.
    await this.assertProductExists(productId);

    if (dto.variantId) {
      await this.assertVariantBelongsToProduct(productId, dto.variantId);
    }

    const { extension } = await validateImageFile(file.buffer);
    const filename = this.storage.generateFilename(extension);

    await this.storage.writeFile(filename, file.buffer);

    const imageId = randomUUID();
    const url = `/api/products/${productId}/images/${imageId}`;

    try {
      const image = await this.prisma.productImage.create({
        data: {
          id: imageId,
          productId,
          variantId: dto.variantId,
          url,
          storageKey: filename,
          altText: dto.altText,
          isPrimary: dto.isPrimary ?? false,
        },
      });

      return toPublicProductImage(image);
    } catch (error) {
      // Compensating cleanup — the file write succeeded but the DB row
      // did not, so remove the now-orphaned file. Best-effort by
      // design (see LocalFileStorageService.deleteFile's doc-comment);
      // never masks the original DB error.
      await this.storage.deleteFile(filename);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
      }

      throw error;
    }
  }

  /**
   * Resolves a streamable file for `GET /products/:productId/images/:imageId`.
   * Visibility is inherited from the parent Product's own status
   * (docs/remaining-architecture-plan.md Section 8): an `ACTIVE` product's
   * images are publicly streamable; anything else requires the caller to
   * own the product or be an ADMIN — the same check
   * `ProductOwnershipGuard` performs, applied here directly since this
   * route's auth is optional, not mandatory.
   */
  async resolveStreamable(
    productId: string,
    imageId: string,
    user: SafeUser | undefined,
  ): Promise<StreamableImage> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!product) {
      throw new NotFoundException(IMAGE_NOT_FOUND_MESSAGE);
    }

    if (product.status !== 'ACTIVE') {
      if (!user) {
        // Unauthenticated caller, non-public product: do not disclose
        // that it exists, same non-disclosure principle as
        // `findPublicBySlug`'s uniform "not found" for any invisible
        // product.
        throw new NotFoundException(IMAGE_NOT_FOUND_MESSAGE);
      }

      const isAdmin = await this.authorizationService.hasRole(user.id, 'ADMIN');

      if (!isAdmin) {
        const vendorId = await this.ownershipService.getVendorIdForUser(
          user.id,
        );
        const owns = vendorId
          ? await this.ownershipService.isProductOwnedByVendor(
              productId,
              vendorId,
            )
          : false;

        if (!owns) {
          throw new ForbiddenException(FORBIDDEN_MESSAGE);
        }
      }
    }

    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId, deletedAt: null },
      select: { storageKey: true },
    });

    if (!image || !image.storageKey) {
      throw new NotFoundException(IMAGE_NOT_FOUND_MESSAGE);
    }

    try {
      const stream = await this.storage.createReadStream(image.storageKey);
      const extension = extensionOf(image.storageKey);

      return { stream, mimeType: mimeTypeForExtension(extension) };
    } catch (error) {
      if (error instanceof StorageFileNotFoundError) {
        throw new NotFoundException(IMAGE_NOT_FOUND_MESSAGE);
      }

      throw error;
    }
  }

  /**
   * Deletes the `ProductImage` row, then best-effort deletes the on-disk
   * file (docs/remaining-architecture-plan.md Section 8: "deleting a
   * `ProductImage` row deletes the on-disk file in the same request,
   * best-effort"). DB-delete-first: if the DB delete succeeds but the
   * file delete fails, the result is a harmless orphan file (an accepted
   * disk-space concern per the approved design); the reverse ordering
   * would risk a DB row pointing at a file that no longer exists.
   */
  async remove(productId: string, imageId: string): Promise<void> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId, deletedAt: null },
    });

    if (!image) {
      throw new NotFoundException(IMAGE_NOT_FOUND_MESSAGE);
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });

    if (image.storageKey) {
      await this.storage.deleteFile(image.storageKey);
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    }
  }

  private async assertVariantBelongsToProduct(
    productId: string,
    variantId: string,
  ): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
      select: { id: true },
    });

    if (!variant) {
      throw new BadRequestException(INVALID_VARIANT_MESSAGE);
    }
  }
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index);
}
