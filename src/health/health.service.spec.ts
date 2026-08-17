import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;

  const prisma = {
    $queryRaw: jest.fn(),
  };

  const redis = {
    getClient: jest.fn(),
  };

  const redisClient = {
    ping: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    redis.getClient.mockReturnValue(redisClient);

    service = new HealthService(
      prisma as any,
      redis as any,
    );
  });

  it('should return healthy status when database and redis are available', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockResolvedValue('PONG');

    const result = await service.check();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.getClient).toHaveBeenCalledTimes(1);
    expect(redisClient.ping).toHaveBeenCalledTimes(1);

    expect(result.status).toBe('ok');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('up');
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it('should propagate database errors', async () => {
    const error = new Error('Database unavailable');

    prisma.$queryRaw.mockRejectedValue(error);

    await expect(service.check()).rejects.toThrow('Database unavailable');

    expect(redisClient.ping).not.toHaveBeenCalled();
  });

  it('should propagate redis errors', async () => {
    const error = new Error('Redis unavailable');

    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisClient.ping.mockRejectedValue(error);

    await expect(service.check()).rejects.toThrow('Redis unavailable');
  });
});