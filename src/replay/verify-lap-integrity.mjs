import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const DEV_PORT = Number(process.env.MODULUS_INTEGRITY_PORT || 5192);
const BASE_URL = `http://127.0.0.1:${DEV_PORT}`;

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

async function runPureSanityUnitTests() {
  const tempDir = await mkdtemp(join(tmpdir(), 'modulus-lap-sanity-'));
  try {
    const outPath = join(tempDir, 'lapIntegrity.mjs');
    await esbuild.build({
      entryPoints: [resolve('worker/routes/lapIntegrity.ts')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      outfile: outPath,
    });
    const mod = await import(pathToFileURL(outPath).href);

    const contentOut = join(tempDir, 'content.mjs');
    await esbuild.build({
      entryPoints: [resolve('src/content/index.ts')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      outfile: contentOut,
    });
    const content = await import(pathToFileURL(contentOut).href);
    const gpTrack = content.TRACKS_BY_ID.get('track_gp_circuit');
    assert.ok(gpTrack, 'track_gp_circuit must exist');

    const lenM = mod.estimateTrackLengthMeters(gpTrack);
    assert.ok(lenM > 1000, `Expected GP circuit chord length > 1000m, got ${lenM}`);

    // 1. Clean Time Trial lap with full checkpoints -> sanity_checked (never verified)
    const clean = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        trackVersion: 'v1.0.0',
        physicsVersion: 'phys-2.0.0',
        rulesetVersion: 'rules-2.0.0',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [19000, 19500, 19500],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b111,
        orderedCheckpointsHit: [0, 1, 2],
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(clean.ok, true);
    assert.equal(clean.verificationLevel, 'sanity_checked');
    assert.notEqual(clean.verificationLevel, 'verified');

    // 2. Legacy Time Trial lap without checkpointMask -> unverified (still valid for backwards compat)
    const legacy = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        lapTimeMs: 59000,
        sectorTimesMs: [19500, 19500, 20000],
        peakSpeedKph: 215,
        pwrRatio: 0.18,
        isAiAssisted: false,
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(legacy.ok, true);
    assert.equal(legacy.verificationLevel, 'unverified');

    // 3. Friend Race & AI Race & AI-assisted rejected
    for (const badMode of ['friend_race', 'ai_race', 'practice', 'drift']) {
      const r = mod.evaluateLapSubmissionSanity(
        {
          trackId: 'track_gp_circuit',
          balanceVersionId: 'v1.0.0',
          sessionMode: badMode,
          lapTimeMs: 58000,
          sectorTimesMs: [19000, 19500, 19500],
          peakSpeedKph: 220,
          pwrRatio: 0.18,
          isAiAssisted: false,
          checkpointMask: 0b111,
        },
        gpTrack,
        'v1.0.0'
      );
      assert.equal(r.ok, false, `Mode ${badMode} must be rejected`);
      assert.equal(r.code, 'MODE_NOT_ELIGIBLE');
    }
    const aiAssisted = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [19000, 19500, 19500],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: true,
        checkpointMask: 0b111,
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(aiAssisted.ok, false);
    assert.equal(aiAssisted.code, 'MODE_NOT_ELIGIBLE');

    // 4. Forged impossibly fast lap rejected
    const forgedFast = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 6000,
        sectorTimesMs: [2000, 2000, 2000],
        peakSpeedKph: 500,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b111,
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(forgedFast.ok, false);
    assert.equal(forgedFast.code, 'IMPLAUSIBLE_LAP_TIME');

    // 5. Sector sum mismatch rejected
    const badSectors = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [20000, 20000, 20000],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b111,
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(badSectors.ok, false);
    assert.equal(badSectors.code, 'INVALID_SECTORS');

    // 6. Incomplete checkpoint mask & out-of-order checkpoints rejected
    const badMask = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [19000, 19500, 19500],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b011,
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(badMask.ok, false);
    assert.equal(badMask.code, 'INVALID_CHECKPOINTS');

    const badOrder = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [19000, 19500, 19500],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b111,
        orderedCheckpointsHit: [0, 2, 1],
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(badOrder.ok, false);
    assert.equal(badOrder.code, 'INVALID_CHECKPOINTS');

    // 7. Oversized telemetry rejected
    const bigPayload = mod.evaluateLapSubmissionSanity(
      {
        trackId: 'track_gp_circuit',
        balanceVersionId: 'v1.0.0',
        sessionMode: 'time_trial',
        lapTimeMs: 58000,
        sectorTimesMs: [19000, 19500, 19500],
        peakSpeedKph: 220,
        pwrRatio: 0.18,
        isAiAssisted: false,
        checkpointMask: 0b111,
        telemetrySummary: { blob: 'x'.repeat(20_000) },
      },
      gpTrack,
      'v1.0.0'
    );
    assert.equal(bigPayload.ok, false);
    assert.equal(bigPayload.code, 'PAYLOAD_TOO_LARGE');

    return { gpTrackChordLengthM: lenM, pureSanityChecksPassed: 10 };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runWranglerLocalSql(sql) {
  const wranglerBin = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  execFileSync(process.execPath, [wranglerBin, 'd1', 'execute', 'modulus-db', '--local', '--command', sql], {
    stdio: 'pipe',
  });
}

async function runLocalWorkerApiTests() {
  const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const viteProc = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
    { stdio: 'pipe' }
  );

  const testEmail = `rivals.fixture.${Date.now()}@example.test`;
  const legacyManualId = `lap_legacy_manual_${Date.now()}`;
  const legacyAiId = `lap_legacy_ai_${Date.now()}`;
  const createdLapIds = [];

  try {
    await waitForHttp(`${BASE_URL}/api/config/public`, 25_000);

    // 1. Authenticate disposable local fixture user via DEV_MODE OTP
    const reqOtpRes = await fetch(`${BASE_URL}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });
    assert.equal(reqOtpRes.status, 200, 'request-otp must succeed in local DEV_MODE');
    const reqOtpJson = await reqOtpRes.json();
    assert.ok(reqOtpJson.devOtpCode, 'Local .dev.vars must have DEV_MODE=true for fixture OTP');

    const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: reqOtpJson.devOtpCode }),
    });
    assert.equal(verifyRes.status, 200, 'verify-otp must succeed');
    const setCookie = verifyRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Session cookie must be issued');
    const cookieHeader = setCookie.split(';')[0];
    const verifyJson = await verifyRes.json();
    const userId = verifyJson.user.id;

    // 2. Seed one legacy historical manual Time Trial row (default migration columns) and one legacy AI row
    runWranglerLocalSql(
      `INSERT INTO lap_records (id, user_id, track_id, balance_version_id, lap_time_ms, sector_times_json, chassis_id, peak_speed_kph, pwr_ratio, is_ai_assisted, credits_awarded) VALUES ('${legacyManualId}', '${userId}', 'track_gp_circuit', 'v1.0.0', 61234, '[20000,20500,20734]', 'chassis_apex_fr', 210, 0.18, 0, 4500);`
    );
    runWranglerLocalSql(
      `INSERT INTO lap_records (id, user_id, track_id, balance_version_id, lap_time_ms, sector_times_json, chassis_id, peak_speed_kph, pwr_ratio, is_ai_assisted, credits_awarded, session_mode) VALUES ('${legacyAiId}', '${userId}', 'track_gp_circuit', 'v1.0.0', 49000, '[16000,16500,16500]', 'chassis_apex_fr', 235, 0.18, 1, 1575, 'ai_race');`
    );

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    };

    // 3. Submit valid clean Time Trial lap (even if client tries to smuggle verificationLevel='verified', server assigns sanity_checked)
    const validLapBody = {
      trackId: 'track_gp_circuit',
      trackVersion: 'v1.0.0',
      chassisId: 'chassis_apex_fr',
      balanceVersionId: 'v1.0.0',
      physicsVersion: 'phys-2.0.0',
      rulesetVersion: 'rules-2.0.0',
      weatherKey: 'clear_dry',
      assistPreset: 'beginner',
      transmissionMode: 'auto',
      sessionMode: 'time_trial',
      verificationLevel: 'verified', // spoof attempt: must be ignored
      lapTimeMs: 57500,
      sectorTimesMs: [19000, 19200, 19300],
      checkpointMask: 7,
      orderedCheckpointsHit: [0, 1, 2],
      peakSpeedKph: 224.5,
      pwrRatio: 0.18,
      isAiAssisted: false,
    };
    const postValid = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validLapBody),
    });
    assert.equal(postValid.status, 200, `Valid lap should return 200, got ${postValid.status}`);
    const validJson = await postValid.json();
    assert.equal(validJson.verificationLevel, 'sanity_checked', 'Client-spoofed verified must be ignored');
    assert.equal(validJson.trackVersion, 'v1.0.0');
    assert.equal(validJson.physicsVersion, 'phys-2.0.0');
    assert.equal(validJson.sessionMode, 'time_trial');
    createdLapIds.push(validJson.id);

    // 4. Duplicate submission of identical lap -> 409 Conflict
    const postDup = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(validLapBody),
    });
    assert.equal(postDup.status, 409, 'Duplicate lap submission must return 409');

    // 5. Friend Race rejected (400)
    const postFriend = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...validLapBody, sessionMode: 'friend_race', lapTimeMs: 56900, sectorTimesMs: [18900, 19000, 19000] }),
    });
    assert.equal(postFriend.status, 400);
    assert.equal((await postFriend.json()).code, 'MODE_NOT_ELIGIBLE');

    // 6. AI-assisted rejected (400)
    const postAi = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...validLapBody, isAiAssisted: true, lapTimeMs: 56800, sectorTimesMs: [18800, 19000, 19000] }),
    });
    assert.equal(postAi.status, 400);
    assert.equal((await postAi.json()).code, 'MODE_NOT_ELIGIBLE');

    // 7. Forged fast lap rejected (400)
    const postForged = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...validLapBody, lapTimeMs: 6500, sectorTimesMs: [2100, 2200, 2200] }),
    });
    assert.equal(postForged.status, 400);
    assert.equal((await postForged.json()).code, 'IMPLAUSIBLE_LAP_TIME');

    // 8. Bad sector sum rejected (400)
    const postBadSectors = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...validLapBody, lapTimeMs: 57600, sectorTimesMs: [20000, 20000, 20000] }),
    });
    assert.equal(postBadSectors.status, 400);
    assert.equal((await postBadSectors.json()).code, 'INVALID_SECTORS');

    // 9. Incomplete checkpoint mask rejected (400)
    const postBadMask = await fetch(`${BASE_URL}/api/laps`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...validLapBody, lapTimeMs: 57700, sectorTimesMs: [19200, 19200, 19300], checkpointMask: 3 }),
    });
    assert.equal(postBadMask.status, 400);
    assert.equal((await postBadMask.json()).code, 'INVALID_CHECKPOINTS');

    // 10. Official leaderboard read: includes clean Time Trial + legacy manual row, EXCLUDES AI row, never shows 'verified'
    const getBoard = await fetch(`${BASE_URL}/api/laps?trackId=track_gp_circuit&version=v1.0.0`);
    assert.equal(getBoard.status, 200);
    const boardJson = await getBoard.json();
    const ids = boardJson.records.map((r) => r.id);
    assert.ok(ids.includes(validJson.id), 'New sanity_checked Time Trial lap must appear');
    assert.ok(ids.includes(legacyManualId), 'Historical migrated Time Trial lap must remain readable');
    assert.ok(!ids.includes(legacyAiId), 'AI lap must be strictly excluded from official leaderboard');

    const newRow = boardJson.records.find((r) => r.id === validJson.id);
    const legacyRow = boardJson.records.find((r) => r.id === legacyManualId);
    assert.equal(newRow.verificationLevel, 'sanity_checked');
    assert.equal(newRow.isLegacyVersion, false);
    assert.equal(legacyRow.verificationLevel, 'unverified');
    assert.equal(legacyRow.trackVersion, 'v1.0.0');
    assert.equal(legacyRow.isLegacyVersion, true, 'Legacy phys-1.0.0 row must be labeled isLegacyVersion=true');
    for (const r of boardJson.records) {
      assert.notEqual(r.verificationLevel, 'verified', 'verified must remain unreachable without trusted replay');
      assert.equal(r.isAiAssisted, false);
      assert.equal(r.sessionMode, 'time_trial');
    }

    // Cleanup disposable fixture user (cascades sessions & lap_records)
    runWranglerLocalSql(`DELETE FROM users WHERE email = '${testEmail}';`);
    runWranglerLocalSql(`DELETE FROM otp_codes WHERE email = '${testEmail}';`);

    return {
      apiAuthPassed: true,
      validTimeTrialAcceptedAs: newRow.verificationLevel,
      legacyRowPreservedAs: legacyRow.verificationLevel,
      legacyRowFlaggedLegacy: legacyRow.isLegacyVersion,
      aiRowExcludedFromLeaderboard: true,
      duplicateSubmissionRejected409: true,
      friendRaceRejected400: true,
      forgedFastLapRejected400: true,
      badSectorsRejected400: true,
      badCheckpointMaskRejected400: true,
      verifiedUnreachableConfirmed: true,
    };
  } finally {
    viteProc.kill();
    await sleep(300);
  }
}

async function main() {
  const unit = await runPureSanityUnitTests();
  const api = await runLocalWorkerApiTests();
  console.log(JSON.stringify({ ok: true, unit, api }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('LAP INTEGRITY VERIFICATION FAILED:', err);
    process.exit(1);
  });
