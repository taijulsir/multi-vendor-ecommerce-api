import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// docs/database/vendor-shop.md §10: ACTIVE is described as the vendor's
// normal operating state, and INACTIVE explicitly "may be caused by the
// vendor disabling the shop" — i.e. vendor-initiated. SUSPENDED is
// described as "restricted by the platform or an administrator" — not a
// state a vendor may set on themselves. This DTO therefore only accepts
// the two vendor-controllable values; SUSPENDED (a valid ShopStatus
// value, just not one this actor may set) is rejected as an invalid
// request body, same as any other value outside the allowed set.
const VENDOR_SETTABLE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
type VendorSettableShopStatus = (typeof VENDOR_SETTABLE_STATUSES)[number];

/**
 * Shop update input. Only the fields docs/database/vendor-shop.md §9
 * identifies as Shop's own descriptive/storefront fields are here.
 * `vendorId`, `id`, `createdAt`, `updatedAt`, and `deletedAt` are never
 * part of this DTO — ownership, identity, and audit fields are not
 * client-modifiable (docs/database/vendor-shop.md §19-20).
 */
export class UpdateShopDto {
  @ApiPropertyOptional({ example: 'Taijul Electronics' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'taijul-electronics' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug?: string;

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

  @ApiPropertyOptional({
    enum: VENDOR_SETTABLE_STATUSES,
    example: 'INACTIVE',
    description:
      'Only ACTIVE and INACTIVE may be set by the owning vendor — ' +
      'SUSPENDED is platform/administrator-controlled (docs/database/' +
      'vendor-shop.md §10) and is rejected here.',
  })
  @IsOptional()
  @IsIn(VENDOR_SETTABLE_STATUSES)
  status?: VendorSettableShopStatus;
}
