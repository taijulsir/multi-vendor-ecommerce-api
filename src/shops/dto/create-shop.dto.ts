import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// docs/database/vendor-shop.md §11 describes the slug as "URL-friendly"
// (example: `taijul-electronics`). This is a light format check on that
// documented characteristic, not an invented business rule — lower-case
// alphanumerics separated by single hyphens, no leading/trailing/doubled
// hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Shop creation input, scoped to the client-provided fields defined for
 * `Shop` in docs/database/vendor-shop.md §9 (Fields). `vendorId` is never
 * part of this DTO — it is always resolved server-side from the
 * authenticated caller's own Vendor profile (docs/database/vendor-shop.md
 * §19, Security Considerations). `status` is also not part of this DTO:
 * it defaults to ACTIVE per the Prisma schema, matching §9/§10.
 */
export class CreateShopDto {
  @ApiProperty({ example: 'Taijul Electronics' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'taijul-electronics' })
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'Consumer electronics and accessories.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/banner.png' })
  @IsOptional()
  @IsString()
  bannerUrl?: string;
}
