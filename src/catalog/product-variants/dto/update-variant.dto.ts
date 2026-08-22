import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

// docs/database/catalog.md §21: ACTIVE/INACTIVE/ARCHIVED — no SUSPENDED-
// style administrator-only value exists for ProductVariant (unlike
// ShopStatus), so all three are vendor-settable, matching the enum
// exactly with no restriction invented.
const VARIANT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

/**
 * ProductVariant update input (Phase 21). Same field set as
 * `CreateVariantDto`, all optional, plus `status`. `isDefault` is
 * deliberately excluded here too — see `CreateVariantDto`'s doc-comment
 * and `ProductVariantsService`'s for the full reasoning (no default-
 * variant reassignment mechanism is implemented in this phase).
 */
export class UpdateVariantDto {
  @ApiPropertyOptional({ example: 'NIKE-TSHIRT-BLK-M' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string;

  @ApiPropertyOptional({ example: 'Black / Medium' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '2500.00' })
  @IsOptional()
  @IsNumberString()
  price?: string;

  @ApiPropertyOptional({ example: '3000.00' })
  @IsOptional()
  @IsNumberString()
  compareAtPrice?: string;

  @ApiPropertyOptional({ example: '1800.00' })
  @IsOptional()
  @IsNumberString()
  costPrice?: string;

  @ApiPropertyOptional({ example: 'BDT' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter uppercase code (e.g. BDT, USD)',
  })
  currency?: string;

  @ApiPropertyOptional({ example: { color: 'Black', size: 'M' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: VARIANT_STATUSES, example: 'INACTIVE' })
  @IsOptional()
  @IsIn(VARIANT_STATUSES)
  status?: (typeof VARIANT_STATUSES)[number];
}
