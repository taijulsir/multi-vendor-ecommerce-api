import type { Shop } from '../../generated/prisma/client';

/**
 * The storefront-facing shape of a Shop — exactly the fields
 * docs/database/vendor-shop.md §7 (Purpose) lists as what a shop
 * "contains" for storefront purposes: name, slug, description, logo,
 * banner, status. `vendorId`, timestamps, and `deletedAt` are
 * deliberately excluded: they are not storefront-relevant, and
 * `vendorId` in particular is the ownership-chain field docs/database/
 * vendor-shop.md §19 says must never be exposed casually.
 */
export type PublicShop = Pick<
  Shop,
  'id' | 'name' | 'slug' | 'description' | 'logoUrl' | 'bannerUrl' | 'status'
>;

/**
 * Maps a full `Shop` record to its public-safe representation. Explicit
 * field allowlist, mirroring the same pattern as
 * `src/auth/utils/safe-user.ts`'s `toSafeUser` — a newly added Shop field
 * must be a conscious decision made here, not an accidental leak.
 */
export function toPublicShop(shop: Shop): PublicShop {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    description: shop.description,
    logoUrl: shop.logoUrl,
    bannerUrl: shop.bannerUrl,
    status: shop.status,
  };
}
