import { WebhooksController } from './webhooks.controller';
import type { WebhookEventDto } from './dto/webhook-event.dto';

describe('WebhooksController', () => {
  let controller: WebhooksController;

  const webhooksService = {
    processEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebhooksController(webhooksService as any);
  });

  it('receive delegates to WebhooksService.processEvent with the request body', async () => {
    const dto: WebhookEventDto = {
      provider: 'MANUAL',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
    };
    webhooksService.processEvent.mockResolvedValue({ status: 'processed' });

    const result = await controller.receive(dto);

    expect(webhooksService.processEvent).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ status: 'processed' });
  });
});
