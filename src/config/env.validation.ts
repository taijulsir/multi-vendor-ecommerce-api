import { THROTTLE_DEFAULTS, THROTTLE_ENV } from '../throttler/throttle-config';

// HS256 (this app's configured JWT algorithm — see AuthModule's
// `JwtModule.registerAsync`) wants at least 256 bits of key material;
// 32 raw characters is the conventional, widely-used floor for a
// secret used directly as an HMAC key (not itself a security guarantee,
// but enough to reject a trivially weak value like "changeme" or "123"
// at startup rather than silently signing tokens with it).
const MIN_JWT_SECRET_LENGTH = 32;

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const required = [
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'JWT_ACCESS_SECRET',
    'JWT_ACCESS_EXPIRES_IN',
    'JWT_REFRESH_SECRET',
    'JWT_REFRESH_EXPIRES_IN',
  ];

  for (const key of required) {
    const value = config[key];

    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if ((config[key] as string).length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `${key} must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
      );
    }
  }

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be the same value',
    );
  }

  const port = Number(config.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  const redisPort = Number(config.REDIS_PORT);

  if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) {
    throw new Error('REDIS_PORT must be a valid TCP port');
  }

  // Optional — LocalFileStorageService (Phase 22) falls back to
  // `./storage/uploads` (docs/remaining-architecture-plan.md Section 8)
  // when unset. Only validated here, never given a machine-specific
  // hardcoded default: if the operator sets it, it must be a non-empty
  // path, not e.g. an accidentally-blank env value.
  if (
    config.FILE_STORAGE_DIR !== undefined &&
    (typeof config.FILE_STORAGE_DIR !== 'string' ||
      config.FILE_STORAGE_DIR.trim() === '')
  ) {
    throw new Error('FILE_STORAGE_DIR must be a non-empty path if set');
  }

  const throttleConfig = validateThrottleConfig(config);

  return {
    ...config,
    PORT: port,
    REDIS_PORT: redisPort,
    ...throttleConfig,
  };
}

/**
 * Rate-limiting. Every value is optional — if an operator forgets to set
 * one, the application still boots, falling back to a
 * production-sensible default (`THROTTLE_DEFAULTS`,
 * `src/throttler/throttle-config.ts`) rather than refusing to start. If
 * set, it must be a positive integer — same failure style as
 * `PORT`/`REDIS_PORT` above. `THROTTLE_TTL_MS` is the one shared window
 * (in milliseconds) every limit below counts against — this app does not
 * expose a separate TTL per route, only a separate request count.
 *
 * Unlike `FILE_STORAGE_DIR` above, every key here is always present in
 * the returned config (default or validated value) — `app.module.ts`
 * reads the two global keys via `ConfigService.getOrThrow`, which
 * requires the key to exist at all, not just be non-empty.
 */
function validateThrottleConfig(
  config: Record<string, unknown>,
): Record<string, number> {
  const keyToDefault: Record<string, number> = {
    [THROTTLE_ENV.ttlMs]: THROTTLE_DEFAULTS.ttlMs,
    [THROTTLE_ENV.globalLimit]: THROTTLE_DEFAULTS.globalLimit,
    [THROTTLE_ENV.authLoginLimit]: THROTTLE_DEFAULTS.authLoginLimit,
    [THROTTLE_ENV.authRegisterLimit]: THROTTLE_DEFAULTS.authRegisterLimit,
    [THROTTLE_ENV.authRefreshLimit]: THROTTLE_DEFAULTS.authRefreshLimit,
    [THROTTLE_ENV.paymentsWebhookLimit]: THROTTLE_DEFAULTS.paymentsWebhookLimit,
    [THROTTLE_ENV.productImageUploadLimit]:
      THROTTLE_DEFAULTS.productImageUploadLimit,
    [THROTTLE_ENV.checkoutLimit]: THROTTLE_DEFAULTS.checkoutLimit,
  };

  const resolved: Record<string, number> = {};

  for (const [key, fallback] of Object.entries(keyToDefault)) {
    const raw = config[key];

    if (raw === undefined || raw === '') {
      resolved[key] = fallback;
      continue;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer if set`);
    }

    resolved[key] = value;
  }

  return resolved;
}
