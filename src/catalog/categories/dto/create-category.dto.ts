import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

// docs/database/catalog.md §2 describes the slug as "URL-friendly" —
// same light format check already used for Shop/Product slugs.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Category creation input, scoped to the client-provided fields defined
 * for `Category` in docs/database/catalog.md §2 (Fields). `status`
 * defaults to ACTIVE per the Prisma schema and is not part of this DTO,
 * matching the same "server-controlled defaults are never
 * client-settable at creation" convention used for Vendor/Shop.
 */
export class CreateCategoryDto {
  @ApiProperty({ example: 'Electronics' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'electronics' })
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'Phones, laptops, and accessories.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/electronics.png' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    example: null,
    description: 'Parent category id. Omit/null for a root category.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
