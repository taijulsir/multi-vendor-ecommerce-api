import type { Product, Vendor } from '../../../generated/prisma/client';

/**
 * Shared "is this product/vendor currently a valid purchase target"
 * predicates. Extracted so `CartService` (add-item) and `CheckoutService`
 * (checkout) apply the exact same availability rule instead of each
 * re-deriving it — see docs/database/cart.md §22 and
 * docs/database/order.md §37, which both list "Validate Product/Variant"
 * and "Validate Vendor" as steps using the same underlying concept
 * (ACTIVE, non-deleted). Only the rule lives here; each caller still
 * fetches whatever additional data (e.g. Inventory) it specifically
 * needs.
 */
export function isProductActive(
  product: Pick<Product, 'status' | 'deletedAt'>,
): boolean {
  return product.status === 'ACTIVE' && product.deletedAt === null;
}

export function isVendorActive(
  vendor: Pick<Vendor, 'status' | 'deletedAt'>,
): boolean {
  return vendor.status === 'ACTIVE' && vendor.deletedAt === null;
}
