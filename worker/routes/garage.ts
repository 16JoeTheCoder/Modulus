import { Hono } from 'hono';
import { CHASSIS_BY_ID, PARTS_BY_ID, STARTER_OWNED_PART_IDS, TRACKS_BY_ID } from '../../src/content';
import { compileVehicleBuild } from '../../src/core/math/vehicleCompiler';
import {
  PurchasePartBodySchema,
  SaveBuildBodySchema,
  SubmitLapBodySchema,
  type ILapLeaderboardEntry,
  type ISavedBuildRecord,
  type IVehicleBuildConfig,
} from '../../src/core/types';
import { maskEmail } from '../auth/crypto';
import { requireAuth } from '../auth/session';
import { getActiveBalanceConfig, getUserGarageSync } from '../db/queries';
import type { HonoEnv } from '../types';

export const publicAndGarageRoutes = new Hono<HonoEnv>();

publicAndGarageRoutes.get('/config/public', async (c) => {
  const config = await getActiveBalanceConfig(c.env);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(config);
});

publicAndGarageRoutes.get('/garage', requireAuth, async (c) => {
  const user = c.get('user')!;
  const syncData = await getUserGarageSync(c.env.DB, user);
  return c.json(syncData);
});

publicAndGarageRoutes.post('/garage/build', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = SaveBuildBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid vehicle build configuration' },
      400
    );
  }

  const { setActive } = parsed.data;
  const build = parsed.data.build as IVehicleBuildConfig;
  const activeConfig = await getActiveBalanceConfig(c.env);
  const compiled = compileVehicleBuild(build, activeConfig);

  const pwrCap = activeConfig.economy_bias.max_pwr_ratio_cap;
  if (pwrCap > 0 && compiled.pwrRatioHpPerKg > pwrCap) {
    return c.json(
      {
        error: `Build P/W (${compiled.pwrRatioHpPerKg.toFixed(3)} HP/kg) exceeds active regulation cap (${pwrCap.toFixed(3)} HP/kg).`,
      },
      400
    );
  }

  const nowIso = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  if (setActive) {
    statements.push(
      c.env.DB.prepare('UPDATE builds SET is_active = 0 WHERE user_id = ?').bind(user.id)
    );
  }

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO builds (id, user_id, name, chassis_id, build_json, total_mass_kg, peak_power_hp, pwr_ratio, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         chassis_id = excluded.chassis_id,
         build_json = excluded.build_json,
         total_mass_kg = excluded.total_mass_kg,
         peak_power_hp = excluded.peak_power_hp,
         pwr_ratio = excluded.pwr_ratio,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at
       WHERE builds.user_id = excluded.user_id`
    ).bind(
      build.id,
      user.id,
      build.name,
      build.chassisId,
      JSON.stringify(build),
      compiled.totalMassKg,
      compiled.peakPowerHp,
      compiled.pwrRatioHpPerKg,
      setActive ? 1 : 0,
      nowIso,
      nowIso
    )
  );

  await c.env.DB.batch(statements);

  const record: ISavedBuildRecord = {
    id: build.id,
    name: build.name,
    chassisId: build.chassisId,
    build,
    totalMassKg: compiled.totalMassKg,
    peakPowerHp: compiled.peakPowerHp,
    pwrRatio: compiled.pwrRatioHpPerKg,
    isActive: setActive,
    updatedAt: nowIso,
  };

  return c.json({ ok: true, build: record });
});

publicAndGarageRoutes.post('/shop/buy', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = PurchasePartBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid partId' }, 400);
  }

  const { partId } = parsed.data;
  const item = PARTS_BY_ID.get(partId) ?? CHASSIS_BY_ID.get(partId);
  if (!item) {
    return c.json({ error: `Unknown catalog item: ${partId}` }, 404);
  }

  // Check if already owned or unlockAll
  const existingInv = await c.env.DB.prepare(
    'SELECT part_id FROM inventory WHERE user_id = ?'
  )
    .bind(user.id)
    .all<{ part_id: string }>();

  const ownedSet = new Set([
    ...STARTER_OWNED_PART_IDS,
    ...(existingInv.results ?? []).map((r) => r.part_id),
  ]);

  if (user.unlockAll || ownedSet.has(partId)) {
    return c.json({
      ok: true,
      credits: user.credits,
      ownedPartIds: Array.from(ownedSet),
    });
  }

  const activeConfig = await getActiveBalanceConfig(c.env);
  const effectivePrice = Math.max(
    0,
    Math.round(item.price * activeConfig.economy_bias.part_price_mult)
  );

  if (user.credits < effectivePrice) {
    return c.json(
      { error: `Insufficient credits (Need ${effectivePrice.toLocaleString()} CR)` },
      400
    );
  }

  const nowIso = new Date().toISOString();
  const invId = `inv_${crypto.randomUUID()}`;

  const [deductRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users
       SET credits = credits - ?, updated_at = ?
       WHERE id = ? AND credits >= ?`
    ).bind(effectivePrice, nowIso, user.id, effectivePrice),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO inventory (id, user_id, part_id, acquired_via, acquired_at)
       VALUES (?, ?, ?, 'shop', ?)`
    ).bind(invId, user.id, partId, nowIso),
  ]);

  if ((deductRes.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'Insufficient credits' }, 400);
  }

  const updatedUser = await c.env.DB.prepare('SELECT credits FROM users WHERE id = ? LIMIT 1')
    .bind(user.id)
    .first<{ credits: number }>();

  ownedSet.add(partId);

  return c.json({
    ok: true,
    credits: updatedUser?.credits ?? Math.max(0, user.credits - effectivePrice),
    ownedPartIds: Array.from(ownedSet),
  });
});

interface LapJoinRow {
  id: string;
  user_id: string;
  email: string;
  track_id: string;
  balance_version_id: string;
  lap_time_ms: number;
  sector_times_json: string;
  chassis_id: string;
  peak_speed_kph: number;
  pwr_ratio: number;
  is_ai_assisted: number;
  created_at: string;
}

publicAndGarageRoutes.get('/laps', async (c) => {
  const trackId = c.req.query('trackId')?.trim();
  if (!trackId) {
    return c.json({ error: 'trackId query parameter is required' }, 400);
  }

  const activeConfig = await getActiveBalanceConfig(c.env);
  const versionId = c.req.query('version')?.trim() || activeConfig.version_id;

  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.user_id, u.email, l.track_id, l.balance_version_id, l.lap_time_ms,
            l.sector_times_json, l.chassis_id, l.peak_speed_kph, l.pwr_ratio,
            l.is_ai_assisted, l.created_at
     FROM lap_records l
     INNER JOIN users u ON u.id = l.user_id
     WHERE l.track_id = ? AND l.balance_version_id = ?
     ORDER BY l.lap_time_ms ASC
     LIMIT 50`
  )
    .bind(trackId, versionId)
    .all<LapJoinRow>();

  const records: ILapLeaderboardEntry[] = (rows.results ?? []).map((row) => {
    let sectorTimesMs: number[] = [];
    try {
      const parsed = JSON.parse(row.sector_times_json);
      if (Array.isArray(parsed)) sectorTimesMs = parsed.map(Number);
    } catch {
      sectorTimesMs = [];
    }
    return {
      id: row.id,
      userId: row.user_id,
      emailMasked: maskEmail(row.email),
      trackId: row.track_id,
      balanceVersionId: row.balance_version_id,
      lapTimeMs: row.lap_time_ms,
      sectorTimesMs,
      chassisId: row.chassis_id,
      peakSpeedKph: row.peak_speed_kph,
      pwrRatio: row.pwr_ratio,
      isAiAssisted: row.is_ai_assisted === 1,
      createdAt: row.created_at,
    };
  });

  return c.json({ versionId, records });
});

publicAndGarageRoutes.post('/laps', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = SubmitLapBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid lap payload' }, 400);
  }

  const data = parsed.data;
  const activeConfig = await getActiveBalanceConfig(c.env);
  const track = TRACKS_BY_ID.get(data.trackId);
  const baseReward = track?.baseLapRewardCredits ?? 2500;
  const aiMult = data.isAiAssisted ? 0.35 : 1.0;
  const creditsAwarded = Math.max(
    250,
    Math.round(baseReward * activeConfig.economy_bias.payout_mult * aiMult)
  );

  const lapId = `lap_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();

  // Verify buildId belongs to user if provided; otherwise null to satisfy FK cleanly
  let verifiedBuildId: string | null = null;
  if (data.buildId) {
    const buildExists = await c.env.DB.prepare(
      'SELECT id FROM builds WHERE id = ? AND user_id = ? LIMIT 1'
    )
      .bind(data.buildId, user.id)
      .first<{ id: string }>();
    if (buildExists) {
      verifiedBuildId = buildExists.id;
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO lap_records (
        id, user_id, build_id, track_id, balance_version_id, lap_time_ms,
        sector_times_json, chassis_id, peak_speed_kph, pwr_ratio,
        is_ai_assisted, credits_awarded, telemetry_summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      lapId,
      user.id,
      verifiedBuildId,
      data.trackId,
      activeConfig.version_id,
      data.lapTimeMs,
      JSON.stringify(data.sectorTimesMs),
      data.chassisId,
      data.peakSpeedKph,
      data.pwrRatio,
      data.isAiAssisted ? 1 : 0,
      creditsAwarded,
      JSON.stringify(data.telemetrySummary ?? {}),
      nowIso
    ),
    c.env.DB.prepare('UPDATE users SET credits = credits + ?, updated_at = ? WHERE id = ?').bind(
      creditsAwarded,
      nowIso,
      user.id
    ),
  ]);

  const updatedUser = await c.env.DB.prepare('SELECT credits FROM users WHERE id = ? LIMIT 1')
    .bind(user.id)
    .first<{ credits: number }>();

  return c.json({
    ok: true,
    id: lapId,
    balanceVersionId: activeConfig.version_id,
    creditsAwarded,
    credits: updatedUser?.credits ?? user.credits + creditsAwarded,
  });
});
