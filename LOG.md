# MODULUS — Engineering & AI Memory Log

> **CRITICAL RULE FOR LEAD ARCHITECT & SWARM WORKERS:** Read this file at the start of every session and append a concise entry before ending any task. Never assume a module is finished unless marked `[DONE]` below.

---

## 1. Project Snapshot
* **Domain:** `https://modulus.josefyang.com` (Repo: `16JoeTheCoder/Modulus`)
* **Current Phase:** `Phase 2 Complete — Integrated & Adversarially Verified`
* **Active Stack:** Vite 6 + `@cloudflare/vite-plugin` | Three.js | `@dimforge/rapier3d-compat` WASM | React 19 + Tailwind v4 | Hono | Cloudflare D1 + Workers KV (Free-Tier Optimized)
* **Platform:** Cross-Platform Installable PWA (iOS Safari, Android Chrome, Desktop)
* **Auth & Sync:** 30-Day Email 6-Digit OTP (`noreply@modulus.josefyang.com`, `DEV_MODE` local fallback) + IndexedDB cold-start mirror
* **Visual Mode:** Dual-Tone (Sunlit *Art of Rally* Low-Poly Track + Dark High-Tech Engineering Lab)

---

## 2. Locked Contracts (DO NOT BREAK)
*All Swarm workers coded strictly against these contracts with zero unauthorized modifications.*
- [x] `src/core/types/plugin.ts` (`IModulusPlugin`, `IEngineContext`, `ITrackGeometryData`, `EngineEventMap`) — **LOCKED v1.0**
- [x] `src/core/types/vehicle.ts` (`ICompiledVehicle`, `IVehicleBuildConfig`, `IVehicleRuntimeState`, `IInputState`) — **LOCKED v1.0**
- [x] `src/core/types/content.ts` (`IChassisSchema`, `IPartSchema`, `ITrackSplineSchema`) — **LOCKED v1.0**
- [x] `src/core/types/balance.ts` (`IGlobalBalanceConfig`, `DEFAULT_BALANCE_CONFIG` matching `ADMIN_PANEL_SPEC.md`) — **LOCKED v1.0**
- [x] `src/core/types/api.ts` (Zod-validated Auth, Garage, Shop, Leaderboard, and Admin payloads) — **LOCKED v1.0**
- [x] `migrations/0001_initial.sql` (Indexed D1 Schema: Users, OTP, 30d Sessions, Inventory, Builds, Laps w/ `balance_version_id`, Snapshots, Audit Logs) — **LOCKED & VERIFIED**

---

## 3. Module Status Board

### Core & Infrastructure (Lead Architect — Gemini 4 Carbon)
| Module | Owner | Status | Notes |
| :--- | :--- | :--- | :--- |
| Repo Scaffold & `wrangler.jsonc` | Carbon | `[DONE]` | Vite 6 + `@cloudflare/vite-plugin` + D1 + `MODULUS_KV` + `modulus.josefyang.com` |
| `src/core` (Loop, Bus, Registry, Sync, Math) | Carbon | `[DONE]` | 120Hz fixed-timestep, Pacejka, 3D banked Catmull-Rom spline, VehicleCompiler, IndexedDB StorageSync |
| `src/content` Starter JSONs | Carbon | `[DONE]` | 3 Chassis, 46 parts across all 8 modules, 3 banked 3D tracks (`gp_circuit`, `mountain_pass`, `oval_test`) |
| D1 Migrations (`0001_initial.sql`) | Carbon | `[DONE]` | 27 statements + full lookup column indexes applied & verified locally |

### Pluggable Game Systems & UI (Gemini 4 Neon Swarm Workers)
| Plugin / Feature | Worker | Status | Notes |
| :--- | :--- | :--- | :--- |
| `physics-rapier` | `physics` (Neon High) | `[DONE]` | 120Hz Rapier3D WASM world, trimesh road + wall colliders, 4-corner chassis-filtered raycasts (`ad145c9`) |
| `vehicle-solver` | `physics` (Neon High) | `[DONE]` | Springs, asymmetric dampers, ARBs, weight transfer, Ackermann, Pacejka + live `physics_bias` (`ad145c9`) |
| `powertrain` | `physics` (Neon High) | `[DONE]` | Dyno interpolation, turbo spool/lag, clutch/gearbox shifts, Open/Torsen/LSD vectoring, fuel burn (`ad145c9`) |
| `aerodynamics` | `physics` (Neon High) | `[DONE]` | Splitter/wing AoA downforce, 3D drag, live rear ride-height Venturi diffuser stall (`ad145c9`) |
| `thermals` | `physics` (Neon High) | `[DONE]` | Engine coolant limp/blown thresholds, Carbon-Ceramic cold bite & brake fade, tire temp/wear (`ad145c9`) |
| `track-generator` | `visuals-pwa` (Neon High) | `[DONE]` | 480-sample banked 3D splines, kerbs, Armco barriers, gantries, `InstancedMesh` props (`0a582ef`) |
| `car-assembler` | `visuals-pwa` (Neon High) | `[DONE]` | Procedural low-poly silhouettes, roll cage, hardpoints, thermal rotor glow + Dark Lab overlays (`0a582ef`) |
| `fx-renderer` | `visuals-pwa` (Neon High) | `[DONE]` | Sunlit/Dark Studio lighting swap, Orbit/Chase/Hood cameras, skidmarks, smoke, shift backfire (`0a582ef`) |
| Verified Brand, PWA & SEO Assets | `visuals-pwa` (Neon High) | `[DONE]` | `manifest.json`, `sw.js`, `robots.txt`, `sitemap.xml`, `logo.svg`, 32/180/192/512 PNGs, `1200x630` `og-banner.png` (`0a582ef`) |
| `worker` Auth, Economy & Edge SEO | `backend-admin` (Neon Med) | `[DONE]` | 30d Email OTP (`DEV_MODE` fallback), batched D1 shop/builds/laps, `HTMLRewriter` dynamic SEO (`9f4973e`) |
| `/admin` Mission Control + Auth Modal | `backend-admin` (Neon Med) | `[DONE]` | Dual-gate `/api/admin/*`, SVG Pacejka/Aero curves, user grants, social previews, JSON diff & rollback (`9f4973e`) |
| Engineering Lab UI + Dyno | `lab-hud-ai` (Neon Med) | `[DONE]` | 8-module customizer, Spider-Balance SVG, Virtual Dyno SVG, warnings, circuit/leaderboard modal (`70cde34`) |
| Drive HUD + `input-keyboard` | `lab-hud-ai` (Neon Med) | `[DONE]` | Speed-sensitive WASD + counter-steer assist + 30Hz rAF telemetry HUD (`70cde34`) |
| `input-touch` (Mobile PWA HUD) | `lab-hud-ai` (Neon Med) | `[DONE]` | `pointer: coarse` auto-activation, safe-area insets, `{ passive: false }` canvas zones (`70cde34`) |
| `ai-test-driver` | `lab-hud-ai` (Neon Med) | `[DONE]` | Physical Pure Pursuit steering + 8-sample forward curvature braking AI (`70cde34`) |

---

## 4. Known Issues & Technical Debt
* **Production Secrets Provisioning:** Before running `npx wrangler deploy` to `https://modulus.josefyang.com`, replace placeholder IDs in `wrangler.jsonc` with provisioned `modulus-db` D1 `database_id` and `MODULUS_KV` namespace `id`, apply `--remote` D1 migrations, and upload `JWT_SECRET`, `ADMIN_EMAILS`, `EMAIL_FROM`, and `EMAIL_API_KEY` via `npx wrangler secret put` per `SETUP.md`.

---

## 5. Chronological Session Handoff Log

### [2026-11-23] — Session 0: Master Blueprints Synchronized
* **Completed:** Finalized all 5 synchronized blueprints (`ARCHITECTURE.md`, `CUSTOMIZATION_SPEC.md`, `ADMIN_PANEL_SPEC.md`, `SETUP.md`, `LOG.md`).

### [2026-11-24] — Session 1 (Phase 0): Core Architecture, Locked Contracts & D1 Scaffold
* **Completed (Lead Architect — Gemini 4 Carbon):**
  1. Canonicalized spec blueprints, scaffolded Vite 6 + `@cloudflare/vite-plugin` + React 19 + Tailwind v4 + Three.js + `@dimforge/rapier3d-compat` + Hono + Zod + `wrangler.jsonc`.
  2. Locked `/src/core/types/*`, `/src/core/math/*`, `EventBus.ts`, `PluginRegistry.ts`, `StorageSync.ts`, `Engine.ts`, `/migrations/0001_initial.sql`, and `/src/content/*` (`0fd5657`).

### [2026-11-24] — Session 1 (Phase 1 & Phase 2): Parallel Neon Swarm Execution & Adversarial Verification
* **Completed (4 Isolated Git Worktree Swarm Workers + Lead Architect Adversarial Verification):**
  1. Merged all 4 parallel Gemini 4 Neon branches (`ad145c9`, `0a582ef`, `9f4973e`, `70cde34`) into `main` with **zero merge conflicts** and **zero modifications** to locked Phase 0 contracts.
  2. Verified `npm run typecheck` (`tsc --noEmit`) and `npm run build` (`tsc -b && vite build` for both Cloudflare Worker SSR `dist/modulus/index.js` and Client `dist/client/`) pass with **0 errors**.
  3. Audited all 11 plugins under `src/plugins/*`: **0 cross-plugin or plugin-to-UI imports**.
  4. Visually inspected and byte-verified IHDR headers on all generated brand/PWA/SEO assets (`favicon-32x32.png` 32x32, `apple-touch-icon.png` 180x180, `icon-192x192.png` 192x192, `icon-512x512.png` 512x512, `og-banner.png` 1200x630, `logo.svg`, `manifest.json`, `sw.js`, `robots.txt`, `sitemap.xml`).
  5. Executed live Cloudflare `workerd` end-to-end API suite: verified `Cache-Control: public, max-age=60` on `/api/config/public`, 6-digit Email OTP + 30-day `HttpOnly` cookie, `403 Forbidden` non-admin gate vs `200 OK` Dual-Gate `/api/admin/config`, atomic D1 shop & lap credit transactions, automatic `version_id` bump + leaderboard partitioning on `physics_bias` publish, live `HTMLRewriter` `<title>` injection on `GET /`, and 1-click snapshot rollback.
  6. Executed 1,200-step (10s @ 120Hz) cross-worker simulation test (`track-generator` + `physics-rapier` + `powertrain` + `aerodynamics` + `vehicle-solver` + `thermals` + `ai-test-driver`): verified 7,680-triangle banked trimesh, smooth gear shifts to 3rd gear (`111.6 km/h`), `898 N` downforce, realistic engine/tire/brake heating & fuel burn, and `0.2m` lateral tracking precision.
* **Next Immediate Action:** Ready for local interactive playtesting (`npm run dev`) and Cloudflare production provisioning/deployment (`SETUP.md`).
