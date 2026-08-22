import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
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

  // -----------------------------------------------------------------
  // ProductVariant + Inventory (Phase 21)
  // -----------------------------------------------------------------
  describe('ProductVariants + Inventory', () => {
    let categoryId: string;
    let vendorA: { id: string; userId: string; accessToken: string };
    let vendorB: { id: string; userId: string; accessToken: string };
    let productId: string;
    let adminUser: { accessToken: string };

    const createProductForVendor = async (vendor: {
      id: string;
      userId: string;
      accessToken: string;
    }) => {
      const response = await request(app.getHttpServer())
        .post('/api/products')
        .set('Authorization', `Bearer ${vendor.accessToken}`)
        .send({
          name: 'Variant Fixture Product',
          slug: uniqueSlug('variant-fixture-product'),
          categoryId,
        })
        .expect(201);
      return response.body.id as string;
    };

    beforeAll(async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });

      const category = await prisma.category.create({
        data: { name: 'Variant Test Category', slug: uniqueSlug('var-cat') },
      });
      categoryId = category.id;

      const vendorAUser = await registerAndLogin('VariantVendorA');
      const vendorARecord = await prisma.vendor.create({
        data: { userId: vendorAUser.id, businessName: 'Variant Vendor A' },
      });
      vendorA = {
        id: vendorARecord.id,
        userId: vendorAUser.id,
        accessToken: vendorAUser.accessToken,
      };

      const vendorBUser = await registerAndLogin('VariantVendorB');
      const vendorBRecord = await prisma.vendor.create({
        data: { userId: vendorBUser.id, businessName: 'Variant Vendor B' },
      });
      vendorB = {
        id: vendorBRecord.id,
        userId: vendorBUser.id,
        accessToken: vendorBUser.accessToken,
      };

      productId = await createProductForVendor(vendorA);

      const adminAccount = await registerAndLogin('VariantAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });
      adminUser = adminAccount;
    });

    afterAll(async () => {
      const variants = await prisma.productVariant.findMany({
        where: { product: { vendorId: { in: [vendorA.id, vendorB.id] } } },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      await prisma.inventoryTransaction.deleteMany({
        where: { inventory: { variantId: { in: variantIds } } },
      });
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

    describe('POST /api/products/:productId/variants', () => {
      it("creates a variant belonging to the authenticated vendor's own product, with its Inventory row defaulting onHand: 0", async () => {
        const response = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-create').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        expect(response.body.productId).toBe(productId);
        // Owner-management responses return the raw Prisma Decimal
        // serialization (no `.toFixed(2)` view mapper exists for this
        // endpoint class, exactly matching ProductsService.findById's
        // existing unmapped-passthrough convention) — compare numerically
        // rather than over-specifying exact string formatting.
        expect(Number(response.body.price)).toBe(2500);
        expect(response.body.currency).toBe('BDT');
        expect(response.body.status).toBe('ACTIVE');

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { variantId: response.body.id },
        });
        expect(inventory.onHand).toBe(0);
        expect(inventory.reserved).toBe(0);
      });

      it("makes a product's first variant its default, and does not make the second variant default", async () => {
        const freshProductId = await createProductForVendor(vendorA);

        const first = await request(app.getHttpServer())
          .post(`/api/products/${freshProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-first').toUpperCase(),
            price: '1000.00',
            currency: 'BDT',
          })
          .expect(201);
        expect(first.body.isDefault).toBe(true);

        const second = await request(app.getHttpServer())
          .post(`/api/products/${freshProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-second').toUpperCase(),
            price: '1200.00',
            currency: 'BDT',
          })
          .expect(201);
        expect(second.body.isDefault).toBe(false);
      });

      it('ignores a client-supplied isDefault — never client-settable', async () => {
        const freshProductId = await createProductForVendor(vendorA);

        await request(app.getHttpServer())
          .post(`/api/products/${freshProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-spoof-default').toUpperCase(),
            price: '1000.00',
            currency: 'BDT',
            isDefault: false,
          })
          .expect(400);
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .send({ sku: 'NO-AUTH-SKU', price: '2500.00', currency: 'BDT' })
          .expect(401);
      });

      it("rejects (403) another vendor creating a variant on a product they don't own", async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .send({
            sku: uniqueSlug('sku-cross-vendor').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(403);
      });

      it('a spoofed vendorId/userId in the body cannot bypass ownership', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .send({
            sku: uniqueSlug('sku-spoof-owner').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
            vendorId: vendorA.id,
            userId: vendorA.id,
          })
          .expect((res) => {
            if (![400, 403].includes(res.status)) {
              throw new Error(`Unexpected status ${res.status}`);
            }
          });
      });

      it('returns 403 for a nonexistent product (ProductOwnershipGuard fails closed before the service ever runs, same non-disclosure convention as every other ownership guard)', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${randomUUID()}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: 'NONEXISTENT-PRODUCT-SKU',
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(403);
      });

      it('rejects (400) an invalid price', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-bad-price').toUpperCase(),
            price: 'not-a-number',
            currency: 'BDT',
          })
          .expect(400);
      });

      it('rejects (400) an invalid currency', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-bad-currency').toUpperCase(),
            price: '2500.00',
            currency: 'bdt',
          })
          .expect(400);
      });

      it('rejects (409) a duplicate SKU (globally unique)', async () => {
        const sku = uniqueSlug('sku-duplicate').toUpperCase();

        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ sku, price: '2500.00', currency: 'BDT' })
          .expect(201);

        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ sku, price: '3000.00', currency: 'BDT' })
          .expect(409);
      });

      it("allows an ADMIN to create a variant on any vendor's product (documented bypass)", async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({
            sku: uniqueSlug('sku-admin-create').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);
      });

      it('returns 404 for a nonexistent product when accessed as ADMIN (guard bypasses existence check, service catches it)', async () => {
        await request(app.getHttpServer())
          .post(`/api/products/${randomUUID()}/variants`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({
            sku: uniqueSlug('sku-admin-404').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(404);
      });
    });

    describe('GET /api/products/:productId/variants', () => {
      it("lists the authenticated vendor's own variants for the product", async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });

      it("rejects (403) another vendor listing variants they don't own", async () => {
        await request(app.getHttpServer())
          .get(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });
    });

    describe('GET /api/products/:productId/variants/:variantId', () => {
      it('rejects (403) another vendor fetching a variant they do not own', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-detail-cross').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(`/api/products/${productId}/variants/${created.body.id}`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);

        const serialized = JSON.stringify(response.body).toLowerCase();
        expect(serialized).not.toMatch(/prisma|postgres|sql/);
      });

      it('returns 404 for a variant belonging to a different product (even one the caller owns)', async () => {
        const otherProductId = await createProductForVendor(vendorA);
        const variantOfOtherProduct = await request(app.getHttpServer())
          .post(`/api/products/${otherProductId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-other-product').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .get(
            `/api/products/${productId}/variants/${variantOfOtherProduct.body.id}`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(404);
      });
    });

    describe('PATCH /api/products/:productId/variants/:variantId', () => {
      it('allows the owner to update status and price', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-update').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .patch(`/api/products/${productId}/variants/${created.body.id}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'INACTIVE', price: '2999.00' })
          .expect(200);

        expect(response.body.status).toBe('INACTIVE');
        expect(Number(response.body.price)).toBe(2999);
      });

      it('ignores a client-supplied isDefault on update — never client-settable', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-update-default').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .patch(`/api/products/${productId}/variants/${created.body.id}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ isDefault: true })
          .expect(400);
      });

      it("rejects (403) another vendor updating a variant they don't own", async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-update-cross').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .patch(`/api/products/${productId}/variants/${created.body.id}`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .send({ price: '1.00' })
          .expect(403);
      });
    });

    describe('GET /api/products/:productId/variants/:variantId/inventory', () => {
      it('returns the inventory with a computed available field', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-inventory-view').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(
            `/api/products/${productId}/variants/${created.body.id}/inventory`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);

        expect(response.body.onHand).toBe(0);
        expect(response.body.reserved).toBe(0);
        expect(response.body.available).toBe(0);
      });

      it("rejects (403) another vendor viewing inventory they don't own", async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-inventory-cross').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .get(
            `/api/products/${productId}/variants/${created.body.id}/inventory`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });
    });

    describe('POST .../inventory/restock', () => {
      it('increments onHand and records a RESTOCK InventoryTransaction', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-restock').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ quantity: 50, note: 'Initial stock' })
          .expect(201);

        expect(response.body.onHand).toBe(50);

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { variantId: created.body.id },
        });
        const transactions = await prisma.inventoryTransaction.findMany({
          where: { inventoryId: inventory.id },
        });
        expect(transactions).toHaveLength(1);
        expect(transactions[0].type).toBe('RESTOCK');
        expect(transactions[0].quantity).toBe(50);
        expect(transactions[0].createdBy).toBe(vendorA.userId);
      });

      it("rejects (403) another vendor restocking inventory they don't own", async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-restock-cross').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .send({ quantity: 10 })
          .expect(403);
      });

      it('rejects (400) a non-positive quantity', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-restock-invalid').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ quantity: 0 })
          .expect(400);
      });
    });

    describe('POST .../inventory/adjust', () => {
      it('applies a negative adjustment and records an ADJUSTMENT InventoryTransaction', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ quantity: 10 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ delta: -3, note: 'Damaged units removed' })
          .expect(201);

        expect(response.body.onHand).toBe(7);

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { variantId: created.body.id },
        });
        const adjustmentTx = await prisma.inventoryTransaction.findFirst({
          where: { inventoryId: inventory.id, type: 'ADJUSTMENT' },
        });
        expect(adjustmentTx?.quantity).toBe(-3);
      });

      it('rejects (400) a delta of 0', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust-zero').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ delta: 0 })
          .expect(400);
      });

      it('rejects (409) an adjustment that would make onHand negative', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust-negative').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ delta: -1 })
          .expect(409);

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { variantId: created.body.id },
        });
        expect(inventory.onHand).toBe(0);
        const transactions = await prisma.inventoryTransaction.findMany({
          where: { inventoryId: inventory.id },
        });
        expect(transactions).toHaveLength(0);
      });

      it('rejects (409) an adjustment that would drop onHand below reserved stock', async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust-reserved').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ quantity: 10 })
          .expect(201);

        // Simulate reserved stock the way Checkout would (no application
        // endpoint sets `reserved` directly; this models the documented
        // "reserved constrains reductions" scenario at the data layer,
        // the same technique already used elsewhere in this test suite
        // for simulating post-add-to-cart state changes).
        const inventoryId = (
          await prisma.inventory.findUniqueOrThrow({
            where: { variantId: created.body.id },
          })
        ).id;
        await prisma.inventory.update({
          where: { id: inventoryId },
          data: { reserved: 8 },
        });

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ delta: -5 })
          .expect(409);

        const inventory = await prisma.inventory.findUniqueOrThrow({
          where: { id: inventoryId },
        });
        expect(inventory.onHand).toBe(10);
      });

      it("rejects (403) another vendor adjusting inventory they don't own", async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust-cross').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .send({ delta: 5 })
          .expect(403);
      });

      it("allows an ADMIN to adjust any vendor's inventory (documented bypass)", async () => {
        const created = await request(app.getHttpServer())
          .post(`/api/products/${productId}/variants`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            sku: uniqueSlug('sku-adjust-admin').toUpperCase(),
            price: '2500.00',
            currency: 'BDT',
          })
          .expect(201);
        await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
          )
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ quantity: 10 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(
            `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
          )
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ delta: -2 })
          .expect(201);

        expect(response.body.onHand).toBe(8);
      });

      describe('Concurrency', () => {
        it('lets exactly one of two concurrent negative adjustments that would together violate onHand >= 0 succeed', async () => {
          const created = await request(app.getHttpServer())
            .post(`/api/products/${productId}/variants`)
            .set('Authorization', `Bearer ${vendorA.accessToken}`)
            .send({
              sku: uniqueSlug('sku-adjust-race').toUpperCase(),
              price: '2500.00',
              currency: 'BDT',
            })
            .expect(201);

          await request(app.getHttpServer())
            .post(
              `/api/products/${productId}/variants/${created.body.id}/inventory/restock`,
            )
            .set('Authorization', `Bearer ${vendorA.accessToken}`)
            .send({ quantity: 10 })
            .expect(201);

          // Each adjustment alone (-6) is valid against onHand=10, but
          // both together (-12) would make onHand negative — exactly the
          // race the atomic conditional UPDATE must prevent.
          const [responseA, responseB] = await Promise.all([
            request(app.getHttpServer())
              .post(
                `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
              )
              .set('Authorization', `Bearer ${vendorA.accessToken}`)
              .send({ delta: -6 }),
            request(app.getHttpServer())
              .post(
                `/api/products/${productId}/variants/${created.body.id}/inventory/adjust`,
              )
              .set('Authorization', `Bearer ${vendorA.accessToken}`)
              .send({ delta: -6 }),
          ]);

          const statuses = [responseA.status, responseB.status].sort(
            (a, b) => a - b,
          );
          expect(statuses).toEqual([201, 409]);

          const inventory = await prisma.inventory.findUniqueOrThrow({
            where: { variantId: created.body.id },
          });
          expect(inventory.onHand).toBe(4);
        });
      });
    });

    describe('Public API integration (unchanged)', () => {
      it('does not include variant/inventory data in the existing public product-by-slug response', async () => {
        const product = await prisma.product.findUniqueOrThrow({
          where: { id: productId },
        });
        await prisma.product.update({
          where: { id: productId },
          data: { status: 'ACTIVE' },
        });

        const response = await request(app.getHttpServer())
          .get(`/api/products/slug/${product.slug}`)
          .expect(200);

        expect(response.body).not.toHaveProperty('variants');
        expect(response.body).not.toHaveProperty('vendorId');

        await prisma.product.update({
          where: { id: productId },
          data: { status: product.status },
        });
      });

      it('does not include variant/inventory data in the existing public product list response', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/products')
          .expect(200);

        if (response.body.data.length > 0) {
          expect(response.body.data[0]).not.toHaveProperty('variants');
        }
      });
    });
  });
});
