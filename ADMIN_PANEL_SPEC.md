# ADMIN_PANEL_SPEC.md — Modulus Mission Control

**Mission Control** (`/admin`) is the developer-only game-theory dashboard for **Modulus** (`https://modulus.josefyang.com`). It lets you live-tune global physics math biases, adjust economy payouts, inject currency/parts into player accounts, and update SEO branding globally in `<60s` without redeploying code.

---

## 1. Access Control & Security
* **Dual Server-Side Gate:** Every `/api/admin/*` route verifies:
  1. A valid 30-day `HttpOnly` JWT/session cookie (`modulus_session`).
  2. `user.email` is present in the Cloudflare Worker Secret `ADMIN_EMAILS` (comma-separated) **AND** `users.role === 'admin'` in D1.
* **Non-Admin Response:** Unauthorized requests return `403 Forbidden` (never leak admin routes or payloads).
* **Immutable Audit Trail:** Every mutating admin action writes a row to D1 `audit_logs (id, admin_email, action, target_user_id, payload_json, created_at)`.

---

## 2. `global_balance_config` JSON Schema (Cloudflare KV)

Stored in **`MODULUS_KV`** under key `global_balance_config` for sub-5ms edge reads (Free-Tier friendly). Every publish increments `version_id` and archives a full JSON snapshot in D1 `balance_snapshots`.

```json
{
  "version_id": "v1.0.0",
  "updated_at": "2026-11-23T00:00:00Z",
  "branding": {
    "site_name": "Modulus",
    "domain": "modulus.josefyang.com",
    "tagline": "Build the machine. Master the physics.",
    "meta_description": "A modular low-poly engineering racing simulator. Mix parts, balance mechanical trade-offs, and test your builds on a 120Hz physics engine."
  },
  "physics_bias": {
    "pacejka_grip_mult": 1.0,
    "aero_drag_mult": 1.0,
    "aero_downforce_mult": 1.0,
    "thermal_heat_soak_mult": 1.0,
    "weight_inertia_mult": 1.0,
    "turbo_lag_mult": 1.0
  },
  "economy_bias": {
    "payout_mult": 1.0,
    "part_price_mult": 1.0,
    "wear_cost_mult": 1.0,
    "starting_credits": 25000,
    "max_pwr_ratio_cap": 0.0
  }
}
```

### Integrity & Live Edge Injection
* **Leaderboard Partitioning (`balance_version_id`):** Every lap saved in D1 `lap_records` stores the active `balance_version_id`. Modifying any `physics_bias` multiplier bumps the version and automatically partitions leaderboards so altered-math runs never corrupt prior records.
* **Live SEO Branding:** The Worker's `HTMLRewriter` reads `branding.site_name`, `branding.tagline`, and `branding.meta_description` from `MODULUS_KV` and dynamically populates `<title>`, `<meta name="description">`, OpenGraph, and Twitter Card tags for `https://modulus.josefyang.com`.

---

## 3. KV / D1 Sync Endpoints (Hono Worker)

| Method & Route | Auth | Description |
| :--- | :--- | :--- |
| `GET /api/config/public` | Public | Returns active `global_balance_config` from `MODULUS_KV` (`Cache-Control: public, max-age=60`). |
| `GET /api/admin/config` | Admin | Returns active KV config + last 20 D1 `balance_snapshots`. |
| `PUT /api/admin/config` | Admin | Validates payload with Zod, writes to `MODULUS_KV`, inserts snapshot + audit log in D1. |
| `POST /api/admin/config/rollback/:version_id` | Admin | Restores target D1 snapshot to `MODULUS_KV` and logs audit entry. |
| `GET /api/admin/users?q=` | Admin | Indexed search by email/ID, returning credits, role, builds count, and inventory. |
| `POST /api/admin/users/:id/grant` | Admin | Add/set credits (`credits_delta` or `credits_exact`) or grant/revoke `part_id`s (or `unlock_all: true`). |
| `DELETE /api/admin/leaderboards/:record_id` | Admin | Remove invalid/cheated lap records from D1. |

---

## 4. Mission Control UI Layout (`/admin`)

Designed with a top-notch high-contrast dark telemetry aesthetic (`#0A0C10` canvas, `#12161F` cards, `#1E2532` borders, `#00F0FF` active accents, `#F59E0B` staged-change highlights, `#FF3B30` destructive/warning states). Fully responsive on desktop and mobile.

1. **Tab 1 — Physics & Math Biases (Game Theory Lab):**
   * Precision sliders (`0.50x`–`2.00x`, step `0.01`) for all 6 `physics_bias` multipliers.
   * **Real-Time SVG Curve Visualizers:** Dragging sliders bends the live **Pacejka Slip-Angle Grip Curve** and **Aero Drag-vs-Downforce Speed Curve** in real time before publishing.
2. **Tab 2 — Economy & User Directory:**
   * Sliders for `payout_mult`, `part_price_mult`, `wear_cost_mult`, `starting_credits`, and optional `max_pwr_ratio_cap`.
   * Live user search table with inline **Inject Credits**, **Grant/Revoke Parts**, and **1-Click Unlock All (Admin Sandbox)** controls.
3. **Tab 3 — Branding & SEO (`modulus.josefyang.com`):**
   * Live text inputs for `site_name`, `tagline`, and `meta_description`.
   * **Instant Social Card Preview:** Renders a live mock of how `https://modulus.josefyang.com` will appear on Discord, X/Twitter, and iMessage using the verified `1200x630` OG banner.
4. **Tab 4 — Publish, Diff & Rollback:**
   * Side-by-side **JSON Diff Preview** highlighting exact staged changes.
   * **Publish to Edge (KV)** button (with confirmation if `physics_bias` changed and will partition leaderboards).
   * **Snapshot History:** 1-click **Rollback** list from D1 `balance_snapshots` + recent `audit_logs` feed.