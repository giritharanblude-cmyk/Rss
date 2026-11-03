import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  latestOtpCode,
  loginAndVerify,
  sessionCookieFrom,
  type TestContext,
} from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
});

describe('sign in with name, password and emailed code', () => {
  it('completes the login flow and sets an httpOnly cookie', async () => {
    context = await createTestContext();

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(login.statusCode).toBe(202);
    expect(login.json()).toMatchObject({ status: 'otp_sent' });
    expect(context.email.sent).toHaveLength(1);

    const code = latestOtpCode(context.email);
    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ user: { name: 'Admin', role: 'master' } });
    expect(sessionCookieFrom(verify)).toContain('session=');
    expect(String(verify.headers['set-cookie'])).toContain('HttpOnly');

    const me = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookieFrom(verify) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { name: 'Admin', role: 'master' } });
  });

  it('stores the password and the code as Argon2id hashes', async () => {
    context = await createTestContext();
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    const code = latestOtpCode(context.email);

    const user = await context.users.findByName('Admin');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain('master-password-1');

    const otp = await context.otps.findLatest(user!.id, 'login');
    expect(otp?.codeHash).toMatch(/^\$argon2id\$/);
    expect(otp?.codeHash).not.toContain(code);
  });

  it('rejects a wrong password without revealing the reason', async () => {
    context = await createTestContext();
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Name or password is incorrect.' });
    expect(context.email.sent).toHaveLength(0);
  });

  it('rejects an expired code', async () => {
    context = await createTestContext();
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    const code = latestOtpCode(context.email);
    context.clock.advance(11 * 60 * 1000);

    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(verify.statusCode).toBe(400);
    expect(verify.json().error).toMatch(/expired/i);
  });

  it('rejects a code that was already used', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    expect(cookie).toContain('session=');

    const code = latestOtpCode(context.email);
    const second = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(second.statusCode).toBe(400);
  });

  it('rejects the correct code after five wrong attempts', async () => {
    context = await createTestContext();
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    const code = latestOtpCode(context.email);
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/auth/verify-otp',
        payload: { name: 'Admin', code: wrongCode },
      });
      expect(response.statusCode).toBe(400);
    }

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(response.statusCode).toBe(400);
  });

  it('enforces the 60 second resend cooldown', async () => {
    context = await createTestContext();
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });

    const early = await context.app.inject({
      method: 'POST',
      url: '/api/auth/resend-otp',
      payload: { name: 'Admin' },
    });
    expect(early.statusCode).toBe(429);

    context.clock.advance(61 * 1000);
    const later = await context.app.inject({
      method: 'POST',
      url: '/api/auth/resend-otp',
      payload: { name: 'Admin' },
    });
    expect(later.statusCode).toBe(202);
    expect(context.email.sent).toHaveLength(2);
  });

  it('locks the account after repeated wrong passwords', async () => {
    context = await createTestContext();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { name: 'Admin', password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
    }

    const fifth = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'wrong-password' },
    });
    expect(fifth.statusCode).toBe(429);

    const correctWhileLocked = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(correctWhileLocked.statusCode).toBe(429);

    context.clock.advance(16 * 60 * 1000);
    const unlocked = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(unlocked.statusCode).toBe(202);
  });
});

describe('password change', () => {
  it('requires a session, the current password and an emailed code', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const noSession = await context.app.inject({
      method: 'POST',
      url: '/api/auth/password-otp',
    });
    expect(noSession.statusCode).toBe(401);

    const request = await context.app.inject({
      method: 'POST',
      url: '/api/auth/password-otp',
      headers: { cookie },
    });
    expect(request.statusCode).toBe(202);
    const code = latestOtpCode(context.email);

    const wrongCurrent = await context.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'not-the-password', code, newPassword: 'new-password-99' },
    });
    expect(wrongCurrent.statusCode).toBe(401);

    const changed = await context.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {
        currentPassword: 'master-password-1',
        code,
        newPassword: 'new-password-99',
      },
    });
    expect(changed.statusCode).toBe(204);
    expect(changed.headers['set-cookie']).toContain('session=;');

    context.clock.advance(61 * 1000);
    const oldPassword = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'new-password-99' },
    });
    expect(newPassword.statusCode).toBe(202);
  });

  it('rejects an incorrect password-change code', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/password-otp',
      headers: { cookie },
    });
    const code = latestOtpCode(context.email);
    const wrongCode = code === '000000' ? '111111' : '000000';

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {
        currentPassword: 'master-password-1',
        code: wrongCode,
        newPassword: 'new-password-99',
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
