import jwt from 'jsonwebtoken';

export type SessionPayload = {
  userId: string;
};

export function signSession(userId: string, secret: string, ttlSeconds: number): string {
  return jwt.sign({}, secret, {
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
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
