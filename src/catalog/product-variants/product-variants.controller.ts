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
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { RestockInventoryDto } from './dto/restock-inventory.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { InventoryService } from './inventory.service';
import { ProductVariantsService } from './product-variants.service';

const PRODUCT_ID_PARAM = {
  name: 'productId',
  description:
    "The parent product's id. Never trusted as an ownership claim by " +
    "itself — the caller's own vendor identity is resolved server-side " +
    'and checked against this product (ProductOwnershipGuard, reused ' +
    'unchanged from Phase 11).',
} as const;

const VARIANT_ID_PARAM = {
  name: 'variantId',
  description: "The variant's id, scoped to the parent product.",
} as const;

/**
 * ProductVariant + Inventory management (Phase 21). Every route is
 * nested under `/products/:productId/...`, which lets this controller
 * reuse `ProductOwnershipGuard` completely unchanged — the guard already
 * resolves ownership from a `:productId` route param regardless of what
 * follows it, exactly the "third entity needing this exact shape"
 * situation its own doc-comment anticipated, except here there is no
 * third *guard* at all: the existing one is reused as-is.
 *
 * No public/customer-facing route exists in this controller — see
 * `ProductVariantsService`'s doc-comment for why.
 */
@ApiTags('product-variants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProductOwnershipGuard)
@Controller('products/:productId/variants')
export class ProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
    private readonly inventoryService: InventoryService,
  ) {}

  @Post()
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOperation({
    summary: "Create a variant for one of the vendor's own products",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      "Creates the variant's 1:1 Inventory row atomically " +
      "(`onHand: 0`). The product's first variant is automatically its " +
      'default; `isDefault` is never client-settable.',
  })
  @ApiCreatedResponse({ description: 'The created variant.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiConflictResponse({ description: 'The requested SKU is already in use.' })
  create(@Param('productId') productId: string, @Body() dto: CreateVariantDto) {
    return this.productVariantsService.createForProduct(productId, dto);
  }

  @Get()
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiOperation({
    summary: "List every variant of one of the vendor's own products",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      'Returns variants of any status (this is the management view, not ' +
      'a public storefront listing).',
  })
  @ApiOkResponse({ description: 'The list of variants.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  findAll(@Param('productId') productId: string) {
    return this.productVariantsService.findAllForProduct(productId);
  }

  @Get(':variantId')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(VARIANT_ID_PARAM)
  @ApiOperation({
    summary: "Get one variant of the vendor's own product",
    description:
      'Requires the caller to own the parent product, or be an ADMIN.',
  })
  @ApiOkResponse({ description: 'The variant.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Variant not found.' })
  findOne(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.productVariantsService.findOne(productId, variantId);
  }

  @Patch(':variantId')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(VARIANT_ID_PARAM)
  @ApiOperation({
    summary: "Update one variant of the vendor's own product",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      'Only the fields defined on UpdateVariantDto can be changed — ' +
      '`isDefault` cannot be changed through this endpoint (see ' +
      "ProductVariantsService's doc-comment).",
  })
  @ApiOkResponse({ description: 'The updated variant.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Variant not found.' })
  @ApiConflictResponse({ description: 'The requested SKU is already in use.' })
  update(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productVariantsService.update(productId, variantId, dto);
  }

  @Get(':variantId/inventory')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(VARIANT_ID_PARAM)
  @ApiOperation({
    summary: "Get a variant's current inventory",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      '`available` (`onHand - reserved`) is always computed, never stored.',
  })
  @ApiOkResponse({ description: 'The inventory record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Variant not found.' })
  findInventory(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.inventoryService.findForVariant(productId, variantId);
  }

  @Post(':variantId/inventory/restock')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(VARIANT_ID_PARAM)
  @ApiOperation({
    summary: "Restock a variant's inventory",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      'Increments `onHand` and records a RESTOCK InventoryTransaction, ' +
      'both atomically.',
  })
  @ApiOkResponse({ description: 'The updated inventory record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Variant not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  restock(
    @CurrentUser() user: SafeUser,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: RestockInventoryDto,
  ) {
    return this.inventoryService.restock(productId, variantId, dto, user.id);
  }

  @Post(':variantId/inventory/adjust')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(VARIANT_ID_PARAM)
  @ApiOperation({
    summary: "Adjust a variant's inventory (positive or negative)",
    description:
      'Requires the caller to own the parent product, or be an ADMIN ' +
      '(ADR-4 — vendor-self-service, not ADMIN-only). Applies a signed ' +
      'delta to `onHand` and records an ADJUSTMENT InventoryTransaction, ' +
      'both atomically. Rejected if the result would make `onHand` ' +
      'negative or fall below `reserved`.',
  })
  @ApiOkResponse({ description: 'The updated inventory record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Variant not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload, or delta is 0.' })
  @ApiConflictResponse({
    description:
      'The adjustment would make onHand negative or fall below reserved stock.',
  })
  adjust(
    @CurrentUser() user: SafeUser,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.inventoryService.adjust(productId, variantId, dto, user.id);
  }
}
