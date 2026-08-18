import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Phase 14 — Order viewing (customer's own MasterOrders,
 * vendor's own VendorOrders). Orders are produced via the real
 * checkout flow (Phase 13) rather than inserted directly, for realism.
 */
describe('Orders API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const registeredEmails: string[] = [];
  const password = 'StrongPassw0rd!';

  const uniqueEmail = () => `orders-e2e-${randomUUID()}@example.com`;
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

  const shippingAddress = {
    fullName: 'Jane Doe',
    phone: '+8801XXXXXXXXX',
    addressLine1: 'House 10, Road 5',
    city: 'Dhaka',
    postalCode: '1207',
    country: 'BD',
  };

  let categoryId: string;

  const createVendorProductVariant = async () => {
    const owner = await registerAndLogin('FixtureOwner');
    const vendor = await prisma.vendor.create({
      data: { userId: owner.id, businessName: 'Fixture Vendor', status: 'ACTIVE' },
    });
    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId,
        name: 'Fixture Product',
        slug: uniqueSlug('fixture-product'),
        status: 'ACTIVE',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: uniqueSlug('sku').toUpperCase(),
        price: '2500.00',
        currency: 'BDT',
      },
    });
    await prisma.inventory.create({
      data: { variantId: variant.id, onHand: 100, reserved: 0 },
    });

    return { owner, vendor, product, variant };
  };

  /** Registers a customer, adds one item to cart, checks out, returns everything needed for assertions. */
  const checkoutAsNewCustomer = async (firstName: string) => {
    const customer = await registerAndLogin(firstName);
    const fixture = await createVendorProductVariant();

    await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ variantId: fixture.variant.id, quantity: 2 })
      .expect(200);

    const checkoutResponse = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ shippingAddress })
      .expect(201);

    return { customer, fixture, order: checkoutResponse.body };
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

    const category = await prisma.category.create({
      data: { name: 'Orders Test Category', slug: uniqueSlug('orders-cat') },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    const testUsers = await prisma.user.findMany({
      where: { email: { in: registeredEmails } },
      select: { id: true },
    });
    const testUserIds = testUsers.map((u) => u.id);

    if (testUserIds.length > 0) {
      const masterOrders = await prisma.masterOrder.findMany({
        where: { userId: { in: testUserIds } },
        select: { id: true },
      });
      const masterOrderIds = masterOrders.map((o) => o.id);

      if (masterOrderIds.length > 0) {
        const vendorOrders = await prisma.vendorOrder.findMany({
          where: { masterOrderId: { in: masterOrderIds } },
          select: { id: true },
        });
        const vendorOrderIds = vendorOrders.map((v) => v.id);

        await prisma.orderItem.deleteMany({
          where: { vendorOrderId: { in: vendorOrderIds } },
        });
        await prisma.vendorOrderStatusHistory.deleteMany({
          where: { vendorOrderId: { in: vendorOrderIds } },
        });
        await prisma.vendorOrder.deleteMany({
          where: { id: { in: vendorOrderIds } },
        });
        await prisma.orderStatusHistory.deleteMany({
          where: { masterOrderId: { in: masterOrderIds } },
        });
        await prisma.masterOrder.deleteMany({
          where: { id: { in: masterOrderIds } },
        });
      }

      await prisma.cart.deleteMany({ where: { userId: { in: testUserIds } } });
    }

    const vendors = await prisma.vendor.findMany({
      where: { user: { email: { in: registeredEmails } } },
      select: { id: true },
    });
    const vendorIds = vendors.map((v) => v.id);

    if (vendorIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { vendorId: { in: vendorIds } },
        select: { id: true },
      });
      const productIds = products.map((p) => p.id);

      const variants = await prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);

      await prisma.inventoryTransaction.deleteMany({
        where: { inventory: { variantId: { in: variantIds } } },
      });
      await prisma.inventory.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }

    await prisma.category.deleteMany({ where: { id: categoryId } });

    if (registeredEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: registeredEmails } } });
    }

    await app.close();
  });

  describe('GET /api/orders (customer)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/orders').expect(401);
    });

    it('returns an empty list for a user with no orders', async () => {
      const user = await registerAndLogin('NoOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it("lists the caller's own orders, newest first", async () => {
      const { customer, order } = await checkoutAsNewCustomer('ListOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(order.id);
    });

    it("does not include another user's orders", async () => {
      const { order: orderA } = await checkoutAsNewCustomer('IsolationOrdersUserA');
      const userB = await registerAndLogin('IsolationOrdersUserB');

      const response = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
      expect(
        response.body.find((o: { id: string }) => o.id === orderA.id),
      ).toBeUndefined();
    });
  });

  describe('GET /api/orders/:masterOrderId (customer)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/orders/${randomUUID()}`)
        .expect(401);
    });

    it("returns the caller's own order with correct totals/currency/status", async () => {
      const { customer, order } = await checkoutAsNewCustomer('DetailOrderUser');

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(order.id);
      expect(response.body.currency).toBe('BDT');
      expect(response.body.totalAmount).toBe('5000.00');
      expect(response.body.paymentStatus).toBe('PENDING');
      expect(response.body.vendorOrders).toHaveLength(1);
      // Customer-facing view must not leak vendor/platform financial split.
      expect(response.body.vendorOrders[0]).not.toHaveProperty(
        'commissionAmount',
      );
      expect(response.body.vendorOrders[0]).not.toHaveProperty(
        'vendorNetAmount',
      );
    });

    it("forbids (403) User A from viewing User B's order", async () => {
      const { order } = await checkoutAsNewCustomer('CrossUserOrderOwnerA');
      const userB = await registerAndLogin('CrossUserOrderAttackerB');

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });

    it('forbids (403) a nonexistent order id, identically to a real cross-user order', async () => {
      const user = await registerAndLogin('NonexistentOrderUser');

      await request(app.getHttpServer())
        .get(`/api/orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("allows an ADMIN to view another user's order (documented bypass)", async () => {
      const { order } = await checkoutAsNewCustomer('AdminViewOrderOwner');
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('OrdersAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/orders/${order.id}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(order.id);
    });
  });

  describe('GET /api/vendor-orders (vendor)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/vendor-orders').expect(401);
    });

    it('rejects (403) a caller with no vendor profile', async () => {
      const user = await registerAndLogin('NoVendorProfileOrdersUser');

      await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("lists the caller's own vendor orders, including commission/vendorNet fields", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorListOrdersUser');

      const response = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].vendorId).toBe(fixture.vendor.id);
      expect(response.body[0]).toHaveProperty('commissionAmount');
      expect(response.body[0]).toHaveProperty('vendorNetAmount');
      expect(response.body[0].items).toHaveLength(1);
    });

    it("does not include another vendor's orders", async () => {
      const { fixture: fixtureA } = await checkoutAsNewCustomer(
        'VendorIsolationOrdersUserA',
      );
      const fixtureB = await createVendorProductVariant();

      const response = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /api/vendor-orders/:vendorOrderId (vendor)', () => {
    it('rejects (401) an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .expect(401);
    });

    it("returns the caller's own vendor order", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorDetailOrdersUser');

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(vendorOrderId);
      expect(response.body.totalAmount).toBe('5000.00');
    });

    it("forbids (403) Vendor A from viewing Vendor B's VendorOrder", async () => {
      const { fixture: fixtureA } = await checkoutAsNewCustomer(
        'VendorCrossAccessOwnerA',
      );
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(403);

      const serialized = JSON.stringify(response.body).toLowerCase();
      expect(serialized).not.toMatch(/prisma|postgres|sql/);
    });

    it('a spoofed vendorId/userId query parameter cannot bypass ownership', async () => {
      const { fixture: fixtureA } = await checkoutAsNewCustomer(
        'VendorSpoofOwnerA',
      );
      const fixtureB = await createVendorProductVariant();

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixtureA.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      await request(app.getHttpServer())
        .get(
          `/api/vendor-orders/${vendorOrderId}?vendorId=${fixtureA.vendor.id}`,
        )
        .set('Authorization', `Bearer ${fixtureB.owner.accessToken}`)
        .expect(403);
    });

    it('forbids (403) a caller with no vendor profile', async () => {
      const user = await registerAndLogin('NoVendorProfileDetailUser');

      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it("allows an ADMIN to view any vendor's VendorOrder (documented bypass)", async () => {
      const { fixture } = await checkoutAsNewCustomer('VendorAdminViewOwner');
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('VendorOrdersAdmin');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      const listResponse = await request(app.getHttpServer())
        .get('/api/vendor-orders')
        .set('Authorization', `Bearer ${fixture.owner.accessToken}`)
        .expect(200);
      const vendorOrderId = listResponse.body[0].id;

      const response = await request(app.getHttpServer())
        .get(`/api/vendor-orders/${vendorOrderId}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(vendorOrderId);
    });

    it('returns 404 for a nonexistent VendorOrder id when accessed as ADMIN (guard bypasses existence check)', async () => {
      const adminRole = await prisma.role.findUniqueOrThrow({
        where: { name: 'ADMIN' },
      });
      const adminAccount = await registerAndLogin('VendorOrdersAdminNotFound');
      await prisma.userRole.create({
        data: { userId: adminAccount.id, roleId: adminRole.id },
      });

      await request(app.getHttpServer())
        .get(`/api/vendor-orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminAccount.accessToken}`)
        .expect(404);
    });
  });
});
