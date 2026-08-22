import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { RestockInventoryDto } from './dto/restock-inventory.dto';
import { toInventoryView, type InventoryView } from './utils/inventory-view';

const VARIANT_NOT_FOUND_MESSAGE = 'Variant not found';
const ZERO_DELTA_MESSAGE = 'delta must not be 0';
const INVALID_ADJUSTMENT_MESSAGE =
  'This adjustment would make onHand negative or fall below reserved stock';

/**
 * Inventory view/restock/adjust (Phase 21, ADR-4 — vendor-self-service,
 * ADMIN bypass via the existing `ProductOwnershipGuard` on every route's
 * `:productId` param). Reservation/release remain exclusively
 * `CheckoutService`'s concern (Phase 13, unchanged) — nothing here
 * reserves, releases, or marks stock sold; see this phase's final report
 * for the exact boundary.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async findVariantInventory(productId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
      include: { inventory: true },
    });

    if (!variant || !variant.inventory) {
      throw new NotFoundException(VARIANT_NOT_FOUND_MESSAGE);
    }

    return variant.inventory;
  }

  async findForVariant(
    productId: string,
    variantId: string,
  ): Promise<InventoryView> {
    const inventory = await this.findVariantInventory(productId, variantId);

    return toInventoryView(inventory);
  }

  /**
   * `RESTOCK` only ever adds stock (docs/database/catalog.md §38), so no
   * invariant can be violated by it — a plain atomic `increment` is
   * already race-safe under Postgres's row-level locking, with no
   * conditional `WHERE` needed (unlike `adjust`, below).
   */
  async restock(
    productId: string,
    variantId: string,
    dto: RestockInventoryDto,
    actorUserId: string,
  ): Promise<InventoryView> {
    const inventory = await this.findVariantInventory(productId, variantId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.inventory.update({
        where: { id: inventory.id },
        data: { onHand: { increment: dto.quantity } },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: 'RESTOCK',
          quantity: dto.quantity,
          note: dto.note,
          createdBy: actorUserId,
        },
      });

      return result;
    });

    return toInventoryView(updated);
  }

  /**
   * `ADJUSTMENT` may be positive or negative (docs/database/catalog.md
   * §43). Unlike `restock`, a negative delta can violate `onHand >= 0`
   * or `reserved <= onHand`, so this uses the same single atomic
   * conditional `UPDATE` pattern already proven in `CheckoutService`'s
   * inventory reservation — never a SELECT-then-check-then-UPDATE
   * sequence (docs/database/catalog.md §47's explicit warning). The
   * existing DB-level `CHECK` constraints
   * (`inventories_on_hand_non_negative`, `inventories_reserved_lte_on_hand`)
   * remain the last-line defense; this check exists so a violation is a
   * clean 409, not a raw constraint-violation 500.
   */
  async adjust(
    productId: string,
    variantId: string,
    dto: AdjustInventoryDto,
    actorUserId: string,
  ): Promise<InventoryView> {
    if (dto.delta === 0) {
      throw new BadRequestException(ZERO_DELTA_MESSAGE);
    }

    const inventory = await this.findVariantInventory(productId, variantId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw`
        UPDATE inventories
        SET on_hand = on_hand + ${dto.delta}, updated_at = now()
        WHERE id = ${inventory.id}::uuid
          AND on_hand + ${dto.delta} >= 0
          AND on_hand + ${dto.delta} >= reserved
      `;

      if (affected === 0) {
        throw new ConflictException(INVALID_ADJUSTMENT_MESSAGE);
      }

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: 'ADJUSTMENT',
          quantity: dto.delta,
          note: dto.note,
          createdBy: actorUserId,
        },
      });

      return tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
    });

    return toInventoryView(updated);
  }
}
