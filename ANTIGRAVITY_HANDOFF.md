# Antigravity handoff for Modulus

Start Antigravity in **`/swarm`** mode with **Claude Opus 5.5 Medium** as the lead and **Neon 4 High** for every worker. The attached Modulus folder is the workspace root. Follow the rebuild plan in phases and use the current game as the baseline.

Paste this after activating `/swarm`.

```text
Use Claude Opus 5.5 Medium as lead and Neon 4 High for all workers.
Read ANTIGRAVITY_HANDOFF.md in the attached Modulus workspace root and execute
the rebuild in its phase order. Let the workers coordinate in /swarm.
Begin with the local baseline and the Apex driving slice on Switchyard Sprint.
```

## Read these files first

| Path from the workspace root | What it contains |
| --- | --- |
| [MODULUS_REBUILD_PLAN.md](MODULUS_REBUILD_PLAN.md) | Product direction, controls, damage, garage, ghost and AI races, private WebRTC and release checks. |
| [CHASSIS_ROSTER.md](CHASSIS_ROSTER.md) | Twelve proposed factory builds. Start with the Apex, Dovetail, and Quarry. |
| [track-designs/short-courses/README.md](track-designs/short-courses/README.md) | Short race and drift layouts, passing zones, elevation profiles and integration notes. JSON files are in [routes](track-designs/short-courses/routes/). |
| [track-designs/rally-endurance/README.md](track-designs/rally-endurance/README.md) | Long route layouts and terrain limitations. JSON files are in [routes](track-designs/rally-endurance/routes/). |
| [ARCHITECTURE.md](ARCHITECTURE.md), [CUSTOMIZATION_SPEC.md](CUSTOMIZATION_SPEC.md), [ADMIN_PANEL_SPEC.md](ADMIN_PANEL_SPEC.md) | The existing game and contracts. The old orchestration prompt in Architecture is historical. |
| [SETUP.md](SETUP.md) and [package.json](package.json) | Local setup and build commands. Use the attached workspace's existing configuration and local test fixtures. |

Check that both packs contain four JSON routes and a preview sheet before assigning track work. The two packs are the current course list and supersede the earlier course proposals in the rebuild plan. Use the actual route files as geometry inputs. Passing zones, surfaces and drift sectors are written in the pack notes.

## Swarm roles

| Role | Model | Responsibility |
| --- | --- | --- |
| Lead and integrator | Claude Opus 5.5 Medium | Inspect the branch and working tree, set phase scope and shared interfaces, resolve cross-worker decisions, review and integrate changes, and own the final end-to-end acceptance pass. |
| Driving physics and vehicle state | Neon 4 High | Own input response, fixed simulation timing, tires, braking, drivetrain, progressive damage and the runtime interfaces used by local AI and live contact. |
| Cockpit, first use and garage | Neon 4 High | Own the title screen, player navigation, cockpit presentation, camera and audio cues, HUD, settings, saved-car views, Beginner and Advanced Lab, and debrief UI. |
| Courses and track authoring | Neon 4 High | Own route integration, track mesh and terrain clearance, start and timing placement, track previews, sector metadata, and the admin Track Kit and import flow. Coordinate chassis content with the physics worker. |
| Rivals, replays and friend races | Neon 4 High | Own AI driver behavior, ghost recording and playback, friend sync and result integrity, and private direct WebRTC rooms. Coordinate shared-world physics with the physics worker and player-facing flows with the UI worker. |

Workers should communicate directly in `/swarm` when another lane needs an interface or an integration check. The lead assigns paths and settles ownership of shared files before parallel edits. Each worker reports the changed files, tests run, relevant measurements, and anything left unverified. Use isolated worktrees when available. Give those worktrees access to the handoff and map assets from the attached folder if the files are local and absent from the Git checkout.

Before feature edits, agree on the small shared contracts for fixed-step inputs and vehicle state, lap and sector events, car and track versions, and render and collision geometry. The lead reviews revisions to those contracts. Keep existing saved cars, ownership, and historical laps usable through versioned changes.

## First work to assign

1. **Inspect and baseline.** Read the named files, check Git state and applicable instructions, build locally, and exercise the current garage and driving entry point. Report the observed baseline and assign independent work.
2. **Build a first playable driving slice.** Use the Apex and **Switchyard Sprint**. Get from the title screen to the cockpit, complete a clean lap, return to a readable debrief, then adjust and retry. Prioritize slower pace, working cockpit cues, keyboard turn-in, and predictable braking. Measure the same corners before adding more cars.
3. **Bring up the second short course.** Use **Dockyard Drift Park** to test transitions and the handbrake. Add **Copper Creek Cross** after mixed grip is available and **Teras Switchback** after crest visibility and downhill braking work. Keep passing zones clear and give drift sessions their own scoring.
4. **Bring up the longer routes after clearance checks.** Start with Tanjung Coast Road and Telaga Ridge Long. Basalt Highlands is the feature endurance event at **26.5 km over two laps**. The large courses need finer road sampling and a terrain clearance corridor before they go into the playable catalog.
5. **Continue through the rebuild plan.** Complete the garage and build comparison, damage, remaining course and chassis work, ghost and physical AI races, private Friend Race, then Royal Prix and the wider roster. Integrate and test each phase as it becomes playable.

The rivals worker can check a four-peer direct-only lobby independently as early work. If real friends are unavailable, report that reachability and host recovery still need their field test and keep the local driving work moving. Use PeerJS Cloud for signaling as planned and keep TURN disabled. Friend Race is private and unranked. Time Trial owns personal bests and ghosts.

## Verification and release boundary

- Run the project build and verify the integrated client in real Chrome. Check the fresh title-to-drive path, controls and full laps. Record browser and device limitations with the results.
- Check road and wall contact, terrain clearance, start placement and sector timing for any course added to the playable catalog. Short-course geometry checks passed locally, and full-lap browser tests are pending. The long-course terrain issue is documented in its pack.
- Show verified lap status only after trusted replay. Keep official records separate from AI and Friend Race. Preserve single-player play when online services fail.
- Use local or isolated fixtures for auth, garages, records and admin tests. Leave production deploys, billing changes and remote migrations for a separate release instruction.
