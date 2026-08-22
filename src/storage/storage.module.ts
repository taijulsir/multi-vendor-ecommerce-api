import { Module } from '@nestjs/common';

import { LocalFileStorageService } from './storage.service';

/**
 * Infrastructure module for local-filesystem storage (Phase 22) —
 * grouped with `PrismaModule`/`RedisModule` in spirit (a shared
 * technical concern, not a business domain), so it gets its own module
 * rather than living inside `CatalogModule`.
 */
@Module({
  providers: [LocalFileStorageService],
  exports: [LocalFileStorageService],
})
export class StorageModule {}
