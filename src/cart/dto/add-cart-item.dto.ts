import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Add-item input, scoped to what docs/database/cart.md §22 (Add Item
 * Flow) actually needs from the client: which variant, and how many.
 * `cartId`, `unitPriceSnapshot`, `currency`, and `selectedAttributes` are
 * never part of this DTO — the cart is resolved server-side from the
 * authenticated user, and price/currency/attributes are always read from
 * the authoritative `ProductVariant` row (docs/database/cart.md §12-13:
 * "Any price used by CartService must come from the database").
 */
export class AddCartItemDto {
  @ApiProperty({ description: 'The ProductVariant to add to the cart.' })
  @IsUUID()
  variantId: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: 'Requested quantity. Defaults to 1 if omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
