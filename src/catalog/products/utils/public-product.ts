import type { Product } from '../../../generated/prisma/client';

/**
 * The storefront-facing shape of a Product. `vendorId` is deliberately
 * excluded — it is the ownership-chain field
 * (docs/database/catalog.md §8), not storefront-relevant, mirroring the
 * same exclusion already applied to Shop's public shape
 * (src/shops/utils/public-shop.ts). `categoryId` is included: it is a
 * classification, not an ownership identifier, and is useful for public
 * category-based browsing.
 */
export type PublicProduct = Pick<
  Product,
  | 'id'
  | 'categoryId'
  | 'name'
  | 'slug'
  | 'description'
  | 'status'
  | 'productType'
>;

/**
 * Maps a full `Product` record to its public-safe representation.
 * Explicit field allowlist, mirroring `toSafeUser`/`toPublicShop` — a
 * newly added Product field must be a conscious decision made here, not
 * an accidental leak.
 */
export function toPublicProduct(product: Product): PublicProduct {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    status: product.status,
    productType: product.productType,
  };
}

/**
 * The pagination envelope docs/architecture.md §16 specifies for
 * collection endpoints (Phase 20 is the first endpoint to implement it —
 * kept as a small, local type rather than a shared/generic pagination
 * abstraction, per this phase's scope: "smallest API that satisfies the
 * documented requirement").
 */
export interface PaginatedPublicProducts {
  data: PublicProduct[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
