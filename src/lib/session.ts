import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { prisma } from './prisma';
import { env } from '../config/env';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SLIDING_TOUCH_MS = 24 * 60 * 60 * 1000; // extend when older than 1 day

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

// Only the sha256 of the token is ever stored; a database leak does not
// expose usable session tokens.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, activeCompanyId: string | null) {
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeCompanyId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

// Look up a session by raw cookie token. Returns null when missing or expired
// (expired rows are deleted opportunistically). Applies sliding expiry.
export async function findSessionByToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (now - session.lastUsedAt.getTime() > SLIDING_TOUCH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    });
  }

  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}
