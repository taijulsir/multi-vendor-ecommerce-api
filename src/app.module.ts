import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnvironment } from './config/env.validation';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisThrottlerStorage } from './throttler/redis-throttler-storage';
import { THROTTLE_ENV } from './throttler/throttle-config';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { VendorsModule } from './vendors/vendors.module';
import { ShopsModule } from './shops/shops.module';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      cache: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
        },
      }),
    }),
    // Global rate limiting. One "default" throttler — @nestjs/throttler
    // keys its counters per (controller, handler, tracker), so this
    // single named throttler already gives every route its own
    // independent per-IP bucket; @Throttle() on specific routes below
    // (AuthController, WebhooksController, ProductImagesController,
    // CheckoutController) only overrides that route's own limit, never
    // the shared window. Storage is Redis-backed (RedisThrottlerStorage,
    // reusing the existing RedisService connection — see its own
    // doc-comment for why not the package's default in-memory storage.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, RedisService],
      useFactory: (
        configService: ConfigService,
        redisService: RedisService,
      ) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow<number>(THROTTLE_ENV.ttlMs),
            limit: configService.getOrThrow<number>(THROTTLE_ENV.globalLimit),
          },
        ],
        storage: new RedisThrottlerStorage(redisService),
      }),
    }),
    HealthModule,
    AuthModule,
    VendorsModule,
    ShopsModule,
    CatalogModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
  ],
  providers: [
    // Applies ThrottlerGuard to every route by default — registering it
    // per-controller would mean a new controller silently ships with no
    // rate limiting until someone remembers to add it.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
