import { BadRequestException } from '@nestjs/common';

/**
 * The only accepted image types (docs/remaining-architecture-plan.md
 * Section 8's validation pipeline, step 3: "an images-only allowlist...
 * which also structurally prevents any executable file type"). Keyed by
 * the MIME type `file-type` reports from *content* sniffing, never the
 * client-supplied `Content-Type` header or filename extension.
 */
const ALLOWED_MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// docs/remaining-architecture-plan.md Section 8: "`FileInterceptor` with
// a `limits.fileSize` cap (e.g. 5 MB)" — the only concrete figure given
// anywhere in the approved design, treated as the approved limit (see
// this phase's final report for the "e.g." hedge, flagged transparently
// rather than silently treated as unquestionable).
export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const INVALID_IMAGE_MESSAGE =
  'Only JPEG, PNG, and WebP images are accepted.';

export interface ValidatedImage {
  mimeType: string;
  extension: string;
}

/**
 * Content-based MIME validation (magic-number sniffing via `file-type`),
 * never trusting the client's declared `Content-Type` or filename
 * extension — step 2 of Section 8's validation pipeline. Dynamic
 * `import()` is required: `file-type` ships as an ESM-only package and
 * this project compiles to CommonJS.
 */
export async function validateImageFile(buffer: Buffer): Promise<ValidatedImage> {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  const extension = detected
    ? ALLOWED_MIME_TO_EXTENSION[detected.mime]
    : undefined;

  if (!detected || !extension) {
    throw new BadRequestException(INVALID_IMAGE_MESSAGE);
  }

  return { mimeType: detected.mime, extension };
}

/**
 * Derives a Content-Type for serving a previously-validated stored file
 * back, from its (server-generated) extension alone — never from
 * arbitrary user-controlled input (Phase 22 Step 19). Every extension
 * this function ever receives came from `validateImageFile` at upload
 * time, so this reverse lookup can only ever produce one of the three
 * allowed image types.
 */
export function mimeTypeForExtension(extension: string): string {
  const match = Object.entries(ALLOWED_MIME_TO_EXTENSION).find(
    ([, ext]) => ext === extension,
  );

  return match ? match[0] : 'application/octet-stream';
}
