import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * Update-quantity input (docs/database/cart.md §23, Update Quantity
 * Flow). Quantity is the only field that flow updates — no price
 * revalidation happens here (that asymmetry vs. Add Item is intentional,
 * see CartService's doc-comment).
 */
export class UpdateCartItemDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
