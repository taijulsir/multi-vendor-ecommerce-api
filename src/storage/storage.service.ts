import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs, constants as fsConstants } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// docs/remaining-architecture-plan.md Section 8: "Development default:
// `./storage/uploads` (git-ignored, outside `dist/`)." Only ever used
// when `FILE_STORAGE_DIR` is unset — never a machine-specific absolute
// path baked into source.
const DEFAULT_STORAGE_DIR = './storage/uploads';

/** Thrown by `createReadStream` when the referenced file does not exist on disk. */
export class StorageFileNotFoundError extends Error {}

/**
 * Thrown when a filename resolves outside the configured storage root.
 * Every filename this service ever receives is server-generated
 * (`generateFilename`), so this should be unreachable in normal
 * operation — it exists as defense-in-depth, not a client-facing
 * validation path (docs/remaining-architecture-plan.md Section 8, Step 8
 * of the Phase 22 task: "use canonical/resolved path verification").
 */
export class StorageInvalidPathError extends Error {}

/**
 * Secure local-filesystem storage abstraction (Phase 22). Deliberately
 * narrow — not a generic multi-provider abstraction, not a general file
 * upload service: writes/reads/deletes exactly one flat, configured
 * directory, using only server-generated filenames.
 *
 * **Never statically served.** Nothing in this codebase registers this
 * directory with `ServeStaticModule` — every read goes through
 * `createReadStream`, which re-verifies the resolved path stays inside
 * the configured root before touching the filesystem. This is what makes
 * "no direct public filesystem exposure" true by construction rather
 * than by policy alone (Section 8).
 *
 * Filenames are always server-generated (`generateFilename`) — a
 * client's original filename is never used as a stored filename or path
 * segment anywhere in this class, which structurally eliminates path
 * traversal from client input. The `resolveSafePath` check below is
 * defense-in-depth on top of that, not the only line of defense.
 */
@Injectable()
export class LocalFileStorageService implements OnModuleInit {
  private readonly logger = new Logger(LocalFileStorageService.name);
  private readonly rootDir: string;

  constructor(private readonly configService: ConfigService) {
    const configured =
      this.configService.get<string>('FILE_STORAGE_DIR') ??
      DEFAULT_STORAGE_DIR;
    this.rootDir = resolve(process.cwd(), configured);
  }

  /** Ensures the configured storage root exists before any request needs it. */
  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  /**
   * A server-controlled filename: random, unguessable, and carrying only
   * the extension already derived from the *validated* MIME type by the
   * caller — never the client's original filename or extension.
   */
  generateFilename(extension: string): string {
    return `${randomUUID()}${extension}`;
  }

  async writeFile(filename: string, buffer: Buffer): Promise<void> {
    const target = this.resolveSafePath(filename);
    await fs.writeFile(target, buffer);
  }

  /**
   * Resolves a readable stream for `filename`, first confirming the file
   * exists so a missing file surfaces as `StorageFileNotFoundError`
   * (translated by the caller into a generic "not found" response)
   * rather than an unhandled stream `error` event after headers may
   * already have been sent.
   */
  async createReadStream(filename: string): Promise<ReadStream> {
    const target = this.resolveSafePath(filename);

    try {
      await fs.access(target, fsConstants.R_OK);
    } catch {
      throw new StorageFileNotFoundError(`File not found: ${filename}`);
    }

    return createReadStream(target);
  }

  /**
   * Best-effort delete — never throws. A missing file is a no-op
   * (idempotent); any other failure is logged, not surfaced, per
   * docs/remaining-architecture-plan.md Section 8: "log on failure — a
   * leftover file is a disk-space problem, not a security one." This
   * same method backs both the documented delete-image flow and the
   * upload-rollback (DB-write-failed) cleanup path.
   */
  async deleteFile(filename: string): Promise<void> {
    let target: string;

    try {
      target = this.resolveSafePath(filename);
    } catch (error) {
      this.logger.warn(
        `Refused to delete an unsafe file reference "${filename}": ${(error as Error).message}`,
      );
      return;
    }

    try {
      await fs.unlink(target);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code !== 'ENOENT') {
        this.logger.warn(
          `Failed to delete stored file "${filename}": ${err.message}`,
        );
      }
    }
  }

  /**
   * Canonical path-traversal defense (Phase 22 Step 8): resolves
   * `filename` against the configured root and verifies the result's
   * path *relative to that root* never escapes it. This catches `../`
   * sequences, absolute paths, and any other traversal shape that
   * `path.resolve`/`path.relative` would normalize — not a
   * string-concatenation-only check.
   */
  private resolveSafePath(filename: string): string {
    if (!filename || filename.includes('\0') || isAbsolute(filename)) {
      throw new StorageInvalidPathError(
        `Invalid stored file reference: ${filename}`,
      );
    }

    const target = resolve(this.rootDir, filename);
    const rel = relative(this.rootDir, target);

    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new StorageInvalidPathError(
        `Invalid stored file reference: ${filename}`,
      );
    }

    return target;
  }
}
