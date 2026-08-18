import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

/**
 * The Order domain (docs/architecture.md's project structure lists
 * `orders/`, honored literally here — matching the same reasoning
 * applied to `vendors/`/`shops/`/`catalog/` in earlier phases). This
 * phase only implements Checkout (Cart → Order creation); order
 * viewing/management for an already-created order is a distinct,
 * future concern that would live in this same module.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class OrdersModule {}
