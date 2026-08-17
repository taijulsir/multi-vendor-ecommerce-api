import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('system')
export class QueueProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    console.log(`[BullMQ] Processing job: ${job.name}`);
    console.log('[BullMQ] Data:', job.data);
  }
}