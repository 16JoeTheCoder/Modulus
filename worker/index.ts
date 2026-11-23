import { Hono } from 'hono';
import { DEFAULT_BALANCE_CONFIG } from '../src/core/types';

export interface Env {
  DB: D1Database;
  MODULUS_KV: KVNamespace;
  ASSETS: Fetcher;
  DEV_MODE?: string;
  SESSION_TTL_DAYS?: string;
  SITE_URL?: string;
  JWT_SECRET?: string;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/api/config/public', (c) => {
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(DEFAULT_BALANCE_CONFIG);
});

app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
