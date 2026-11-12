import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const SESSION_IDLE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = {
  userId: string;
  sessionId: string;
  sessionVersion: number;
};

export function signSession(
  userId: string,
  secret: string,
  ttlSeconds: number,
  sessionVersion = 0,
  sessionId: string = randomUUID(),
): string {
  return jwt.sign({ sessionVersion }, secret, {
    algorithm: 'HS256',
    subject: userId,
    jwtid: sessionId,
    expiresIn: ttlSeconds,
  });
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return null;
    }
    if (payload.sub.length === 0 || typeof payload.jti !== 'string' || payload.jti.length === 0) {
      return null;
    }
    const sessionVersion = payload.sessionVersion ?? 0;
    if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) {
      return null;
    }
    return { userId: payload.sub, sessionId: payload.jti, sessionVersion };
  } catch {
    return null;
  }
}
