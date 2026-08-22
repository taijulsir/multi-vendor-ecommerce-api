import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Inventory restock input (Phase 21, ADR-4). `RESTOCK` (docs/database/
 * catalog.md §38) only ever adds stock — `quantity` must be positive.
 * No `onHand`/`reserved` field exists here: those are never client-
 * supplied, only ever derived from the existing value plus this delta.
 */
export class RestockInventoryDto {
  @ApiProperty({ example: 20, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ example: 'Received shipment #4821' })
  @IsOptional()
  @IsString()
  note?: string;
}
