import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SafeUser } from '../auth/utils/safe-user';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { PaymentsService } from './payments.service';

/**
 * Payment / PaymentAttempt / Refund foundation (Phase 15). Every route
 * is authenticated; refund creation is additionally ADMIN-only. See
 * PaymentsService's doc-comment for the ownership/authorization model.
 */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: "Create a payment for the authenticated user's own order",
    description:
      'Creates the payment and its first PaymentAttempt. Amount and ' +
      "currency are always derived from the order's own totals — never " +
      'accepted from the client. Rejected if the order already has a ' +
      'payment (use the retry endpoint instead).',
  })
  @ApiCreatedResponse({ description: 'The created payment.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The order does not exist or does not belong to the caller. ' +
      'Intentionally generic.',
  })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiConflictResponse({ description: 'This order already has a payment.' })
  create(@CurrentUser() user: SafeUser, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.createForUser(user.id, dto);
  }

  @Post(':paymentId/retry')
  @ApiOperation({
    summary: 'Retry a failed payment',
    description:
      'Creates a new PaymentAttempt on an existing FAILED payment ' +
      '(docs/database/payment-refund.md §26) — previous attempts are ' +
      'preserved, never overwritten.',
  })
  @ApiParam({ name: 'paymentId', description: "The payment's id." })
  @ApiOkResponse({ description: 'The updated payment.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The payment does not exist or does not belong to the caller. ' +
      'Intentionally generic.',
  })
  @ApiConflictResponse({
    description: 'The payment is not currently in a retryable (FAILED) state.',
  })
  retry(@CurrentUser() user: SafeUser, @Param('paymentId') paymentId: string) {
    return this.paymentsService.retry(user.id, paymentId);
  }

  @Get(':paymentId')
  @ApiOperation({
    summary: 'Get a payment, including its attempt and refund history',
  })
  @ApiParam({ name: 'paymentId', description: "The payment's id." })
  @ApiOkResponse({ description: 'The payment.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'The payment does not exist or does not belong to the caller, ' +
      'and the caller is not an ADMIN. Intentionally generic.',
  })
  findById(
    @CurrentUser() user: SafeUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.findById(user.id, paymentId);
  }

  @Post(':paymentId/refunds')
  @UseGuards(AuthorizationGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create a refund against a payment (ADMIN only)',
    description:
      "The refund amount is validated against the payment's actual " +
      'refundable balance (paidAmount - refundedAmount) — it can never ' +
      'exceed it. Currency always comes from the payment being refunded.',
  })
  @ApiParam({ name: 'paymentId', description: "The payment's id." })
  @ApiCreatedResponse({ description: 'The created refund.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({ description: 'Caller is not an ADMIN.' })
  @ApiNotFoundResponse({ description: 'Payment not found.' })
  @ApiBadRequestResponse({ description: 'Invalid payload or refund amount.' })
  @ApiConflictResponse({
    description:
      "The requested amount exceeds the payment's refundable balance.",
  })
  createRefund(
    @CurrentUser() user: SafeUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.paymentsService.createRefund(user.id, paymentId, dto);
  }
}
