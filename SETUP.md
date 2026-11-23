# MODULUS — Cloudflare Free-Tier Setup & Deployment Guide

This guide covers installing Antigravity agent skills, provisioning **Cloudflare D1 + Workers KV**, testing locally with Email OTP + Admin Panel, and deploying live to **`https://modulus.josefyang.com`** on the Cloudflare Free Plan.

---

## 1. Prerequisites & Antigravity Agent Skills

* **Node.js** `v20+` and **npm**
* **Cloudflare Account** (Free Tier works out of the box) with `josefyang.com` managed on Cloudflare DNS
* **Wrangler CLI** logged in:
  ```bash
  npx wrangler login
  ```

### Install Recommended Skills (Run inside Antigravity Terminal)
Before pasting the Argon Master Prompt from `ARCHITECTURE.md`, install these skills so Argon and Hydrogen have up-to-date Cloudflare, Three.js, game-feel, and UI/UX workflows:

```bash
npx skills add https://github.com/cloudflare/skills --skill workers-best-practices --skill wrangler --skill cloudflare-email-service --skill web-perf
npx skills add https://github.com/gamedev-skills/awesome-gamedev-agent-skills
npx skills add https://github.com/github/awesome-copilot --skill game-engine
```

---

## 2. Provision Cloudflare D1 & Workers KV

Run these two commands once in your project root:

```bash
# 1. Create the D1 SQLite database
npx wrangler d1 create modulus-db

# 2. Create the KV namespace for live Game-Theory Admin configs
npx wrangler kv namespace create MODULUS_KV
```

Paste the returned `database_id` and KV `id` into `wrangler.jsonc`:

```jsonc
{
  "name": "modulus",
  "compatibility_date": "2026-01-01",
  "routes": [
    { "pattern": "modulus.josefyang.com", "custom_domain": true }
  ],
  "assets": {
    "not_found_handling": "single-page-application"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "modulus-db",
      "database_id": "PASTE_YOUR_D1_DATABASE_ID_HERE"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "MODULUS_KV",
      "id": "PASTE_YOUR_KV_NAMESPACE_ID_HERE"
    }
  ],
  "vars": {
    "DEV_MODE": "false",
    "SESSION_TTL_DAYS": "30",
    "SITE_URL": "https://modulus.josefyang.com"
  }
}
```

---

## 3. Apply Database Migrations

```bash
# Local development D1
npx wrangler d1 migrations apply modulus-db --local

# Production Cloudflare D1
npx wrangler d1 migrations apply modulus-db --remote
```

---

## 4. Local Development Environment

Create a `.dev.vars` file in the project root (**never commit `.dev.vars` to GitHub**):

```ini
# Logs 6-digit OTP codes directly to your terminal so you can sign in locally without sending emails
DEV_MODE=true

# Strong random secret for signing/hashing 30-day session cookies
JWT_SECRET=local-dev-super-secret-change-me-32chars

# Comma-separated emails granted Mission Control (/admin) access
ADMIN_EMAILS=your-email@example.com

# Optional locally (required for production Email OTP)
EMAIL_FROM=noreply@modulus.josefyang.com
EMAIL_API_KEY=
```

Start the unified local dev server (Frontend + Worker API + Local D1 + Local KV):

```bash
npm install
npm run dev
```

### Testing Auth, Sync & Admin Panel Locally
1. Open the local Vite URL (`http://localhost:5173`).
2. Click **Sign In**, enter your `ADMIN_EMAILS` address, and grab the 6-digit code printed in your terminal (`[DEV OTP] Code: 482910`).
3. Verify your 30-day session persists across refreshes and navigate to `/admin` to test the **Game-Theory Mission Control** sliders, SVG curve visualizers, and credit injector.

---

## 5. Production Email OTP & Custom Domain (`modulus.josefyang.com`)

1. **Custom Domain:** Because `wrangler.jsonc` includes `"custom_domain": true` for `modulus.josefyang.com`, Cloudflare automatically provisions the DNS record and SSL certificate on deploy.
2. **Email OTP Delivery (`noreply@modulus.josefyang.com`):**
   * Configure SPF/DKIM records for `josefyang.com` in Cloudflare DNS using either **Cloudflare Email Service** or a free-tier transactional API (e.g., Resend/Brevo) wired into `worker/auth/email.ts`.
3. **Upload Production Secrets:**
   ```bash
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put EMAIL_FROM
   npx wrangler secret put EMAIL_API_KEY
   ```

---

## 6. Build & Deploy

```bash
npm run build
npx wrangler deploy
```

### Pre-Launch & Free-Tier Verification Checklist
* [ ] `DEV_MODE` is `"false"` in `wrangler.jsonc`.
* [ ] Remote D1 migrations applied (`--remote`) and all lookup columns have SQL `INDEX`es.
* [ ] `MODULUS_KV` seeded with default `global_balance_config` (happens automatically on first `/admin` save or Worker fallback).
* [ ] `https://modulus.josefyang.com` loads with verified logo, favicon, `1200x630` OG banner, `robots.txt`, and `sitemap.xml`.
* [ ] Tested **Add to Home Screen** on both **iOS Safari** and **Android Chrome** (standalone mode, zero notch clipping, touch controls responsive, IndexedDB cold-restart works).
* [ ] Verified Email OTP login syncs garage builds & credits seamlessly between phone and desktop.
* [ ] Verified `/admin` returns `403 Forbidden` for non-admin accounts and loads Mission Control for `ADMIN_EMAILS`.