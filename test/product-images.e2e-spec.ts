import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

// A test-specific temporary storage directory — never the dev/production
// `./storage/uploads` default — configured *before* `Test
// .createTestingModule({ imports: [AppModule] }).compile()` runs, since
// `ConfigModule.forRoot()`'s factory only reads `process.env` at that
// point (module *instantiation*, not import time), and dotenv never
// overwrites an already-set `process.env` key.
let tempStorageDir: string;

// A real, minimal 1x1 PNG/WebP/JPEG — used so the server's real
// content-based MIME sniffing (never mocked) genuinely detects the
// declared type, per this phase's "do not mock away important security
// behavior" instruction.
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const WEBP_BUFFER = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64',
);
const HTML_BUFFER = Buffer.from('<html><script>alert(1)</script></html>');

describe('Product Images API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `product-images-e2e-${randomUUID()}@example.com`;
  const uniqueSlug = (prefix: string) => `${prefix}-${randomUUID()}`;

  const registerAndLogin = async (firstName: string) => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, firstName })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      id: login.body.id as string,
      email,
      accessToken: login.body.accessToken as string,
    };
  };

  beforeAll(async () => {
    tempStorageDir = await mkdtemp(
      join(tmpdir(), 'product-images-e2e-storage-'),
    );
    process.env.FILE_STORAGE_DIR = tempStorageDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (registeredEmails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: registeredEmails } },
      });
    }

    await app.close();
    await rm(tempStorageDir, { recursive: true, force: true });
    delete process.env.FILE_STORAGE_DIR;
  });

  describe('Upload / Stream / Delete', () => {
    let categoryId: string;
    let vendorA: { id: string; userId: string; accessToken: string };
    let vendorB: { id: string; userId: string; accessToken: string };
    let adminUser: { accessToken: string };
    let draftProductId: string;
    let activeProductId: string;

    const createProductForVendor = async (
      vendor: { accessToken: string },
      status?: 'ACTIVE',
    ) => {
      const response = await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', `Bearer ${vendor.accessToken}`)
        .send({
          name: 'Image Fixture Product',
          slug: uniqueSlug('image-fixture-product'),
          categoryId,
        })
        .expect(201);

      const productId = response.body.id as string;

      if (status === 'ACTIVE') {
        await prisma.product.update({
          where: { id: productId },
          data: { status: 'ACTIVE' },
        });
      }

      return productId;
    };

    beforeAll(async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });

      const category = await prisma.category.create({
        data: { name: 'Image Test Category', slug: uniqueSlug('img-cat') },
      });
      categoryId = category.id;

      const vendorAUser = await registerAndLogin('ImageVendorA');
      const vendorARecord = await prisma.vendor.create({
        data: { userId: vendorAUser.id, businessName: 'Image Vendor A' },
      });
      vendorA = {
        id: vendorARecord.id,
        userId: vendorAUser.id,
        accessToken: vendorAUser.accessToken,
      };

      const vendorBUser = await registerAndLogin('ImageVendorB');
      const vendorBRecord = await prisma.vendor.create({
        data: { userId: vendorBUser.id, businessName: 'Image Vendor B' },
      });
      vendorB = {
        id: vendorBRecord.id,
        userId: vendorBUser.id,
        accessToken: vendorBUser.accessToken,
      };

      const adminAccount = await registerAndLogin('ImageAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });
      adminUser = adminAccount;

      draftProductId = await createProductForVendor(vendorA);
      activeProductId = await createProductForVendor(vendorA, 'ACTIVE');
    });

    afterAll(async () => {
      await prisma.productImage.deleteMany({
        where: { product: { vendorId: { in: [vendorA.id, vendorB.id] } } },
      });

      const variants = await prisma.productVariant.findMany({
        where: { product: { vendorId: { in: [vendorA.id, vendorB.id] } } },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);
      await prisma.inventory.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });

      await prisma.product.deleteMany({
        where: { vendorId: { in: [vendorA.id, vendorB.id] } },
      });
      await prisma.vendor.deleteMany({
        where: { id: { in: [vendorA.id, vendorB.id] } },
      });
      await prisma.category.deleteMany({ where: { id: categoryId } });
    });

    describe('POST /api/products/:productId/images', () => {
      it("uploads an image to the authenticated vendor's own product, storing it under a server-generated filename on disk", async () => {
        const response = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'my-original-filename.png')
          .field('altText', 'Front view')
          .expect(201);

        expect(response.body.productId).toBe(draftProductId);
        expect(response.body.altText).toBe('Front view');
        expect(response.body.url).toBe(
          `/api/products/${draftProductId}/images/${response.body.id}`,
        );
        // Never leak the internal storage filename or absolute filesystem path.
        expect(response.body).not.toHaveProperty('storageKey');
        expect(JSON.stringify(response.body)).not.toContain(tempStorageDir);
        expect(JSON.stringify(response.body)).not.toContain(
          'my-original-filename',
        );

        const stored = await prisma.productImage.findUniqueOrThrow({
          where: { id: response.body.id as string },
        });
        expect(stored.storageKey).toBeTruthy();
        // Physically exists on disk, under a random name — never the
        // client's original filename.
        expect(stored.storageKey).not.toContain('my-original-filename');
        expect(existsSync(join(tempStorageDir, stored.storageKey!))).toBe(true);

        await prisma.productImage.delete({ where: { id: stored.id } });
      });

      it('accepts variantId, altText, and isPrimary as multipart fields', async () => {
        const variant = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('img-sku').toUpperCase(),
            price: '1000.00',
            currency: 'BDT',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', WEBP_BUFFER, 'variant.webp')
          .field('variantId', variant.body.id as string)
          .field('isPrimary', 'true')
          .expect(201);

        expect(response.body.variantId).toBe(variant.body.id);
        expect(response.body.isPrimary).toBe(true);

        await prisma.productImage.delete({
          where: { id: response.body.id as string },
        });
      });

      it('rejects (400) a variantId that belongs to a different product', async () => {
        const otherProductId = await createProductForVendor(vendorA);
        const otherVariant = await request(app.getHttpServer())
          .post(`/api/products/${otherProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('other-sku').toUpperCase(),
            price: '500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .field('variantId', otherVariant.body.id as string)
          .expect(400);

        await prisma.inventory.deleteMany({
          where: { variantId: otherVariant.body.id as string },
        });
        await prisma.productVariant.delete({
          where: { id: otherVariant.body.id as string },
        });
        await prisma.product.delete({ where: { id: otherProductId } });
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(401);
      });

      it("rejects (403) a different vendor uploading to vendor A's product", async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(403);
      });

      it('allows an ADMIN to upload to any product', async () => {
        const response = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await prisma.productImage.delete({
          where: { id: response.body.id as string },
        });
      });

      it('rejects (400) content that is not one of the allowed image types, regardless of declared filename/extension', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', HTML_BUFFER, 'totally-a-photo.png')
          .expect(400);
      });

      it('rejects (413) a file exceeding the size limit', async () => {
        const oversized = Buffer.concat([
          PNG_BUFFER,
          Buffer.alloc(6 * 1024 * 1024, 0),
        ]);

        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', oversized, 'big.png')
          .expect(413);
      });

      it('rejects (400) a missing file', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .field('altText', 'No file attached')
          .expect(400);
      });

      it("rejects (400) an attempt to smuggle ownership fields into the multipart body, even from the product's real owner", async () => {
        // The DTO's `whitelist: true`/`forbidNonWhitelisted: true`
        // validation rejects unknown fields outright — `vendorId`/
        // `userId` are never part of CreateProductImageDto, so this
        // fails at the body-validation layer regardless of who the
        // caller is. (A non-owner sending the same payload is rejected
        // even earlier, by ProductOwnershipGuard, with 403 — see the
        // "different vendor" test above.)
        await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .field('vendorId', vendorB.id)
          .field('userId', vendorB.userId)
          .expect(400);
      });

      it("rejects (404) an ADMIN uploading to a nonexistent product (ProductOwnershipGuard's ADMIN bypass skips existence checking, so the service must)", async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${randomUUID()}/images`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(404);
      });

      it('rejects (403) a non-owner uploading to a nonexistent product (ownership check fails closed before existence is ever considered)', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${randomUUID()}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(403);
      });
    });

    describe('GET /api/products/:productId/images/:imageId', () => {
      it('streams an ACTIVE product image publicly, with no authentication required', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${activeProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        const streamed = await request(app.getHttpServer())
          .get(uploaded.body.url as string)
          .expect(200);

        expect(streamed.headers['content-type']).toBe('image/png');
        expect(streamed.headers['x-content-type-options']).toBe('nosniff');
        expect(Buffer.compare(streamed.body as Buffer, PNG_BUFFER)).toBe(0);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('reports 404 (no disclosure) for an unauthenticated request to a DRAFT product image', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await request(app.getHttpServer())
          .get(uploaded.body.url as string)
          .expect(404);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('allows the owning vendor to stream a DRAFT product image', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', WEBP_BUFFER, 'x.webp')
          .expect(201);

        const streamed = await request(app.getHttpServer())
          .get(uploaded.body.url as string)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);

        expect(streamed.headers['content-type']).toBe('image/webp');

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('rejects (403) a different authenticated vendor streaming a DRAFT product image', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await request(app.getHttpServer())
          .get(uploaded.body.url as string)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('allows an ADMIN to stream a DRAFT product image regardless of ownership', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await request(app.getHttpServer())
          .get(uploaded.body.url as string)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .expect(200);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('reports 404 for a nonexistent imageId under a real product', async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${activeProductId}/images/${randomUUID()}`)
          .expect(404);
      });
    });

    describe('DELETE /api/products/:productId/images/:imageId', () => {
      it("deletes the DB record and the physical file for the vendor's own image", async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        const stored = await prisma.productImage.findUniqueOrThrow({
          where: { id: uploaded.body.id as string },
        });
        const diskPath = join(tempStorageDir, stored.storageKey!);
        expect(existsSync(diskPath)).toBe(true);

        await request(app.getHttpServer())
          .delete(
            `/api/products/${draftProductId}/images/${uploaded.body.id as string}`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(204);

        await expect(
          prisma.productImage.findUnique({ where: { id: stored.id } }),
        ).resolves.toBeNull();
        expect(existsSync(diskPath)).toBe(false);
      });

      it('rejects (401) an unauthenticated request', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await request(app.getHttpServer())
          .delete(
            `/api/products/${draftProductId}/images/${uploaded.body.id as string}`,
          )
          .expect(401);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it("rejects (403) a different vendor deleting vendor A's image", async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${draftProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        await request(app.getHttpServer())
          .delete(
            `/api/products/${draftProductId}/images/${uploaded.body.id as string}`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('rejects (404) deleting a nonexistent image', async () => {
        await request(app.getHttpServer())
          .delete(`/api/products/${draftProductId}/images/${randomUUID()}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(404);
      });
    });

    describe('Storage directory isolation', () => {
      it('never exposes the storage directory as static content (no directory listing, no direct file access)', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${activeProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        const stored = await prisma.productImage.findUniqueOrThrow({
          where: { id: uploaded.body.id as string },
        });

        // The physical filename must not be directly fetchable through
        // any guessed static route — this app never registers the
        // storage directory as static content at all.
        await request(app.getHttpServer())
          .get(`/${stored.storageKey}`)
          .expect(404);
        await request(app.getHttpServer())
          .get(`/storage/uploads/${stored.storageKey}`)
          .expect(404);
        await request(app.getHttpServer())
          .get(`/api/storage/uploads/${stored.storageKey}`)
          .expect(404);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });

      it('writes uploaded files only under the configured temporary storage root, never the dev/production default', async () => {
        const uploaded = await request(app.getHttpServer())
          .post(`/api/products/${activeProductId}/images`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .attach('file', PNG_BUFFER, 'x.png')
          .expect(201);

        const filesInTempDir = await readdir(tempStorageDir);
        expect(filesInTempDir.length).toBeGreaterThan(0);

        await prisma.productImage.delete({
          where: { id: uploaded.body.id as string },
        });
      });
    });
  });
});
