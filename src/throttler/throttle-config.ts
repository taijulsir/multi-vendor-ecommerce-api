import type { ExecutionContext } from '@nestjs/common';

/**
 * Every rate-limit value in this application is configurable through one
 * of these environment variables (validated in
 * `src/config/env.validation.ts`; recommended production values are
 * documented in `docs/deployment.md`'s Environment Variables table).
 * Centralized here so the global default (`app.module.ts`) and every
 * `@Throttle()` call site (`AuthController`, `WebhooksController`,
 * `ProductImagesController`, `CheckoutController`) read the same names —
 * no env var name duplicated/typo-able at each call site.
 */
export const THROTTLE_ENV = {
  ttlMs: 'THROTTLE_TTL_MS',
  globalLimit: 'THROTTLE_LIMIT',
  authLoginLimit: 'THROTTLE_AUTH_LOGIN_LIMIT',
  authRegisterLimit: 'THROTTLE_AUTH_REGISTER_LIMIT',
  authRefreshLimit: 'THROTTLE_AUTH_REFRESH_LIMIT',
  paymentsWebhookLimit: 'THROTTLE_PAYMENTS_WEBHOOK_LIMIT',
  productImageUploadLimit: 'THROTTLE_PRODUCT_IMAGE_UPLOAD_LIMIT',
  checkoutLimit: 'THROTTLE_CHECKOUT_LIMIT',
} as const;

/**
 * Fallback used only when the corresponding environment variable is
 * entirely unset. `env.validation.ts` already guarantees that whatever
 * *is* set is a valid positive integer, so these numbers exist purely
 * for "the operator forgot to configure it" — a secure-by-default floor,
 * not the values this application expects to actually run on day to
 * day. Every route-specific limit here is deliberately stricter than
 * `globalLimit`; `globalLimit` itself is a generous per-route-per-IP
 * ceiling (see the guard's own key derivation — each route/IP pair gets
 * its own independent bucket even under the shared "default" throttler
 * name, so this is not one counter shared across the whole API).
 */
export const THROTTLE_DEFAULTS = {
  ttlMs: 60_000,
  globalLimit: 100,
  authLoginLimit: 5,
  authRegisterLimit: 5,
  authRefreshLimit: 10,
  paymentsWebhookLimit: 20,
  productImageUploadLimit: 20,
  checkoutLimit: 20,
} as const satisfies Record<string, number>;

/**
 * Builds a `@Throttle()`-compatible resolver that reads a validated
 * throttle env var lazily, at request time, rather than a plain number
 * baked in at decoration time.
 *
 * This is not a stylistic choice: `@nestjs/throttler`'s `limit`/`ttl`
 * accept either a literal number or a `(context) => number` resolver,
 * and the resolver form is evaluated inside `ThrottlerGuard.canActivate`
 * — i.e. per request, long after the application has finished
 * bootstrapping. A literal read at decoration time would instead run
 * the moment a controller class is defined, which happens while
 * `AuthModule` (and every other feature module) is still being
 * imported by `AppModule` — *before* `AppModule`'s own
 * `ConfigModule.forRoot({ envFilePath: ['.env'] })` call has actually
 * loaded `.env` into `process.env` (Node fully resolves a file's
 * imports before running that file's own top-level code, and the
 * `ConfigModule.forRoot(...)` call lives in `app.module.ts`'s own body,
 * not in anything its imports execute first). A literal value would
 * therefore silently freeze at whatever `process.env` held pre-dotenv —
 * effectively always the coded fallback, never the `.env`/
 * `.env.production` value an operator actually set. Reading lazily
 * sidesteps that ordering hazard entirely: by the time any real request
 * is served, bootstrap has long since completed.
 */
export function throttleLimitFromEnv(
  envKey: string,
  fallback: number,
): (context: ExecutionContext) => number {
  return () => {
    const raw = process.env[envKey];

    if (raw === undefined || raw === '') {
      return fallback;
    }

    const parsed = Number(raw);

    // env.validation.ts already rejects a non-positive-integer value at
    // startup — this repeats the check defensively (e.g. a value
    // exported into process.env by something other than the validated
    // config path) rather than trusting it silently.
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
}
