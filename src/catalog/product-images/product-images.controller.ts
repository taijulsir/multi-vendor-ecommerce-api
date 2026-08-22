import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { ProductOwnershipGuard } from '../../auth/guards/product-ownership.guard';
import type { SafeUser } from '../../auth/utils/safe-user';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { ProductImagesService } from './product-images.service';
import { MAX_IMAGE_FILE_SIZE_BYTES } from './utils/image-validation';

const PRODUCT_ID_PARAM = {
  name: 'productId',
  description:
    "The parent product's id. Never trusted as an ownership claim by " +
    "itself — the caller's own vendor identity is resolved server-side " +
    'and checked against this product (ProductOwnershipGuard, reused ' +
    'unchanged, for upload/delete only — the GET stream route below ' +
    'has its own mixed visibility model).',
} as const;

const IMAGE_ID_PARAM = {
  name: 'imageId',
  description: "The image's id, scoped to the parent product.",
} as const;

/**
 * Product image upload/stream/delete (Phase 22,
 * docs/remaining-architecture-plan.md Section 8/11). Local filesystem
 * storage only — never S3/Spaces/MinIO/any object storage — via
 * `LocalFileStorageService`, never scattered `fs` calls in this
 * controller.
 *
 * Upload and delete are owner-only (`ProductOwnershipGuard`, reused
 * unchanged). The GET stream route is deliberately *not* behind that
 * guard: its visibility is "mixed", inherited from the parent Product's
 * own status, so it uses `OptionalJwtAuthGuard` and lets
 * `ProductImagesService.resolveStreamable` decide access — see that
 * method's doc-comment.
 */
@ApiTags('product-images')
@Controller('products/:productId/images')
export class ProductImagesController {
  constructor(private readonly productImagesService: ProductImagesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, ProductOwnershipGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_FILE_SIZE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `JPEG, PNG, or WebP only, up to ${MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024)} MB. Validated by content, not by filename/Content-Type.`,
        },
        variantId: {
          type: 'string',
          format: 'uuid',
          description:
            'Optional — attach to a specific variant of this product.',
        },
        altText: { type: 'string' },
        isPrimary: { type: 'boolean' },
      },
    },
  })
  @ApiOperation({
    summary: "Upload an image to one of the vendor's own products",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      'The file is validated by content-based MIME sniffing (never the ' +
      "client's declared Content-Type or filename) and stored under a " +
      'server-generated filename — the original filename is never used ' +
      'as a stored path. Returns the created image record; `url` is the ' +
      "path to this image's streaming endpoint below.",
  })
  @ApiCreatedResponse({ description: 'The created image record.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiBadRequestResponse({
    description:
      'Missing file, unsupported image type, or variantId does not ' +
      'reference a variant of this product.',
  })
  @ApiPayloadTooLargeResponse({
    description: 'The file exceeds the size limit.',
  })
  create(
    @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateProductImageDto,
  ) {
    return this.productImagesService.upload(productId, file, dto);
  }

  @Get(':imageId')
  @UseGuards(OptionalJwtAuthGuard)
  // Phase 25 Swagger audit: `@ApiBearerAuth()` alone marks this route as
  // *requiring* the bearer scheme in the generated OpenAPI security
  // requirement — inaccurate for a route whose auth is genuinely
  // optional (an ACTIVE product's image needs none at all). Declaring
  // both a bearer requirement *and* an empty requirement (`{}`) is the
  // standard OpenAPI 3 way to express "this scheme is accepted, but not
  // mandatory" — Swagger UI still offers the Authorization field for
  // testing the owner/ADMIN case, but no longer implies a token is
  // always required.
  @ApiBearerAuth()
  @ApiSecurity({})
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiOperation({
    summary: 'Stream a product image',
    description:
      "Visibility is inherited from the parent product's own status: " +
      "an ACTIVE product's images are publicly streamable with no " +
      'authentication required; any other status requires the caller ' +
      'to own the product or be an ADMIN, same as viewing the product ' +
      'itself.',
  })
  @ApiOkResponse({
    description: 'The image bytes, with an image/* Content-Type.',
  })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own a non-public parent product. ' +
      'Intentionally generic.',
  })
  @ApiNotFoundResponse({
    description: 'Image not found, or not visible to this caller.',
  })
  async stream(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: SafeUser | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { stream, mimeType } =
      await this.productImagesService.resolveStreamable(
        productId,
        imageId,
        user,
      );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');

    stream.on('error', () => {
      if (!res.headersSent) {
        res
          .status(404)
          .json(new NotFoundException('Image not found').getResponse());
      } else {
        res.destroy();
      }
    });

    stream.pipe(res);
  }

  @Delete(':imageId')
  @UseGuards(JwtAuthGuard, ProductOwnershipGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiParam(PRODUCT_ID_PARAM)
  @ApiParam(IMAGE_ID_PARAM)
  @ApiOperation({
    summary: "Delete an image from one of the vendor's own products",
    description:
      'Requires the caller to own the parent product, or be an ADMIN. ' +
      'Deletes the database record and best-effort deletes the on-disk ' +
      'file (a leftover file on delete failure is logged, not surfaced).',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiUnauthorizedResponse({ description: 'Missing/invalid access token.' })
  @ApiForbiddenResponse({
    description:
      'Authenticated, but does not own the parent product. Intentionally generic.',
  })
  @ApiNotFoundResponse({ description: 'Image not found.' })
  async remove(
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    await this.productImagesService.remove(productId, imageId);
  }
}
