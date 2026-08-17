import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Auth API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  const registeredEmails: string[] = [];

  const uniqueEmail = () => `auth-e2e-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

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

  it('POST /api/auth/register creates a user and hides sensitive fields', async () => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'StrongPassw0rd!',
        firstName: 'Jane',
        lastName: 'Doe',
      })
      .expect(201);

    expect(response.body.email).toBe(email);
    expect(response.body.firstName).toBe('Jane');
    expect(response.body.status).toBe('ACTIVE');
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /api/auth/register rejects a duplicate email with 409 Conflict', async () => {
    const email = uniqueEmail();
    registeredEmails.push(email);

    const payload = {
      email,
      password: 'StrongPassw0rd!',
      firstName: 'Jane',
    };

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);

    const duplicateResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(409);

    expect(duplicateResponse.body).not.toHaveProperty('passwordHash');
  });

  it('POST /api/auth/register rejects an invalid payload with 400 Bad Request', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
      })
      .expect(400);
  });

  describe('POST /api/auth/login', () => {
    const password = 'StrongPassw0rd!';

    const registerTestUser = async () => {
      const email = uniqueEmail();
      registeredEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, firstName: 'Jane' })
        .expect(201);

      return email;
    };

    it('logs in with correct credentials, returns a valid access token, and hides sensitive fields', async () => {
      const email = await registerTestUser();

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      expect(response.body.email).toBe(email);
      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.lastLoginAt).toEqual(expect.any(String));
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('refreshToken');

      // accessToken: present, non-empty string.
      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.length).toBeGreaterThan(0);

      // Structural assertions on the token itself: verifies it was signed
      // with the app's actual configured secret, carries the expected
      // `sub` identity claim (no password/roles/other data), and expires
      // according to the configured JWT_ACCESS_EXPIRES_IN window.
      const payload = await jwtService.verifyAsync<{
        sub: string;
        iat: number;
        exp: number;
      }>(response.body.accessToken as string);

      expect(payload.sub).toBe(response.body.id);
      expect(payload).not.toHaveProperty('password');
      expect(payload).not.toHaveProperty('passwordHash');
      expect(typeof payload.exp).toBe('number');
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.exp - payload.iat).toBe(15 * 60); // JWT_ACCESS_EXPIRES_IN=15m

      const userInDb = await prisma.user.findUniqueOrThrow({
        where: { email },
      });
      expect(userInDb.lastLoginAt).not.toBeNull();
    });

    it('rejects a wrong password with 401 Unauthorized', async () => {
      const email = await registerTestUser();

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword1!' })
        .expect(401);

      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('accessToken');

      const userInDb = await prisma.user.findUniqueOrThrow({
        where: { email },
      });
      expect(userInDb.lastLoginAt).toBeNull();
    });

    it('rejects an unknown email with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: uniqueEmail(), password })
        .expect(401);
    });

    it('rejects an invalid payload with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects a %s account with 403 Forbidden and does not update lastLoginAt',
      async (status) => {
        const email = await registerTestUser();
        await prisma.user.update({ where: { email }, data: { status } });

        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email, password })
          .expect(403);

        expect(response.body).not.toHaveProperty('accessToken');

        const userInDb = await prisma.user.findUniqueOrThrow({
          where: { email },
        });
        expect(userInDb.lastLoginAt).toBeNull();
      },
    );
  });
});
