import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.getClient().ping();

    return {
      status: 'ok',
      services: {
        database: 'up',
        redis: 'up',
      },
      timestamp: new Date().toISOString(),
    };
  }
}