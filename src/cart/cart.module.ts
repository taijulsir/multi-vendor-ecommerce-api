import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * Cart is user-owned, not vendor-owned — this module imports `AuthModule`
 * only for `JwtAuthGuard`/`@CurrentUser()` (authentication), not for any
 * ownership/RBAC guard. See CartService's doc-comment for why no
 * ownership guard is used here.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
