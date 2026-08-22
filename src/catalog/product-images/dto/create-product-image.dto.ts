import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * ProductImage upload metadata (Phase 22, docs/remaining-architecture-
 * plan.md Section 11): the file itself arrives as multipart, handled
 * separately by `FileInterceptor`/`@UploadedFile()` — this DTO only
 * covers the accompanying form fields. `productId` is never accepted
 * here: it comes from the route and is ownership-checked by
 * `ProductOwnershipGuard`, matching every other nested-under-product
 * resource in this codebase.
 */
export class CreateProductImageDto {
  @ApiPropertyOptional({
    description:
      'Attach this image to a specific variant of the product, rather ' +
      'than the product generally. Must reference a variant that ' +
      'belongs to this same product.',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiPropertyOptional({ example: 'Front view, black colorway' })
  @IsOptional()
  @IsString()
  altText?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this is the primary/cover image.',
  })
  @IsOptional()
  // multipart/form-data fields always arrive as strings — "false" would
  // otherwise pass a naive Boolean() cast as truthy.
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : Boolean(value),
  )
  @IsBoolean()
  isPrimary?: boolean;
}
