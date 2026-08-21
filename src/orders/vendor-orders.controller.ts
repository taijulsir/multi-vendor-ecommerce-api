import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { UpdateVendorOrderStatusDto } from './dto/update-vendor-order-status.dto';
import { VendorOrdersService } from './vendor-orders.service';

/**
 * Order viewing (Phase 14), vendor perspective
 * (docs/database/order.md §48: "Vendors may view VendorOrders belonging
 * to themselves"), extended with vendor-initiated fulfillment status
 * transitions (Phase 19, ADR-2/ADR-3 —
 * docs/remaining-architecture-plan.md's Architecture Decision Register).
 * Controller stays thin: ownership resolution, transition validation, and
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
    summary: "Get one of the authenticated vendor's own VendorOrders",
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

  @Patch(':vendorOrderId/status')
  @UseGuards(VendorOrderOwnershipGuard)
  @ApiParam({
    name: 'vendorOrderId',
    description:
      "The vendor order's id. Never trusted as an ownership claim by " +
      "itself — the caller's own vendor identity is resolved server-side " +
      'and checked against this order (VendorOrderOwnershipGuard).',
  })
  @ApiOperation({
    summary:
      "Update the status of one of the authenticated vendor's own VendorOrders",
    description:
      'Requires the caller to own this VendorOrder, or be an ADMIN. Only ' +
      'the transitions documented in docs/database/order.md §10/§31 are ' +
      'accepted: PENDING→CONFIRMED, CONFIRMED→PROCESSING, PROCESSING→' +
      'READY_TO_SHIP, READY_TO_SHIP→SHIPPED, SHIPPED→DELIVERED, and ' +
      'PENDING/CONFIRMED→CANCELLED. DELIVERED and CANCELLED are terminal. ' +
      'MasterOrder.status is never directly settable — it is always ' +
      "re-derived from all of the MasterOrder's VendorOrders as part of " +
      'this same request.',
  })
  @ApiOkResponse({ description: 'The updated vendor order.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own this VendorOrder. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Vendor order not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiConflictResponse({
    description:
      "The vendor order's current status does not allow this transition " +
      '(including a concurrent request that already changed it).',
  })
  updateStatus(
    @CurrentUser() user: SafeUser,
    @Param('vendorOrderId') vendorOrderId: string,
    @Body() dto: UpdateVendorOrderStatusDto,
  ) {
    return this.vendorOrdersService.updateStatus(vendorOrderId, dto, user.id);
  }
}
