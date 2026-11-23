# MODULUS — Engineering & AI Memory Log

> **CRITICAL RULE FOR LEAD ARCHITECT & SWARM WORKERS:** Read this file at the start of every session and append a concise entry before ending any task. Never assume a module is finished unless marked `[DONE]` below.

---

## 1. Project Snapshot
* **Domain:** `https://modulus.josefyang.com` (Repo: `16JoeTheCoder/Modulus`)
* **Current Phase:** `Phase 1 — Parallel Swarm Execution (4 Isolated Git Worktrees)`
* **Active Stack:** Vite 6 + `@cloudflare/vite-plugin` | Three.js | `@dimforge/rapier3d-compat` WASM | React 19 + Tailwind v4 | Hono | Cloudflare D1 + Workers KV (Free-Tier Optimized)
* **Platform:** Cross-Platform Installable PWA (iOS Safari, Android Chrome, Desktop)
* **Auth & Sync:** 30-Day Email 6-Digit OTP (`noreply@modulus.josefyang.com`, `DEV_MODE` local fallback) + IndexedDB cold-start mirror
* **Visual Mode:** Dual-Tone (Sunlit *Art of Rally* Low-Poly Track + Dark High-Tech Engineering Lab)

---

## 2. Locked Contracts (DO NOT BREAK)
*All Swarm workers must code strictly against these contracts. Any change requires Lead Architect sign-off and a version bump here.*
- [x] `src/core/types/plugin.ts` (`IModulusPlugin`, `IEngineContext`, `ITrackGeometryData`, `EngineEventMap`) — **LOCKED v1.0**
- [x] `src/core/types/vehicle.ts` (`ICompiledVehicle`, `IVehicleBuildConfig`, `IVehicleRuntimeState`, `IInputState`) — **LOCKED v1.0**
- [x] `src/core/types/content.ts` (`IChassisSchema`, `IPartSchema`, `ITrackSplineSchema`) — **LOCKED v1.0**
- [x] `src/core/types/balance.ts` (`IGlobalBalanceConfig`, `DEFAULT_BALANCE_CONFIG` matching `ADMIN_PANEL_SPEC.md`) — **LOCKED v1.0**
- [x] `src/core/types/api.ts` (Zod-validated Auth, Garage, Shop, Leaderboard, and Admin payloads) — **LOCKED v1.0**
- [x] `migrations/0001_initial.sql` (Indexed D1 Schema: Users, OTP, 30d Sessions, Inventory, Builds, Laps w/ `balance_version_id`, Snapshots, Audit Logs) — **LOCKED & VERIFIED ON LOCAL D1**

---

## 3. Module Status Board

### Core & Infrastructure (Lead Architect — Gemini 4 Carbon)
| Module | Owner | Status | Notes |
| :--- | :--- | :--- | :--- |
| Repo Scaffold & `wrangler.jsonc` | Carbon | `[DONE]` | Vite 6 + `@cloudflare/vite-plugin` + D1 + `MODULUS_KV` + `modulus.josefyang.com` |
| `src/core` (Loop, Bus, Registry, Sync, Math) | Carbon | `[DONE]` | 120Hz fixed-timestep, Pacejka, 3D banked Catmull-Rom spline, VehicleCompiler, IndexedDB StorageSync |
| `src/content` Starter JSONs | Carbon | `[DONE]` | 3 Chassis, 46 parts across all 8 modules, 3 banked 3D tracks (`gp_circuit`, `mountain_pass`, `oval_test`) |
| D1 Migrations (`0001_initial.sql`) | Carbon | `[DONE]` | 27 statements + full lookup column indexes applied cleanly via Wrangler local D1 |

### Pluggable Game Systems & UI (Gemini 4 Neon Swarm Workers)
| Plugin / Feature | Worker | Status | Notes |
| :--- | :--- | :--- | :--- |
| `physics-rapier` | `physics` (Neon High) | `[IN PROGRESS]` | Rapier3D WASM world, trimesh track + wall colliders, 4-corner raycasts |
| `vehicle-solver` | `physics` (Neon High) | `[IN PROGRESS]` | Suspension, weight transfer, Pacejka tires + live `physics_bias` |
| `powertrain` | `physics` (Neon High) | `[IN PROGRESS]` | Torque curves, turbo boost/lag, gearbox shifts, LSD |
| `aerodynamics` | `physics` (Neon High) | `[IN PROGRESS]` | Splitter, diffuser ride-height stall, wing AoA |
| `thermals` | `physics` (Neon High) | `[IN PROGRESS]` | Engine/tire/brake temp curves + fade/wear |
| `track-generator` | `visuals-pwa` (Neon High) | `[IN PROGRESS]` | Banked 3D Catmull-Rom splines + instanced low-poly props |
| `car-assembler` | `visuals-pwa` (Neon High) | `[IN PROGRESS]` | Procedural low-poly hardpoint car + Dark Lab CG/aero vectors |
| `fx-renderer` | `visuals-pwa` (Neon High) | `[IN PROGRESS]` | Sunlit/Lab lighting swap, skidmarks, smoke, chase/orbit camera |
| Verified Brand, PWA & SEO Assets | `visuals-pwa` (Neon High) | `[IN PROGRESS]` | `manifest.json`, `sw.js`, `robots.txt`, `sitemap.xml`, logos, favicons, `1200x630` OG banner |
| `worker` Auth, Economy & Edge SEO | `backend-admin` (Neon Med) | `[IN PROGRESS]` | 30d Email OTP, batched D1 sync, `HTMLRewriter` dynamic SEO |
| `/admin` Mission Control + Auth Modal | `backend-admin` (Neon Med) | `[IN PROGRESS]` | KV/D1 math-bias sliders, SVG curves, branding, user grants, diff/rollback |
| Engineering Lab UI + Dyno | `lab-hud-ai` (Neon Med) | `[IN PROGRESS]` | 8-module customizer, sliders, dyno graph, spider chart, warnings |
| Drive HUD + `input-keyboard` | `lab-hud-ai` (Neon Med) | `[IN PROGRESS]` | Speed-sensitive WASD + counter-steer assist + live telemetry |
| `input-touch` (Mobile PWA HUD) | `lab-hud-ai` (Neon Med) | `[IN PROGRESS]` | `pointer: coarse`, safe-area insets, `{ passive: false }` controls |
| `ai-test-driver` | `lab-hud-ai` (Neon Med) | `[IN PROGRESS]` | Physical Pure Pursuit + spline braking AI driver |

---

## 4. Known Issues & Technical Debt
* *(None yet — log bugs, mobile Safari quirks, physics instabilities, or FPS regressions here immediately.)*

---

## 5. Chronological Session Handoff Log

### [2026-11-23] — Session 0: Master Blueprints Synchronized
* **Completed:** Finalized all 5 synchronized blueprints (`ARCHITECTURE.md`, `CUSTOMIZATION_SPEC.md`, `ADMIN_PANEL_SPEC.md`, `SETUP.md`, `LOG.md`).

### [2026-11-24] — Session 1 (Phase 0): Core Architecture, Locked Contracts & D1 Scaffold
* **Completed (Lead Architect — Gemini 4 Carbon):**
  1. Canonicalized the 5 master spec blueprints (`ARCHITECTURE.md`, `CUSTOMIZATION_SPEC.md`, `ADMIN_PANEL_SPEC.md`, `SETUP.md`, `LOG.md`).
  2. Scaffolded Vite 6 + `@cloudflare/vite-plugin` + React 19 + Tailwind CSS v4 + Three.js + `@dimforge/rapier3d-compat` + Hono + Zod + `wrangler.jsonc`.
  3. Authored and locked all TypeScript contracts in `/src/core/types/`, deterministic math modules (`prng.ts`, `pacejka.ts`, `spline.ts`, `vehicleCompiler.ts`), `EventBus.ts`, `PluginRegistry.ts`, `StorageSync.ts` (IndexedDB + batched D1), and 120Hz decoupled `Engine.ts` with single persistent WebGL context (`pixelRatio <= 2`).
  4. Authored `/migrations/0001_initial.sql` with full indexes on all lookup columns and verified migration execution on local D1 (27 statements succeeded).
  5. Created baseline `/src/content` catalogs (3 chassis, 46 modular parts across 8 categories, 3 banked 3D tracks) and verified `npm run build` passes cleanly for both SSR Worker and Client bundles.
* **Next Immediate Action:** Commit Phase 0 lock to `main` and dispatch the 4 isolated parallel Gemini 4 Neon swarm workers in Git worktrees (`workspace: "share"`).
