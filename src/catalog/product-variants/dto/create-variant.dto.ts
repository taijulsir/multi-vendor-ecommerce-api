import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

// docs/database/catalog.md §15: three-letter ISO-4217-style codes,
// uppercase (BDT, USD, EUR, GBP examples). No enum exists in the schema
// (`currency String @db.Char(3)`), so this is a format check, not an
// allowlist of specific currencies.
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * ProductVariant creation input (Phase 21). Scoped to exactly the
 * client-provided fields documented in docs/database/catalog.md §10
 * (Fields). Server-controlled fields are intentionally absent:
 *
 * - `productId` comes from the route (`:productId`), never the body —
 *   ownership is resolved server-side via `ProductOwnershipGuard`,
 *   mirroring `CreateProductDto`'s existing exclusion of `vendorId`.
 * - `isDefault` is never client-settable. `ProductVariantsService`
 *   deterministically makes a product's *first* variant its default and
 *   never reassigns it thereafter — see the service's doc-comment for
 *   why (the exact reassignment/enforcement mechanism for "at most one
 *   default variant" is genuinely undefined by the source documents;
 *   this phase avoids the question entirely rather than inventing an
 *   answer — see this phase's final report).
 * - `status` is never accepted at creation — defaults to `ACTIVE` per
 *   `prisma/schema/catalog.prisma`, matching `CreateProductDto`'s
 *   equivalent omission for `Product.status` (status changes happen via
 *   the update endpoint instead).
 * - `attributes` is accepted as opaque JSON with no validation scheme —
 *   docs/database/catalog.md §18 explicitly states "the exact attribute-
 *   definition system is intentionally left open for future Catalog
 *   expansion," so none is invented here.
 */
export class CreateVariantDto {
  @ApiProperty({ example: 'NIKE-TSHIRT-BLK-M' })
  @IsString()
  @IsNotEmpty()
  sku: string;

  @ApiPropertyOptional({ example: 'Black / Medium' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: '2500.00',
    description: 'Decimal string — the current selling price.',
  })
  @IsNumberString()
  price: string;

  @ApiPropertyOptional({
    example: '3000.00',
    description:
      'Decimal string — reference/original price for discount display.',
  })
  @IsOptional()
  @IsNumberString()
  compareAtPrice?: string;

  @ApiPropertyOptional({
    example: '1800.00',
    description:
      "Decimal string — the vendor's internal cost. Never exposed to " +
      'public/customer-facing responses (docs/database/catalog.md §13).',
  })
  @IsOptional()
  @IsNumberString()
  costPrice?: string;

  @ApiProperty({ example: 'BDT', description: 'ISO-4217-style 3-letter code.' })
  @IsString()
  @Length(3, 3)
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter uppercase code (e.g. BDT, USD)',
  })
  currency: string;

  @ApiPropertyOptional({
    example: { color: 'Black', size: 'M' },
    description:
      'Free-form JSON. No fixed attribute schema exists in this phase.',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
