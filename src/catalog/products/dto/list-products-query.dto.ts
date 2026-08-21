import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Query input for `GET /api/products` (Phase 20). Only pagination is
 * accepted — no category/vendor/search filter exists anywhere in
 * docs/database/catalog.md, so none is invented here (see this phase's
 * final report). `docs/architecture.md` §16 specifies the pagination
 * envelope shape (`{ data, meta: { page, limit, total, totalPages } }`)
 * but not field names for the query string itself; `page`/`limit` are
 * chosen to match those exact `meta` field names.
 */
export class ListProductsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: DEFAULT_PAGE,
    minimum: 1,
    description: '1-indexed page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    example: 20,
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `Page size, capped at ${MAX_LIMIT}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;
}
