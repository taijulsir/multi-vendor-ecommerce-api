import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { VendorOrderOwnershipGuard } from '../auth/guards/vendor-order-ownership.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { VendorOrdersService } from './vendor-orders.service';

/**
 * Order viewing (Phase 14), vendor perspective
 * (docs/database/order.md §48: "Vendors may view VendorOrders belonging
 * to themselves"). Controller stays thin: ownership resolution and
 * persistence live in VendorOrdersService and VendorOrderOwnershipGuard.
 */
@ApiTags('vendor-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vendor-orders')
export class VendorOrdersController {
  constructor(private readonly vendorOrdersService: VendorOrdersService) {}

  @Get()
  @ApiOperation({
    summary: "List the authenticated vendor's own VendorOrders",
  })
  @ApiOkResponse({ description: 'The list of vendor orders, newest first.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description: 'The authenticated account has no vendor profile.',
  })
  findMyVendorOrders(@CurrentUser() user: SafeUser) {
    return this.vendorOrdersService.findMyVendorOrders(user.id);
  }

  @Get(':vendorOrderId')
  @UseGuards(VendorOrderOwnershipGuard)
  @ApiParam({
    name: 'vendorOrderId',
    description:
      "The vendor order's id. Never trusted as an ownership claim by " +
      "itself — the caller's own vendor identity is resolved server-side " +
      'and checked against this order (VendorOrderOwnershipGuard).',
  })
  @ApiOperation({
    summary: 'Get one of the authenticated vendor\'s own VendorOrders',
    description: 'Requires the caller to own this VendorOrder, or be an ADMIN.',
  })
  @ApiOkResponse({ description: 'The vendor order.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this VendorOrder. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Vendor order not found.' })
  findById(@Param('vendorOrderId') vendorOrderId: string) {
    return this.vendorOrdersService.findById(vendorOrderId);
  }
}
