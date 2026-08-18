import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

// docs/database/catalog.md §7 describes the slug as globally unique and
// used for "human-readable URLs" — same light URL-friendly format check
// already used for Category/Shop slugs.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRODUCT_TYPES = ['SIMPLE', 'VARIABLE'] as const;

/**
 * Product creation input, scoped to the client-provided fields defined
 * for `Product` in docs/database/catalog.md §3 (Fields). `vendorId` is
 * never part of this DTO — it is always resolved server-side from the
 * authenticated caller's own Vendor profile (docs/database/catalog.md
 * §8: "The service layer must verify ownership before allowing
 * vendor-level mutations"). `status` is also not part of this DTO: it
 * defaults to DRAFT per the Prisma schema, matching §3/§4 ("the product
 * exists but is not published to customers").
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Apple iPhone 17 Pro Max' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'apple-iphone-17-pro-max' })
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'The latest flagship phone.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'The primary category this product belongs to.' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    enum: PRODUCT_TYPES,
    example: 'SIMPLE',
    description: 'Defaults to SIMPLE if omitted (docs/database/catalog.md §5).',
  })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: (typeof PRODUCT_TYPES)[number];
}
