import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

import { RedisService } from '../redis/redis.service';

const KEY_PREFIX = 'throttler';

// Atomically increments the hit counter and arms its expiry only on the
// very first hit of a fresh window. Two separate round trips (INCR then
// PEXPIRE) would leave a small race — a crash between them abandons a
// counter key that never expires — closed here the same way this
// codebase's SQL layer prefers one atomic conditional UPDATE over a
// SELECT-then-UPDATE (see CheckoutService's inventory reservation):
// Redis runs this whole script server-side as a single operation.
const INCREMENT_SCRIPT = `
local totalHits = redis.call("INCR", KEYS[1])
if totalHits == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local pttl = redis.call("PTTL", KEYS[1])
return { totalHits, pttl }
`;

function millisecondsToSeconds(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

/**
 * Redis-backed `ThrottlerStorage` for `@nestjs/throttler`, built on the
 * application's existing `RedisService` connection rather than opening a
 * second Redis client — `RedisService` is already the single place this
 * codebase's Redis access lives (see its own doc-comment), and Redis is
 * already a hard startup dependency (`env.validation.ts`,
 * `RedisService.onModuleInit`'s ping), so this adds no new
 * infrastructure requirement.
 *
 * Chosen over `@nestjs/throttler`'s default in-memory storage
 * specifically because production redeploys automatically on every push
 * to `main` (`.github/workflows/cd.yml`) — in-memory counters reset on
 * every container replacement, quietly weakening protection against a
 * sustained low-and-slow attacker across releases. Redis-backed counters
 * survive a redeploy the same way the rest of the application's state
 * does.
 *
 * Two Redis keys per (route, throttler-name, tracker):
 *  - `throttler:<name>:<key>` — the rolling hit counter, TTL = the
 *    window (`ttl`).
 *  - `throttler:<name>:<key>:blocked` — set only once the counter first
 *    exceeds the limit, TTL = `blockDuration`, written with `NX` so a
 *    request arriving *while already blocked* cannot keep resetting the
 *    block timer (it would otherwise never expire under continued
 *    traffic).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const client = this.redisService.getClient();
    const counterKey = `${KEY_PREFIX}:${throttlerName}:${key}`;
    const blockKey = `${counterKey}:blocked`;

    const blockPttl = await client.pttl(blockKey);

    if (blockPttl > 0) {
      // Already blocked: frozen, not re-incremented — matches
      // @nestjs/throttler's own reference (in-memory) storage, which
      // stops counting hits while a key is blocked.
      const totalHits = await this.readCurrentCount(client, counterKey);

      return {
        totalHits,
        timeToExpire: millisecondsToSeconds(await client.pttl(counterKey)),
        isBlocked: true,
        timeToBlockExpire: millisecondsToSeconds(blockPttl),
      };
    }

    const [totalHitsRaw, counterPttlRaw] = (await client.eval(
      INCREMENT_SCRIPT,
      1,
      counterKey,
      ttl,
    )) as [number, number];

    const totalHits = Number(totalHitsRaw);
    const isBlocked = totalHits > limit;

    if (isBlocked) {
      await client.set(blockKey, '1', 'PX', blockDuration, 'NX');
    }

    return {
      totalHits,
      timeToExpire: millisecondsToSeconds(Number(counterPttlRaw)),
      isBlocked,
      timeToBlockExpire: isBlocked ? millisecondsToSeconds(blockDuration) : 0,
    };
  }

  private async readCurrentCount(
    client: Redis,
    counterKey: string,
  ): Promise<number> {
    const raw = await client.get(counterKey);

    return raw ? Number(raw) : 0;
  }
}
