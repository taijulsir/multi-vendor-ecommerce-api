import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
