import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

/**
 * Cart retrieval/mutation (Phase 12). Every route is authenticated and
 * scoped to the caller's own cart — there is no public cart operation
 * (docs/database/cart.md §20/§21 describe only authenticated,
 * self-service operations). Controller stays thin: ownership
 * resolution, variant validation, and persistence all live in
 * CartService — see its doc-comment.
 */
@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({
    summary: "Get the authenticated user's active cart",
    description:
      'Always returns 200, even when the user has no active cart yet ' +
      '— an empty cart view is returned rather than 404.',
  })
  @ApiOkResponse({ description: 'The current cart (possibly empty).' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  getCart(@CurrentUser() user: SafeUser) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a product variant to the cart',
    description:
      "Creates the caller's active cart if none exists yet. If the " +
      'variant is already in the cart, its quantity is incremented ' +
      'rather than creating a second row (docs/database/cart.md §10). ' +
      'Price, currency, and selected attributes are always read from ' +
      'the current ProductVariant — never accepted from the client. ' +
      'Returns 200 rather than 201: the outcome is sometimes a new ' +
      'row, sometimes an increment of an existing one, and the response ' +
      'body is always "the current cart", not "the created item".',
  })
  @ApiOkResponse({ description: 'The updated cart.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or variantId does not reference an available ' +
      'product variant (nonexistent, inactive, its product inactive, ' +
      'or its vendor not ACTIVE).',
  })
  @ApiConflictResponse({
    description: "The variant's currency does not match the cart's currency.",
  })
  addItem(@CurrentUser() user: SafeUser, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update a cart item quantity' })
  @ApiParam({
    name: 'itemId',
    description:
      "The cart item's id. Never trusted as an ownership claim by " +
      "itself — it must belong to the caller's own active cart.",
  })
  @ApiOkResponse({ description: 'The updated cart.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The item does not exist or does not belong to an active cart ' +
      'owned by the caller. Intentionally generic — identical whether ' +
      "the item belongs to another user's cart or does not exist.",
  })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  updateItemQuantity(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(user.id, itemId, dto);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove an item from the cart' })
  @ApiParam({
    name: 'itemId',
    description:
      "The cart item's id. Never trusted as an ownership claim by " +
      "itself — it must belong to the caller's own active cart.",
  })
  @ApiOkResponse({ description: 'The updated cart.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The item does not exist or does not belong to an active cart ' +
      'owned by the caller. Intentionally generic.',
  })
  removeItem(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.cartService.removeItem(user.id, itemId);
  }

  @Delete('items')
  @ApiOperation({
    summary: "Clear the authenticated user's active cart",
    description:
      'Removes every item from the active cart. A no-op (still 200) if ' +
      'the caller has no active cart.',
  })
  @ApiOkResponse({ description: 'The updated (now empty) cart.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  clearCart(@CurrentUser() user: SafeUser) {
    return this.cartService.clearCart(user.id);
  }
}
