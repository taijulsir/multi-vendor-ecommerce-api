import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Phase 24: read through the same validated ConfigService every other
  // module already uses (PrismaService, RedisService, JwtModule,
  // BullModule, LocalFileStorageService) — `env.validation.ts` already
  // coerces/validates `PORT` into a number; reading `process.env.PORT`
  // directly here bypassed that validation and was the one remaining
  // direct `process.env` access outside the config layer.
  const configService = app.get(ConfigService);

  // Phase 23: wires OS SIGTERM/SIGINT through to Nest's own lifecycle —
  // `app.close()` (which already runs on every test's `afterAll`, and
  // already correctly triggers PrismaService/RedisService's existing
  // `onModuleDestroy` hooks) is now also invoked automatically on a real
  // process termination signal, so a container `docker stop` drains
  // in-flight requests and closes DB/Redis connections instead of the
  // process dying mid-request. No new lifecycle hooks were added — both
  // services already implement `onModuleDestroy` correctly; this only
  // makes NestJS actually call it on a termination signal.
  app.enableShutdownHooks();

  // Phase 23: last-line-of-defense global exception filter — every
  // service already translates domain-meaningful errors into typed
  // HttpExceptions (passed through unchanged below); this only
  // guarantees a safe, detail-free response for whatever exception type
  // reaches here instead.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Standard NestJS-recommended baseline HTTP security headers
  // (https://docs.nestjs.com/security/helmet) — safe defaults with no
  // functional impact on this API's behavior. CORS is intentionally not
  // enabled here: no consuming frontend origin is defined anywhere in
  // the current scope, and this API is bearer-token authenticated (not
  // cookie-based), so there is nothing concrete to configure yet — see
  // docs/architecture.md's security notes.
  app.use(helmet());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Multi-Vendor E-Commerce API')
    .setDescription(
      'Multi-vendor e-commerce backend: JWT auth + RBAC + ownership, ' +
        'vendor/shop/catalog management, cart, checkout, order viewing, ' +
        'and a payment/refund/webhook foundation. See docs/API.md for a ' +
        'narrative walkthrough of each flow.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    // Declared explicitly, in the same domain order as postman/ and
    // README's Project Structure, so Swagger UI groups/orders tags
    // meaningfully instead of falling back to first-appearance order.
    .addTag('health', 'Application/database/Redis health check')
    .addTag(
      'auth',
      'Registration, login, refresh-token rotation, RBAC demo routes',
    )
    .addTag('vendors', 'Vendor onboarding')
    .addTag('shops', 'Shop creation/retrieval/update')
    .addTag('categories', 'Platform-owned category taxonomy (ADMIN-managed)')
    .addTag('products', 'Vendor-owned products')
    .addTag(
      'product-images',
      'Product image upload/stream/delete — local filesystem storage',
    )
    .addTag('cart', "The authenticated user's active cart")
    .addTag('checkout', 'Cart → Order creation')
    .addTag('orders', "The authenticated customer's own orders")
    .addTag('vendor-orders', "A vendor's own orders")
    .addTag('payments', 'Payment/PaymentAttempt lifecycle and refunds')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
  });
  await app.listen(configService.getOrThrow<number>('PORT'));
}

void bootstrap();
