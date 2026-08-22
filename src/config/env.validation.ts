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

  return {
    ...config,
    PORT: port,
    REDIS_PORT: redisPort,
  };
}
