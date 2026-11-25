# Modulus multiplayer contact probe

This local prototype runs four drivers inside one server-authoritative Rapier world and replicates state over WebSockets. It uses a flat practice pad, basic steering, throttle and braking, and rigid-body contacts. The production Modulus solver, full tracks, damage, and ranked results are outside this probe. The live Worker configuration is independent of these files.

## Run the probe

From the repository root with the existing dependencies installed:

```powershell
node prototypes/multiplayer/measure.mjs
```

The command bundles a temporary Worker with the installed Rapier WebAssembly module and starts Miniflare on loopback. It measures local Node simulation batch time, then runs four WebSocket clients against a local Durable Object. It verifies shared movement and car contact, a four-driver cap and removal of a disconnected driver. It also reports the local snapshot cadence and the change in speed at contact. Measurements vary across runs and devices.

The match sends inputs and snapshots at roughly 15 Hz and advances the shared world in 120 Hz steps. It bounds catch-up work and neutralizes stale controls. Rooms expire after five minutes or 30 seconds without input and release the simulation when the last driver leaves.

## Drive in Chrome

```powershell
node prototypes/multiplayer/measure.mjs --serve
```

Open the printed loopback URL in two Chrome windows. Select the same room in both windows, join, and drive with WASD or the arrow keys. The top-down view and controls belong to the contact probe.

## Before any public beta

Integrate the actual tire and chassis solver into the shared world. Measure 2- and 4-car rooms on regional infrastructure under a network delay representative of the audience. Measure authoritative frame time, end-to-end controls, position corrections during contact, and compute usage. The local Node batch timing and local WebSocket timing measure different things.

Use signed private invites and an account-wide concurrency and usage budget before enabling the room entry point on the live site. Keep solo play in the browser. If a room misses its measured simulation or latency budget, move the race simulation to a dedicated process and use Durable Objects for room coordination.
