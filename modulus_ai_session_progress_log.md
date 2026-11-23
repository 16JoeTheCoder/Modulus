# MODULUS — Engineering & AI Memory Log

> **CRITICAL RULE FOR ARGON & HYDROGEN:** Read this file at the start of every session and append a concise entry before ending any task. Never assume a module is finished unless marked `[DONE]` below.

---

## 1. Project Snapshot
* **Domain:** `https://modulus.josefyang.com` (Repo: `16JoeTheCoder/Modulus`)
* **Current Phase:** `Phase 0 — Architecture & Repo Initialization`
* **Active Stack:** Vite + `@cloudflare/vite-plugin` | Three.js | Rapier3D WASM | React 19 + Tailwind | Hono | Cloudflare D1 + Workers KV (Free-Tier Optimized)
* **Platform:** Cross-Platform Installable PWA (iOS Safari, Android Chrome, Desktop)
* **Auth & Sync:** 30-Day Email 6-Digit OTP (`noreply@modulus.josefyang.com`, `DEV_MODE` local fallback) + IndexedDB cold-start mirror
* **Visual Mode:** Dual-Tone (Sunlit *Art of Rally* Low-Poly Track + Dark High-Tech Engineering Lab)

---

## 2. Locked Contracts (DO NOT BREAK)
*All Hydrogen workers must code strictly against these contracts. Any change requires Argon sign-off and a version bump here.*
- [ ] `src/core/types/plugin.ts` (`IModulusPlugin`, `IEngineContext`)
- [ ] `src/core/types/vehicle.ts` (`ICompiledVehicle`, `IVehicleRuntimeState`, `IInputState`)
- [ ] `src/core/types/content.ts` (`IChassisSchema`, `IPartSchema`, `ITrackSplineSchema`)
- [ ] `src/core/types/balance.ts` (`IGlobalBalanceConfig` matching `ADMIN_PANEL_SPEC.md`)
- [ ] `migrations/0001_initial.sql` (Indexed D1 Schema: Users, OTP, 30d Sessions, Inventory, Builds, Laps w/ `balance_version_id`, Snapshots, Audit Logs)

---

## 3. Module Status Board

### Core & Infrastructure (Argon)
| Module | Owner | Status | Notes |
| :--- | :--- | :--- | :--- |
| Repo Scaffold & `wrangler.jsonc` | Argon | `[TODO]` | Vite + Cloudflare plugin + D1 + `MODULUS_KV` + custom domain |
| `src/core` (Loop, Bus, Registry, Sync) | Argon | `[TODO]` | 120Hz fixed-timestep + IndexedDB cold-start mirror |
| `src/content` Starter JSONs | Argon | `[TODO]` | 2 Chassis, starter parts for all 8 modules, 2 3D tracks |
| D1 Migrations (`0001_initial.sql`) | Argon | `[TODO]` | Full indexes on all lookup columns (Free-Tier efficiency) |

### Pluggable Game Systems & UI (Hydrogen Workers)
| Plugin / Feature | Worker | Status | Notes |
| :--- | :--- | :--- | :--- |
| `physics-rapier` | H-1 | `[TODO]` | Rapier3D WASM world, trimesh track, raycasts |
| `vehicle-solver` | H-1 | `[TODO]` | Suspension, weight transfer, Pacejka tires + live `physics_bias` |
| `powertrain` | H-1 | `[TODO]` | Torque curves, turbo boost/lag, gearbox, LSD |
| `aerodynamics` | H-1 | `[TODO]` | Splitter, diffuser ride-height stall, wing AoA |
| `thermals` | H-1 | `[TODO]` | Engine/tire/brake temp curves + fade/wear |
| `track-generator` | H-2 | `[TODO]` | Banked 3D Catmull-Rom splines + instanced low-poly props |
| `car-assembler` | H-2 | `[TODO]` | Procedural low-poly hardpoint car + Dark Lab CG/aero vectors |
| `fx-renderer` | H-2 | `[TODO]` | Sunlit/Lab lighting swap, skidmarks, smoke, single WebGL ctx |
| Verified Brand, PWA & SEO Assets | H-2 | `[TODO]` | `manifest.json`, `sw.js`, logos, favicons, `1200x630` OG banner |
| `worker` Auth, Economy & Edge SEO | H-3 | `[TODO]` | 30d Email OTP, batched D1 sync, `HTMLRewriter` dynamic SEO |
| `/admin` Mission Control Panel | H-3 | `[TODO]` | KV/D1 math-bias sliders, SVG curves, branding, diff/rollback |
| Engineering Lab UI + Dyno | H-4 | `[TODO]` | 8-module customizer, sliders, dyno graph, spider chart, warnings |
| Drive HUD + `input-keyboard` | H-4 | `[TODO]` | Speed-sensitive WASD + counter-steer assist + live telemetry |
| `input-touch` (Mobile PWA HUD) | H-4 | `[TODO]` | `pointer: coarse`, safe-area insets, `{ passive: false }` controls |
| `ai-test-driver` | H-4 | `[TODO]` | Physical Pure Pursuit + spline braking AI driver |

---

## 4. Known Issues & Technical Debt
* *(None yet — log bugs, mobile Safari quirks, physics instabilities, or FPS regressions here immediately.)*

---

## 5. Chronological Session Handoff Log

### [2026-11-23] — Session 0: Master Blueprints Synchronized
* **Completed:** Finalized all 5 synchronized blueprints (`ARCHITECTURE.md`, `CUSTOMIZATION_SPEC.md`, `ADMIN_PANEL_SPEC.md`, `SETUP.md`, `LOG.md`) covering `modulus.josefyang.com`, 120Hz decoupled physics, 8-module customization, KV/D1 Game-Theory `/admin` panel, installable iOS/Android/Desktop PWA rules, Cloudflare Free-Tier efficiency, and verified SEO/brand assets.
* **Next Immediate Action:** User pushes all 5 `.md` files to `16JoeTheCoder/Modulus`, installs the skills in `SETUP.md`, and pastes the **Argon Master Prompt** (`ARCHITECTURE.md` Section 7) into Antigravity to start Phase 0.