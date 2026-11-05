import { describe, expect, it } from 'vitest';
import { redactLogText, sanitizeUrl, scrubLogPayload } from './logging';

describe('logging redaction', () => {
  it('sanitizes URL tokens and secrets', () => {
    const url = '/api/public/unsubscribe/abc123?token=super-secret-123';
    expect(sanitizeUrl(url)).toContain('[REDACTED]');
    expect(sanitizeUrl(url)).not.toContain('super-secret-123');
  });

  it('scrubs known secret fields and contact data', () => {
    expect(
      scrubLogPayload({
        password: 'hunter2',
        otp: '123456',
        recipientContact: 'contact:v1.a.b.c',
        nested: { email: 'person@example.com', token: 'jwt-value' },
      }),
    ).toMatchObject({
      password: '[REDACTED]',
      otp: '[REDACTED]',
      recipientContact: '[REDACTED]',
      nested: {
        email: '[REDACTED]',
        token: '[REDACTED]',
      },
    });
  });

  it('redacts contact and JWT fragments from free-text logs', () => {
    expect(redactLogText('token=eyJhbGciOiJIUzI1NiJ9.abc.def')).toContain('[REDACTED-JWT]');
    expect(redactLogText('contact:v1.a.b.c')).toContain('contact:[REDACTED]');
  });
});
