import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const validConfig = (): Record<string, unknown> => ({
    DATABASE_URL: 'postgresql://user:pass@localhost:5433/db',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_REFRESH_EXPIRES_IN: '7d',
    PORT: '3000',
  });

  it('accepts a fully valid configuration and coerces PORT/REDIS_PORT to numbers', () => {
    const result = validateEnvironment(validConfig());

    expect(result.PORT).toBe(3000);
    expect(result.REDIS_PORT).toBe(6379);
  });

  it('defaults PORT to 3000 when unset', () => {
    const config = validConfig();
    delete config.PORT;

    expect(validateEnvironment(config).PORT).toBe(3000);
  });

  it.each([
    'DATABASE_URL',
    'REDIS_HOST',
    'REDIS_PORT',
    'JWT_ACCESS_SECRET',
    'JWT_ACCESS_EXPIRES_IN',
    'JWT_REFRESH_SECRET',
    'JWT_REFRESH_EXPIRES_IN',
  ])('rejects a missing %s', (key) => {
    const config = validConfig();
    delete config[key];

    expect(() => validateEnvironment(config)).toThrow(
      `Missing required environment variable: ${key}`,
    );
  });

  it('rejects a blank (whitespace-only) required value the same as a missing one', () => {
    const config = validConfig();
    config.JWT_ACCESS_SECRET = '   ';

    expect(() => validateEnvironment(config)).toThrow(
      'Missing required environment variable: JWT_ACCESS_SECRET',
    );
  });

  describe('JWT secret strength (Phase 24)', () => {
    it('rejects a JWT_ACCESS_SECRET shorter than the minimum length', () => {
      const config = validConfig();
      config.JWT_ACCESS_SECRET = 'too-short';

      expect(() => validateEnvironment(config)).toThrow(
        'JWT_ACCESS_SECRET must be at least 32 characters',
      );
    });

    it('rejects a JWT_REFRESH_SECRET shorter than the minimum length', () => {
      const config = validConfig();
      config.JWT_REFRESH_SECRET = 'changeme';

      expect(() => validateEnvironment(config)).toThrow(
        'JWT_REFRESH_SECRET must be at least 32 characters',
      );
    });

    it('rejects identical access/refresh secrets, even if both are individually strong', () => {
      const config = validConfig();
      config.JWT_REFRESH_SECRET = config.JWT_ACCESS_SECRET;

      expect(() => validateEnvironment(config)).toThrow(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be the same value',
      );
    });
  });

  it('rejects a non-integer PORT', () => {
    const config = validConfig();
    config.PORT = 'not-a-port';

    expect(() => validateEnvironment(config)).toThrow(
      'PORT must be a valid TCP port',
    );
  });

  it('rejects a PORT outside the valid TCP range', () => {
    const config = validConfig();
    config.PORT = '70000';

    expect(() => validateEnvironment(config)).toThrow(
      'PORT must be a valid TCP port',
    );
  });

  it('rejects a non-integer REDIS_PORT', () => {
    const config = validConfig();
    config.REDIS_PORT = 'nope';

    expect(() => validateEnvironment(config)).toThrow(
      'REDIS_PORT must be a valid TCP port',
    );
  });

  describe('FILE_STORAGE_DIR (Phase 22)', () => {
    it('is optional — a fully valid config without it still passes', () => {
      expect(() => validateEnvironment(validConfig())).not.toThrow();
    });

    it('accepts a valid non-empty path when set', () => {
      const config = validConfig();
      config.FILE_STORAGE_DIR = './storage/uploads';

      expect(() => validateEnvironment(config)).not.toThrow();
    });

    it('rejects a blank FILE_STORAGE_DIR rather than silently ignoring it', () => {
      const config = validConfig();
      config.FILE_STORAGE_DIR = '   ';

      expect(() => validateEnvironment(config)).toThrow(
        'FILE_STORAGE_DIR must be a non-empty path if set',
      );
    });
  });
});
