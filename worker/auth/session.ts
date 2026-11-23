import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { IAuthUser } from '../../src/core/types';
import type { Env, HonoEnv } from '../types';
import { hashWithPepper, isAdminEmail } from './crypto';

export const SESSION_COOKIE_NAME = 'modulus_session';

export function getSessionTtlSeconds(env: Env): number {
  const days = Number.parseInt(env.SESSION_TTL_DAYS ?? '30', 10);
  const clampedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 30;
  return clampedDays * 24 * 60 * 60;
}

export function buildSessionCookieHeader(
  token: string,
  maxAgeSeconds: number,
  requestUrl: string
): string {
  const isHttps = requestUrl.startsWith('https://');
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(requestUrl: string): string {
  return buildSessionCookieHeader('', 0, requestUrl);
}

interface SessionUserRow {
  session_id: string;
  user_id: string;
  email: string;
  role: 'player' | 'admin';
  credits: number;
  unlock_all: number;
}

export async function resolveSession(
  c: Context<HonoEnv>
): Promise<{ user: IAuthUser; sessionId: string } | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token || token.length < 16) return null;

  const tokenHash = await hashWithPepper(token, c.env);
  const nowIso = new Date().toISOString();

  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.role, u.credits, u.unlock_all
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, nowIso)
    .first<SessionUserRow>();

  if (!row) return null;

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      credits: row.credits,
      unlockAll: row.unlock_all === 1,
    },
  };
}

export async function requireAuth(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', session.user);
  c.set('sessionId', session.sessionId);
  await next();
}

/**
 * Dual Server-Side Gate (ADMIN_PANEL_SPEC.md Section 1):
 * 1. Valid 30-day HttpOnly session cookie (modulus_session)
 * 2. user.email present in ADMIN_EMAILS secret AND users.role === 'admin' in D1
 * Returns strict 403 Forbidden otherwise.
 */
export async function requireAdmin(c: Context<HonoEnv>, next: Next): Promise<Response | void> {
  const session = await resolveSession(c);
  if (!session) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (session.user.role !== 'admin' || !isAdminEmail(session.user.email, c.env)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  c.set('user', session.user);
  c.set('sessionId', session.sessionId);
  await next();
}
