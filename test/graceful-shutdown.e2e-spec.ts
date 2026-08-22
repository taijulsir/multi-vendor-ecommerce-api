import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';

/**
 * Phase 23 — graceful shutdown proof, scoped to what Jest can actually
 * verify reliably.
 *
 * **What this proves:** `app.enableShutdownHooks()` (added to
 * `src/main.ts`) wires real OS signals to `app.close()`, and `app.close()`
 * itself already invokes every module's `onModuleDestroy()` — that part
 * is directly, deterministically testable and is what's asserted below.
 *
 * **What this does not, and cannot reliably, prove in Jest:** actually
 * sending a real `SIGTERM` to the process and observing an in-flight
 * HTTP request drain before exit. Spawning a real child process, timing
 * signal delivery, and asserting on its exit sequence is exactly the kind
 * of "signal-level testing unreliable in Jest" this phase's own
 * instructions say to document rather than fake — a synthetic test that
 * sends `SIGTERM` to the *test runner's own* process would either do
 * nothing meaningful (Jest itself intercepts/ignores it in most
 * configurations) or risk killing the test run. Manual verification (a
 * real `docker stop` against the running container, with log inspection
 * confirming the shutdown-hook log lines below appear before exit) is
 * the practical verification method for that part, exactly as this
 * phase's own completion criteria describes it.
 *
 * Also confirmed manually during this phase (not asserted here, since it
 * isn't a stable invariant across Prisma versions): querying through
 * `PrismaService` again *after* `app.close()` does not reliably reject —
 * `@prisma/client` with the `@prisma/adapter-pg` driver adapter can
 * lazily reconnect on the next query. That makes "does a post-close
 * query reject" an unreliable, version-dependent behavior to assert on,
 * so this test does not rely on it — asserting that the *cleanup hook
 * itself ran* is the meaningful, stable guarantee.
 */
describe('Graceful shutdown (e2e)', () => {
  let app: INestApplication;

  it('enableShutdownHooks + app.close() invokes onModuleDestroy for every long-lived resource (Prisma, Redis)', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    await app.init();

    const prisma = app.get(PrismaService);
    const redis = app.get(RedisService);

    const prismaDestroySpy = jest.spyOn(prisma, 'onModuleDestroy');
    const redisDestroySpy = jest.spyOn(redis, 'onModuleDestroy');

    await app.close();

    expect(prismaDestroySpy).toHaveBeenCalledTimes(1);
    expect(redisDestroySpy).toHaveBeenCalledTimes(1);
  });

  it('app.close() resolves (does not hang) — the same call every e2e suite already performs in afterAll', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const isolatedApp = moduleFixture.createNestApplication();
    isolatedApp.enableShutdownHooks();
    await isolatedApp.init();

    await expect(isolatedApp.close()).resolves.toBeUndefined();
  });
});
