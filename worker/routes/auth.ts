import { Hono, type Context } from 'hono';
import { STARTER_OWNED_PART_IDS } from '../../src/content';
import {
  RequestOtpBodySchema,
  VerifyOtpBodySchema,
  type IAuthUser,
} from '../../src/core/types';
import {
  generateOtpCode,
  generateSessionToken,
  hashWithPepper,
  isAdminEmail,
} from '../auth/crypto';
import { sendOtpEmail } from '../auth/email';
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  getSessionTtlSeconds,
  resolveSession,
} from '../auth/session';
import { getActiveBalanceConfig, getUserGarageSync } from '../db/queries';
import type { HonoEnv } from '../types';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post('/request-otp', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RequestOtpBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid email address' },
      400
    );
  }

  const email = parsed.data.email;
  const code = generateOtpCode();
  const codeHash = await hashWithPepper(`${email}:${code}`, c.env);
  const otpId = `otp_${crypto.randomUUID()}`;
  const now = Date.now();
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO otp_codes (id, email, code_hash, attempts, expires_at)
     VALUES (?, ?, ?, 0, ?)`
  )
    .bind(otpId, email, codeHash, expiresAt)
    .run();

  try {
    await sendOtpEmail(c.env, email, code);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to send verification code' },
      502
    );
  }

  const isDevMode = c.env.DEV_MODE === 'true';
  return c.json({
    ok: true,
    expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
    ...(isDevMode ? { devOtpCode: code } : {}),
  });
});

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
}

interface UserRow {
  id: string;
  email: string;
  role: 'player' | 'admin';
  credits: number;
  unlock_all: number;
}

authRoutes.post('/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = VerifyOtpBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid OTP payload' },
      400
    );
  }

  const { email, code } = parsed.data;
  const nowIso = new Date().toISOString();

  const otpRow = await c.env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at
     FROM otp_codes
     WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1`
  )
    .bind(email, nowIso)
    .first<OtpRow>();

  if (!otpRow) {
    return c.json({ error: 'Verification code expired or not found. Request a new code.' }, 400);
  }

  if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
    return c.json({ error: 'Too many failed attempts. Please request a new code.' }, 429);
  }

  const expectedHash = await hashWithPepper(`${email}:${code}`, c.env);
  if (expectedHash !== otpRow.code_hash) {
    await c.env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(otpRow.id)
      .run();
    const remaining = Math.max(0, MAX_OTP_ATTEMPTS - (otpRow.attempts + 1));
    return c.json(
      {
        error:
          remaining > 0
            ? `Invalid 6-digit code (${remaining} attempts remaining).`
            : 'Too many failed attempts. Please request a new code.',
      },
      400
    );
  }

  return completeSignIn(c, email, [
    c.env.DB.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ?').bind(nowIso, otpRow.id),
  ]);
});

authRoutes.get('/config', (c) => c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID?.trim() || null }));

authRoutes.post('/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return c.json({ error: 'Google sign-in is not configured' }, 503);
  const body = (await c.req.json().catch(() => null)) as { credential?: unknown } | null;
  const credential = typeof body?.credential === 'string' ? body.credential : '';
  if (!credential || credential.length > 4096) return c.json({ error: 'Missing Google credential' }, 400);

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );
  if (!res.ok) return c.json({ error: 'Google sign-in failed' }, 401);
  const info = (await res.json().catch(() => null)) as {
    aud?: string;
    iss?: string;
    email?: string;
    email_verified?: string | boolean;
    exp?: string;
  } | null;
  const issOk = info?.iss === 'https://accounts.google.com' || info?.iss === 'accounts.google.com';
  const verified = info?.email_verified === true || info?.email_verified === 'true';
  if (!info || info.aud !== clientId || !issOk || !verified || !info.email) {
    return c.json({ error: 'Google sign-in failed' }, 401);
  }
  return completeSignIn(c, info.email.trim().toLowerCase(), []);
});


authRoutes.get('/me', async (c) => {
  const session = await resolveSession(c);
  if (!session) {
    return c.json({ authenticated: false, user: null });
  }
  return c.json({ authenticated: true, user: session.user });
});

authRoutes.post('/logout', async (c) => {
  const session = await resolveSession(c);
  if (session) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(session.sessionId)
      .run();
  }
  c.header('Set-Cookie', buildClearSessionCookieHeader(c.req.url));
  return c.json({ ok: true });
});

async function completeSignIn(
  c: Context<HonoEnv>,
  email: string,
  preStatements: D1PreparedStatement[]
) {
  const nowIso = new Date().toISOString();
  const activeConfig = await getActiveBalanceConfig(c.env);
  const shouldBeAdmin = isAdminEmail(email, c.env);

  const existingUser = await c.env.DB.prepare(
    'SELECT id, email, role, credits, unlock_all FROM users WHERE email = ? LIMIT 1'
  )
    .bind(email)
    .first<UserRow>();

  let user: IAuthUser;
  const statements: D1PreparedStatement[] = [...preStatements];

  if (!existingUser) {
    const newUserId = `usr_${crypto.randomUUID()}`;
    const role: 'player' | 'admin' = shouldBeAdmin ? 'admin' : 'player';
    const startingCredits = activeConfig.economy_bias.starting_credits;

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO users (id, email, role, credits, unlock_all, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      ).bind(newUserId, email, role, startingCredits, nowIso, nowIso)
    );

    user = {
      id: newUserId,
      email,
      role,
      credits: startingCredits,
      unlockAll: false,
    };
  } else {
    const nextRole: 'player' | 'admin' = shouldBeAdmin ? 'admin' : existingUser.role;
    if (nextRole !== existingUser.role) {
      statements.push(
        c.env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').bind(
          nextRole,
          nowIso,
          existingUser.id
        )
      );
    }

    user = {
      id: existingUser.id,
      email: existingUser.email,
      role: nextRole,
      credits: existingUser.credits,
      unlockAll: existingUser.unlock_all === 1,
    };
  }

  // Seed starter parts idempotently via INSERT OR IGNORE in the same batch
  for (const partId of STARTER_OWNED_PART_IDS) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO inventory (id, user_id, part_id, acquired_via, acquired_at)
         VALUES (?, ?, ?, 'starter', ?)`
      ).bind(`inv_${crypto.randomUUID()}`, user.id, partId, nowIso)
    );
  }

  // Create 30-day session
  const sessionToken = generateSessionToken();
  const tokenHash = await hashWithPepper(sessionToken, c.env);
  const ttlSeconds = getSessionTtlSeconds(c.env);
  const sessionExpiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const sessionId = `ses_${crypto.randomUUID()}`;
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 240);

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, user.id, tokenHash, userAgent, sessionExpiresAt, nowIso)
  );

  await c.env.DB.batch(statements);

  const garage = await getUserGarageSync(c.env.DB, user);
  c.header('Set-Cookie', buildSessionCookieHeader(sessionToken, ttlSeconds, c.req.url));
  return c.json(garage);
}
