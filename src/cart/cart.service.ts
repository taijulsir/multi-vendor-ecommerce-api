import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { isProductActive, isVendorActive } from '../catalog/products/utils/availability';
import { Prisma, type Cart, type CartItem } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartView, emptyCartView, toCartView } from './utils/cart-view';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// Deliberately identical in shape/generality to the ownership-denial
// messages elsewhere in this codebase (VendorShopOwnershipGuard,
// ProductOwnershipGuard) — never states whether the item/cart exists or
// belongs to someone else. Both are indistinguishable to the caller.
const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

const INVALID_VARIANT_MESSAGE =
  'variantId does not reference an available product variant';
const CURRENCY_MISMATCH_MESSAGE =
  "This item's currency does not match the cart's currency";

/**
 * Cart creation/retrieval/mutation (Phase 12).
 *
 * **Ownership model (deliberately not a guard, not OwnershipService):**
 * Cart is `User → Cart → CartItem` — a direct `userId` match, not the
 * `User → Vendor → <resource>` chain `OwnershipService`/
 * `VendorShopOwnershipGuard`/`ProductOwnershipGuard` exist for. Cart has
 * no vendor indirection at all, so reusing that vendor-ownership
 * machinery would be a type mismatch, not reuse. Per this phase's task
 * ("if [OwnershipService] is not appropriate because Cart is user-owned
 * rather than vendor-owned, keep Cart ownership logic inside
 * CartService"), every method here scopes its own Prisma query directly
 * to the authenticated `userId` — e.g. `cart: { userId, status: 'ACTIVE' }`
 * — rather than trusting any client-supplied id. No new guard, no new
 * generic ownership abstraction.
 *
 * **Add vs. Update validation asymmetry (deliberate, matches the docs):**
 * docs/database/cart.md §22 (Add Item Flow) explicitly validates the
 * variant/product/vendor state and currency compatibility every time an
 * item is added. §23 (Update Quantity Flow) does **not** list any of
 * those steps — only ownership + quantity validation. This service
 * mirrors that asymmetry: `updateItemQuantity` never re-touches
 * `unitPriceSnapshot`/`currency`/`selectedAttributes`; only `addItem`
 * (whether creating a new row or incrementing an existing one, per §10)
 * re-reads the authoritative variant and refreshes the snapshot.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { items: true },
    });

    if (!cart) {
      return emptyCartView();
    }

    return toCartView(cart, cart.items);
  }

  /**
   * Adds a variant to the caller's active cart, creating the cart if the
   * user has none yet. If the variant is already in the cart, its
   * quantity is incremented rather than a second row being created
   * (docs/database/cart.md §10, backed by `UNIQUE(cartId, variantId)`).
   *
   * Variant/product/vendor validation happens outside the transaction
   * (read-only); cart resolution + item upsert happen inside one
   * transaction so a concurrent "first add" from the same user can never
   * leave an inconsistent cart/item pair — see the class doc-comment and
   * this phase's final report for the atomicity analysis.
   */
  async addItem(userId: string, dto: AddCartItemDto): Promise<CartView> {
    const variant = await this.validateVariantForAdd(dto.variantId);
    const quantity = dto.quantity ?? 1;

    const existingCart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, currency: true },
    });

    if (existingCart && existingCart.currency !== variant.currency) {
      throw new ConflictException(CURRENCY_MISMATCH_MESSAGE);
    }

    const cart = await this.prisma.$transaction(async (tx) => {
      const activeCart = await this.getOrCreateActiveCart(
        tx,
        userId,
        variant.currency,
      );

      await tx.cartItem.upsert({
        where: {
          cartId_variantId: { cartId: activeCart.id, variantId: variant.id },
        },
        create: {
          cartId: activeCart.id,
          variantId: variant.id,
          quantity,
          unitPriceSnapshot: variant.price,
          currency: variant.currency,
          selectedAttributes: variant.attributes as Prisma.InputJsonValue,
        },
        update: {
          quantity: { increment: quantity },
          unitPriceSnapshot: variant.price,
          currency: variant.currency,
          selectedAttributes: variant.attributes as Prisma.InputJsonValue,
        },
      });

      return tx.cart.findUniqueOrThrow({
        where: { id: activeCart.id },
        include: { items: true },
      });
    });

    return toCartView(cart, cart.items);
  }

  async updateItemQuantity(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartView> {
    const item = await this.findOwnedActiveItem(userId, itemId);

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const item = await this.findOwnedActiveItem(userId, itemId);

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    return this.getCart(userId);
  }

  /**
   * Removes every item from the caller's active cart. A no-op (not an
   * error) when the user has no active cart at all — idempotent, same
   * convention as logout (Phase 7).
   */
  async clearCart(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    });

    if (!cart) {
      return emptyCartView();
    }

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    return this.getCart(userId);
  }

  /**
   * Resolves the user's active cart, creating one (with the given
   * currency) if none exists. The partial unique index
   * `cart_one_active_per_user` (`UNIQUE(userId) WHERE status = 'ACTIVE'`)
   * is the actual concurrency guard: if two requests race to create the
   * first cart for the same user, the loser's `create` throws P2002 and
   * this re-fetches the winner's row instead of failing the request.
   */
  private async getOrCreateActiveCart(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
  ): Promise<Cart> {
    const existing = await tx.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
    });

    if (existing) {
      return existing;
    }

    try {
      return await tx.cart.create({
        data: { userId, currency },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const raced = await tx.cart.findFirst({
          where: { userId, status: 'ACTIVE' },
        });

        if (raced) {
          return raced;
        }
      }

      throw error;
    }
  }

  /**
   * Docs/database/cart.md §22's Add Item Flow: validate the variant,
   * its product, and its vendor before touching the cart. All failures
   * are reported the same generic way (400) — the request references
   * something that is not currently a valid cart target — without
   * distinguishing "doesn't exist" from "inactive" from
   * "vendor unavailable", matching this codebase's established
   * non-disclosure convention.
   */
  private async validateVariantForAdd(variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null, status: 'ACTIVE' },
      include: {
        product: { include: { vendor: true } },
      },
    });

    if (!variant) {
      throw new BadRequestException(INVALID_VARIANT_MESSAGE);
    }

    const { product } = variant;

    // Shared with CheckoutService — see availability.ts's doc-comment.
    if (!isProductActive(product) || !isVendorActive(product.vendor)) {
      throw new BadRequestException(INVALID_VARIANT_MESSAGE);
    }

    return variant;
  }

  /**
   * Fails closed with the same generic 403 whether `itemId` belongs to
   * another user's cart, belongs to a non-ACTIVE (e.g. historical) cart
   * of the caller's own, or does not exist at all — the caller's
   * client-supplied `itemId` is never trusted as an ownership claim by
   * itself (docs/database/cart.md §20).
   */
  private async findOwnedActiveItem(
    userId: string,
    itemId: string,
  ): Promise<CartItem> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId, status: 'ACTIVE' } },
    });

    if (!item) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    return item;
  }
}
