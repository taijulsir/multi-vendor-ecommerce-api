import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutService } from './checkout.service';

/**
 * Checkout (Phase 13). Operates only on the authenticated caller's own
 * active cart — there is no client-supplied cart/user/vendor identifier
 * anywhere in this controller. Controller stays thin: the entire
 * validate → reserve → create flow lives in CheckoutService — see its
 * doc-comment.
 */
@ApiTags('checkout')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post()
  @ApiOperation({
    summary: "Check out the authenticated user's active cart",
    description:
      'Creates a MasterOrder (with one VendorOrder per distinct vendor ' +
      'and one OrderItem per cart item), reserving inventory and ' +
      'converting the cart to CONVERTED, all atomically. No payment, ' +
      'commission, or coupon processing happens here — see this ' +
      "phase's final report for the exact scope.",
  })
  @ApiCreatedResponse({ description: 'The created order.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, the cart is empty/missing, or it contains an ' +
      'item that is no longer available for purchase.',
  })
  @ApiConflictResponse({
    description:
      'Currency mismatch, insufficient inventory, or the cart was ' +
      'already checked out (including by a concurrent/retried request).',
  })
  checkout(@CurrentUser() user: SafeUser, @Body() dto: CheckoutDto) {
    return this.checkoutService.checkout(user.id, dto);
  }
}
