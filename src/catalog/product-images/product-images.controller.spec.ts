import { ProductImagesController } from './product-images.controller';

describe('ProductImagesController', () => {
  let controller: ProductImagesController;

  const productImagesService = {
    upload: jest.fn(),
    resolveStreamable: jest.fn(),
    remove: jest.fn(),
  };

  const user = { id: 'user-uuid' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ProductImagesController(productImagesService as any);
  });

  it('create delegates to ProductImagesService.upload with the productId route param, file, and dto', async () => {
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    const dto = { altText: 'Front view' };
    productImagesService.upload.mockResolvedValue({ id: 'image-uuid' });

    await expect(controller.create('product-uuid', file, dto)).resolves.toEqual(
      { id: 'image-uuid' },
    );

    expect(productImagesService.upload).toHaveBeenCalledWith(
      'product-uuid',
      file,
      dto,
    );
  });

  describe('stream', () => {
    const makeResponse = () => {
      const res: any = {
        headersSent: false,
        headers: {} as Record<string, string>,
        setHeader: jest.fn(function (this: any, key: string, value: string) {
          this.headers[key] = value;
        }),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        destroy: jest.fn(),
      };
      return res;
    };

    it('resolves the streamable image and pipes it to the response with security headers', async () => {
      const streamEvents: Record<string, () => void> = {};
      const stream = {
        on: jest.fn((event: string, cb: () => void) => {
          streamEvents[event] = cb;
        }),
        pipe: jest.fn(),
      };
      productImagesService.resolveStreamable.mockResolvedValue({
        stream,
        mimeType: 'image/png',
      });
      const res = makeResponse();

      await controller.stream('product-uuid', 'image-uuid', user, res);

      expect(productImagesService.resolveStreamable).toHaveBeenCalledWith(
        'product-uuid',
        'image-uuid',
        user,
      );
      expect(res.headers['Content-Type']).toBe('image/png');
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(res.headers['Content-Disposition']).toBe('inline');
      expect(stream.pipe).toHaveBeenCalledWith(res);
    });

    it("passes the guard-resolved user through, even when it's undefined (optional auth)", async () => {
      const stream = { on: jest.fn(), pipe: jest.fn() };
      productImagesService.resolveStreamable.mockResolvedValue({
        stream,
        mimeType: 'image/jpeg',
      });
      const res = makeResponse();

      await controller.stream('product-uuid', 'image-uuid', undefined, res);

      expect(productImagesService.resolveStreamable).toHaveBeenCalledWith(
        'product-uuid',
        'image-uuid',
        undefined,
      );
    });
  });

  it('remove delegates to ProductImagesService.remove with both route params', async () => {
    productImagesService.remove.mockResolvedValue(undefined);

    await controller.remove('product-uuid', 'image-uuid');

    expect(productImagesService.remove).toHaveBeenCalledWith(
      'product-uuid',
      'image-uuid',
    );
  });
});
