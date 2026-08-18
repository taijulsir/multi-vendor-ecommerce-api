import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { OrdersService } from './orders.service';

/**
 * Order viewing (Phase 14), customer perspective. Every route is
 * authenticated and scoped to the caller's own orders (or an ADMIN) —
 * there is no public order-viewing operation. Controller stays thin:
 * ownership resolution and persistence live in OrdersService.
 */
@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List the authenticated user's own orders" })
  @ApiOkResponse({ description: 'The list of orders, newest first.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  findMyOrders(@CurrentUser() user: SafeUser) {
    return this.ordersService.findMyOrders(user.id);
  }

  @Get(':masterOrderId')
  @ApiOperation({ summary: "Get one of the authenticated user's own orders" })
  @ApiParam({
    name: 'masterOrderId',
    description:
      "The order's id. Never trusted as an ownership claim by itself " +
      '— the caller must own this order, or be an ADMIN.',
  })
  @ApiOkResponse({ description: 'The order.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The order does not exist or does not belong to the caller. ' +
      'Intentionally generic — identical whether the order belongs to ' +
      'another user or does not exist.',
  })
  findMyOrderById(
    @CurrentUser() user: SafeUser,
    @Param('masterOrderId') masterOrderId: string,
  ) {
    return this.ordersService.findMyOrderById(user.id, masterOrderId);
  }
}
