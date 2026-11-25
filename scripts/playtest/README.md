# Modulus Headless-Chrome / CDP Playtest Harness

Zero-dependency (Node 20+/24 native `WebSocket` + `fetch`) headless-Chrome playtest and telemetry measurement runner for Modulus. Boots the local app, selects a track by `trackId`, enters Drive mode, runs scripted keyboard inputs or AI full-lap runs, and saves screenshots, console/network errors, HUD readings, lap/sector events, spline-progress probe crossings, corner window metrics, and high-frequency speed traces into `playtest-results/runs/`.

## Prerequisites

1. Start the local dev server (local fixtures only; never remote migrations):
   ```bash
   npm run db:migrate:local
   npm run dev
   ```
2. Real Google Chrome installed (auto-detected on Windows/macOS/Linux, or set `CHROME_PATH`).

## Quick Usage

### 1. Manual keyboard smoke run
```bash
node scripts/playtest/run.mjs --track track_gp_circuit --scenario scripts/playtest/scenarios/manual-smoke.json
```

### 2. Full-lap AI verification with spline probes
```bash
node scripts/playtest/run.mjs --track track_gp_circuit --scenario scripts/playtest/scenarios/ai-full-lap.json
```

### 3. Custom ad-hoc corner / spline probe run
```bash
node scripts/playtest/run.mjs \
  --url http://localhost:5173 \
  --track track_switchyard_sprint \
  --probes 0.08,0.18,0.35,0.60,0.82 \
  --ai \
  --stop-on-lap 1 \
  --duration 75 \
  --out playtest-results/runs/switchyard-check
```

## CLI Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--url <url>` | `http://localhost:5173` | Local dev server URL |
| `--track <trackId>` | current default | Track ID to select via `engine.selectTrack(trackId)` before driving |
| `--scenario <path>` | none | JSON scenario file (keyboard actions, probes, cornerWindows, AI mode) |
| `--ai` | `false` | Enable AI Driver after entering Drive mode |
| `--duration <sec>` | `20` (manual) / `75` (`--ai`) | Max drive duration in seconds |
| `--probes <list>` | `0.1,0.25,0.5,0.75,0.9` | Comma-separated `splineProgress` probe points in `[0, 1)` |
| `--camera <preset>` | default | Set camera preset (`cockpit`, `chase`, `hood`, `orbit`) |
| `--stop-on-lap <n>` | `1` for `--ai` | Stop recording after `n` `lap:finished` events |
| `--out <dir>` | `playtest-results/runs/<ts>-<track>` | Output directory for `summary.json`, `trace.json`, and PNGs |
| `--headed` | `false` | Launch visible Chrome instead of `--headless=new` |
| `--width` / `--height` | `1280` / `800` | Viewport size |

## Scenario JSON Schema

```json
{
  "trackId": "track_switchyard_sprint",
  "ai": false,
  "stopOnLap": 1,
  "maxDurationSec": 45,
  "camera": "cockpit",
  "traceIntervalMs": 100,
  "probes": [0.08, 0.14, 0.28, 0.67, 0.85],
  "cornerWindows": [
    { "name": "Turn1", "entryProgress": 0.07, "exitProgress": 0.18 },
    { "name": "FreightHairpin", "entryProgress": 0.62, "exitProgress": 0.78 }
  ],
  "actions": [
    { "type": "hold", "key": "KeyW", "ms": 2500 },
    { "type": "hold", "keys": ["KeyW", "KeyD"], "ms": 600 },
    { "type": "hold", "key": "KeyS", "ms": 1500 },
    { "type": "press", "key": "KeyC", "holdMs": 100 },
    { "type": "screenshot", "name": "after-turn1" }
  ]
}
```

Supported action types: `hold` (`key` or `keys`, `ms`), `keyDown` (`key`), `keyUp` (`key`), `press` (`key`, `holdMs`), `wait` (`ms`), `screenshot` (`name`), `clickText` (`pattern`), `setAi` (`enabled`), `setCamera` (`preset`).

## Outputs (written to `--out`)

- `summary.json`: environment (WebGL renderer, FPS), track info, final HUD DOM + runtime state, `sector:split` and `lap:finished` events, `probeHits` at each crossed `splineProgress`, `cornerSummaries` (`entrySpeedKph`, `minSpeedKph`, `exitSpeedKph`, `brakingDistanceM`, `steeringResponseTimeMs`, `peakLateralG`, `lapValidThroughout`), screenshot paths, and all console errors, uncaught exceptions, and HTTP >= 400 requests.
- `trace.json`: timestamped 10Hz telemetry trace (`splineProgress`, `speedKph`, `gear`, `rpm`, `throttle`, `brake`, `steer`, `lateralG`, `longitudinalG`, `yawRateRadS`, `pos`, `lapValid`).
- `01-boot.png`, `02-drive-start.png`, `03-drive-end.png`, plus any scenario `screenshot` steps.
