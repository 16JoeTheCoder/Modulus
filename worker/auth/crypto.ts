import type { Env } from '../types';

const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const bytes = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashWithPepper(value: string, env: Env): Promise<string> {
  const pepper = env.JWT_SECRET?.trim() || 'modulus-local-dev-pepper-change-me';
  return sha256Hex(`${pepper}:${value}`);
}

export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const num = buf[0] % 1_000_000;
  return num.toString().padStart(6, '0');
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isAdminEmail(email: string, env: Env): boolean {
  const raw = env.ADMIN_EMAILS ?? '';
  const normalized = email.trim().toLowerCase();
  if (!normalized || !raw.trim()) return false;
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0] ?? '*'}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}
