import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProductOwnershipGuard } from '../../auth/guards/product-ownership.guard';
import type { SafeUser } from '../../auth/utils/safe-user';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

/**
 * Product creation/retrieval/update (Phase 11). Controller stays thin:
 * identity resolution, ownership, and persistence live in ProductsService
 * and ProductOwnershipGuard — see their doc-comments.
 *
 * Same two-route-shape pattern as ShopsController, for the same reason:
 * `/products/slug/:slug` (public) vs `/products/:productId`
 * (ownership-protected) avoid a routing collision that a shared
 * single-segment pattern would create.
 */
@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Create a product for the authenticated vendor's own profile",
    description:
      '`vendorId` is always resolved server-side from the access token ' +
      '— the request body cannot specify whose product this is ' +
      '(docs/database/catalog.md §8).',
  })
  @ApiCreatedResponse({ description: 'Product created.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'The authenticated account has no vendor profile.',
  })
  @ApiConflictResponse({ description: 'The requested slug is already in use.' })
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateProductDto) {
    return this.productsService.createForUser(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Public storefront product list',
    description:
      'Unauthenticated. Returns only `ACTIVE`, non-deleted products, ' +
      'paginated per docs/architecture.md §16. No category/vendor/search ' +
      'filter exists — none is documented for this resource.',
  })
  @ApiOkResponse({
    description: 'A page of public products.',
    schema: {
      example: {
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid page/limit query parameter.' })
  findPublicList(@Query() query: ListProductsQueryDto) {
    return this.productsService.findPublicList(query);
  }

  @Get('slug/:slug')
  @ApiOperation({
    summary: 'Public storefront lookup by slug',
    description:
      'Unauthenticated. Returns only the storefront-relevant fields for ' +
      'an ACTIVE product. A product that does not exist, is not ACTIVE, ' +
      'or is soft-deleted is reported identically as not found.',
  })
  @ApiParam({ name: 'slug', description: "The product's public, unique slug." })
  @ApiOkResponse({ description: 'The public product details.' })
  @ApiNotFoundResponse({ description: 'No active product with this slug.' })
  findPublicBySlug(@Param('slug') slug: string) {
    return this.productsService.findPublicBySlug(slug);
  }

  @Get(':productId')
  @UseGuards(JwtAuthGuard, ProductOwnershipGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'productId',
    description:
      "The product's id. Never trusted as an ownership claim by itself " +
      "— the caller's own vendor identity is resolved server-side and " +
      'checked against this product (ProductOwnershipGuard).',
  })
  @ApiOperation({
    summary: 'Get product details for vendor management',
    description: 'Requires the caller to own this product, or be an ADMIN.',
  })
  @ApiOkResponse({ description: 'The full product record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  findById(@Param('productId') productId: string) {
    return this.productsService.findById(productId);
  }

  @Patch(':productId')
  @UseGuards(JwtAuthGuard, ProductOwnershipGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'productId',
    description:
      "The product's id. Never trusted as an ownership claim by itself " +
      "— the caller's own vendor identity is resolved server-side and " +
      'checked against this product (ProductOwnershipGuard).',
  })
  @ApiOperation({
    summary: 'Update your own product',
    description:
      'Requires the caller to own this product, or be an ADMIN. Only ' +
      'the fields defined on UpdateProductDto can be changed — ' +
      'ownership, identity, and audit fields are never client-modifiable.',
  })
  @ApiOkResponse({ description: 'The updated product record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiConflictResponse({ description: 'The requested slug is already in use.' })
  update(@Param('productId') productId: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(productId, dto);
  }
}
