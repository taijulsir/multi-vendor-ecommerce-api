import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import {
  isProductActive,
  isVendorActive,
} from '../catalog/products/utils/availability';
import {
  Prisma,
  type CartItem,
  type ProductVariant,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddressDto } from './dto/address.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { generateOrderNumber } from './utils/order-number';
import { toMasterOrderView, type MasterOrderView } from './utils/order-view';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const EMPTY_CART_MESSAGE = 'Your cart is empty or does not exist';
const INVALID_ITEM_MESSAGE =
  'Your cart contains an item that is no longer available for purchase';
const CURRENCY_MISMATCH_MESSAGE =
  "An item's currency no longer matches the cart's currency";
const INSUFFICIENT_INVENTORY_MESSAGE =
  'One or more items in your cart no longer have sufficient stock';
// Deliberately identical wording/shape to the "cart already checked out"
// race case — a request that loses a concurrent-checkout race gets the
// same 409 as one that arrives after the cart genuinely has no stock,
// rather than a distinguishable "someone already checked this cart out"
// message that would leak timing information.
const CART_NO_LONGER_ACTIVE_MESSAGE = 'Your cart is empty or does not exist';

type ValidatedVariant = ProductVariant & {
  product: {
    id: string;
    name: string;
    vendorId: string;
    status: string;
    deletedAt: Date | null;
    vendor: { id: string; status: string; deletedAt: Date | null };
  };
  inventory: { id: string; onHand: number; reserved: number } | null;
};

interface CheckoutLine {
  item: CartItem;
  variant: ValidatedVariant;
}

/**
 * Checkout (Phase 13) — turns the authenticated user's active Cart into
 * a MasterOrder + one VendorOrder per distinct vendor + OrderItems,
 * exactly following the flow docs/database/order.md §37 documents:
 * validate cart → validate product/variant → validate vendor → validate
 * current prices → validate currency → validate inventory → reserve
 * inventory → create MasterOrder → group by vendor → create VendorOrders
 * → create OrderItems → create status history → convert cart.
 *
 * Deliberately NOT implemented, and why (see this phase's final report
 * for the full reasoning):
 *  - No Payment/PaymentAttempt record is created. `docs/database/
 *    payment-refund.md`'s own Implementation Status marks "Payment APIs"
 *    and "Gateway integration" as NOT IMPLEMENTED, and `Payment.provider`
 *    is a required field with no configured gateway to supply it —
 *    MasterOrder.paymentStatus simply keeps its schema default (PENDING).
 *  - No Commission/WalletTransaction record is created, and
 *    `VendorOrder.commissionAmount`/`vendorNetAmount` stay at their
 *    schema default (0). No commission rate exists anywhere in the
 *    persisted data model (`Commission.rate` has no default and nothing
 *    configures it), and `docs/database/wallet-commission.md` itself
 *    marks its Commission/Wallet services as NOT IMPLEMENTED.
 *  - No coupon/discount is accepted or applied. `docs/database/
 *    promotion.md`'s own Implementation Status marks the entire
 *    Promotion/Coupon domain as NOT IMPLEMENTED (no calculation service,
 *    no redemption service exist anywhere in this codebase).
 *  - `shippingAmount`/`taxAmount`/`serviceFee` stay at their schema
 *    default (0) on every order — no shipping-rate or tax-calculation
 *    rule is documented anywhere in the required source documents.
 */
@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<MasterOrderView> {
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { items: true },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException(EMPTY_CART_MESSAGE);
    }

    const lines = await this.validateAndLoadLines(cart.items, cart.currency);

    const groupedByVendor = new Map<string, CheckoutLine[]>();
    for (const line of lines) {
      const vendorId = line.variant.product.vendorId;
      const group = groupedByVendor.get(vendorId) ?? [];
      group.push(line);
      groupedByVendor.set(vendorId, group);
    }

    const shippingAddress = dto.shippingAddress;
    const billingAddress = dto.billingAddress ?? dto.shippingAddress;

    const masterOrderNumber = await this.reserveUniqueOrderNumber('ORD', (n) =>
      this.prisma.masterOrder.count({ where: { orderNumber: n } }),
    );

    const masterOrder = await this.prisma.$transaction(async (tx) => {
      // Atomic idempotency/concurrency guard: this only succeeds once
      // per cart. A concurrent or retried checkout request against the
      // same cart loses this race and gets the same "no active cart"
      // outcome a legitimately-empty cart would — see the class
      // doc-comment and this phase's final report for why no separate
      // idempotency-key mechanism was introduced.
      const converted = await tx.cart.updateMany({
        where: { id: cart.id, status: 'ACTIVE' },
        data: { status: 'CONVERTED' },
      });

      if (converted.count === 0) {
        throw new ConflictException(CART_NO_LONGER_ACTIVE_MESSAGE);
      }

      // Atomic, transaction-safe stock reservation — a single
      // conditional UPDATE per variant rather than a
      // SELECT-then-check-then-UPDATE, per docs/database/catalog.md §47
      // and docs/database/order.md §37 ("Reserve Inventory"). Increments
      // `reserved` only; `onHand` is untouched (docs/database/cart.md
      // §16-17 / catalog.md §30-32).
      for (const line of lines) {
        const affected = await tx.$executeRaw`
          UPDATE inventories
          SET reserved = reserved + ${line.item.quantity}, updated_at = now()
          WHERE variant_id = ${line.variant.id}::uuid
            AND on_hand - reserved >= ${line.item.quantity}
        `;

        if (affected === 0) {
          throw new ConflictException(INSUFFICIENT_INVENTORY_MESSAGE);
        }
      }

      let subtotal = new Prisma.Decimal(0);
      for (const line of lines) {
        subtotal = subtotal.add(line.variant.price.mul(line.item.quantity));
      }

      const createdMasterOrder = await this.createOrderOrTranslateCollision(
        () =>
          tx.masterOrder.create({
            data: {
              orderNumber: masterOrderNumber,
              userId,
              currency: cart.currency,
              subtotal,
              totalAmount: subtotal,
              shippingAddressSnapshot: this.toSnapshot(shippingAddress),
              billingAddressSnapshot: this.toSnapshot(billingAddress),
              customerNote: dto.customerNote,
              placedAt: new Date(),
            },
          }),
      );

      await tx.orderStatusHistory.create({
        data: {
          masterOrderId: createdMasterOrder.id,
          fromStatus: null,
          toStatus: 'PENDING',
          changedBy: userId,
        },
      });

      for (const [vendorId, vendorLines] of groupedByVendor) {
        let vendorSubtotal = new Prisma.Decimal(0);
        for (const line of vendorLines) {
          vendorSubtotal = vendorSubtotal.add(
            line.variant.price.mul(line.item.quantity),
          );
        }

        const vendorOrderNumber = await this.reserveUniqueOrderNumber(
          'VO',
          (n) => tx.vendorOrder.count({ where: { orderNumber: n } }),
        );

        const vendorOrder = await this.createOrderOrTranslateCollision(() =>
          tx.vendorOrder.create({
            data: {
              masterOrderId: createdMasterOrder.id,
              vendorId,
              orderNumber: vendorOrderNumber,
              subtotal: vendorSubtotal,
              totalAmount: vendorSubtotal,
            },
          }),
        );

        await tx.vendorOrderStatusHistory.create({
          data: {
            vendorOrderId: vendorOrder.id,
            fromStatus: null,
            toStatus: 'PENDING',
            changedBy: userId,
          },
        });

        for (const line of vendorLines) {
          const lineTotal = line.variant.price.mul(line.item.quantity);

          const orderItem = await tx.orderItem.create({
            data: {
              vendorOrderId: vendorOrder.id,
              productId: line.variant.product.id,
              variantId: line.variant.id,
              productName: line.variant.product.name,
              variantName: line.variant.name,
              sku: line.variant.sku,
              attributes: line.variant.attributes as Prisma.InputJsonValue,
              unitPrice: line.variant.price,
              quantity: line.item.quantity,
              totalAmount: lineTotal,
              currency: line.variant.currency,
            },
          });

          await tx.inventoryTransaction.create({
            data: {
              inventoryId: line.variant.inventory!.id,
              type: 'RESERVATION',
              quantity: line.item.quantity,
              referenceType: 'ORDER_ITEM',
              referenceId: orderItem.id,
            },
          });
        }
      }

      return tx.masterOrder.findUniqueOrThrow({
        where: { id: createdMasterOrder.id },
        include: { vendorOrders: { include: { items: true } } },
      });
    });

    return toMasterOrderView(masterOrder);
  }

  /**
   * Re-fetches every cart item's variant fresh from the database
   * (docs/database/order.md §37: "Validate Current Prices" — the cart's
   * own `unitPriceSnapshot` is never trusted here) and re-applies the
   * same availability rule Cart uses for add-item, plus the two checks
   * that are checkout-specific: currency compatibility with the cart and
   * inventory existence/availability.
   */
  private async validateAndLoadLines(
    items: CartItem[],
    cartCurrency: string,
  ): Promise<CheckoutLine[]> {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: items.map((item) => item.variantId) },
        deletedAt: null,
      },
      include: {
        product: { include: { vendor: true } },
        inventory: true,
      },
    });

    const variantById = new Map(variants.map((v) => [v.id, v]));
    const lines: CheckoutLine[] = [];

    for (const item of items) {
      const variant = variantById.get(item.variantId);

      if (!variant || variant.status !== 'ACTIVE') {
        throw new BadRequestException(INVALID_ITEM_MESSAGE);
      }

      if (
        !isProductActive(variant.product) ||
        !isVendorActive(variant.product.vendor)
      ) {
        throw new BadRequestException(INVALID_ITEM_MESSAGE);
      }

      if (variant.currency !== cartCurrency) {
        throw new ConflictException(CURRENCY_MISMATCH_MESSAGE);
      }

      // No Inventory row at all means availability can never be
      // verified — treated the same as insufficient stock rather than
      // silently allowing unlimited/untracked purchase.
      if (
        !variant.inventory ||
        variant.inventory.onHand - variant.inventory.reserved < item.quantity
      ) {
        throw new ConflictException(INSUFFICIENT_INVENTORY_MESSAGE);
      }

      lines.push({ item, variant: variant });
    }

    return lines;
  }

  private toSnapshot(address: AddressDto): Prisma.InputJsonValue {
    return {
      fullName: address.fullName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      city: address.city,
      state: address.state ?? null,
      postalCode: address.postalCode,
      country: address.country,
    };
  }

  /**
   * `reserveUniqueOrderNumber`'s pre-check makes a collision vanishingly
   * unlikely, but not impossible (a concurrent request could win the gap
   * between the check and this insert). This is the final backstop: a
   * genuine `orderNumber` unique-constraint violation is translated to a
   * 409 instead of leaking a raw Prisma error, rather than silently
   * retried — retrying an entire multi-record order-creation transaction
   * for an event this improbable is not worth the complexity (see this
   * phase's final report).
   */
  private async createOrderOrTranslateCollision<T>(
    create: () => Promise<T>,
  ): Promise<T> {
    try {
      return await create();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'A duplicate order number was generated; please retry checkout',
        );
      }

      throw error;
    }
  }

  private async reserveUniqueOrderNumber(
    prefix: 'ORD' | 'VO',
    countExisting: (orderNumber: string) => Promise<number>,
  ): Promise<string> {
    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateOrderNumber(prefix);

      if ((await countExisting(candidate)) === 0) {
        return candidate;
      }
    }

    throw new Error(
      `Failed to generate a unique ${prefix} order number after ${MAX_ATTEMPTS} attempts`,
    );
  }
}
