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

    it('logs in with correct credentials, returns a valid access token + refresh token, and hides sensitive fields', async () => {
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
      expect(response.body).not.toHaveProperty('tokenHash');

      // accessToken: present, non-empty string.
      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.length).toBeGreaterThan(0);

      // refreshToken: present, non-empty, opaque (not a JWT — no "." segments).
      expect(typeof response.body.refreshToken).toBe('string');
      expect(response.body.refreshToken.length).toBeGreaterThan(0);
      expect(response.body.refreshToken.split('.')).toHaveLength(1);

      // Structural assertions on the access token itself: verifies it was
      // signed with the app's actual configured secret, carries the
      // expected `sub` identity claim (no password/roles/other data), and
      // expires according to the configured JWT_ACCESS_EXPIRES_IN window.
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

      // The raw refresh token must never equal what's persisted — only a
      // hash of it is stored.
      const persistedTokens = await prisma.refreshToken.findMany({
        where: { userId: userInDb.id },
      });
      expect(persistedTokens).toHaveLength(1);
      expect(persistedTokens[0].tokenHash).not.toBe(response.body.refreshToken);
      expect(persistedTokens[0].expiresAt.getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('rejects a wrong password with 401 Unauthorized', async () => {
      const email = await registerTestUser();

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword1!' })
        .expect(401);

      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.body).not.toHaveProperty('refreshToken');

      const userInDb = await prisma.user.findUniqueOrThrow({
        where: { email },
      });
      expect(userInDb.lastLoginAt).toBeNull();

      const persistedTokens = await prisma.refreshToken.findMany({
        where: { userId: userInDb.id },
      });
      expect(persistedTokens).toHaveLength(0);
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
        expect(response.body).not.toHaveProperty('refreshToken');

        const userInDb = await prisma.user.findUniqueOrThrow({
          where: { email },
        });
        expect(userInDb.lastLoginAt).toBeNull();
      },
    );
  });

  describe('POST /api/auth/refresh', () => {
    const password = 'StrongPassw0rd!';

    const registerAndLogin = async () => {
      const email = uniqueEmail();
      registeredEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, firstName: 'Jane' })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      return {
        email,
        id: loginResponse.body.id as string,
        accessToken: loginResponse.body.accessToken as string,
        refreshToken: loginResponse.body.refreshToken as string,
      };
    };

    it('exchanges a valid refresh token for a new, valid access token whose sub matches the user', async () => {
      const { id, accessToken, refreshToken } = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.length).toBeGreaterThan(0);
      expect(response.body).not.toHaveProperty('refreshToken');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('tokenHash');

      const newAccessToken = response.body.accessToken as string;

      // Cryptographically verify the new token (not just decode it) and
      // confirm its identity claim.
      const payload = await jwtService.verifyAsync<{ sub: string }>(
        newAccessToken,
      );
      expect(payload.sub).toBe(id);

      // The new access token actually works against the existing
      // GET /api/auth/me flow.
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);

      // The original access token issued at login is completely
      // unaffected — refresh does not invalidate it in this phase.
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('rejects an invalid/random refresh token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: randomUUID() })
        .expect(401);
    });

    it('rejects an expired refresh token with 401', async () => {
      const { id, refreshToken } = await registerAndLogin();

      // No admin/expiry-forcing endpoint exists yet, so the persisted
      // record is backdated directly via Prisma, exactly as the task
      // instructs for status changes. The raw token itself (captured from
      // the login response) is still presented to the real endpoint, so
      // this exercises the actual 401 path end to end rather than just
      // asserting the database state.
      await prisma.refreshToken.updateMany({
        where: { userId: id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('rejects malformed/empty input with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({})
        .expect(400);
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects a refresh token belonging to a %s user with 401',
      async (status) => {
        const { email, refreshToken } = await registerAndLogin();
        await prisma.user.update({ where: { email }, data: { status } });

        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .send({ refreshToken })
          .expect(401);
      },
    );
  });

  describe('GET /api/auth/me', () => {
    const password = 'StrongPassw0rd!';

    const registerAndLogin = async () => {
      const email = uniqueEmail();
      registeredEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, firstName: 'Jane' })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      return {
        email,
        id: loginResponse.body.id as string,
        accessToken: loginResponse.body.accessToken as string,
      };
    };

    it('returns the authenticated user for a valid access token and hides sensitive fields', async () => {
      const { email, id, accessToken } = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(id);
      expect(response.body.email).toBe(email);
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('accessToken');
      expect(response.body).not.toHaveProperty('refreshToken');
    });

    it('rejects a request with no Authorization header with 401', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it.each([
      ['missing the Bearer scheme', (token: string) => token],
      ['not a JWT at all', () => 'Bearer not-a-jwt-token'],
      ['using an unsupported scheme', (token: string) => `Token ${token}`],
    ])(
      'rejects a malformed Authorization header (%s) with 401',
      async (_label, buildHeader) => {
        const { accessToken } = await registerAndLogin();

        await request(app.getHttpServer())
          .get('/api/auth/me')
          .set('Authorization', buildHeader(accessToken))
          .expect(401);
      },
    );

    it('rejects a token with an invalid signature with 401', async () => {
      const { accessToken } = await registerAndLogin();

      // Flip the last character of the signature segment so the payload
      // is otherwise well-formed but the signature no longer verifies.
      const tampered = accessToken.slice(0, -1) + (accessToken.endsWith('a') ? 'b' : 'a');

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);
    });

    it('rejects an expired token with 401', async () => {
      const { id } = await registerAndLogin();
      const expiredToken = await jwtService.signAsync(
        { sub: id },
        { expiresIn: -10 },
      );

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('rejects a token whose sub does not match any user with 401', async () => {
      const tokenForUnknownUser = await jwtService.signAsync({
        sub: randomUUID(),
      });

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenForUnknownUser}`)
        .expect(401);
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects a token for a %s account with 401, even though the token itself is otherwise valid',
      async (status) => {
        const { email, accessToken } = await registerAndLogin();
        await prisma.user.update({ where: { email }, data: { status } });

        await request(app.getHttpServer())
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(401);
      },
    );
  });
});
