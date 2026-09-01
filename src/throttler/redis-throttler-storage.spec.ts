import { RedisThrottlerStorage } from './redis-throttler-storage';

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;

  const client = {
    pttl: jest.fn(),
    eval: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
  };

  const redisService = {
    getClient: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    redisService.getClient.mockReturnValue(client);

    storage = new RedisThrottlerStorage(redisService as any);
  });

  it('increments via an atomic Lua script scoped to a namespaced key, and is not blocked under the limit', async () => {
    client.pttl.mockResolvedValueOnce(-2); // no existing block
    client.eval.mockResolvedValueOnce([1, 60_000]);

    const result = await storage.increment(
      'route-key',
      60_000,
      5,
      60_000,
      'default',
    );

    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'throttler:default:route-key',
      60_000,
    );
    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(client.set).not.toHaveBeenCalled();
  });

  it('marks the request blocked once totalHits exceeds the limit, and arms the block key with NX + PX', async () => {
    client.pttl.mockResolvedValueOnce(-2); // no existing block yet
    client.eval.mockResolvedValueOnce([6, 45_000]); // 6th hit, limit is 5

    const result = await storage.increment(
      'route-key',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(result).toEqual({
      totalHits: 6,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
    expect(client.set).toHaveBeenCalledWith(
      'throttler:default:route-key:blocked',
      '1',
      'PX',
      30_000,
      'NX',
    );
  });

  it('does not increment further while already blocked — returns the frozen count instead', async () => {
    client.pttl.mockResolvedValueOnce(12_000); // block key still has 12s left
    client.get.mockResolvedValueOnce('7');
    client.pttl.mockResolvedValueOnce(9_000); // counter key's own remaining ttl

    const result = await storage.increment(
      'route-key',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(client.eval).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(result).toEqual({
      totalHits: 7,
      timeToExpire: 9,
      isBlocked: true,
      timeToBlockExpire: 12,
    });
  });

  it('namespaces keys independently per throttler name, so two named throttlers never collide on the same route key', async () => {
    client.pttl.mockResolvedValue(-2);
    client.eval.mockResolvedValueOnce([1, 60_000]);

    await storage.increment('shared-key', 60_000, 5, 60_000, 'strict');

    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'throttler:strict:shared-key',
      60_000,
    );
  });

  it('treats a missing counter value as zero hits while blocked (defensive: should not normally happen)', async () => {
    client.pttl.mockResolvedValueOnce(5_000);
    client.get.mockResolvedValueOnce(null);
    client.pttl.mockResolvedValueOnce(5_000);

    const result = await storage.increment(
      'route-key',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(result.totalHits).toBe(0);
    expect(result.isBlocked).toBe(true);
  });
});
