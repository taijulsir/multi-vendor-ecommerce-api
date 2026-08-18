import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { WebhookEventDto } from './dto/webhook-event.dto';
import { WebhooksService } from './webhooks.service';

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
  @ApiOperation({
    summary: 'Receive a payment/refund gateway event',
    description:
      "Foundation-level webhook ingestion, matching PaymentWebhookEvent's " +
      'own field shape rather than any specific real gateway payload. ' +
      'Idempotent via the existing UNIQUE(provider, eventId) constraint ' +
      '— a replayed event is a no-op. Always returns 200 for a ' +
      'well-formed request; the response body reports the outcome ' +
      '(processed / duplicate / ignored / unmatched) without ever ' +
      'echoing the stored payload back.',
  })
  @ApiOkResponse({
    description: 'The event was received (regardless of processing outcome).',
    schema: {
      example: { status: 'processed' },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  receive(@Body() dto: WebhookEventDto) {
    return this.webhooksService.processEvent(dto);
  }
}
