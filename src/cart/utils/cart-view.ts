import {
  Prisma,
  type Cart,
  type CartItem,
} from '../../generated/prisma/client';

/**
 * The API response shape for "the current user's cart". Not the raw
 * Prisma `Cart` row: it adds `subtotal` per item and `total` for the
 * cart, both *computed*, never persisted — docs/database/cart.md's
 * schema (§3, §8) stores no total/subtotal column, and "Cart Totals"
 * instructs calculating from authoritative values rather than storing
 * derived totals.
 *
 * When the user has no ACTIVE cart yet (nothing has ever been added, or
 * everything has been removed/cleared), `GET /api/cart` still returns
 * 200 with this same shape, synthesized rather than backed by a Cart
 * row — see `emptyCartView` and CartService's doc-comment for why no
 * empty Cart row is created just to answer a read.
 */
export interface CartItemView {
  id: string;
  variantId: string;
  quantity: number;
  unitPriceSnapshot: string;
  currency: string;
  selectedAttributes: Prisma.JsonValue;
  subtotal: string;
}

export interface CartView {
  id: string | null;
  status: Cart['status'] | null;
  currency: string | null;
  expiresAt: Date | null;
  items: CartItemView[];
  total: string;
}

function toItemView(item: CartItem): CartItemView {
  const subtotal = item.unitPriceSnapshot.mul(item.quantity);

  return {
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPriceSnapshot: item.unitPriceSnapshot.toFixed(2),
    currency: item.currency,
    selectedAttributes: item.selectedAttributes,
    subtotal: subtotal.toFixed(2),
  };
}

export function toCartView(cart: Cart, items: CartItem[]): CartView {
  const itemViews = items.map(toItemView);
  const total = items
    .reduce(
      (sum, item) => sum.add(item.unitPriceSnapshot.mul(item.quantity)),
      new Prisma.Decimal(0),
    )
    .toFixed(2);

  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    expiresAt: cart.expiresAt,
    items: itemViews,
    total,
  };
}

export function emptyCartView(): CartView {
  return {
    id: null,
    status: null,
    currency: null,
    expiresAt: null,
    items: [],
    total: '0.00',
  };
}
