# MODULUS: System Architecture & Orchestration Blueprint

**Modulus** (`https://modulus.josefyang.com`) is a deterministic, plugin-driven 3D engineering racing simulator and installable Progressive Web App (PWA) running 100% on the **Cloudflare Free-Tier Edge Stack** (Workers Static Assets, Hono API, D1, Workers KV, and 30-Day Email OTP Auth). It pairs an *Art of Rally*-inspired sunlit low-poly track aesthetic with a high-tech dark motorsport Engineering Lab.

---

## 1. Tech Stack & Visual Architecture

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Bundler & Runtime** | Vite + `@cloudflare/vite-plugin` | Unified local `workerd` runtime for Frontend Static Assets, Hono API, D1 SQLite, and KV. |
| **3D Engine** | Vanilla **Three.js** (Imperative) | Zero React reconciliation overhead inside the render loop. Locks 120+ FPS on desktop and 60 FPS on mobile. |
| **Physics Engine** | **Rapier3D (WASM)** + Custom 120Hz TS Solver | Deterministic rigid-body + trimesh track collision; custom Pacejka tire, raycast suspension, weight transfer, and thermal solver layered on top. 100% client-side. |
| **UI / Garage / HUD** | **React 19 + Tailwind CSS** | Motorsport telemetry graphs, garage sliders, mobile touch HUD, and `/admin` Mission Control mounted as a lightweight overlay. |
| **PWA & Offline** | Web Manifest + Service Worker + IndexedDB | Installable on iOS Safari, Android Chrome, and Desktop. Zero-latency cold restarts and cross-device email sync. |
| **Backend API** | **Hono** on Cloudflare Workers | Ultra-lightweight routing, dynamic edge SEO injection, 30-day JWT/Cookie middleware, D1 economy, and `/api/admin/*`. |
| **Database & Edge Config** | **Cloudflare D1** + **Workers KV** | D1 stores users, OTPs, 30-day sessions, inventory, builds, laps, and audit logs. KV caches `global_balance_config` globally in `<5ms`. |
| **Authentication** | **Email 6-Digit OTP + 30-Day Cookie** | Zero Google Cloud dependency. Cross-device cloud sync tied to email (`noreply@modulus.josefyang.com`). |

### Dual-Aesthetic Lighting Pipeline
* **Track Mode (Sunlit Stylized Motorsport):** Warm directional sun, soft hemisphere sky bounce, flat-shaded low-poly faceted geometry, vertex-colored kerbs/tarmac/grass, GPU `InstancedMesh` props, subtle bloom, dynamic skidmarks, and tire smoke particles.
* **Engineering Lab Mode (High-Tech Dark Bay):** Instant lighting rig swap to matte obsidian studio floor (`#0A0C10`), overhead LED strip reflections, cyan/amber rim lighting, toggleable **X-Ray Wireframe**, glowing **CG Sphere**, and live **Aero Vector Arrows**.

---

## 2. True Plug-and-Play Modularity (Plugin Bus)

No gameplay feature is allowed to hard-couple to another feature. Every system registers with `ModulusCore` via strict interfaces. Adding or removing a feature (e.g., plugging in Cloudflare Durable Objects multiplayer later or toggling Thermals) requires **zero core edits**—just registering/unplugging its folder in `src/plugins/registry.ts`.

```text
modulus/
├── public/                      # Verified Brand, PWA & SEO Assets
│   ├── manifest.json            # Installable PWA manifest
│   ├── sw.js                    # Service Worker (Static + WASM caching)
│   ├── robots.txt               # SEO crawler directives
│   ├── sitemap.xml              # Canonical sitemap for modulus.josefyang.com
│   └── assets/                  # Verified SVG/PNG logos, favicons, apple-touch-icon, 1200x630 OG banner
│
├── src/
│   ├── core/                    # IMMUTABLE ENGINE CORE (Argon Owned)
│   │   ├── Engine.ts            # 120Hz fixed-timestep accumulator + render interpolation
│   │   ├── EventBus.ts          # Typed pub/sub ('car:rebuilt', 'lap:finished', 'config:updated')
│   │   ├── PluginRegistry.ts    # Registers & executes plugins by lifecycle phase
│   │   ├── StorageSync.ts       # IndexedDB mirror + batched Email-Auth D1 sync
│   │   ├── types/               # LOCKED CONTRACTS (IModulusPlugin, IPartSchema, IGlobalBalanceConfig)
│   │   └── math/                # Deterministic PRNG, Pacejka helpers, Spline math
│   │
│   ├── plugins/                 # PLUG-AND-PLAY FEATURE MODULES (Hydrogen Owned)
│   │   ├── registry.ts          # Single manifest toggling active plugins
│   │   ├── physics-rapier/      # Rapier3D WASM world, trimesh colliders, raycasts
│   │   ├── vehicle-solver/      # Suspension, weight transfer, Pacejka tires, brakes (reads physics_bias)
│   │   ├── powertrain/          # Engine torque curve, turbo lag, gearbox, LSD
│   │   ├── aerodynamics/        # Downforce, drag, ride-height diffuser stall
│   │   ├── thermals/            # Engine, tire, and brake temperature + wear/fade
│   │   ├── input-keyboard/      # Speed-sensitive WASD steering + counter-steer assist
│   │   ├── input-touch/         # Mobile touch controls (pointer: coarse) outputting IInputState
│   │   ├── ai-test-driver/      # Physical Pure Pursuit steering + spline curvature braking AI
│   │   ├── track-generator/     # Procedural banked 3D Catmull-Rom spline track builder
│   │   ├── car-assembler/       # Procedural low-poly hardpoint mesh snapper + Lab overlays
│   │   └── fx-renderer/         # Tire smoke, skidmarks, brake glow, chase/orbit camera rig
│   │
│   ├── content/                 # PURE JSON DATA (Zero-code content expansion)
│   │   ├── chassis/             # e.g., apex_fr.json, stratos_mr.json
│   │   ├── parts/               # engines.json, tires.json, aero.json, suspension.json...
│   │   └── tracks/              # mountain_pass.json, gp_circuit.json, oval_test.json
│   │
│   └── ui/                      # REACT OVERLAY (Mounted over Canvas)
│       ├── lab/                 # Engineering Lab, 8-Module Customizer, Dyno, Spider Chart
│       ├── hud/                 # Live Speedo, Tach, Tire Temps, G-Force, Lap Delta
│       ├── auth/                # Email + 6-Digit OTP Modal + Cloud Sync indicator
│       └── admin/               # Mission Control Game-Theory Panel (/admin)
│
├── worker/                      # CLOUDFLARE WORKER BACKEND (Hono + D1 + KV)
│   ├── index.ts                 # Main Worker entry + Dynamic Edge SEO HTMLRewriter
│   ├── auth/                    # Email OTP generation, verification, 30-day session cookie
│   ├── routes/                  # /api/config, /api/garage, /api/shop, /api/laps, /api/admin
│   └── db/                      # Indexed D1 query helpers
│
├── migrations/                  # D1 SQLite Migrations
│   └── 0001_initial.sql
├── ARCHITECTURE.md
├── CUSTOMIZATION_SPEC.md
├── ADMIN_PANEL_SPEC.md
├── LOG.md
├── SETUP.md
└── wrangler.jsonc
```

---

## 3. Core Plugin Interfaces (Locked Contracts)

```typescript
export interface IModulusPlugin {
  readonly id: string;
  readonly version: string;
  readonly priority: number; // Execution order in 120Hz loop
  init(ctx: IEngineContext): Promise<void> | void;
  onBalanceConfigUpdated?(config: IGlobalBalanceConfig): void;
  onBuildCompiled?(vehicle: ICompiledVehicle): void;
  onPhysicsStep?(dt: number, state: IVehicleRuntimeState, input: IInputState): void;
  onRender?(alpha: number, state: IVehicleRuntimeState): void;
  dispose?(): void;
}
```

---

## 4. Mobile PWA & Bug-Free Cross-Platform Rules

Modulus must run with zero layout, touch, or memory bugs on **iOS Safari**, **Android Chrome**, and **Desktop**:
1. **Installable PWA:** Ship `manifest.json` (`display: "standalone"`, `theme_color: "#0A0C10"`) plus Apple meta tags (`apple-mobile-web-app-capable="yes"`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `apple-touch-icon`).
2. **Viewport & Safe Areas:** Lock root containers to `100dvh` (never `100vh`), apply `touch-action: none` and `overscroll-behavior: none` on the canvas, and respect `env(safe-area-inset-top/bottom/left/right)` with a minimum `20px` top buffer for notches/Dynamic Islands.
3. **Single Persistent WebGL Context:** Debounce resize/orientation events and update camera aspect + `renderer.setSize()` only. **Never** destroy or recreate the WebGL context on orientation change (prevents iOS WebKit memory leaks). Cap `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.
4. **Touch Controls (`input-touch`):** Auto-activate on `pointer: coarse` devices. Compute touch coordinates via `canvas.getBoundingClientRect()` with `{ passive: false }` `preventDefault()` listeners to stop accidental Safari edge-swipes and pinch-zooming.
5. **iOS Cold-Start Recovery:** Continuously mirror active garage/tune state to `IndexedDB` so backgrounded iOS PWAs restore instantly on relaunch, then reconcile with D1 via the 30-day Email OTP session.

---

## 5. Cloudflare Free-Tier Efficiency Architecture

Designed to stay comfortably inside Cloudflare's Free Tier (100k Worker req/day, 5M D1 row reads & 100k writes/day, 100k KV reads & 1k writes/day) without sacrificing 120Hz performance:
* **Zero-Cost Asset Delivery:** Serve the entire Vite bundle, Rapier3D WASM, and `/src/content` JSONs via **Workers Static Assets** + Service Worker cache (0 Worker invocations or D1 hits per load).
* **100% Client-Side Simulation:** All 120Hz physics, Pacejka tire math, virtual dyno curves, and AI test-driver laps run locally in the browser.
* **Batched D1 Writes:** Sync to D1 **only** on explicit mutations (`Save Build`, `Buy Part`, `Finish Lap`). Never poll D1 on timers.
* **Indexed D1 Queries:** Every lookup column (`users.email`, `sessions.token_hash`, `inventory.user_id`, `builds.user_id`, `lap_records.track_id + balance_version_id`) MUST have a SQL `INDEX` to prevent full-table scans.
* **Edge-Cached Balance Config:** Read `global_balance_config` from `MODULUS_KV` with a `Cache-Control: public, max-age=60` header so thousands of players share a single cached edge response.

---

## 6. SEO, Dynamic Branding & Asset Verification

* **Dynamic Edge SEO:** The Cloudflare Worker reads `branding` (`site_name`, `tagline`, `meta_description`) from `MODULUS_KV` and injects `<title>`, `<meta name="description">`, OpenGraph, Twitter Card, JSON-LD `VideoGame` schema, and canonical `https://modulus.josefyang.com` tags into HTML responses via `HTMLRewriter`.
* **Verified Assets:** All logos, favicons (`32x32`, `192x192`, `512x512`), `apple-touch-icon.png` (`180x180`), and the `1200x630` OpenGraph social banner MUST be procedurally generated, saved in `/public/assets/`, and verified to render cleanly with zero broken links or placeholder text.

---

## 7. Antigravity Master Prompt (For Gemini 4 Argon — Orchestrator)

> **Copy and paste this prompt into Gemini 4 Argon (Orchestrator Mode) in your Antigravity cloud session after committing all 5 `.md` files and installing the skills in `SETUP.md`:**

```text
ROLE: You are ARGON, Lead Architect & Orchestrator for MODULUS (https://modulus.josefyang.com).
Dispatch isolated parallel tasks to HYDROGEN (High-Mode Workers).

SOURCE OF TRUTH:
Read ARCHITECTURE.md, CUSTOMIZATION_SPEC.md, ADMIN_PANEL_SPEC.md, SETUP.md, and LOG.md before writing any code. Update LOG.md at the end of EVERY milestone.

STRICT ARCHITECTURAL RULES:
1. Ownership: You own /src/core, /migrations, wrangler.jsonc, and LOG.md. Workers must NEVER break locked interfaces.
2. Plug-and-Play Modularity: Every game feature lives in /src/plugins/<name> implementing IModulusPlugin. Zero cross-plugin direct imports—communicate only via EventBus and IVehicleRuntimeState.
3. Physics & Rendering: Decoupled 120Hz Rapier3D WASM + custom Pacejka/weight-transfer/aero/thermal solver completely outside React. Dual aesthetic: Sunlit low-poly track ("Art of Rally" vibe) + High-tech dark Engineering Lab.
4. PWA & Mobile Bug-Free: Installable PWA (manifest.json, sw.js, iOS Safari standalone tags). Enforce 100dvh, safe-area-inset padding, touch-action: none, pixelRatio <= 2, single persistent WebGL context on resize, IndexedDB state mirroring, and pluggable touch controls (src/plugins/input-touch) alongside keyboard (src/plugins/input-keyboard).
5. Cloudflare Free-Tier Efficiency & Auth: 100% Cloudflare stack (@cloudflare/vite-plugin, Hono, D1, MODULUS_KV, Workers Static Assets). 30-day Email 6-Digit OTP Auth (NO Google OAuth; sender noreply@modulus.josefyang.com; DEV_MODE=true local console fallback). Batch D1 writes (save/purchase/lap-finish only) and index all D1 lookup columns.
6. Game-Theory Admin Panel (/admin): Follow ADMIN_PANEL_SPEC.md exactly. Gated by ADMIN_EMAILS secret + D1 role='admin'. Store global_balance_config in MODULUS_KV with D1 snapshots + audit_logs. Live math-bias sliders with real-time SVG curve visualizers, editable SEO tagline/description, user credit/part injector, JSON diff preview, 1-click rollback, and balance_version_id leaderboard partitioning.
7. SEO & Verified Assets: Implement dynamic Worker HTMLRewriter SEO injection for https://modulus.josefyang.com, robots.txt, sitemap.xml, and procedurally generate + visually verify all SVG/PNG logos, favicons, apple-touch-icon, and 1200x630 OG banner. Zero placeholders or broken links.

EXECUTION PLAN:
- PHASE 0 (Argon): Scaffold Vite + @cloudflare/vite-plugin + React 19 + Tailwind + Hono + Rapier3D + Three.js + Zod. Lock all TypeScript contracts in /src/core/types, write migrations/0001_initial.sql (with full indexes), configure wrangler.jsonc (D1 + MODULUS_KV), and create baseline JSON content in /src/content. Update LOG.md.
- PHASE 1 (Parallel Hydrogen Workers):
  * WORKER 1 (Physics): physics-rapier, vehicle-solver (Pacejka + live physics_bias multipliers), powertrain, aerodynamics, thermals.
  * WORKER 2 (3D, Visuals & Brand Assets): track-generator (banked 3D splines + instanced props), car-assembler (hardpoint low-poly meshes + Dark Lab CG/aero overlays), fx-renderer, plus verified PWA/SEO/OG assets in /public.
  * WORKER 3 (Backend, Sync & Admin): Hono API (30-day Email OTP, D1 economy, KV/D1 /api/admin/*, dynamic HTMLRewriter SEO) + Mission Control /admin React UI.
  * WORKER 4 (Lab UI, HUD, Mobile & AI): Engineering Lab UI (8 modules, Dyno, Spider Chart, warnings), Drive HUD, input-keyboard, input-touch (mobile), StorageSync (IndexedDB), and physical ai-test-driver (Pure Pursuit + spline braking).

Confirm installed agent skills, output the planned file tree, and begin Phase 0 now.
```