import jwt from 'jsonwebtoken';

export type SessionPayload = {
  userId: string;
  sessionVersion: number;
};

export function signSession(
  userId: string,
  secret: string,
  ttlSeconds: number,
  sessionVersion = 0,
): string {
  return jwt.sign({ sessionVersion }, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: ttlSeconds,
  });
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return null;
    }
    if (payload.sub.length === 0) {
      return null;
    }
    const sessionVersion = payload.sessionVersion ?? 0;
    if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) {
      return null;
    }
    return { userId: payload.sub, sessionVersion };
  } catch {
    return null;
  }
}
