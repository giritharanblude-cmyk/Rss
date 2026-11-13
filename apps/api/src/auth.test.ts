import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailUnavailableError } from './errors';
import {
  createTestContext,
  latestOtpCode,
  loginAndVerify,
  seedMember,
  sessionCookieFrom,
  type TestContext,
} from './test/helpers';

let context: TestContext;

afterEach(async () => {
  await context.app.close();
});

describe('sign in with name, password and emailed code', () => {
  it('completes the login flow and sets a scoped session cookie', async () => {
    context = await createTestContext();
    const privateProfile = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });
    expect(privateProfile.statusCode).toBe(401);

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
    expect(verify.json().user).not.toHaveProperty('email');
    const setCookie = String(verify.headers['set-cookie']);
    expect(sessionCookieFrom(verify)).toContain('session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Secure');

    const me = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookieFrom(verify) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { name: 'Admin', role: 'master', email: 'admin@example.com', phone: null },
    });
  });

  it('skips OTP when the same account has a valid active session', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const sentCount = context.email.sent.length;

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie },
      payload: { name: 'Admin', password: 'master-password-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'session_active' });
    expect(context.email.sent).toHaveLength(sentCount);
    const refreshedProfile = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookieFrom(response) },
    });
    expect(refreshedProfile.statusCode).toBe(200);
  });

  it('finds an account by the normalized email lookup during login', async () => {
    context = await createTestContext();
    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: ' ADMIN@example.com ', password: 'master-password-1' },
    });
    expect(login.statusCode).toBe(202);
    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'admin@example.com', code: latestOtpCode(context.email) },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ user: { name: 'Admin', role: 'master' } });
  });

  it('sends member login OTPs only to the member email, including resends', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'Mina',
      email: 'mina@example.test',
      password: 'member-password-1',
    });

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: member.name, password: 'member-password-1' },
    });

    expect(login.statusCode).toBe(202);
    expect(context.email.sent.at(-1)?.to).toBe(member.email);
    expect(context.email.sent.at(-1)?.to).not.toBe(context.master.email);

    context.clock.advance(61_000);
    const resend = await context.app.inject({
      method: 'POST',
      url: '/api/auth/resend-otp',
      payload: { name: member.name },
    });

    expect(resend.statusCode).toBe(202);
    expect(context.email.sent.at(-1)?.to).toBe(member.email);
    expect(context.email.sent.at(-1)?.to).not.toBe(context.master.email);
  });

  it('sends master login OTPs to the master email', async () => {
    context = await createTestContext();

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: context.master.name, password: 'master-password-1' },
    });

    expect(login.statusCode).toBe(202);
    expect(context.email.sent.at(-1)?.to).toBe(context.master.email);
  });

  it('refuses login when the account has no email address', async () => {
    context = await createTestContext();
    const member = await seedMember(context.users, {
      name: 'NoEmail',
      email: '',
      password: 'member-password-1',
    });

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: member.name, password: 'member-password-1' },
    });

    expect(login.statusCode).toBe(400);
    expect(login.json().error).toMatch(/no email address/i);
    expect(context.email.sent).toHaveLength(0);
    expect(await context.otps.findLatest(member.id, 'login')).toBeNull();
  });

  it.each([
    { role: 'master', name: 'Admin', email: 'admin@example.com' },
    { role: 'member', name: 'Mina', email: 'mina@example.test' },
  ])('$role must verify contact changes with an OTP sent to the current email', async (account) => {
    context = await createTestContext();
    if (account.role === 'member') {
      await seedMember(context.users, {
        name: account.name,
        email: account.email,
        password: 'member-password-1',
      });
    }
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      account.name,
      account.role === 'master' ? 'master-password-1' : 'member-password-1',
    );
    const user = await context.users.findByName(account.name);
    if (!user) throw new Error('Expected the account to exist.');

    const contacts = {
      email: `${account.name.toLowerCase()}-new@example.test`,
      phone: '+14155552671',
    };
    const request = await context.app.inject({
      method: 'POST',
      url: '/api/auth/contact-change/request',
      headers: { cookie },
      payload: contacts,
    });
    expect(request.statusCode).toBe(202);
    expect(context.email.sent.at(-1)?.to).toBe(account.email);

    const withoutOtp = await context.app.inject({
      method: 'POST',
      url: '/api/auth/contact-change/verify',
      headers: { cookie },
      payload: contacts,
    });
    expect(withoutOtp.statusCode).toBe(400);

    const code = latestOtpCode(context.email);
    const wrongCode = `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;
    const rejected = await context.app.inject({
      method: 'POST',
      url: '/api/auth/contact-change/verify',
      headers: { cookie },
      payload: { ...contacts, code: wrongCode },
    });
    expect(rejected.statusCode).toBe(400);
    expect(await context.users.findById(user.id)).toMatchObject({
      email: account.email,
      phone: null,
    });

    const verified = await context.app.inject({
      method: 'POST',
      url: '/api/auth/contact-change/verify',
      headers: { cookie },
      payload: { ...contacts, code },
    });
    expect(verified.statusCode).toBe(204);
    expect(await context.users.findById(user.id)).toMatchObject(contacts);

    const profile = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(profile.json()).toMatchObject({ user: contacts });
  });

  it('keeps an active session valid by refreshing its last-active time', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    context.clock.advance(6 * 24 * 60 * 60 * 1000);
    const firstActivity = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(firstActivity.statusCode).toBe(200);

    context.clock.advance(6 * 24 * 60 * 60 * 1000);
    const secondActivity = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookieFrom(firstActivity) },
    });
    expect(secondActivity.statusCode).toBe(200);
  });

  it('rejects a session idle for seven days and one millisecond', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    context.clock.advance(7 * 24 * 60 * 60 * 1000 + 1);

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(401);
  });

  it('requires a new OTP login after the session expires from inactivity', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    context.clock.advance(7 * 24 * 60 * 60 * 1000);

    const expiredSession = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(expiredSession.statusCode).toBe(401);

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie },
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(login.statusCode).toBe(202);
    expect(login.json()).toMatchObject({ status: 'otp_sent' });
    expect(context.email.sent).toHaveLength(2);

    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code: latestOtpCode(context.email) },
    });
    expect(verify.statusCode).toBe(200);
    const activeSession = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookieFrom(verify) },
    });
    expect(activeSession.statusCode).toBe(200);
  });

  it('sets the session cookie Secure in production and clears it on logout', async () => {
    context = await createTestContext({
      nodeEnv: 'production',
      originSecret: 'origin-secret-value-123456',
      originSecretEnforced: true,
    });

    const headers = {
      origin: 'https://news.example.test',
      'x-origin-secret': 'origin-secret-value-123456',
    };

    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      headers,
      payload: { name: 'Admin', code: latestOtpCode(context.email) },
    });

    expect(verify.statusCode).toBe(200);
    const setCookie = String(verify.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');

    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...headers, cookie: sessionCookieFrom(verify) },
    });
    expect(logout.statusCode).toBe(204);
    const clearedCookie = String(logout.headers['set-cookie']);
    expect(clearedCookie).toContain('session=;');
    expect(clearedCookie).toContain('Path=/');
    expect(clearedCookie).toMatch(/(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);

    const revokedSession = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { ...headers, cookie: sessionCookieFrom(verify) },
    });
    expect(revokedSession.statusCode).toBe(401);
  });

  it('requires a new OTP after logout', async () => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );
    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('session=;');

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: sessionCookieFrom(logout) },
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(login.statusCode).toBe(202);
    expect(login.json()).toMatchObject({ status: 'otp_sent' });
    expect(context.email.sent).toHaveLength(2);
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

  it('allows only one concurrent request to consume a code', async () => {
    context = await createTestContext();
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    const code = latestOtpCode(context.email);

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        context.app.inject({
          method: 'POST',
          url: '/api/auth/verify-otp',
          payload: { name: 'Admin', code },
        }),
      ),
    );

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 400)).toHaveLength(1);
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
    const previousCode = latestOtpCode(context.email);

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
    expect(later.json()).toMatchObject({
      message: 'A new code was sent; use the latest one.',
    });
    expect(context.email.sent).toHaveLength(2);
    expect(context.email.sent.at(-1)?.text).toContain('A new code was sent; use the latest one.');

    const oldCode = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code: previousCode },
    });
    const latestCode = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code: latestOtpCode(context.email) },
    });
    expect(oldCode.statusCode).toBe(400);
    expect(latestCode.statusCode).toBe(200);
  });

  it('logs a sanitized SMTP failure reason and returns a clear error', async () => {
    context = await createTestContext();
    const logError = vi.spyOn(context.app.log, 'error');
    let otpCode = '';
    vi.spyOn(context.email, 'send').mockImplementation(async (message) => {
      otpCode = /Your verification code is (\d{6})/.exec(message.text)?.[1] ?? '';
      throw new EmailUnavailableError(
        `SMTP authentication failed: password=mail-secret verification=${otpCode}`,
      );
    });

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('SMTP authentication failed');
    expect(response.json().error).not.toContain('mail-secret');
    expect(response.json().error).not.toContain(otpCode);
    expect(otpCode).toMatch(/^\d{6}$/);
    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).toContain('SMTP authentication failed');
    expect(logged).not.toContain('mail-secret');
    expect(logged).not.toContain(otpCode);
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

describe('authentication rate limits', () => {
  it('limits login and OTP verification requests', async () => {
    context = await createTestContext({
      rateLimits: { login: 1, verify: 1, resend: 1, password: 1, windowMs: 60_000 },
    });

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'master-password-1' },
    });
    expect(login.statusCode).toBe(202);

    const limitedLogin = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Admin', password: 'wrong-password' },
    });
    expect(limitedLogin.statusCode).toBe(429);

    const code = latestOtpCode(context.email);
    const verified = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(verified.statusCode).toBe(200);

    const limitedVerification = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-otp',
      payload: { name: 'Admin', code },
    });
    expect(limitedVerification.statusCode).toBe(429);
  });
});

describe('password change', () => {
  it.each([
    ['short1!', 'Password must be at least 8 characters'],
    ['password1', 'Password must include at least one symbol'],
    ['password!', 'Password must include at least one number'],
    ['1234567!', 'Password must include at least one letter'],
  ])('rejects new passwords that violate the rule', async (newPassword, message) => {
    context = await createTestContext();
    const { cookie } = await loginAndVerify(
      context.app,
      context.email,
      'Admin',
      'master-password-1',
    );

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {
        currentPassword: 'master-password-1',
        code: '123456',
        newPassword,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe(message);
  });

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
