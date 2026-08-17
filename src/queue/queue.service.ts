import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('system')
    private readonly queue: Queue,
  ) {}

  async addTestJob() {
    return this.queue.add('integration-test', {
      message: 'BullMQ is working',
      createdAt: new Date().toISOString(),
    });
  }
}