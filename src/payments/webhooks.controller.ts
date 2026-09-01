import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { WebhookEventDto } from './dto/webhook-event.dto';
import { WebhooksService } from './webhooks.service';
import {
  THROTTLE_DEFAULTS,
  THROTTLE_ENV,
  throttleLimitFromEnv,
} from '../throttler/throttle-config';

/**
 * Payment webhook foundation (Phase 15). Deliberately **not**
 * `@ApiBearerAuth()`-protected and has no `JwtAuthGuard` — a real
 * payment provider webhook is not initiated by a logged-in user, it is
 * called by the external gateway itself. See WebhooksService's
 * doc-comment for why signature verification is not implemented in
 * this foundation (no provider is chosen) and why that is a deliberate,
 * documented gap rather than an oversight.
 */
@ApiTags('payments')
@Controller('payments/webhook')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: throttleLimitFromEnv(
        THROTTLE_ENV.paymentsWebhookLimit,
        THROTTLE_DEFAULTS.paymentsWebhookLimit,
      ),
    },
  })
  @ApiOperation({
    summary: 'Receive a payment/refund gateway event',
    description:
      "Foundation-level webhook ingestion, matching PaymentWebhookEvent's " +
      'own field shape rather than any specific real gateway payload. ' +
      'Idempotent via the existing UNIQUE(provider, eventId) constraint ' +
      '— a replayed event is a no-op. Always returns 200 for a ' +
      'well-formed request; the response body reports the outcome ' +
      '(processed / duplicate / ignored / unmatched) without ever ' +
      'echoing the stored payload back. Rate-limited per client like ' +
      'every other endpoint (see THROTTLE_PAYMENTS_WEBHOOK_LIMIT) — this ' +
      'endpoint has no signature verification (no real gateway is ' +
      'integrated; see WebhooksService), so a coarse per-IP ceiling is ' +
      'one of the few mitigations available against it being flooded.',
  })
  @ApiOkResponse({
    description: 'The event was received (regardless of processing outcome).',
    schema: {
      example: { status: 'processed' },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiTooManyRequestsResponse({
    description: 'Too many webhook events from this client.',
  })
  receive(@Body() dto: WebhookEventDto) {
    return this.webhooksService.processEvent(dto);
  }
}
