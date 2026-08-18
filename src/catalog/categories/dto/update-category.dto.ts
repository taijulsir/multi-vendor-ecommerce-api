import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/**
 * Category update input. `id`, `createdAt`, `updatedAt`, and `deletedAt`
 * are never part of this DTO — audit/identity fields are not
 * client-modifiable. `status` may be set to either documented value
 * (docs/database/catalog.md §2's "Category Status") since, unlike Shop,
 * both ACTIVE and INACTIVE are managed by the same actor here (ADMIN
 * only — see this phase's final report for that decision).
 */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Electronics' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'electronics' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be URL-friendly: lower-case letters, numbers, and single hyphens only',
  })
  slug?: string;

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
    description:
      'Parent category id. Rejected (400) if it would create a cycle ' +
      '(docs/database/catalog.md §2: "the application layer must ' +
      'prevent invalid category cycles").',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ enum: CATEGORY_STATUSES, example: 'INACTIVE' })
  @IsOptional()
  @IsIn(CATEGORY_STATUSES)
  status?: (typeof CATEGORY_STATUSES)[number];
}
