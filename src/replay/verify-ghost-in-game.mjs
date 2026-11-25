import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import * as THREE from 'three';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEV_PORT = Number(process.env.MODULUS_GHOST_PORT || 5193);
const CDP_PORT = Number(process.env.MODULUS_GHOST_CDP_PORT || 9243);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function loadTsModule(entryPath, tempDir, outName) {
  const outPath = join(tempDir, outName);
  await esbuild.build({
    entryPoints: [resolve(entryPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['three'],
    outfile: outPath,
  });
  return import(pathToFileURL(outPath).href);
}

function makeFakeContext(compiled, track) {
  const listeners = new Map();
  const fixedStepListeners = new Set();
  const events = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    once(event, fn) {
      const off = events.on(event, (p) => {
        off();
        fn(p);
      });
      return off;
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of Array.from(set)) fn(payload);
    },
    clear() {
      listeners.clear();
    },
  };

  let visualMode = 'lab';
  let sessionMode = 'practice';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2400);
  camera.position.set(0, 1.5, -6);

  const runtimeState = {
    position: { x: 0, y: 0.35, z: 0 },
    prevPosition: { x: 0, y: 0.35, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prevRotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocityWorld: { x: 0, y: 0, z: 0 },
    angularVelocityWorld: { x: 0, y: 0, z: 0 },
    localVelocity: { x: 0, y: 0, z: 0 },
    forwardWorld: { x: 0, y: 0, z: 1 },
    upWorld: { x: 0, y: 1, z: 0 },
    rightWorld: { x: -1, y: 0, z: 0 },
    speedMs: 0,
    speedKph: 0,
    longitudinalG: 0,
    lateralG: 0,
    yawRateRadS: 0,
    engineRpm: 1000,
    engineTorqueNm: 0,
    enginePowerHp: 0,
    turboBoostBar: 0,
    gear: 1,
    shiftTimerS: 0,
    isShifting: false,
    clutchEngagement: 1,
    fuelLiters: 35,
    downforceFrontN: 0,
    downforceRearN: 0,
    downforceTotalN: 0,
    dragForceN: 0,
    diffuserStalled: false,
    ambientTempC: 24,
    trackTempC: 34,
    engineTempC: 85,
    engineLimpMode: false,
    engineBlown: false,
    wheels: [0, 1, 2, 3].map((index) => ({
      index,
      grounded: true,
      surface: 'tarmac',
      contactPointWorld: { x: 0, y: 0, z: 0 },
      contactNormalWorld: { x: 0, y: 1, z: 0 },
      worldPosition: { x: 0, y: 0.3, z: 0 },
      prevWorldPosition: { x: 0, y: 0.3, z: 0 },
      suspensionLengthM: 0.28,
      compressionM: 0.04,
      compressionVelocityMs: 0,
      bottomedOut: false,
      steerAngleRad: 0,
      camberAngleRad: 0,
      angularVelocityRadS: 0,
      rotationAngleRad: 0,
      normalLoadN: 3000,
      slipRatio: 0,
      slipAngleRad: 0,
      longitudinalForceN: 0,
      lateralForceN: 0,
      driveTorqueNm: 0,
      brakeTorqueNm: 0,
      tireTempC: 60,
      tireWear: 0,
      thermalGripMultiplier: 1,
      brakeTempC: 80,
      brakeFadeMultiplier: 1,
    })),
    forceAccumulatorWorld: { x: 0, y: 0, z: 0 },
    torqueAccumulatorWorld: { x: 0, y: 0, z: 0 },
    pointForces: [],
    aiEnabled: false,
    aiTargetPointWorld: { x: 0, y: 0, z: 10 },
    splineProgress: 0,
    currentLap: 1,
    currentSector: 0,
    currentLapTimeMs: 0,
    lastLapTimeMs: null,
    bestLapTimeMs: null,
    lapDeltaMs: 0,
    sectorTimesMs: [0, 0, 0],
    peakLapSpeedKph: 0,
    offTrackCount: 0,
    lapValid: true,
  };

  let latestSnapshot = null;

  const ctx = {
    events,
    scene,
    camera,
    renderer: null,
    canvas: null,
    getVisualMode: () => visualMode,
    setVisualMode: (m) => {
      visualMode = m;
      events.emit('mode:changed', { mode: m });
    },
    getCameraPreset: () => 'cockpit',
    setCameraPreset: () => {},
    getLabOverlayOptions: () => ({
      wireframe: false,
      cgSphere: false,
      aeroVectors: false,
      highlightedModule: null,
    }),
    setLabOverlayOptions: () => {},
    getBalanceConfig: () => ({
      version_id: 'v1.0.0',
      updated_at: '2026-11-25T00:00:00Z',
      branding: { site_name: 'Modulus', domain: 'modulus.josefyang.com', tagline: 't', meta_description: 'desc desc desc' },
      physics_bias: { pacejka_grip_mult: 1, aero_drag_mult: 1, aero_downforce_mult: 1, thermal_heat_soak_mult: 1, weight_inertia_mult: 1, turbo_lag_mult: 1 },
      economy_bias: { payout_mult: 1, part_price_mult: 1, wear_cost_mult: 1, starting_credits: 25000, max_pwr_ratio_cap: 0 },
    }),
    setBalanceConfig: () => {},
    getCompiledVehicle: () => compiled,
    updateBuild: () => compiled,
    getActiveTrack: () => track,
    selectTrack: () => {},
    getTrackGeometry: () => ({
      trackSchema: track,
      collisionHandle: { geometryHash: 'trk_sw_hash' },
    }),
    setTrackGeometry: () => {},
    getRuntimeState: () => runtimeState,
    getInputState: () => ({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: 0,
      clutch: 0,
      gearUp: false,
      gearDown: false,
      resetVehicle: false,
      inputSource: 'keyboard',
    }),
    setHardwareInput: () => {},
    resetVehicleToStart: () => {
      events.emit('vehicle:reset', {
        position: { x: 0, y: 0.35, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      });
    },
    setAiEnabled: (enabled) => {
      runtimeState.aiEnabled = enabled;
      events.emit('ai:toggled', { enabled });
    },
    // Phase 3 Physics hooks (#44)
    getSessionMode: () => sessionMode,
    setSessionMode: (mode) => {
      sessionMode = mode;
      events.emit('session:mode-changed', { mode });
    },
    onFixedStep: (fn) => {
      fixedStepListeners.add(fn);
      return () => fixedStepListeners.delete(fn);
    },
    getVehicleSnapshot: () => latestSnapshot,
    emitFixedStep(tick, frame, snap) {
      latestSnapshot = snap;
      for (const fn of Array.from(fixedStepListeners)) {
        fn(tick, frame, snap);
      }
    },
  };

  return ctx;
}

function makeStepSnapshot(tick, simTimeMs, speedMs, z, progress, lapValid = true, lapArmed = true) {
  return {
    tick,
    simTimeMs,
    vehicleId: 'v0',
    slotIndex: 0,
    controllerKind: 'local',
    position: { x: 0, y: 0.35, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocityWorld: { x: 0, y: 0, z: speedMs },
    angularVelocityWorld: { x: 0, y: 0, z: 0 },
    speedMs,
    forwardSpeedMs: speedMs,
    longitudinalG: 0.1,
    lateralG: 0,
    yawRateRadS: 0,
    bodySlipAngleRad: 0,
    rawSteerInput: 0,
    commandedSteer: 0,
    frontWheelAngleRad: 0.08,
    throttle: 0.9,
    brake: 0,
    handbrake: 0,
    brakeLightOn: false,
    reverseState: 'forward',
    transmissionMode: 'auto',
    assistPreset: 'beginner',
    gear: 3,
    isShifting: false,
    shiftDirection: 0,
    engineRpm: 5200,
    idleRpm: 900,
    redlineRpm: 7200,
    revLimiterRpm: 7500,
    engineLoad: 0.8,
    turboBoostBar: 0,
    maxBoostBar: 0,
    fuelLiters: 35,
    fuelCapacityL: 45,
    engineTempC: 86,
    engineMaxSafeTempC: 112,
    engineLimpMode: false,
    engineBlown: false,
    downforceTotalN: 150,
    diffuserStalled: false,
    wheels: [0, 1, 2, 3].map((index) => ({
      index,
      grounded: true,
      surface: 'tarmac',
      suspensionLengthM: 0.28,
      compressionM: 0.04,
      compressionVelocityMs: 0,
      steerAngleRad: index < 2 ? 0.08 : 0,
      camberAngleRad: -0.02,
      rotationAngleRad: tick * 0.2,
      angularVelocityRadS: 60,
      normalLoadN: 3000,
      slipRatio: 0.02,
      slipAngleRad: 0.01,
      lockupIntensity: 0,
      scrubIntensity: 0.1,
      tireTempC: 70,
      tireWear: 0.01,
      brakeTempC: 95,
    })),
    damageZones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    lastImpact: null,
    lapNumber: 1,
    sectorIndex: progress < 0.33 ? 0 : progress < 0.66 ? 1 : 2,
    sectorCount: 3,
    splineProgress: progress,
    lapArmed,
    currentLapTimeMs: simTimeMs,
    lastLapTimeMs: null,
    bestLapTimeMs: null,
    lapDeltaMs: 0,
    sectorTimesMs: [1667, 1667, 1666],
    lapValid,
    checkpointMask: 7,
  };
}

async function main() {
  const cacheRoot = resolve('node_modules/.cache');
  await mkdir(cacheRoot, { recursive: true });
  const tempDir = await mkdtemp(join(cacheRoot, 'modulus-ghost-plugin-'));
  try {
    const content = await loadTsModule('src/content/index.ts', tempDir, 'content.mjs');
    const compiler = await loadTsModule('src/core/math/vehicleCompiler.ts', tempDir, 'compiler.mjs');
    const ghostMod = await loadTsModule('src/plugins/ghost-renderer/index.ts', tempDir, 'ghost.mjs');

    const starterBuild = content.createStarterBuild();
    const compiled = compiler.compileVehicleBuild(starterBuild, {
      version_id: 'v1.0.0',
      updated_at: '2026-11-25T00:00:00Z',
      branding: { site_name: 'Modulus', domain: 'modulus.josefyang.com', tagline: 't', meta_description: 'desc desc desc' },
      physics_bias: { pacejka_grip_mult: 1, aero_drag_mult: 1, aero_downforce_mult: 1, thermal_heat_soak_mult: 1, weight_inertia_mult: 1, turbo_lag_mult: 1 },
      economy_bias: { payout_mult: 1, part_price_mult: 1, wear_cost_mult: 1, starting_credits: 25000, max_pwr_ratio_cap: 0 },
    });
    const swTrack = content.TRACKS_BY_ID.get('track_switchyard_sprint');
    assert.ok(swTrack, 'track_switchyard_sprint must exist');

    const ctx = makeFakeContext(compiled, swTrack);
    const plugin = ghostMod.ghostRendererPlugin;
    await plugin.init(ctx);

    // 1. In Practice mode: must NOT record or show ghost
    ctx.setSessionMode('practice');
    ctx.setVisualMode('track');
    ctx.emitFixedStep(
      1,
      { tick: 1, vehicleId: 'v0', controllerKind: 'local', inputSource: 'keyboard', throttle: 1, brake: 0, steer: 0, handbrake: 0, clutch: 0, flags: 0 },
      makeStepSnapshot(1, 8.33, 20, 1, 0.01)
    );
    assert.equal(ghostMod.getGhostHudState().isRecording, false, 'Practice mode must not record Time Trial ghost');

    // 2. Switch to Time Trial: record a clean 5.000s (600 ticks @ 120 Hz) PB lap
    ctx.setSessionMode('time_trial');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ghostMod.getGhostHudState().hasGhost, false, 'No PB ghost before first completed lap');

    for (let i = 0; i < 600; i++) {
      const tick = 100 + i;
      const simTimeMs = (i * 1000) / 120;
      const z = (i / 120) * 20; // 20 m/s -> 100m
      const progress = Math.min(0.999, i / 600);
      ctx.emitFixedStep(
        tick,
        { tick, vehicleId: 'v0', controllerKind: 'local', inputSource: 'keyboard', throttle: 0.9, brake: 0, steer: 0.1, handbrake: 0, clutch: 0, flags: 0 },
        makeStepSnapshot(tick, simTimeMs, 20, z, progress)
      );
    }

    ctx.events.emit('lap:finished', {
      vehicleId: 'v0',
      tick: 699,
      sessionMode: 'time_trial',
      trackId: swTrack.id,
      trackVersion: 'v1.0.0',
      geometryHash: 'trk_sw_hash',
      physicsVersion: 'phys-2.0.0',
      rulesetVersion: 'rules-2.0.0',
      balanceVersionId: 'v1.0.0',
      buildId: starterBuild.id,
      buildSchemaVersion: 2,
      chassisId: starterBuild.chassisId,
      pwrRatio: compiled.pwrRatioHpPerKg,
      lapNumber: 1,
      lapTimeMs: 5000,
      sectorTimesMs: [1667, 1667, 1666],
      sectorNames: ['Main Straight', 'Infield S', 'Freight Hairpin'],
      deltaToBestLapMs: null,
      isPersonalBest: true,
      lapValid: true,
      invalidReasons: [],
      checkpointMask: 7,
      orderedCheckpointsHit: [0, 1, 2],
      peakSpeedMs: 20,
      peakSpeedKph: 72,
      isAiAssisted: false,
      verificationLevel: 'local',
    });

    // Wait for async GhostStorage PB save + GhostPlayer load
    await new Promise((r) => setTimeout(r, 50));

    const postLapHud = ghostMod.getGhostHudState();
    assert.equal(postLapHud.hasGhost, true, 'Completed clean Time Trial PB must immediately load into GhostPlayer');
    assert.equal(postLapHud.ghostSource, 'personal_best');
    assert.equal(postLapHud.ghostBestLapMs, 5000);
    assert.equal(postLapHud.lastPbImproved, true);

    // 3. Start Run 2 (reset + faster driving) -> ghost mesh renders & live delta is negative (ahead!)
    ctx.resetVehicleToStart();
    // At t = 2000ms, PB ghost was at progress = 2000/5000 = 0.40 (z = 40m).
    // Suppose player is faster: already at progress = 0.50 at t = 2000ms -> delta should be ~ -500ms!
    const fastSnap = makeStepSnapshot(800, 2000, 25, 50, 0.5, true, true);
    ctx.emitFixedStep(
      800,
      { tick: 800, vehicleId: 'v0', controllerKind: 'local', inputSource: 'keyboard', throttle: 1, brake: 0, steer: 0, handbrake: 0, clutch: 0, flags: 0 },
      fastSnap
    );
    // Position camera 12m away from ghost so full translucency applies
    ctx.camera.position.set(0, 2, 28);
    // Force HUD publish window
    await new Promise((r) => setTimeout(r, 60));
    plugin.onRender(1.0, ctx.getRuntimeState());

    const ghostRoot = ctx.scene.getObjectByName('modulus_ghost_vehicle_root');
    assert.ok(ghostRoot, 'Translucent ghost Three.js root must be mounted in scene');
    assert.equal(ghostRoot.visible, true, 'Ghost mesh must be visible on Time Trial Run 2');
    assert.ok(Math.abs(ghostRoot.position.z - 40) < 0.8, `Expected ghost at z≈40m at t=2s, got ${ghostRoot.position.z}`);

    const run2Hud = ghostMod.getGhostHudState();
    assert.ok(run2Hud.liveDeltaMs !== null, 'Live ghost delta must be computed');
    assert.ok(run2Hud.liveDeltaMs < -400 && run2Hud.liveDeltaMs > -600, `Expected liveDeltaMs ≈ -500ms, got ${run2Hud.liveDeltaMs}`);

    // 4. Proximity fade check when camera is right next to ghost (cockpit sightline clarity)
    ctx.camera.position.set(0, 1.0, 40.5);
    plugin.onRender(1.0, ctx.getRuntimeState());
    const hullMesh = ghostRoot.children.find((c) => c.type === 'Mesh');
    assert.ok(hullMesh && hullMesh.material.transparent === true && hullMesh.material.depthWrite === false);
    assert.ok(hullMesh.material.opacity < 0.1, `Expected proximity fade < 0.1 near camera, got ${hullMesh.material.opacity}`);

    // 5. Returning to Lab hides ghost cleanly
    ctx.setVisualMode('lab');
    assert.equal(ghostRoot.visible, false, 'Ghost mesh must hide in Lab mode');

    // Capture the recorded PB bundle so we can also verify live Three.js rendering in Chrome
    const recordedBundle = await ghostMod
      .getSharedGhostStorage()
      .getPersonalBest(
        'track_switchyard_sprint::v1.0.0::phys-2.0.0::rules-2.0.0::v1.0.0::clear_dry::beginner::auto'
      );
    assert.ok(recordedBundle?.bundle, 'Recorded PB bundle must be persisted in GhostStorage');

    plugin.dispose();
    return {
      simReport: {
        pbRecordedLapMs: postLapHud.ghostBestLapMs,
        pbReplayId: postLapHud.lastRecordedReplayId,
        run2GhostPosZ: Number(ghostRoot.position.z.toFixed(2)),
        run2LiveDeltaMs: run2Hud.liveDeltaMs,
        proximityFadedOpacity: Number(hullMesh.material.opacity.toFixed(4)),
        zeroCollisionBodyConfirmed: true,
      },
      sampleBundle: recordedBundle.bundle,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runChromeSmokeTest(sampleBundle) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'modulus-ghost-chrome-'));
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
    { stdio: 'pipe' }
  );
  let chromeProc = null;
  let ws = null;

  try {
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/`, 25_000);
    chromeProc = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--no-sandbox',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${userDataDir}`,
        '--autoplay-policy=no-user-gesture-required',
        'about:blank',
      ],
      { stdio: 'pipe' }
    );
    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 15_000);

    const tabRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
    const target = await tabRes.json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.onopen = resolveOpen;
      ws.onerror = rejectOpen;
    });

    let nextId = 1;
    const pending = new Map();
    const exceptions = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params?.exceptionDetails?.text || 'Runtime exception');
      }
    };
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result?.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/` });

    // Wait for __modulusGhost to be registered by ghostRendererPlugin
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const ready = await evalJs('Boolean(window.__modulusGhost)');
      if (ready) break;
      await sleep(200);
    }
    assert.equal(await evalJs('Boolean(window.__modulusGhost)'), true, 'ghostRendererPlugin must expose window.__modulusGhost');

    // Track window 'ghost:state' events (consumed by @cockpit HUD per #46)
    await evalJs(`
      window.__ghostEventsCount = 0;
      window.addEventListener('ghost:state', () => { window.__ghostEventsCount++; });
    `);

    // Enter Garage -> Time Trial -> Drive on Track (via UI buttons)
    await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').toLowerCase().includes('enter garage')
      );
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(300);
    await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').toLowerCase().includes('time trial')
      );
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(150);
    await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => {
        const t = (b.textContent || '').toLowerCase();
        return t.includes('drive') || t.includes('start time trial') || t.includes('launch');
      });
      if (btn) btn.click();
      return Boolean(btn);
    })()`);
    await sleep(800);

    // Sync Time Trial session mode via the window event agreed with @cockpit (#46) and load sample PB ghost
    await evalJs(`
      window.dispatchEvent(new CustomEvent('modulus:session-mode', { detail: { mode: 'time_trial' } }));
      window.__modulusGhost.loadFriendGhost(${JSON.stringify(sampleBundle)});
    `);
    // Hold W briefly to drive forward & trigger live recording + ghost playback
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await sleep(900);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
    await sleep(200);

    const browserState = await evalJs(`({
      state: window.__modulusGhost.getState(),
      meshVisible: window.__modulusGhost.isMeshVisible(),
      hasCollisionBody: window.__modulusGhost.hasCollisionBody(),
      lastPose: window.__modulusGhost.getLastPose(),
      ghostEventsCount: window.__ghostEventsCount,
    })`);

    assert.equal(browserState.state.sessionMode, 'time_trial');
    assert.equal(browserState.state.active, true);
    assert.equal(browserState.state.hasGhost, true);
    assert.equal(browserState.state.isRecording, true);
    assert.ok(browserState.state.recordedTicks > 10, `Expected recordedTicks > 10, got ${browserState.state.recordedTicks}`);
    assert.equal(browserState.meshVisible, true, 'Translucent ghost mesh must be visible in Chrome scene');
    assert.equal(browserState.hasCollisionBody, false, 'Ghost must have zero collision body');
    assert.equal(browserState.lastPose?.collisionEnabled, false);
    assert.ok(browserState.ghostEventsCount > 0, 'ghost:state window events must fire for HUD');
    assert.equal(exceptions.length, 0, `Unexpected Chrome JS exceptions: ${exceptions.join('; ')}`);

    return {
      chromeBootOk: true,
      sessionMode: browserState.state.sessionMode,
      active: browserState.state.active,
      recordedTicks: browserState.state.recordedTicks,
      meshVisible: browserState.meshVisible,
      hasCollisionBody: browserState.hasCollisionBody,
      liveDeltaMs: browserState.state.liveDeltaMs,
      ghostEventsCount: browserState.ghostEventsCount,
      exceptions,
    };
  } finally {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    chromeProc?.kill();
    viteProc.kill();
    await sleep(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runAll() {
  const { simReport, sampleBundle } = await main();
  const chromeReport = await runChromeSmokeTest(sampleBundle);
  console.log(JSON.stringify({ ok: true, simReport, chromeReport }, null, 2));
}

runAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('GHOST-RENDERER VERIFICATION FAILED:', err);
    process.exit(1);
  });
