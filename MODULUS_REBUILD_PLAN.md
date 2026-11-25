# Modulus rebuild plan

Antigravity handoff for the next implementation branch. Use this plan for the rebuild and the existing architecture and customization specs to understand the current game. Read the [chassis roster](CHASSIS_ROSTER.md) for proposed factory builds. Inspect the working tree before editing. Preserve pending auth and deployment work, existing garages and part ownership, and access to historical lap records.

## What Modulus should feel like

Build a car, feel it react, and understand what to change after a run. Being quick should come from control, line choice and knowing the machine. Players should have fun with a slow car while learning what its tires are doing. Deep tuning should become worthwhile as soon as a player has a specific problem to solve.

The first-use path is **Title screen → Garage → Practice Drive → Result → Adjust → Retry**. Start with a dim garage bay and the player's car, with **Enter Garage** as the main action. Offer **Continue Driving** once they have something to resume. The garage is the home for named cars, builds, and modes. Open the Engineering Lab from there.

## Decisions for the first playable

| Area | Direction | First playable check |
| --- | --- | --- |
| Pace | Regear and retune the starter Apex around modest corner speeds. Use **25–45 mph** as a proposed practice-course range. Keep simulation time tied to real elapsed time. Show MPH by default with a km/h option. | A player who lifts, brakes and turns at the right moments beats a full-throttle attempt on the same course. |
| Handling | Make steering prompt at low speed and progressive at speed. Measure commanded steering, front wheel angle, actual yaw rate and tire slip together. Tune keyboard ramp, steering authority and tire response from those readings. | Players can catch a small slide, recognize the nose pushing wide and repeat a clean corner. |
| Controls | `W` accelerates. `S` brakes while moving. At a standstill, release and press `S` again to engage reverse. `Space` is the handbrake. Beginner defaults include automatic shifts and a simple assist preset. | Holding the brake through a stop keeps the car stopped. A fresh press engages reverse predictably. First use teaches the keys. |
| Camera and sound | Default to a cockpit with a steering wheel, instruments and clear sight lines. Keep hood and chase views available. Use engine load, shifts, tire scrub, kerbs and impacts as cues. | Players can hear or see grip changing before the slide without the camera obscuring the road. |
| Settings | One short screen for Camera, Motion, Audio and Controls. Use motion presets and keep remapping behind Controls. | A player can reduce motion and change a key without navigating setup before the first drive. |
| Garage | Beginner selects an OEM engine package, tires and handling presets. Advanced opens the same build down to internals, geometry, gears and cooling. Both edit the same versioned build. | Switching views preserves edits. A player can see, name, duplicate, save, and switch cars. |

Test turn-in at matched speeds before and after changes. Check front grip under braking, rear breakaway, recovery, lockups and braking on uneven ground. Keep the existing fixed physics step where it can meet its budget. Handle slow rendering separately from simulation timing. Profile cockpit assets, shadows, particles and replay cars independently. Measure desktop Chrome and a representative lower-power device before publishing performance targets.

## Builds, damage and course design

The launch garage should make cars easy to pick and compare. Give builds a visible grid, two comparison slots, and part previews before spending credits. Show build deltas where they matter. A different final drive should show what it does to shift points and acceleration. A cooling upgrade should show sustained temperature benefit and its mass or drag cost. Add advanced options for engine internals, ducting, oil cooling, fans, and intercoolers where relevant.

The roster contains twelve proposed vehicles. Build **Apex GT-86R**, **Dovetail 2.5**, and **Quarry 240** first. They cover a forgiving starter, a predictable drift sedan, and a heavy contact vehicle. Each needs its own silhouette, cockpit eye point, collision dimensions, and a handling trade-off a player can feel. Expand the roster once those three work. Keep the existing chassis IDs and add compatible save defaults when fields change.

### Damage

Use one main chassis body and four tire contacts per car. Start with ten gameplay damage zones. Four are the wheel corners. The others are front, rear, left side, right side, cooling and driveline. Render meshes can share a zone. Classify contact in car-local space and use impact strength and direction to determine wear. A scrape should be readable, followed by meaningful effects such as reduced front aero, steering pull, or cooling trouble after harder hits. Most contact should let the driver continue. Apply tire wear for lockups and sustained slip. Downshifts carry no damage penalty.

Show a top-down damage silhouette after a meaningful impact and in the garage. Explain the handling consequence in plain language. Replicate changes to damage zones in Friend Race and apply cosmetic effects on each device. Treat engine heat and tire wear as race state. Keep races from permanently changing saved builds.

### Courses

| Course | Purpose | Proposed geometry |
| --- | --- | --- |
| Dockyard Drift | Learn to initiate, hold and recover a slide. | Wide linked bends and room to recover. |
| Saltworks Switchbacks | Practice transitions. | Long sweepers feeding tighter direction changes. |
| Telaga Ridge | Time Trial and a first useful ghost comparison. | Roughly 70 m elevation range, a crest and a sustained descent. |
| Basalt Pass | A demanding high-elevation run. | Roughly 113 m elevation range, blind crests and downhill switchbacks. |

Use the current spline pipeline as the starting point. Tag drift courses `drift` in the selector. Score drift by line, angle and continuity inside designated sections. Keep drift scores separate from lap times. Check that preview geometry, rendering and collision geometry come from the same track data. Validate a clean lap with the starter car, tune brake markers and sight lines, and test AI before treating a route as race-ready.

### Admin track workflow

Ship a versioned **Track Kit** ZIP from Admin. Include the current track schema, a worked track example, coordinate conventions, the surface and tag vocabulary, validation rules and a preview workflow. The ZIP should give a capable design agent enough context to generate a top-down preview and an elevation profile before exporting its data.

The admin flow is **Import Draft → Validate → Preview → Publish**. Accept data-only track packages with bounded size, control-point count, dimensions, grades, and playable start and sector definitions. Report validation errors with named points or sections. The same spline builder should drive preview and in-game collision generation. Publish and roll back by track version, require the existing admin authorization, and preserve legacy versions for historical times and ghost playback. Render previews without running any uploaded scripts.

## Play modes and result ownership

| Mode | Where it runs | Rules |
| --- | --- | --- |
| Practice and Time Trial | Player's browser | Immediate reset and clean manual runs. Basic weather changes grip and tire behavior. |
| Personal and friend ghosts | Replay rendered locally | A translucent replay of the actual driven line. Ghosts have no collision body. Download the selected replay once and cache it for retries. |
| AI Race | Player's browser | Start with one physical opponent that brakes, leaves room, recovers and can make contact. The current AI Benchmark drives the player's car, so AI Race needs a second car in the shared world. |
| Friend Race | One player's browser hosts | Private invite, up to four, unranked. Host owns contact, checkpoints, damage and finish order. |
| Royal Prix | Local first | Advanced weather, tire wear and timed automated pit service. Map `T` to the pit radio and `1–4` to Soft, Medium, Hard and Wet. Queue the choice and take over at the marked pit entry. The timer keeps running. Main modes use simple weather and need no pit radio. |

### Personal bests and replay integrity

Record only completed clean manual Time Trials for shareable personal bests. Partition records by track version and physics or ruleset version. Keep weather and assist rules in the comparison key when they change the race. Label results from older versions in history. A track update or manual reset should never splice two runs into a replay.

Keep pose samples for visual ghost playback and time-stamped input for verification. Store the local best on-device. Use the existing signed-in account for friend invitations or approval, and use a display identity in shared views. Sync a replay only when the eligible best improves. Fetch friend times in one indexed read and fetch the selected replay only when needed. Friend Race and AI finishes stay out of the Time Trial record path.

Add light server checks for known versions, consistent splits, ordered checkpoints, payload size, plausible movement and duplicate submissions. Show the actual submission status. Existing times and new sanity-checked times should carry their actual verification level. Reserve the **Verified** label for times recomputed by a trusted replay of the inputs from a known starting state. Prototype that replay across representative browsers and check its compute cost before enabling verified competition. [Rapier determinism conditions](https://rapier.rs/docs/user_guides/javascript/determinism/)

## Private WebRTC races

Start with **PeerJS Cloud for signaling**, Cloudflare STUN for direct connections, and **TURN off**. Keep the existing Workers Static Assets deployment. Use an invite-only room with an unpredictable identifier, max four participants and a session ID separate from the current host. Keep signaling behind an adapter so it can change independently of gameplay. The existing loopback contact tests used simplified physics. Production WebRTC latency and the cost of four full vehicles still need testing.

### Host selection and race transport

1. When four players are in the lobby, probe the six peer links over WebRTC. Check reachability, actual round-trip latency and spikes, application-level packet loss and whether the selected ICE path is direct or relayed. Test each candidate's browser with a four-car physics workload.
2. Choose the eligible candidate with the steadiest worst link. Prefer direct paths among comparable candidates. Pick a named backup and allow an explicit host override before the countdown. Keep the host for the race.
3. Use a fixed simulation loop owned by the host. Clients send bounded, sequenced driver inputs. The host replicates state and outcomes. Use replaceable updates for routine movement and reliable messages for countdown, checkpoints and results. Predict the local player's movement, interpolate other cars and reconcile against host state. Measure corrections in side-to-side contact before tuning network update rates.
4. Keep the security boundary simple. Validate room membership and message schema, ignore stale messages, and rate-limit attempts. The private host settles the game state. Public records use the separate Time Trial path.

### Recovery and host migration

For the first release, support handoff **between races**. Keep the membership and track choice available to the backup before starting. On a short host interruption, pause and attempt to reconnect. If the host is gone, let the designated backup claim the lobby and offer **Restart race**. Confirm the host change with the remaining players. Give the new host a higher session authority number so clients ignore messages from an old host after recovery. Prove the remaining players can reach the backup using a prearranged path or fresh signaling.

Add mid-race migration only if actual friend sessions show enough drops to justify it. Its checkpoint must include the physics state needed to resume, latest accepted inputs, timing, ordered checkpoints, vehicle damage, tire state and any weather or random state. Freeze the session, restore the most recent mutually confirmed checkpoint, and count back in. Test divergent connectivity and a returning old host before enabling this path.

### Cloudflare budget

Direct P2P gameplay consumes no Workers requests or TURN relay traffic. Existing auth, garage, records and future ghost sync still use the app's HTTP and database paths. Keep live race ticks and snapshots out of those paths. Measure the account's normal usage before expanding the beta, since other projects share its limits. Throttle invites and score submissions, and cache friend-time reads and replay downloads. Keep local play usable when an online route hits its limit.

- **Hard $0 in relay charges.** Leave TURN off. If any invited player cannot reach a suitable host, retry with another eligible host or offer a friend ghost challenge. Measure actual friends on their normal Wi‑Fi and mobile connections. Connection failure rate is an open measurement for this group.
- **Optional relay after a budget decision.** Cloudflare lists the first 1,000 GB of Realtime egress per month free, shared by TURN and SFU, then $0.05/GB. Confirm the account's billing controls before enabling. Use a dedicated key, mint short-lived credentials only for authenticated invited players, rate-limit issuance and stop well below the budget. Check actual egress per key. Issuance limits and analytics are operational safeguards. A provider-enforced $0 cutoff for Realtime is still unverified.
- **Durable Objects only when their role is clear.** A signaling-only object is a fallback for unreliable discovery. A blocked direct path would still need TURN or a different data transport. A gameplay relay or hosted race is a separate budget and performance decision. Measure both request and active compute usage before putting it on the account.

[PeerJS Cloud](https://peerjs.com/client/faq) · [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) · [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/) · [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) · [TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/) · [TURN analytics](https://developers.cloudflare.com/realtime/turn/analytics/) · [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## Implementation sequence

| Phase | Work | Exit check |
| --- | --- | --- |
| 0. Baseline and connectivity | Inspect live paths, dirty files and data migrations. Use a disposable local test setup. Validate a direct-only PeerJS four-friend lobby independently from the game simulation. | Join and reconnect on the friends' actual networks. Record which links fail and whether another host solves it. |
| 1. Driving slice | Title, Garage, stock Apex cockpit, readable handling, first-use controls, a technical course and debrief. Separate simulation time from rendering. | A new keyboard player reaches a clean run, explains why one attempt went better and can retry without help. |
| 2. Builds and tracks | Beginner and Advanced Lab, visible saved builds, previews, comparison, first three chassis, ten damage zones and four course layouts. Build the admin track kit and draft workflow on the versioned schema. | Existing saves still load. The three chassis have distinct behavior. An imported draft matches its preview and passes a local clean lap. |
| 3. Ghosts and AI | Local PB and replay playback, opt-in friends sync, lightweight integrity checks, and a separate physical AI opponent. | A friend's ghost uses the saved line with zero collision. AI contact uses the same rules as player contact. Failure to sync preserves local play. |
| 4. Friend Race | Integrate host selection, browser-authoritative contact, client prediction, lobby handoff and reset recovery. | Four real Chrome players complete two contact races. Deliberately disconnect the host once and confirm the lobby survives. |
| 5. Additional content | Royal Prix, the remaining chassis and any deeper migration work supported by playtest evidence. | Pit cost and changing weather create understandable decisions. New chassis have a course that suits them and a visible trade-off. |

If the four friends are unavailable for the connectivity check, record that field test as pending and continue the local driving work. Use local and emulated tests for regressions and the friends' actual networks to establish reachability.

## Concerns to wrap up

- **Direct connections are the first multiplayer gate.** A direct-only private race can be unavailable to a member of the group. Keep ghosts and AI available regardless. Later TURN use depends on a separate budget decision.
- **Handling comes before content volume.** A low-power car still feels frantic if steering, road scale or camera motion are wrong. Test the same corners with keyboard players before scaling to twelve vehicles.
- **One simulation must serve solo, ghosts and live contact cleanly.** Separate physics from browser rendering early. Record real inputs and version the ruleset. Measure drift across browsers before making a verification promise.
- **Legacy saves and rankings need an upgrade path.** Keep old content IDs, version newly incompatible behavior, and test the existing garage, settings, auth and admin flows on local fixtures before opening any production migration.

## Antigravity kickoff

Start with the [Antigravity handoff](ANTIGRAVITY_HANDOFF.md) for the current prompt, swarm roles, map packs, and first implementation tasks.
