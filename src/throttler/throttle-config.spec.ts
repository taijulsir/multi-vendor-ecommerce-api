import { throttleLimitFromEnv } from './throttle-config';

describe('throttleLimitFromEnv', () => {
  const ENV_KEY = 'THROTTLE_TEST_LIMIT';
  const originalValue = process.env[ENV_KEY];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
  });

  it('returns the fallback when the environment variable is unset', () => {
    delete process.env[ENV_KEY];

    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(5);
  });

  it('returns the fallback when the environment variable is an empty string', () => {
    process.env[ENV_KEY] = '';

    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(5);
  });

  it('returns the parsed value when the environment variable is a valid positive integer', () => {
    process.env[ENV_KEY] = '42';

    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(42);
  });

  it('falls back for a non-integer value', () => {
    process.env[ENV_KEY] = '4.5';

    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(5);
  });

  it('falls back for a zero or negative value', () => {
    process.env[ENV_KEY] = '0';

    expect(throttleLimitFromEnv(ENV_KEY, 5)(undefined as never)).toBe(5);

    process.env[ENV_KEY] = '-3';

    expect(throttleLimitFromEnv(ENV_KEY, 5)(undefined as never)).toBe(5);
  });

  it('falls back for a non-numeric value', () => {
    process.env[ENV_KEY] = 'not-a-number';

    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(5);
  });

  it('re-reads process.env on every call, not just once at creation time', () => {
    delete process.env[ENV_KEY];
    const resolve = throttleLimitFromEnv(ENV_KEY, 5);

    expect(resolve(undefined as never)).toBe(5);

    process.env[ENV_KEY] = '99';

    expect(resolve(undefined as never)).toBe(99);
  });
});
