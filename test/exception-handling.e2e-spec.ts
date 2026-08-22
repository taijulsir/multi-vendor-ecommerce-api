import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 23 — dedicated HTTP-contract proof for `AllExceptionsFilter`,
 * exercised through real endpoints rather than a test-only route (per
 * this phase's own instruction: no production-only test endpoints unless
 * there is no cleaner alternative — every scenario below is triggerable
 * through an already-existing, already-shipped endpoint).
 */
describe('Global exception handling (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `exception-e2e-${randomUUID()}@example.com`;
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

  const assertSafeBody = (body: unknown) => {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/at .*\(.*:\d+:\d+\)/); // stack frame shape
    expect(serialized.toLowerCase()).not.toContain('prisma');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain(process.cwd());
    expect(serialized.toLowerCase()).not.toContain('select ');
    // The literal password *value* must never appear — field names like
    // "password must be longer than..." in a legitimate validation
    // message are expected and not a leak.
    expect(serialized).not.toContain(password);
  };

  it('400 — validation failure returns the standard whitelist-validated envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(response.body.error).toBe('Bad Request');
    expect(Array.isArray(response.body.message)).toBe(true);
    assertSafeBody(response.body);
  });

  it('401 — missing/invalid access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);

    expect(response.body.statusCode).toBe(401);
    assertSafeBody(response.body);
  });

  it('403 — authenticated but not the resource owner', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'ADMIN' },
    });
    const category = await prisma.category.create({
      data: { name: 'Exception Test Category', slug: uniqueSlug('exc-cat') },
    });
    const vendorAUser = await registerAndLogin('ExcVendorA');
    const vendorA = await prisma.vendor.create({
      data: { userId: vendorAUser.id, businessName: 'Exc Vendor A' },
    });
    const product = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${vendorAUser.accessToken}`)
      .send({
        name: 'Exception Fixture Product',
        slug: uniqueSlug('exc-product'),
        categoryId: category.id,
      })
      .expect(201);

    const vendorBUser = await registerAndLogin('ExcVendorB');

    const response = await request(app.getHttpServer())
      .patch(`/api/products/${product.body.id as string}`)
      .set('Authorization', `Bearer ${vendorBUser.accessToken}`)
      .send({ description: 'Hijack attempt' })
      .expect(403);

    expect(response.body.statusCode).toBe(403);
    assertSafeBody(response.body);

    await prisma.product.delete({ where: { id: product.body.id as string } });
    await prisma.vendor.delete({ where: { id: vendorA.id } });
    await prisma.category.delete({ where: { id: category.id } });
    void adminRole;
  });

  it('404 — resource genuinely does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/categories/${randomUUID()}`)
      .expect(404);

    expect(response.body.statusCode).toBe(404);
    assertSafeBody(response.body);
  });

  it('409 — duplicate unique field', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'ADMIN' },
    });
    const adminUser = await registerAndLogin('ExcAdmin');
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole.id },
    });
    const slug = uniqueSlug('exc-dup');
    await request(app.getHttpServer())
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminUser.accessToken}`)
      .send({ name: 'First', slug })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminUser.accessToken}`)
      .send({ name: 'Duplicate', slug })
      .expect(409);

    expect(response.body.statusCode).toBe(409);
    assertSafeBody(response.body);

    await prisma.category.deleteMany({ where: { slug } });
  });

  it('safe 500 — an untranslated Prisma error (malformed UUID reaching a @db.Uuid column) never leaks internals', async () => {
    // No controller in this codebase applies `ParseUUIDPipe` to route
    // params (confirmed by a full-codebase audit) — a malformed UUID
    // reaches Prisma directly and throws a `PrismaClientKnownRequestError`
    // whose code is neither `P2002` nor `P2025` (confirmed at runtime),
    // which no service's Prisma-error translation was written to expect.
    // This is exactly the "escaped service-level translation" case
    // `AllExceptionsFilter` exists to catch safely — a real,
    // already-existing endpoint, not a synthetic test-only route.
    const response = await request(app.getHttpServer()).get(
      '/api/categories/this-is-not-a-valid-uuid',
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      message: 'An unexpected error occurred.',
      error: 'Internal Server Error',
    });
    assertSafeBody(response.body);
  });
});
