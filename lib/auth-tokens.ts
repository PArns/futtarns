import { createHash, randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Login tokens are stored hashed, so a database dump does not hand out logins. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function loginLink(token: string): string {
  return `${appUrl()}/login/${token}`;
}

export function calendarLink(calendarToken: string): string {
  return `${appUrl()}/ics/${calendarToken}.ics`;
}
