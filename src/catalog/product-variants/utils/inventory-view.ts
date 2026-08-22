import type { Inventory } from '../../../generated/prisma/client';

/**
 * `available` is always derived (`onHand - reserved`), never stored —
 * docs/database/catalog.md §32 explicitly says storing it "would prevent
 * inconsistent states such as onHand=100, reserved=20, available=95" and
 * requires the service/query layer to compute it instead.
 */
export interface InventoryView {
  id: string;
  variantId: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toInventoryView(inventory: Inventory): InventoryView {
  return {
    id: inventory.id,
    variantId: inventory.variantId,
    onHand: inventory.onHand,
    reserved: inventory.reserved,
    available: inventory.onHand - inventory.reserved,
    lowStockThreshold: inventory.lowStockThreshold,
    createdAt: inventory.createdAt,
    updatedAt: inventory.updatedAt,
  };
}
