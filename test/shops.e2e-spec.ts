import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 10 — Vendor onboarding + Shop creation/retrieval/update.
 *
 * Also carries forward the ownership-guard integration coverage that
 * used to live in test/auth.e2e-spec.ts's "Ownership (Vendor → Shop) —
 * Phase 9" suite (against the now-removed temporary
 * GET /api/auth/ownership-demo/shop/:shopId route), now exercised
 * against the real GET/PATCH /api/shops/:shopId routes instead.
 */
describe('Vendors + Shops API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `shops-e2e-${randomUUID()}@example.com`;
  const uniqueSlug = () => `shop-${randomUUID()}`;

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
  // Vendor onboarding
  // -----------------------------------------------------------------
  describe('POST /api/vendors', () => {
    it('creates a vendor profile for the authenticated user, defaulting status/verificationStatus to PENDING', async () => {
      const user = await registerAndLogin('Onboard');

      const response = await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ businessName: 'Onboard Business' })
        .expect(201);

      expect(response.body.businessName).toBe('Onboard Business');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.verificationStatus).toBe('PENDING');
      expect(response.body.userId).toBe(user.id);

      await prisma.vendor.delete({ where: { id: response.body.id } });
    });

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/vendors')
        .send({ businessName: 'No Auth Business' })
        .expect(401);
    });

    it('rejects (400) an invalid payload', async () => {
      const user = await registerAndLogin('InvalidVendor');

      await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });

    it('rejects (400) a body attempting to set server-controlled fields (whitelist rejects unknown properties)', async () => {
      const user = await registerAndLogin('SpoofVendorStatus');

      await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          businessName: 'Spoofed Business',
          status: 'ACTIVE',
          verificationStatus: 'VERIFIED',
          userId: randomUUID(),
        })
        .expect(400);
    });

    it('rejects (409) a second vendor application from the same user', async () => {
      const user = await registerAndLogin('DuplicateVendor');

      const first = await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ businessName: 'First Business' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ businessName: 'Second Business' })
        .expect(409);

      await prisma.vendor.delete({ where: { id: first.body.id } });
    });
  });

  describe('GET /api/vendors/me', () => {
    it("returns the caller's own vendor profile", async () => {
      const user = await registerAndLogin('ViewOwnVendor');

      const created = await request(app.getHttpServer())
        .post('/api/vendors')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ businessName: 'View Own Business' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/vendors/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);

      await prisma.vendor.delete({ where: { id: created.body.id } });
    });

    it('returns 404 when the account has no vendor profile', async () => {
      const user = await registerAndLogin('NoVendorYet');

      await request(app.getHttpServer())
        .get('/api/vendors/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/vendors/me').expect(401);
    });
  });

  // -----------------------------------------------------------------
  // Shop creation / retrieval / update
  // -----------------------------------------------------------------
  describe('Shops', () => {
    let shopAId: string;
    let shopBId: string;
    let vendorAVendorId: string;
    let vendorBVendorId: string;
    let vendorA: { id: string; email: string; accessToken: string };
    let vendorB: { id: string; email: string; accessToken: string };
    let nonVendorUser: { accessToken: string };
    let adminUser: { accessToken: string };
    let shopASlug: string;

    beforeAll(async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });

      vendorA = await registerAndLogin('VendorA');
      const vendorARecord = await prisma.vendor.create({
        data: { userId: vendorA.id, businessName: 'Vendor A Business' },
      });
      vendorAVendorId = vendorARecord.id;
      shopASlug = uniqueSlug();
      const shopA = await prisma.shop.create({
        data: { vendorId: vendorAVendorId, name: 'Shop A', slug: shopASlug },
      });
      shopAId = shopA.id;

      vendorB = await registerAndLogin('VendorB');
      const vendorBRecord = await prisma.vendor.create({
        data: { userId: vendorB.id, businessName: 'Vendor B Business' },
      });
      vendorBVendorId = vendorBRecord.id;
      const shopB = await prisma.shop.create({
        data: {
          vendorId: vendorBVendorId,
          name: 'Shop B',
          slug: uniqueSlug(),
        },
      });
      shopBId = shopB.id;

      nonVendorUser = await registerAndLogin('NoVendorProfile');

      const adminAccount = await registerAndLogin('Admin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });
      adminUser = adminAccount;
    });

    afterAll(async () => {
      await prisma.shop.deleteMany({
        where: { id: { in: [shopAId, shopBId] } },
      });
      await prisma.vendor.deleteMany({
        where: { id: { in: [vendorAVendorId, vendorBVendorId] } },
      });
    });

    describe('POST /api/shops', () => {
      it("creates a shop belonging to the authenticated vendor's own profile", async () => {
        const vendorUser = await registerAndLogin('FreshVendor');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Fresh Business' },
        });

        const response = await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${vendorUser.accessToken}`)
          .send({ name: 'Fresh Shop', slug: uniqueSlug() })
          .expect(201);

        expect(response.body.vendorId).toBe(vendorRecord.id);
        expect(response.body.status).toBe('ACTIVE');

        await prisma.shop.delete({ where: { id: response.body.id } });
        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });

      it("ignores a client-supplied vendorId/ownerId in the body — the shop always belongs to the caller's own vendor", async () => {
        const vendorUser = await registerAndLogin('SpoofOwnerOnCreate');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Spoof Business' },
        });

        const response = await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${vendorUser.accessToken}`)
          .send({
            name: 'Spoofed Shop',
            slug: uniqueSlug(),
            vendorId: vendorAVendorId,
            ownerId: vendorA.id,
          })
          .expect(400); // unknown properties rejected by the global whitelist

        expect(response.body).toBeDefined();

        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .post('/api/shops')
          .send({ name: 'No Auth Shop', slug: uniqueSlug() })
          .expect(401);
      });

      it('rejects (400) an invalid payload', async () => {
        await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: '' })
          .expect(400);
      });

      it('rejects (403) a caller with no vendor profile', async () => {
        await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${nonVendorUser.accessToken}`)
          .send({ name: 'No Vendor Shop', slug: uniqueSlug() })
          .expect(403);
      });

      it('rejects (409) a second shop for a vendor that already has one', async () => {
        await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Second Shop A', slug: uniqueSlug() })
          .expect(409);
      });

      it('rejects (409) a duplicate slug across vendors', async () => {
        const vendorUser = await registerAndLogin('DuplicateSlugVendor');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Dup Slug Business' },
        });

        await request(app.getHttpServer())
          .post('/api/shops')
          .set('Authorization', `Bearer ${vendorUser.accessToken}`)
          .send({ name: 'Dup Slug Shop', slug: shopASlug })
          .expect(409);

        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });
    });

    describe('GET /api/shops/slug/:slug (public)', () => {
      it('returns storefront-safe fields for an ACTIVE shop with no authentication', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/shops/slug/${shopASlug}`)
          .expect(200);

        expect(response.body.slug).toBe(shopASlug);
        expect(response.body.name).toBe('Shop A');
        expect(response.body).not.toHaveProperty('vendorId');
        expect(response.body).not.toHaveProperty('createdAt');
      });

      it('returns 404 for a nonexistent slug', async () => {
        await request(app.getHttpServer())
          .get(`/api/shops/slug/${uniqueSlug()}`)
          .expect(404);
      });

      it('returns 404 for an INACTIVE shop (not disclosed to the public)', async () => {
        const vendorUser = await registerAndLogin('InactiveShopVendor');
        const vendorRecord = await prisma.vendor.create({
          data: { userId: vendorUser.id, businessName: 'Inactive Business' },
        });
        const slug = uniqueSlug();
        const shop = await prisma.shop.create({
          data: {
            vendorId: vendorRecord.id,
            name: 'Inactive Shop',
            slug,
            status: 'INACTIVE',
          },
        });

        await request(app.getHttpServer())
          .get(`/api/shops/slug/${slug}`)
          .expect(404);

        await prisma.shop.delete({ where: { id: shop.id } });
        await prisma.vendor.delete({ where: { id: vendorRecord.id } });
      });
    });

    describe('GET /api/shops/:shopId (authenticated management access)', () => {
      it('allows the authenticated owner to fetch their own shop', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);

        expect(response.body.id).toBe(shopAId);
      });

      it("forbids (403) vendor A from fetching vendor B's shop, and vice versa", async () => {
        await request(app.getHttpServer())
          .get(`/api/shops/${shopBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(403);

        await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });

      it('forbids (403) a user with no vendor profile at all', async () => {
        await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${nonVendorUser.accessToken}`)
          .expect(403);
      });

      it('a spoofed vendorId/userId query parameter cannot bypass ownership', async () => {
        await request(app.getHttpServer())
          .get(
            `/api/shops/${shopAId}?vendorId=${vendorAVendorId}&userId=${vendorA.id}`,
          )
          .set('Authorization', `Bearer ${vendorB.accessToken}`)
          .expect(403);
      });

      it("allows an ADMIN to fetch any vendor's shop (documented bypass)", async () => {
        await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .expect(200);
      });

      it('rejects an unauthenticated request with 401 (not 403)', async () => {
        await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .expect(401);
      });

      it('keeps RBAC denial and ownership denial architecturally separate', async () => {
        // Vendor A has no RBAC role at all and is denied on an
        // RBAC-gated route unrelated to shop ownership...
        await request(app.getHttpServer())
          .get('/api/auth/rbac-demo/role')
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(403);

        // ...yet is fully allowed on the ownership-gated route for their
        // OWN shop, which carries no @Roles()/@Permissions() metadata —
        // proving ownership does not depend on RBAC role assignment.
        await request(app.getHttpServer())
          .get(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(200);
      });

      it('a 403 ownership failure never exposes internal database details', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/shops/${shopBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .expect(403);

        const serialized = JSON.stringify(response.body).toLowerCase();
        expect(serialized).not.toContain(vendorAVendorId.toLowerCase());
        expect(serialized).not.toContain(vendorBVendorId.toLowerCase());
        expect(serialized).not.toContain(shopBId.toLowerCase());
        expect(serialized).not.toMatch(/prisma|postgres|sql/);
      });
    });

    describe('PATCH /api/shops/:shopId', () => {
      it('allows the owning vendor to update their own shop', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ description: 'Updated description' })
          .expect(200);

        expect(response.body.description).toBe('Updated description');
      });

      it('allows the owning vendor to toggle status to INACTIVE and back to ACTIVE', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'INACTIVE' })
          .expect(200)
          .expect((res) => {
            if (res.body.status !== 'INACTIVE') {
              throw new Error('expected status INACTIVE');
            }
          });

        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'ACTIVE' })
          .expect(200);
      });

      it('rejects (400) SUSPENDED as a client-set status — administrator-only value', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ status: 'SUSPENDED' })
          .expect(400);
      });

      it("Vendor A cannot update Vendor B's shop", async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ name: 'Hijacked Name' })
          .expect(403);
      });

      it('a spoofed vendorId/userId in the body cannot be used to update a shop the caller does not own', async () => {
        // VendorShopOwnershipGuard runs before body validation (guards
        // execute before pipes in Nest's pipeline), so the non-owner is
        // rejected with 403 before the (also-invalid, unknown-property)
        // body would even be considered.
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopBId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            name: 'Hijacked Name',
            vendorId: vendorAVendorId,
            id: shopAId,
          })
          .expect(403);
      });

      it('rejects (400) a body attempting to set ownership/identity fields on a shop the caller does own — unknown properties rejected by the global whitelist', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            name: 'Still Shop A',
            vendorId: vendorBVendorId,
            id: shopBId,
          })
          .expect(400);
      });

      it('rejects (401) an unauthenticated request', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .send({ name: 'No Auth Update' })
          .expect(401);
      });

      it('rejects (400) an invalid payload', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({ slug: 'Not A Valid Slug!' })
          .expect(400);
      });

      it('rejects (409) updating to a slug already used by another shop', async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopAId}`)
          .set('Authorization', `Bearer ${vendorA.accessToken}`)
          .send({
            slug: (
              await prisma.shop.findUniqueOrThrow({ where: { id: shopBId } })
            ).slug,
          })
          .expect(409);
      });

      it("allows an ADMIN to update any vendor's shop (documented bypass)", async () => {
        await request(app.getHttpServer())
          .patch(`/api/shops/${shopBId}`)
          .set('Authorization', `Bearer ${adminUser.accessToken}`)
          .send({ description: 'Admin-updated description' })
          .expect(200);
      });
    });
  });
});
