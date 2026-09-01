import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { RedisService } from './../src/redis/redis.service';

/**
 * Proves the rate-limiting phase's global `ThrottlerGuard` (registered
 * via `APP_GUARD` in `AppModule`) and the `POST /auth/login` route
 * override (`AuthController`'s `@Throttle()`) are genuinely enforced,
 * not just configured — the same "prove it, don't just wire it" bar
 * this codebase already holds itself to elsewhere (e.g.
 * `webhooks.service.spec.ts`'s concurrent-request proof of the
 * refund-settlement fix).
 *
 * This test intentionally does **not** use the generous
 * `THROTTLE_AUTH_LOGIN_LIMIT`/`THROTTLE_TTL_MS` values every other e2e
 * file relies on (set in `.env`/CI specifically so the rest of the
 * suite's normal auth traffic is never accidentally rate-limited — see
 * `docs/deployment.md`). Instead it boots its own, fully isolated
 * `AppModule` instance with a deliberately tiny override, applied by
 * mutating `process.env` *before* compiling this file's own testing
 * module (each e2e file gets a fresh `ConfigModule`/`ConfigService`
 * instance from its own `Test.createTestingModule` call, so this cannot
 * leak into any other file's module graph — only the shared external
 * Redis storage is common, which is why the Redis keys are flushed both
 * before and after).
 */
describe('Rate limiting (e2e)', () => {
  const LOGIN_LIMIT_ENV = 'THROTTLE_AUTH_LOGIN_LIMIT';
  const TTL_ENV = 'THROTTLE_TTL_MS';
  const TEST_LOGIN_LIMIT = 2;
  const TEST_TTL_MS = 2_000;

  const originalLoginLimit = process.env[LOGIN_LIMIT_ENV];
  const originalTtl = process.env[TTL_ENV];

  let app: INestApplication<App>;
  let redis: RedisService;

  beforeAll(async () => {
    // Deliberately tiny and short-lived: (1) 2 requests is enough to
    // prove both "under the limit passes through" and "over the limit
    // is blocked" without a slow test, and (2) a 2-second window means
    // the block this test deliberately trips has fully expired long
    // before the next e2e spec file (shops.e2e-spec.ts, which also
    // calls POST /auth/login once) gets anywhere near its own request —
    // on top of the explicit Redis flush in afterAll below.
    process.env[LOGIN_LIMIT_ENV] = String(TEST_LOGIN_LIMIT);
    process.env[TTL_ENV] = String(TEST_TTL_MS);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    redis = app.get(RedisService);

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Clean slate: an earlier e2e file (auth.e2e-spec.ts, or any other
    // file that calls POST /auth/login) may already have left hit
    // counters in the *same* real Redis instance under the exact same
    // key this test is about to exercise — the throttler key is a hash
    // of (controller, handler, throttler name, tracker), independent of
    // which file/app-instance made the earlier calls. Flushing first
    // makes the assertions below deterministic regardless of e2e run
    // order or timing.
    await flushThrottlerKeys(redis);
  });

  afterAll(async () => {
    // Flush again so this test's deliberately-tripped block never
    // leaks into whichever e2e file runs next in this same process
    // (Jest e2e runs in-band — see test/jest-e2e.json / ci.yml's
    // `--runInBand`).
    await flushThrottlerKeys(redis);

    if (originalLoginLimit === undefined) {
      delete process.env[LOGIN_LIMIT_ENV];
    } else {
      process.env[LOGIN_LIMIT_ENV] = originalLoginLimit;
    }

    if (originalTtl === undefined) {
      delete process.env[TTL_ENV];
    } else {
      process.env[TTL_ENV] = originalTtl;
    }

    await app.close();
  });

  const attemptLogin = () =>
    request(app.getHttpServer()).post('/api/auth/login').send({
      email: 'rate-limit-e2e@example.com',
      password: 'definitely-wrong-password',
    });

  it(`allows the first ${TEST_LOGIN_LIMIT} requests through to the real handler (still get the normal auth failure, not a 429)`, async () => {
    for (let attempt = 0; attempt < TEST_LOGIN_LIMIT; attempt++) {
      const response = await attemptLogin();

      expect(response.status).toBe(401);
    }
  });

  it(`returns 429 once more than ${TEST_LOGIN_LIMIT} requests hit POST /auth/login within the configured window`, async () => {
    const response = await attemptLogin();

    expect(response.status).toBe(429);
    // ThrottlerException builds its HttpException from a plain string
    // message (see @nestjs/throttler's throttler.exception.ts), so
    // `AllExceptionsFilter`'s HttpException passthrough serializes
    // `response.body` as that raw string — not the
    // `{ statusCode, message, error }` envelope Nest's own
    // UnauthorizedException/BadRequestException etc. produce.
    expect(response.body).toBe('ThrottlerException: Too Many Requests');
    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps blocking further requests without re-extending the block window on every hit', async () => {
    const first = await attemptLogin();
    const second = await attemptLogin();

    expect(first.status).toBe(429);
    expect(second.status).toBe(429);

    // The block's own Retry-After must not grow request-over-request —
    // proves the "blocked" state is frozen (RedisThrottlerStorage sets
    // the block key with NX), not repeatedly re-armed by every
    // subsequent request while already blocked.
    const firstRetryAfter = Number(first.headers['retry-after']);
    const secondRetryAfter = Number(second.headers['retry-after']);

    expect(secondRetryAfter).toBeLessThanOrEqual(firstRetryAfter);
  });

  it('does not rate-limit an unrelated route under the same generous global default', async () => {
    // A sanity check that the strict per-route override above is scoped
    // to POST /auth/login specifically, not accidentally applied
    // globally — GET /health has its own, much more generous bucket
    // (the global THROTTLE_LIMIT/THROTTLE_TTL_MS from .env/CI, left
    // untouched by this test) and must still succeed normally.
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(200);
  });
});

async function flushThrottlerKeys(redisService: RedisService): Promise<void> {
  const client = redisService.getClient();
  const keys = await client.keys('throttler:*');

  if (keys.length > 0) {
    await client.del(...keys);
  }
}
