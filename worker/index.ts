import { Hono } from 'hono';
import { getActiveBalanceConfig } from './db/queries';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { publicAndGarageRoutes } from './routes/garage';
import { rewriteHtmlWithBranding } from './seo/rewriter';
import type { Env, HonoEnv } from './types';

export type { Env };

const app = new Hono<HonoEnv>();

// Mount API route groups
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', publicAndGarageRoutes);

// Catch-all for unknown /api/* routes so they never fall through to SPA HTML
app.all('/api/*', (c) => {
  return c.json({ error: 'API route not found' }, 404);
});

// Dynamic Edge SEO HTMLRewriter for HTML SPA entrypoints
const isSeoHtmlPath = (pathname: string): boolean =>
  pathname === '/' ||
  pathname === '/index.html' ||
  pathname === '/admin' ||
  pathname.startsWith('/admin/');

app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);

  if (c.req.method === 'GET' && isSeoHtmlPath(url.pathname)) {
    const contentType = assetResponse.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      const config = await getActiveBalanceConfig(c.env);
      return rewriteHtmlWithBranding(assetResponse, config.branding, url.pathname);
    }
  }

  return assetResponse;
});

export default app;
