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

    const doRefresh = (refreshToken: string) =>
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });

    it('rotates a valid refresh token: issues a new access token + refresh token, and invalidates the old one', async () => {
      const { id, accessToken, refreshToken: tokenA } =
        await registerAndLogin();

      const response = await doRefresh(tokenA).expect(200);

      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.accessToken.length).toBeGreaterThan(0);
      expect(typeof response.body.refreshToken).toBe('string');
      expect(response.body.refreshToken.length).toBeGreaterThan(0);
      expect(response.body.refreshToken).not.toBe(tokenA);
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('tokenHash');

      const tokenB = response.body.refreshToken as string;
      const newAccessToken = response.body.accessToken as string;

      // Cryptographically verify the new access token (not just decode
      // it) and confirm its identity claim.
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

      // The pre-rotation access token issued at login is unaffected —
      // access-token behavior is unchanged from Phase 4/5.
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Token B (the rotated replacement) itself works for a further
      // rotation. (Token A's post-rotation behavior — reusing it — is
      // intentionally NOT checked here: doing so would revoke B as part
      // of this phase's family-revocation policy and contaminate this
      // "does rotation basically work" test with reuse-detection
      // behavior, which has its own dedicated tests below.)
      await doRefresh(tokenB).expect(200);
    });

    it('consumes the presented token as part of rotation: it cannot be used a second time', async () => {
      const { refreshToken: tokenA } = await registerAndLogin();

      await doRefresh(tokenA).expect(200);

      // Presenting A again is refresh-token reuse (covered in depth by
      // the dedicated describe block below); here we only assert the
      // simple fact that A itself is now unusable.
      await doRefresh(tokenA).expect(401);
    });

    it('rejects an invalid/random refresh token with 401', async () => {
      await doRefresh(randomUUID()).expect(401);
    });

    it('rejects an expired-but-never-used refresh token with 401 without revoking anything else', async () => {
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

      await doRefresh(refreshToken).expect(401);
    });

    it('rejects malformed/empty input with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({})
        .expect(400);
    });

    it.each(['SUSPENDED', 'BLOCKED'] as const)(
      'rejects a refresh token belonging to a %s user with 401 and issues no replacement',
      async (status) => {
        const { email, refreshToken } = await registerAndLogin();
        await prisma.user.update({ where: { email }, data: { status } });

        await doRefresh(refreshToken).expect(401);
      },
    );

    describe('reuse detection and family revocation', () => {
      it('detects reuse of an already-rotated token (A→B, then reuse A) with a generic 401', async () => {
        const { refreshToken: tokenA } = await registerAndLogin();

        const { body } = await doRefresh(tokenA).expect(200);
        const tokenB = body.refreshToken as string;

        // Reusing A must fail exactly like every other rejection reason —
        // a generic 401 with no distinguishing detail.
        const reuseResponse = await doRefresh(tokenA).expect(401);
        expect(reuseResponse.body).not.toHaveProperty('accessToken');
        expect(reuseResponse.body).not.toHaveProperty('refreshToken');

        // The reuse must have revoked the whole family: B (A's own
        // rotated replacement) is now dead too, even though B itself was
        // never reused or expired.
        await doRefresh(tokenB).expect(401);
      });

      it('revokes an entire multi-generation family (A→B→C, reuse A) — B and C both become unusable', async () => {
        const { refreshToken: tokenA } = await registerAndLogin();

        const responseB = await doRefresh(tokenA).expect(200);
        const tokenB = responseB.body.refreshToken as string;

        const responseC = await doRefresh(tokenB).expect(200);
        const tokenC = responseC.body.refreshToken as string;

        // Reuse the very first token in the chain.
        await doRefresh(tokenA).expect(401);

        // Every descendant is revoked, not just the immediate successor.
        await doRefresh(tokenB).expect(401);
        await doRefresh(tokenC).expect(401);
      });

      it('does not revoke an unrelated session (family) when reuse is detected in another', async () => {
        // Session 1 → family F1.
        const session1 = await registerAndLogin();
        // Session 2 → family F2 (different user, so definitely a
        // different family — also verifies revocation is correctly
        // scoped by more than coincidence).
        const session2 = await registerAndLogin();

        // Rotate F1 once, then trigger reuse in F1.
        const rotated1 = await doRefresh(session1.refreshToken).expect(200);
        await doRefresh(session1.refreshToken).expect(401); // reuse -> revokes F1

        // F1's rotated token is now also dead (family revoked)...
        await doRefresh(rotated1.body.refreshToken as string).expect(401);

        // ...but F2 is completely unaffected.
        await doRefresh(session2.refreshToken).expect(200);
      });
    });

    describe('concurrent refresh', () => {
      it('allows exactly one of two simultaneous requests for the same token to succeed; the loser is treated as reuse', async () => {
        const { refreshToken: tokenA } = await registerAndLogin();

        const [resultA, resultB] = await Promise.all([
          doRefresh(tokenA),
          doRefresh(tokenA),
        ]);

        const statuses = [resultA.status, resultB.status].sort();
        // Exactly one 200 (the winner) and one 401 (the loser) — the
        // database's row-level locking under AuthService.refresh()'s
        // transaction guarantees only one caller can ever successfully
        // claim a given token, no matter how close together the requests
        // arrive. Two successes (a duplicate valid rotation) would be a
        // serious security bug; this asserts it cannot happen.
        expect(statuses).toEqual([200, 401]);

        const winner = resultA.status === 200 ? resultA : resultB;
        expect(typeof winner.body.accessToken).toBe('string');
        expect(typeof winner.body.refreshToken).toBe('string');

        // Per this phase's reuse policy, the losing concurrent request is
        // indistinguishable from a genuine replay attack, so it revokes
        // the family — including the winner's brand-new token. This is a
        // deliberate, documented security trade-off (favoring safety over
        // convenience for a same-token double-fire), not an oversight.
        await doRefresh(winner.body.refreshToken as string).expect(401);
      });
    });
  });

  describe('POST /api/auth/logout', () => {
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

    const doRefresh = (refreshToken: string) =>
      request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });

    const doLogout = (accessToken: string, refreshToken: string) =>
      request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });

    it('revokes the session: refresh with the logged-out token afterward returns 401', async () => {
      const { accessToken, refreshToken } = await registerAndLogin();

      const response = await doLogout(accessToken, refreshToken);
      expect(response.status).toBe(204);
      expect(response.body).toEqual({});

      await doRefresh(refreshToken).expect(401);
    });

    it('does not blacklist the access token: GET /api/auth/me still works with it after logout', async () => {
      // Explicitly proves this phase does NOT implement access-token
      // revocation, per task §4 — logout only affects the refresh-token
      // session.
      const { accessToken, refreshToken } = await registerAndLogin();

      await doLogout(accessToken, refreshToken).expect(204);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('revokes the entire family: logging out after A→B→C rotation invalidates C (and the whole chain)', async () => {
      const { accessToken, refreshToken: tokenA } = await registerAndLogin();

      const responseB = await doRefresh(tokenA).expect(200);
      const tokenB = responseB.body.refreshToken as string;

      const responseC = await doRefresh(tokenB).expect(200);
      const tokenC = responseC.body.refreshToken as string;

      await doLogout(accessToken, tokenC).expect(204);

      await doRefresh(tokenC).expect(401);
      // The already-superseded earlier tokens in the chain were already
      // unusable from rotation itself (Phase 6 behavior) — reused here
      // only to confirm logout didn't somehow resurrect them.
      await doRefresh(tokenA).expect(401);
      await doRefresh(tokenB).expect(401);
    });

    it("isolates sessions for the SAME user: logging out session F1 (one device) does not affect independent session F2 (another device)", async () => {
      const email = uniqueEmail();
      registeredEmails.push(email);

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, firstName: 'Jane' })
        .expect(201);

      // Two independent logins for the SAME account -> two independent
      // families (e.g. "phone" and "laptop"), matching Phase 6's own
      // "User has: Family F1 ... Family F2" example.
      const loginF1 = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      const loginF2 = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      await doLogout(
        loginF1.body.accessToken as string,
        loginF1.body.refreshToken as string,
      ).expect(204);

      await doRefresh(loginF1.body.refreshToken as string).expect(401);
      await doRefresh(loginF2.body.refreshToken as string).expect(200);
    });

    it('isolates sessions across different users: logging out one user does not affect another', async () => {
      const session1 = await registerAndLogin();
      const session2 = await registerAndLogin();

      await doLogout(session1.accessToken, session1.refreshToken).expect(
        204,
      );

      await doRefresh(session1.refreshToken).expect(401);
      await doRefresh(session2.refreshToken).expect(200);
    });

    it('is idempotent: calling logout twice with the same token behaves consistently with no server error', async () => {
      const { accessToken, refreshToken } = await registerAndLogin();

      await doLogout(accessToken, refreshToken).expect(204);
      // Second call: same (already-revoked) refresh token, same still-
      // valid access token. Must not 500 — logout succeeds either way.
      await doLogout(accessToken, refreshToken).expect(204);

      await doRefresh(refreshToken).expect(401);
    });

    it('does not revoke another session merely because an unrelated/unknown refresh token is presented', async () => {
      const { accessToken } = await registerAndLogin();
      const otherSession = await registerAndLogin();

      // A syntactically-valid-looking but unrecognized token in the body
      // must not error, and must not affect any real session.
      await doLogout(accessToken, randomUUID()).expect(204);

      await doRefresh(otherSession.refreshToken).expect(200);
    });

    it('rejects malformed/empty input with 400', async () => {
      const { accessToken } = await registerAndLogin();

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);
    });

    it('rejects a request with no Authorization header with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: randomUUID() })
        .expect(401);
    });

    it('rejects a request with an invalid access token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer not-a-jwt-token')
        .send({ refreshToken: randomUUID() })
        .expect(401);
    });
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
