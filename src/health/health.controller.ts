import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Report application/database/Redis health' })
  @ApiOkResponse({
    description:
      'The current health status of the application and its dependencies.',
    schema: {
      example: {
        status: 'ok',
        services: { database: 'up', redis: 'up' },
        timestamp: '2026-08-19T00:00:00.000Z',
      },
    },
  })
  check() {
    return this.healthService.check();
  }
}
