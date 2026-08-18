import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Webhook event ingestion input, matching `PaymentWebhookEvent`'s own
 * documented field shape (docs/database/payment-refund.md §19) rather
 * than any specific real gateway's payload format — no gateway is
 * integrated in this phase (see WebhooksService's doc-comment).
 *
 * `eventType` is deliberately a free string, not a restricted enum,
 * matching the schema's own choice (`String`, not a DB enum) — a real
 * gateway can send event types this foundation doesn't act on; those
 * are recorded and marked IGNORED rather than rejected.
 */
export class WebhookEventDto {
  @ApiProperty({ example: 'MANUAL', description: 'The originating provider.' })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    example: 'evt_1a2b3c',
    description: "The provider's own event identifier — the idempotency key.",
  })
  @IsString()
  @IsNotEmpty()
  eventId: string;

  @ApiProperty({
    example: 'payment.succeeded',
    description:
      'The provider event type. Only a small set of recognized values ' +
      'are acted on; anything else is recorded and ignored.',
  })
  @IsString()
  @IsNotEmpty()
  eventType: string;

  @ApiPropertyOptional({
    example: 'ref_1a2b3c4d5e6f',
    description:
      'The gateway reference this event is about — correlates to a ' +
      "PaymentAttempt's or Refund's own providerReference.",
  })
  @IsOptional()
  @IsString()
  providerReference?: string;

  @ApiPropertyOptional({ description: 'Provider-specific event payload.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
