import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Inventory adjustment input (Phase 21, ADR-4 — vendor-self-service,
 * ADMIN bypass via the existing `ProductOwnershipGuard`). `delta` may be
 * positive or negative (docs/database/catalog.md §43: "ADJUSTMENT -3" /
 * "ADJUSTMENT +5" — damaged/lost inventory vs. a correction upward).
 * `InventoryService.adjust` rejects a zero delta (a no-op, not a
 * documented adjustment) and any delta that would make `onHand` negative
 * or fall below `reserved` — both enforced atomically, never via a
 * SELECT-then-UPDATE race.
 */
export class AdjustInventoryDto {
  @ApiProperty({
    example: -3,
    description: 'Signed integer delta applied to onHand. Must not be 0.',
  })
  @IsInt()
  delta: number;

  @ApiPropertyOptional({ example: 'Damaged units removed' })
  @IsOptional()
  @IsString()
  note?: string;
}
