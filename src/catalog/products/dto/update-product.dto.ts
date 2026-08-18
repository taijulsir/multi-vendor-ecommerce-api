import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

/**
 * Product update input. `vendorId`, `id`, `createdAt`, `updatedAt`, and
 * `deletedAt` are never part of this DTO — ownership, identity, and
 * audit fields are not client-modifiable (docs/database/catalog.md §8).
 *
 * `productType` is deliberately excluded: docs/database/catalog.md §22
 * requires SIMPLE products to have exactly one default variant and
 * VARIABLE products to manage multiple — since `ProductVariant`
 * management is out of scope for this phase, allowing `productType` to
 * change after creation could leave the product inconsistent with a
 * rule this phase has no variant-management logic to enforce.
 *
 * `status` accepts any of the four documented values — unlike Shop,
 * nothing in §4 singles out one value as administrator-only, so no
 * subset restriction is applied.
 */
export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Apple iPhone 17 Pro Max' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'apple-iphone-17-pro-max' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug?: string;

  @ApiPropertyOptional({ example: 'The latest flagship phone.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'The primary category this product belongs to.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES, example: 'ACTIVE' })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];
}
