import assert from 'node:assert/strict';
import esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function loadTsModule(entryPath, tempDir, outName) {
  const outPath = join(tempDir, outName);
  await esbuild.build({
    entryPoints: [resolve(entryPath)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    outfile: outPath,
  });
  return import(pathToFileURL(outPath).href);
}

function makeSnapshot(tick, simTimeMs, x, z, lapValid = true, lapArmed = true) {
  return {
    tick,
    simTimeMs,
    vehicleId: 'v0',
    slotIndex: 0,
    controllerKind: 'local',
    position: { x, y: 0.35, z },
    rotation: { x: 0, y: Math.sin(tick * 0.001), z: 0, w: Math.cos(tick * 0.001) },
    linearVelocityWorld: { x: 0, y: 0, z: 22 },
    angularVelocityWorld: { x: 0, y: 0.05, z: 0 },
    speedMs: 22,
    forwardSpeedMs: 22,
    longitudinalG: 0.2,
    lateralG: 0.4,
    yawRateRadS: 0.05,
    bodySlipAngleRad: 0.02,
    rawSteerInput: 0.25,
    commandedSteer: 0.25,
    frontWheelAngleRad: 0.12,
    throttle: 0.85,
    brake: 0,
    handbrake: 0,
    brakeLightOn: false,
    reverseState: 'forward',
    transmissionMode: 'auto',
    assistPreset: 'beginner',
    gear: 3,
    isShifting: false,
    shiftDirection: 0,
    engineRpm: 5400,
    idleRpm: 900,
    redlineRpm: 7200,
    revLimiterRpm: 7500,
    engineLoad: 0.85,
    turboBoostBar: 0,
    maxBoostBar: 0,
    fuelLiters: 42,
    fuelCapacityL: 45,
    engineTempC: 88,
    engineMaxSafeTempC: 112,
    engineLimpMode: false,
    engineBlown: false,
    downforceTotalN: 320,
    diffuserStalled: false,
    wheels: [0, 1, 2, 3].map((index) => ({
      index,
      grounded: true,
      surface: 'tarmac',
      suspensionLengthM: 0.28,
      compressionM: 0.04,
      compressionVelocityMs: 0,
      steerAngleRad: index < 2 ? 0.12 : 0,
      camberAngleRad: -0.02,
      rotationAngleRad: tick * 0.25,
      angularVelocityRadS: 70,
      normalLoadN: 3100,
      slipRatio: 0.03,
      slipAngleRad: 0.04,
      lockupIntensity: 0,
      scrubIntensity: 0.15,
      tireTempC: 72,
      tireWear: 0.01,
      brakeTempC: 120,
    })),
    damageZones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    lastImpact: null,
    lapNumber: 1,
    sectorIndex: tick < 200 ? 0 : tick < 400 ? 1 : 2,
    sectorCount: 3,
    splineProgress: Math.min(0.999, tick / 600),
    lapArmed,
    currentLapTimeMs: simTimeMs,
    lastLapTimeMs: null,
    bestLapTimeMs: null,
    lapDeltaMs: 0,
    sectorTimesMs: [1667, 1667, 1666],
    lapValid,
    checkpointMask: 0b111,
  };
}

function makeStartCheckpoint() {
  return {
    tick: 0,
    prngSeed: 1337,
    sessionMode: 'time_trial',
    track: {
      trackId: 'track_switchyard_sprint',
      trackVersion: 'v2.0.0',
      geometryHash: 'hash_sw_01',
    },
    ruleset: {
      physicsVersion: 'phys-2.0.0',
      rulesetVersion: 'rules-2.0.0',
      balanceVersionId: 'v1.0.0',
      weatherKey: 'clear_dry',
      assistPreset: 'beginner',
      transmissionMode: 'auto',
    },
    vehicles: [
      {
        vehicleId: 'v0',
        slotIndex: 0,
        controllerKind: 'local',
        buildMeta: {
          buildId: 'build_starter_apex',
          chassisId: 'chassis_apex_fr',
          buildSchemaVersion: 2,
          buildRevision: 1,
          buildContentHash: 'bhash_apex_stock',
          balanceVersionId: 'v1.0.0',
        },
        position: { x: 0, y: 0.35, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        linearVelocityWorld: { x: 0, y: 0, z: 0 },
        angularVelocityWorld: { x: 0, y: 0, z: 0 },
        fuelLiters: 42,
        engineTempC: 82,
        tireTempsC: [50, 50, 50, 50],
        tireWear: [0, 0, 0, 0],
        brakeTempsC: [60, 60, 60, 60],
        damageZones: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        lapNumber: 1,
        sectorIndex: 0,
        checkpointMask: 0,
        lapValid: true,
      },
    ],
  };
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'modulus-rivals-unit-'));
  try {
    const replay = await loadTsModule('src/replay/index.ts', tempDir, 'replay.mjs');
    const net = await loadTsModule('src/net/index.ts', tempDir, 'net.mjs');

    // === 1. Replay quantization & RLE pack/unpack ===
    const sampleFrames = [];
    for (let tick = 0; tick < 600; tick++) {
      sampleFrames.push(
        replay.quantizeInputFrame({
          tick,
          vehicleId: 'v0',
          controllerKind: 'local',
          inputSource: 'keyboard',
          throttle: tick < 450 ? 1.0 : 0.0,
          brake: tick >= 450 ? 0.6 : 0.0,
          steer: tick > 200 && tick < 350 ? 0.5 : 0.0,
          handbrake: 0,
          clutch: 0,
          flags: tick === 240 ? 1 : 0, // GEAR_UP edge flag
        })
      );
    }
    const packed = replay.packQuantizedInputs(sampleFrames);
    assert.ok(packed.length < 15, `Expected strong RLE compression, got ${packed.length} runs for 600 ticks`);
    const unpacked = replay.unpackQuantizedInputs(packed, 'v0');
    assert.equal(unpacked.length, 600);
    assert.deepEqual(unpacked[240], sampleFrames[240]);
    const restored = replay.dequantizeInputFrame(unpacked[240]);
    assert.equal(restored.flags, 1);
    assert.ok(Math.abs(restored.steer - 0.5) < 0.0001);

    // === 2. GhostRecorder mode & cleanliness guards ===
    const startCp = makeStartCheckpoint();
    const recorder = new replay.GhostRecorder();

    // Non-Time-Trial modes must not record
    assert.equal(
      recorder.beginRun({
        sessionMode: 'friend_race',
        driverDisplayName: 'Racer',
        track: startCp.track,
        ruleset: startCp.ruleset,
        buildMeta: startCp.vehicles[0].buildMeta,
        startCheckpoint: startCp,
      }),
      false
    );
    assert.equal(
      recorder.beginRun({
        sessionMode: 'ai_race',
        driverDisplayName: 'Racer',
        track: startCp.track,
        ruleset: startCp.ruleset,
        buildMeta: startCp.vehicles[0].buildMeta,
        startCheckpoint: startCp,
      }),
      false
    );

    // Clean manual Time Trial run
    assert.equal(
      recorder.beginRun({
        sessionMode: 'time_trial',
        driverDisplayName: 'Racer',
        track: startCp.track,
        ruleset: startCp.ruleset,
        buildMeta: startCp.vehicles[0].buildMeta,
        startCheckpoint: startCp,
      }),
      true
    );

    // Pre-launch ticks (lapArmed=false) must be ignored
    recorder.recordFixedStep(
      {
        tick: 0,
        vehicleId: 'v0',
        controllerKind: 'local',
        inputSource: 'keyboard',
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: 0,
        clutch: 0,
        flags: 0,
      },
      makeSnapshot(0, 0, 0, 0, true, false)
    );
    assert.equal(recorder.getRecordedTickCount(), 0);

    // 600 ticks = 5.0 seconds at 120Hz (plausible speed 22 m/s = 110m travel)
    for (let i = 0; i < 600; i++) {
      const tick = 10 + i;
      const simTimeMs = (i * 1000) / 120;
      const z = (i / 120) * 22;
      recorder.recordFixedStep(
        {
          tick,
          vehicleId: 'v0',
          controllerKind: 'local',
          inputSource: 'keyboard',
          throttle: 0.85,
          brake: 0,
          steer: 0.25,
          handbrake: 0,
          clutch: 0,
          flags: 0,
        },
        makeSnapshot(tick, simTimeMs, 0, z, true, true)
      );
    }

    const lapEvent = {
      vehicleId: 'v0',
      tick: 609,
      sessionMode: 'time_trial',
      trackId: 'track_switchyard_sprint',
      trackVersion: 'v2.0.0',
      geometryHash: 'hash_sw_01',
      physicsVersion: 'phys-2.0.0',
      rulesetVersion: 'rules-2.0.0',
      balanceVersionId: 'v1.0.0',
      buildId: 'build_starter_apex',
      buildSchemaVersion: 2,
      buildContentHash: 'bhash_apex_stock',
      chassisId: 'chassis_apex_fr',
      pwrRatio: 0.126,
      lapNumber: 1,
      lapTimeMs: 5000,
      sectorTimesMs: [1667, 1667, 1666],
      sectorNames: ['Main Straight', 'Infield S', 'Freight Hairpin'],
      deltaToBestLapMs: null,
      isPersonalBest: true,
      lapValid: true,
      invalidReasons: [],
      checkpointMask: 0b111,
      orderedCheckpointsHit: [0, 1, 2],
      peakSpeedMs: 22,
      peakSpeedKph: 79.2,
      isAiAssisted: false,
      verificationLevel: 'local',
    };

    const bundle = recorder.finalizeLap(lapEvent);
    assert.ok(bundle, 'Clean Time Trial run must produce a replay bundle');
    assert.equal(bundle.header.verificationLevel, 'local', 'Must not falsely claim verified before trusted replay');
    assert.equal(bundle.packedInputs.length, 1, 'Constant input for 600 ticks should RLE-pack to 1 run');
    assert.equal(bundle.poseSamples.length, 101, '600 ticks @ stride 6 + final sample = 101 pose samples');

    // Integrity check passes as sanity_checked (NOT verified)
    const integrity = replay.validateReplayIntegrity(bundle, {
      expectedTrackId: 'track_switchyard_sprint',
      expectedTrackVersion: 'v2.0.0',
      expectedBalanceVersionId: 'v1.0.0',
    });
    assert.equal(integrity.valid, true, `Integrity errors: ${integrity.errors.join('; ')}`);
    assert.equal(integrity.recommendedVerificationLevel, 'sanity_checked');

    // Reset must abort and prevent splicing
    recorder.beginRun({
      sessionMode: 'time_trial',
      driverDisplayName: 'Racer',
      track: startCp.track,
      ruleset: startCp.ruleset,
      buildMeta: startCp.vehicles[0].buildMeta,
      startCheckpoint: startCp,
    });
    recorder.recordFixedStep(
      {
        tick: 100,
        vehicleId: 'v0',
        controllerKind: 'local',
        inputSource: 'keyboard',
        throttle: 1,
        brake: 0,
        steer: 0,
        handbrake: 0,
        clutch: 0,
        flags: 0,
      },
      makeSnapshot(100, 10, 0, 0.2, true, true)
    );
    recorder.abortRun('manual_reset');
    assert.equal(recorder.finalizeLap(lapEvent), null, 'Reset run must never splice or produce a bundle');

    // === 3. GhostPlayer zero-collision interpolation & delta ===
    const player = new replay.GhostPlayer();
    player.load(bundle);
    assert.equal(player.isLoaded(), true);
    assert.equal(player.isCompatibleWithTrack(startCp.track), true);
    const midPose = player.sampleAtSimTimeMs(2500);
    assert.ok(midPose);
    assert.equal(midPose.collisionEnabled, false, 'Ghost must have zero collision');
    assert.ok(Math.abs(midPose.position.z - 55) < 0.5, `Expected z≈55m at 2.5s, got ${midPose.position.z}`);
    const qNorm = Math.hypot(midPose.rotation.x, midPose.rotation.y, midPose.rotation.z, midPose.rotation.w);
    assert.ok(Math.abs(qNorm - 1) < 1e-4, 'SLERP quaternion must remain unit-length');

    // === 4. GhostStorage PB partitioning & friend cache ===
    const storage = new replay.GhostStorage();
    const res1 = await storage.savePersonalBestIfFaster(bundle);
    assert.equal(res1.improved, true);
    const slower = structuredClone(bundle);
    slower.header.lapTimeMs = 5500;
    const res2 = await storage.savePersonalBestIfFaster(slower);
    assert.equal(res2.improved, false);
    const faster = structuredClone(bundle);
    faster.header.lapTimeMs = 4800;
    const res3 = await storage.savePersonalBestIfFaster(faster);
    assert.equal(res3.improved, true);
    assert.equal(res3.previousBestMs, 5000);
    await storage.cacheFriendGhost(bundle.header.replayId, bundle);
    const cached = await storage.getCachedFriendGhost(bundle.header.replayId);
    assert.equal(cached?.header.replayId, bundle.header.replayId);

    // === 5. Net protocol & host selection unit checks ===
    assert.throws(
      () => net.buildDirectOnlyRtcConfig(['turn:relay.example.com:3478']),
      /TURN relay URLs are strictly disabled/
    );
    assert.throws(
      () => net.buildDirectOnlyRtcConfig(['turns:relay.example.com:5349']),
      /TURN relay URLs are strictly disabled/
    );
    const rtcCfg = net.buildDirectOnlyRtcConfig();
    assert.deepEqual(rtcCfg.iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }]);

    // Host election chooses steadiest worst link & rejects relayed candidate
    const members = [
      { peerId: 'peerA', displayName: 'A', slotIndex: 0, joinedAtMs: 1, ready: true, connected: true, benchMedianMs: 5.0 },
      { peerId: 'peerB', displayName: 'B', slotIndex: 1, joinedAtMs: 2, ready: true, connected: true, benchMedianMs: 4.0 },
      { peerId: 'peerC', displayName: 'C', slotIndex: 2, joinedAtMs: 3, ready: true, connected: true, benchMedianMs: 6.0 },
      { peerId: 'peerD', displayName: 'D', slotIndex: 3, joinedAtMs: 4, ready: true, connected: true, benchMedianMs: 5.5 },
    ];
    const mk = (a, b, p95, loss, jitter, direct = true) => ({
      fromPeerId: a,
      toPeerId: b,
      reachable: true,
      probesSent: 10,
      probesReceived: Math.round(10 * (1 - loss / 100)),
      packetLossPct: loss,
      rttMedianMs: p95 * 0.8,
      rttP95Ms: p95,
      rttMaxMs: p95 * 1.1,
      jitterMs: jitter,
      icePathClass: direct ? 'direct_srflx' : 'relayed_turn',
      isDirect: direct,
      isRelayed: !direct,
      measuredAtMs: Date.now(),
    });
    const linkMatrix = {
      // peerA has a spiky worst link (110ms p95)
      'peerA->peerB': mk('peerA', 'peerB', 25, 0, 2),
      'peerA->peerC': mk('peerA', 'peerC', 110, 0, 15),
      'peerA->peerD': mk('peerA', 'peerD', 30, 0, 3),
      // peerB has the steadiest worst link (all <= 28ms, 0% loss, direct)
      'peerB->peerA': mk('peerB', 'peerA', 25, 0, 2),
      'peerB->peerC': mk('peerB', 'peerC', 28, 0, 3),
      'peerB->peerD': mk('peerB', 'peerD', 24, 0, 2),
      // peerC has a relayed link -> ineligible under direct-only policy
      'peerC->peerA': mk('peerC', 'peerA', 20, 0, 1, false),
      'peerC->peerB': mk('peerC', 'peerB', 20, 0, 1),
      'peerC->peerD': mk('peerC', 'peerD', 20, 0, 1),
      // peerD is 2nd steadiest (worst 42ms)
      'peerD->peerA': mk('peerD', 'peerA', 30, 0, 3),
      'peerD->peerB': mk('peerD', 'peerB', 24, 0, 2),
      'peerD->peerC': mk('peerD', 'peerC', 42, 0, 4),
    };
    const decision = net.selectHostAndBackup(members, linkMatrix, { authorityEpoch: 1 });
    assert.equal(decision.hostPeerId, 'peerB', 'peerB should win with steadiest worst link');
    assert.equal(decision.backupHostPeerId, 'peerD', 'peerD should be named backup');
    assert.equal(decision.rankings.find((r) => r.peerId === 'peerC').eligible, false, 'Relayed peerC must be ineligible');
    assert.equal(net.isHostAuthorityValid(3, 'peerD', 2, 'peerB'), false, 'Stale epoch must be rejected');
    assert.equal(net.isHostAuthorityValid(3, 'peerD', 3, 'peerB'), false, 'Wrong host at same epoch must be rejected');
    assert.equal(net.isHostAuthorityValid(3, 'peerD', 4, 'peerD'), true, 'Higher epoch must be accepted');

    console.log(
      JSON.stringify(
        {
          ok: true,
          replayRleRuns: packed.length,
          replayPoseSamples: bundle.poseSamples.length,
          replayIntegrityBytes: integrity.estimatedBytes,
          replayIntegrityLevel: integrity.recommendedVerificationLevel,
          turnRejectionVerified: true,
          hostElectionWinner: decision.hostPeerId,
          hostElectionBackup: decision.backupHostPeerId,
        },
        null,
        2
      )
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('REPLAY/NET UNIT CHECKS FAILED:', err);
  process.exit(1);
});
