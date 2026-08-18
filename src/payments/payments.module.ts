import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Payment / Refund / Webhook foundation (Phase 15). One module for both
 * domains — `docs/database/payment-refund.md` is itself a single merged
 * document for Payment and Refund (mirroring the same consolidation
 * reasoning already applied to Category+Product in `CatalogModule`,
 * Phase 11). `WebhooksController` has no `JwtAuthGuard` (see its
 * doc-comment) but still lives in this module — it imports `AuthModule`
 * only for `PaymentsController`'s auth/RBAC needs.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, WebhooksService],
})
export class PaymentsModule {}
