import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { VendorOrdersController } from './vendor-orders.controller';
import { VendorOrdersService } from './vendor-orders.service';

/**
 * The Order domain (docs/architecture.md's project structure lists
 * `orders/`, honored literally here — matching the same reasoning
 * applied to `vendors/`/`shops/`/`catalog/` in earlier phases). Phase 13
 * implemented Checkout (Cart → Order creation); Phase 14 adds order
 * *viewing* from both the customer perspective (`OrdersController`,
 * user-owned) and the vendor perspective (`VendorOrdersController`,
 * vendor-owned via the existing ownership infrastructure). Fulfillment
 * status transitions/updates remain unimplemented — order.md itself
 * defers the exact transition matrix to a later phase.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CheckoutController, OrdersController, VendorOrdersController],
  providers: [CheckoutService, OrdersService, VendorOrdersService],
})
export class OrdersModule {}
