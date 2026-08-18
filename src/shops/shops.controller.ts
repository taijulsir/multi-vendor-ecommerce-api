import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VendorShopOwnershipGuard } from '../auth/guards/vendor-shop-ownership.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopsService } from './shops.service';

/**
 * Shop creation/retrieval/update (Phase 10). Controller stays thin: all
 * identity resolution, ownership, and persistence decisions live in
 * ShopsService and the guard chain — see their doc-comments.
 *
 * Two structurally distinct route shapes are used deliberately to avoid
 * a routing collision: `/shops/slug/:slug` (two segments, public) vs
 * `/shops/:shopId` (one segment, ownership-protected). Both patterns
 * matching a single dynamic segment under `/shops/` would otherwise be
 * indistinguishable to the router. docs/database/vendor-shop.md §11's
 * `/api/shops/taijul-electronics` example is illustrative only — the doc
 * itself defers "the exact public URL structure" to routing design; see
 * this phase's final report.
 */
@ApiTags('shops')
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Create the authenticated vendor's shop",
    description:
      "Creates a shop for the caller's own Vendor profile. `vendorId` " +
      'is always resolved server-side from the access token — the ' +
      'request body cannot specify whose shop this is. A vendor may ' +
      'have at most one shop (docs/database/vendor-shop.md §12).',
  })
  @ApiCreatedResponse({ description: 'Shop created.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'The authenticated account has no vendor profile.',
  })
  @ApiConflictResponse({
    description:
      'This vendor already has a shop, or the requested slug is already in use.',
  })
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateShopDto) {
    return this.shopsService.createForUser(user.id, dto);
  }

  @Get('slug/:slug')
  @ApiOperation({
    summary: 'Public storefront lookup by slug',
    description:
      'Unauthenticated. Returns only the storefront-relevant fields ' +
      '(docs/database/vendor-shop.md §7) for an ACTIVE shop. A shop ' +
      'that does not exist, is not ACTIVE, or is soft-deleted is ' +
      'reported identically as not found.',
  })
  @ApiParam({ name: 'slug', description: "The shop's public, unique slug." })
  @ApiOkResponse({ description: 'The public shop details.' })
  @ApiNotFoundResponse({ description: 'No active shop with this slug.' })
  findPublicBySlug(@Param('slug') slug: string) {
    return this.shopsService.findPublicBySlug(slug);
  }

  @Get(':shopId')
  @UseGuards(JwtAuthGuard, VendorShopOwnershipGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'shopId',
    description:
      "The shop's id. Never trusted as an ownership claim by itself — " +
      "the caller's own vendor identity is resolved server-side and " +
      'checked against this shop (VendorShopOwnershipGuard).',
  })
  @ApiOperation({
    summary: 'Get shop details for vendor management',
    description:
      'Requires the caller to own this shop, or be an ADMIN ' +
      '(docs/database/vendor-shop.md §19-20).',
  })
  @ApiOkResponse({ description: 'The full shop record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this shop. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Shop not found.' })
  findById(@Param('shopId') shopId: string) {
    return this.shopsService.findById(shopId);
  }

  @Patch(':shopId')
  @UseGuards(JwtAuthGuard, VendorShopOwnershipGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'shopId',
    description:
      "The shop's id. Never trusted as an ownership claim by itself — " +
      "the caller's own vendor identity is resolved server-side and " +
      'checked against this shop (VendorShopOwnershipGuard).',
  })
  @ApiOperation({
    summary: 'Update your own shop',
    description:
      'Requires the caller to own this shop, or be an ADMIN. Only the ' +
      'fields defined on UpdateShopDto can be changed — ownership, ' +
      'identity, and audit fields are never client-modifiable. `status` ' +
      'may only be set to ACTIVE or INACTIVE (docs/database/' +
      'vendor-shop.md §10); SUSPENDED is administrator-controlled.',
  })
  @ApiOkResponse({ description: 'The updated shop record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this shop. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Shop not found.' })
  @ApiConflictResponse({ description: 'The requested slug is already in use.' })
  update(@Param('shopId') shopId: string, @Body() dto: UpdateShopDto) {
    return this.shopsService.update(shopId, dto);
  }
}
