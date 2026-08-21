import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 11 — Category management (ADMIN-only mutation, public retrieval)
 * + Product creation/retrieval/update (vendor-owned, ownership-enforced
 * via ProductOwnershipGuard).
 */
describe('Catalog API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `catalog-e2e-${randomUUID()}@example.com`;
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);

    app.setGlobalPrefix('api');
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
  });

  // -----------------------------------------------------------------
  // Category
  // -----------------------------------------------------------------
  describe('Categories', () => {
    let adminUser: { accessToken: string };
    let nonAdminUser: { accessToken: string };
    let rootCategoryId: string;
    let rootCategorySlug: string;

    beforeAll(async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });

      const adminAccount = await registerAndLogin('CatalogAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });
      adminUser = adminAccount;

      nonAdminUser = await registerAndLogin('CatalogNonAdmin');

      rootCategorySlug = uniqueSlug('electronics');
      const root = await prisma.category.create({
        data: { name: 'Electronics', slug: rootCategorySlug },
      });
      rootCategoryId = root.id;
    });

    afterAll(async () => {
      await prisma.category.deleteMany({ where: { id: rootCategoryId } });
    });

    describe('GET /api/categories', () => {
      it('lists categories with no authentication required', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/categories')
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(
          response.body.some((c: { id: string }) => c.id === rootCategoryId),
        ).toBe(true);
      });
    });

    describe('GET /api/categories/:categoryId', () => {
      it('returns a category by id, no authentication required', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/categories/${rootCategoryId}`)
          .expect(200);

        expect(response.body.slug).toBe(rootCategorySlug);
      });

      it('returns 404 for a nonexistent category', async () => {
        await request(app.getHttpServer())
          .get(`/api/categories/${randomUUID()}`)
          .expect(404);
      });
    });

    describe('POST /api/categories', () => {
      it('creates a root category (ADMIN)', async () => {
        const slug = uniqueSlug('books');
        const response = await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ name: 'Books', slug })
          .expect(201);

        expect(response.body.slug).toBe(slug);
        expect(response.body.parentId).toBeNull();
        expect(response.body.status).toBe('ACTIVE');

        await prisma.category.delete({ where: { id: response.body.id } });
      });

      it('creates a child category referencing an existing parent', async () => {
        const slug = uniqueSlug('mobile');
        const response = await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ name: 'Mobile', slug, parentId: rootCategoryId })
          .expect(201);

        expect(response.body.parentId).toBe(rootCategoryId);

        await prisma.category.delete({ where: { id: response.body.id } });
      });

      it('rejects (400) a parentId that does not reference an existing category', async () => {
        await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({
            name: 'Orphan',
            slug: uniqueSlug('orphan'),
            parentId: randomUUID(),
          })
          .expect(400);
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .post('/api/categories')
          .send({ name: 'No Auth', slug: uniqueSlug('no-auth') })
          .expect(401);
      });

      it('rejects (403) a non-ADMIN authenticated user', async () => {
        await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${nonAdminUser.accessToken}`)
          .send({ name: 'Forbidden', slug: uniqueSlug('forbidden') })
          .expect(403);
      });

      it('rejects (400) an invalid payload', async () => {
        await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ name: '' })
          .expect(400);
      });

      it('rejects (409) a duplicate slug', async () => {
        await request(app.getHttpServer())
          .post('/api/categories')
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ name: 'Duplicate', slug: rootCategorySlug })
          .expect(409);
      });
    });

    describe('PATCH /api/categories/:categoryId', () => {
      it('updates a category (ADMIN)', async () => {
        const created = await prisma.category.create({
          data: { name: 'Temp', slug: uniqueSlug('temp') },
        });

        const response = await request(app.getHttpServer())
          .patch(`/api/categories/${created.id}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ description: 'Updated description', status: 'INACTIVE' })
          .expect(200);

        expect(response.body.description).toBe('Updated description');
        expect(response.body.status).toBe('INACTIVE');

        await prisma.category.delete({ where: { id: created.id } });
      });

      it('rejects (400) a reparenting that would create a cycle', async () => {
        const parent = await prisma.category.create({
          data: { name: 'Parent', slug: uniqueSlug('parent') },
        });
        const child = await prisma.category.create({
          data: {
            name: 'Child',
            slug: uniqueSlug('child'),
            parentId: parent.id,
          },
        });

        // Attempt to make the parent a child of its own child.
        await request(app.getHttpServer())
          .patch(`/api/categories/${parent.id}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ parentId: child.id })
          .expect(400);

        await prisma.category.delete({ where: { id: child.id } });
        await prisma.category.delete({ where: { id: parent.id } });
      });

      it('rejects (403) a non-ADMIN authenticated user', async () => {
        await request(app.getHttpServer())
          .patch(`/api/categories/${rootCategoryId}`)
          .set('Authorization', `Bearer ${nonAdminUser.accessToken}`)
          .send({ description: 'Hijacked' })
          .expect(403);
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .patch(`/api/categories/${rootCategoryId}`)
          .send({ description: 'No Auth' })
          .expect(401);
      });

      it('rejects (404) updating a nonexistent category', async () => {
        await request(app.getHttpServer())
          .patch(`/api/categories/${randomUUID()}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ description: 'Nope' })
          .expect(404);
      });
    });
  });

  // -----------------------------------------------------------------
  // Product
  // -----------------------------------------------------------------
  describe('Products', () => {
    let vendorA: { id: string; email: string; accessToken: string };
    let vendorB: { id: string; email: string; accessToken: string };
    let vendorAVendorId: string;
    let vendorBVendorId: string;
    let productAId: string;
    let productBId: string;
    let productASlug: string;
    let categoryId: string;
    let nonVendorUser: { accessToken: string };
    let adminUser: { accessToken: string };

    beforeAll(async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });

      const category = await prisma.category.create({
        data: { name: 'Catalog Test Category', slug: uniqueSlug('cat-test') },
      });
      categoryId = category.id;

      vendorA = await registerAndLogin('ProductVendorA');
      const vendorARecord = await prisma.vendor.create({
        data: { userId: vendorA.id, businessName: 'Product Vendor A' },
      });
      vendorAVendorId = vendorARecord.id;
      productASlug = uniqueSlug('product-a');
      const productA = await prisma.product.create({
        data: {
          vendorId: vendorAVendorId,
          categoryId,
          name: 'Product A',
          slug: productASlug,
          status: 'ACTIVE',
        },
      });
      productAId = productA.id;

      vendorB = await registerAndLogin('ProductVendorB');
      const vendorBRecord = await prisma.vendor.create({
        data: { userId: vendorB.id, businessName: 'Product Vendor B' },
      });
      vendorBVendorId = vendorBRecord.id;
      const productB = await prisma.product.create({
        data: {
          vendorId: vendorBVendorId,
          categoryId,
          name: 'Product B',
          slug: uniqueSlug('product-b'),
        },
      });
      productBId = productB.id;

      nonVendorUser = await registerAndLogin('ProductNoVendorProfile');

      const adminAccount = await registerAndLogin('ProductAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });
      adminUser = adminAccount;
    });

    afterAll(async () => {
      await prisma.product.deleteMany({
        where: { id: { in: [productAId, productBId] } },
      });
      await prisma.vendor.deleteMany({
        where: { id: { in: [vendorAVendorId, vendorBVendorId] } },
      });
      await prisma.category.deleteMany({ where: { id: categoryId } });
    });

    describe('POST /api/products', () => {
      it("creates a product belonging to the authenticated vendor's own profile", async () => {
        const vendorUser = await registerAndLogin('FreshProductVendor');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Fresh Business' },
        });

        const response = await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${vendorUser.accessToken}`)
          .send({
            name: 'Fresh Product',
            slug: uniqueSlug('fresh-product'),
            categoryId,
          })
          .expect(201);

        expect(response.body.vendorId).toBe(vendorRecord.id);
        expect(response.body.status).toBe('DRAFT');
        expect(response.body.productType).toBe('SIMPLE');

        await prisma.product.delete({ where: { id: response.body.id } });
        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });

      it('ignores a client-supplied vendorId in the body — unknown properties rejected by the global whitelist', async () => {
        const vendorUser = await registerAndLogin('SpoofProductOwnerOnCreate');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Spoof Business' },
        });

        await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${vendorUser.accessToken}`)
          .send({
            name: 'Spoofed Product',
            slug: uniqueSlug('spoofed-product'),
            categoryId,
            vendorId: vendorAVendorId,
          })
          .expect(400);

        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .post('/api/products')
          .send({ name: 'No Auth', slug: uniqueSlug('no-auth'), categoryId })
          .expect(401);
      });

      it('rejects (400) an invalid payload', async () => {
        await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: '' })
          .expect(400);
      });

      it('rejects (403) a caller with no vendor profile', async () => {
        await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${nonVendorUser.accessToken}`)
          .send({
            name: 'No Vendor Product',
            slug: uniqueSlug('no-vendor'),
            categoryId,
          })
          .expect(403);
      });

      it('rejects (400) a categoryId that does not reference an existing category', async () => {
        await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            name: 'Bad Category Product',
            slug: uniqueSlug('bad-category'),
            categoryId: randomUUID(),
          })
          .expect(400);
      });

      it('rejects (409) a duplicate slug', async () => {
        await request(app.getHttpServer())
          .post('/api/products')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Duplicate Slug', slug: productASlug, categoryId })
          .expect(409);
      });
    });

    describe('GET /api/products/slug/:slug (public)', () => {
      it('returns storefront-safe fields for an ACTIVE product with no authentication', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/products/slug/${productASlug}`)
          .expect(200);

        expect(response.body.slug).toBe(productASlug);
        expect(response.body.name).toBe('Product A');
        expect(response.body).not.toHaveProperty('vendorId');
        expect(response.body).not.toHaveProperty('createdAt');
      });

      it('returns 404 for a nonexistent slug', async () => {
        await request(app.getHttpServer())
          .get(`/api/products/slug/${uniqueSlug('nonexistent')}`)
          .expect(404);
      });

      it('returns 404 for a DRAFT product (not published, not disclosed to the public)', async () => {
        // productB was created without an explicit status, defaulting DRAFT.
        await request(app.getHttpServer())
          .get(
            `/api/products/slug/${(await prisma.product.findUniqueOrThrow({ where: { id: productBId } })).slug}`,
          )
          .expect(404);
      });
    });

    describe('GET /api/products (public list, Phase 20)', () => {
      it('lists ACTIVE products with no authentication required, in the documented pagination envelope', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/products')
          .expect(200);

        expect(response.body).toHaveProperty('data');
        expect(response.body).toHaveProperty('meta');
        expect(response.body.meta).toEqual(
          expect.objectContaining({ page: 1, limit: 20 }),
        );
        expect(Array.isArray(response.body.data)).toBe(true);

        const found = response.body.data.find(
          (p: { id: string }) => p.id === productAId,
        );
        expect(found).toBeDefined();
        expect(found).not.toHaveProperty('vendorId');
        expect(found).not.toHaveProperty('createdAt');
        expect(found).not.toHaveProperty('deletedAt');
      });

      it('excludes DRAFT products from the public list', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/products')
          .expect(200);

        expect(
          response.body.data.some((p: { id: string }) => p.id === productBId),
        ).toBe(false);
      });

      it('excludes soft-deleted products from the public list', async () => {
        const softDeleted = await prisma.product.create({
          data: {
            vendorId: vendorAVendorId,
            categoryId,
            name: 'Soft Deleted Product',
            slug: uniqueSlug('soft-deleted-product'),
            status: 'ACTIVE',
            deletedAt: new Date(),
          },
        });

        const response = await request(app.getHttpServer())
          .get('/api/products')
          .expect(200);

        expect(
          response.body.data.some(
            (p: { id: string }) => p.id === softDeleted.id,
          ),
        ).toBe(false);

        await prisma.product.delete({ where: { id: softDeleted.id } });
      });

      it('respects page/limit query parameters', async () => {
        const category = await prisma.category.create({
          data: { name: 'Pagination Category', slug: uniqueSlug('pag-cat') },
        });
        const vendorUser = await registerAndLogin('PaginationVendor');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Pagination Vendor' },
        });
        const products = await Promise.all(
          Array.from({ length: 3 }).map((_, i) =>
            prisma.product.create({
              data: {
                vendorId: vendorRecord.id,
                categoryId: category.id,
                name: `Pagination Product ${i}`,
                slug: uniqueSlug(`pagination-product-${i}`),
                status: 'ACTIVE',
              },
            }),
          ),
        );

        const firstPage = await request(app.getHttpServer())
          .get('/api/products')
          .query({ page: 1, limit: 1 })
          .expect(200);
        expect(firstPage.body.data).toHaveLength(1);
        expect(firstPage.body.meta.limit).toBe(1);
        expect(firstPage.body.meta.total).toBeGreaterThanOrEqual(4); // productA + 3 fixtures

        await prisma.product.deleteMany({
          where: { id: { in: products.map((p) => p.id) } },
        });
        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
        await prisma.category.delete({ where: { id: category.id } });
      });

      it('rejects (400) an invalid page query parameter', async () => {
        await request(app.getHttpServer())
          .get('/api/products')
          .query({ page: 0 })
          .expect(400);
      });

      it('rejects (400) a limit exceeding the documented maximum', async () => {
        await request(app.getHttpServer())
          .get('/api/products')
          .query({ limit: 1000 })
          .expect(400);
      });

      it('rejects (400) a non-numeric page/limit value', async () => {
        await request(app.getHttpServer())
          .get('/api/products')
          .query({ page: 'not-a-number' })
          .expect(400);
      });
    });

    describe('GET /api/products/:productId (authenticated management access)', () => {
      it('allows the authenticated owner to fetch their own product', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);

        expect(response.body.id).toBe(productAId);
      });

      it("forbids (403) vendor A from fetching vendor B's product, and vice versa", async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${productBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(403);

        await request(app.getHttpServer())
          .get(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });

      it('forbids (403) a user with no vendor profile at all', async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${nonVendorUser.accessToken}`)
          .expect(403);
      });

      it('a spoofed vendorId/userId query parameter cannot bypass ownership', async () => {
        await request(app.getHttpServer())
          .get(
            `/api/products/${productAId}?vendorId=${vendorAVendorId}&userId=${vendorA.id}`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });

      it("allows an ADMIN to fetch any vendor's product (documented bypass)", async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .expect(200);
      });

      it('rejects an unauthenticated request with 401 (not 403)', async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${productAId}`)
          .expect(401);
      });

      it('a 403 ownership failure never exposes internal database details', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/products/${productBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(403);

        const serialized = JSON.stringify(response.body).toLowerCase();
        expect(serialized).not.toContain(vendorAVendorId.toLowerCase());
        expect(serialized).not.toContain(vendorBVendorId.toLowerCase());
        expect(serialized).not.toContain(productBId.toLowerCase());
        expect(serialized).not.toMatch(/prisma|postgres|sql/);
      });
    });

    describe('PATCH /api/products/:productId', () => {
      it('allows the owning vendor to update their own product', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ description: 'Updated description' })
          .expect(200);

        expect(response.body.description).toBe('Updated description');
      });

      it('allows the owning vendor to move the product through documented status values', async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'INACTIVE' })
          .expect(200);

        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'ACTIVE' })
          .expect(200);
      });

      it("Vendor A cannot update Vendor B's product", async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Hijacked Name' })
          .expect(403);
      });

      it('a spoofed vendorId in the body cannot be used to update a product the caller does not own', async () => {
        // ProductOwnershipGuard runs before body validation, so the
        // non-owner is rejected with 403 before the (also-invalid,
        // unknown-property) body is even considered.
        await request(app.getHttpServer())
          .patch(`/api/products/${productBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Hijacked Name', vendorId: vendorAVendorId })
          .expect(403);
      });

      it('rejects (400) a body attempting to set ownership/identity fields on a product the caller does own', async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Still Product A', vendorId: vendorBVendorId })
          .expect(400);
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .send({ name: 'No Auth Update' })
          .expect(401);
      });

      it('rejects (400) an invalid payload', async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ slug: 'Not A Valid Slug!' })
          .expect(400);
      });

      it('rejects (400) a categoryId that does not reference an existing category', async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ categoryId: randomUUID() })
          .expect(400);
      });

      it('rejects (409) updating to a slug already used by another product', async () => {
        const productBSlug = (
          await prisma.product.findUniqueOrThrow({ where: { id: productBId } })
        ).slug;

        await request(app.getHttpServer())
          .patch(`/api/products/${productAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ slug: productBSlug })
          .expect(409);
      });

      it("allows an ADMIN to update any vendor's product (documented bypass)", async () => {
        await request(app.getHttpServer())
          .patch(`/api/products/${productBId}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ description: 'Admin-updated description' })
          .expect(200);
      });
    });
  });
});
