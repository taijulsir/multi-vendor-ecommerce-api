import type { ProductImage } from '../../../generated/prisma/client';

/**
 * The API-safe shape of a `ProductImage`. `storageKey` (the actual
 * on-disk filename) and `deletedAt` are deliberately excluded — never
 * expose internal storage implementation details in a response
 * (Phase 22 Step 16), mirroring the explicit-allowlist pattern already
 * used by `toPublicProduct`/`toSafeUser`.
 */
export type PublicProductImage = Pick<
  ProductImage,
  | 'id'
  | 'productId'
  | 'variantId'
  | 'url'
  | 'altText'
  | 'sortOrder'
  | 'isPrimary'
  | 'createdAt'
  | 'updatedAt'
>;

export function toPublicProductImage(image: ProductImage): PublicProductImage {
  return {
    id: image.id,
    productId: image.productId,
    variantId: image.variantId,
    url: image.url,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
}
