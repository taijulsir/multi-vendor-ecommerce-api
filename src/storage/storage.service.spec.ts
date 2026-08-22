import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import {
  LocalFileStorageService,
  StorageFileNotFoundError,
} from './storage.service';

describe('LocalFileStorageService', () => {
  let rootDir: string;
  let service: LocalFileStorageService;

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'storage-service-test-'));
    configService.get.mockReturnValue(rootDir);
    service = new LocalFileStorageService(configService as unknown as ConfigService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe('onModuleInit', () => {
    it('creates the configured root directory if it does not already exist', async () => {
      const nested = join(rootDir, 'does', 'not', 'exist', 'yet');
      configService.get.mockReturnValue(nested);
      const nestedService = new LocalFileStorageService(
        configService as unknown as ConfigService,
      );

      await nestedService.onModuleInit();

      const stat = await fs.stat(nested);
      expect(stat.isDirectory()).toBe(true);
    });

    it('falls back to the documented default when FILE_STORAGE_DIR is unset', () => {
      configService.get.mockReturnValue(undefined);
      expect(
        () => new LocalFileStorageService(configService as unknown as ConfigService),
      ).not.toThrow();
    });
  });

  describe('generateFilename', () => {
    it('produces a random, unguessable filename with the given extension', () => {
      const a = service.generateFilename('.jpg');
      const b = service.generateFilename('.jpg');

      expect(a).not.toBe(b);
      expect(a.endsWith('.jpg')).toBe(true);
      expect(a).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
      );
    });
  });

  describe('writeFile / createReadStream', () => {
    it('writes a buffer and reads it back byte-for-byte', async () => {
      const filename = service.generateFilename('.png');
      const contents = Buffer.from('fake-png-bytes');

      await service.writeFile(filename, contents);
      const stream = await service.createReadStream(filename);

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }

      expect(Buffer.concat(chunks).toString()).toBe('fake-png-bytes');
    });

    it('writes the file inside the configured root directory', async () => {
      const filename = service.generateFilename('.jpg');
      await service.writeFile(filename, Buffer.from('x'));

      const stat = await fs.stat(join(rootDir, filename));
      expect(stat.isFile()).toBe(true);
    });

    it('throws StorageFileNotFoundError for a filename that was never written', async () => {
      await expect(
        service.createReadStream(`${service.generateFilename('.jpg')}`),
      ).rejects.toBeInstanceOf(StorageFileNotFoundError);
    });
  });

  describe('path traversal protection', () => {
    it('rejects a relative-parent-directory traversal attempt on write', async () => {
      await expect(
        service.writeFile('../escaped.txt', Buffer.from('x')),
      ).rejects.toThrow(/Invalid stored file reference/);
    });

    it('rejects a nested traversal attempt disguised inside a normal-looking name', async () => {
      await expect(
        service.writeFile('foo/../../escaped.txt', Buffer.from('x')),
      ).rejects.toThrow(/Invalid stored file reference/);
    });

    it('rejects an absolute path on write', async () => {
      await expect(
        service.writeFile('/etc/passwd', Buffer.from('x')),
      ).rejects.toThrow(/Invalid stored file reference/);
    });

    it('rejects an absolute path on read', async () => {
      await expect(service.createReadStream('/etc/passwd')).rejects.toThrow(
        /Invalid stored file reference/,
      );
    });

    it('rejects a null-byte injection attempt', async () => {
      await expect(
        service.writeFile('safe.jpg\0.png', Buffer.from('x')),
      ).rejects.toThrow(/Invalid stored file reference/);
    });

    it('rejects an empty filename', async () => {
      await expect(service.writeFile('', Buffer.from('x'))).rejects.toThrow(
        /Invalid stored file reference/,
      );
    });

    it('never deletes anything and never throws for a traversal attempt on delete', async () => {
      await expect(service.deleteFile('../escaped.txt')).resolves.toBeUndefined();
    });
  });

  describe('deleteFile', () => {
    it('removes a previously written file', async () => {
      const filename = service.generateFilename('.webp');
      await service.writeFile(filename, Buffer.from('x'));

      await service.deleteFile(filename);

      await expect(service.createReadStream(filename)).rejects.toBeInstanceOf(
        StorageFileNotFoundError,
      );
    });

    it('does not throw when deleting a file that does not exist (idempotent)', async () => {
      await expect(
        service.deleteFile(service.generateFilename('.jpg')),
      ).resolves.toBeUndefined();
    });
  });
});
