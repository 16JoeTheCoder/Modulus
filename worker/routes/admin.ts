import { Hono } from 'hono';
import {
  AdminPublishConfigBodySchema,
  AdminUserGrantBodySchema,
  didPhysicsBiasChange,
  GlobalBalanceConfigSchema,
  type IAdminUserSummary,
  type IAuditLogRecord,
  type IBalanceSnapshotRecord,
  type IGlobalBalanceConfig,
} from '../../src/core/types';
import { requireAdmin } from '../auth/session';
import {
  getActiveBalanceConfig,
  incrementSemverPatch,
  KV_BALANCE_CONFIG_KEY,
  prepareAuditLogStatement,
} from '../db/queries';
import type { HonoEnv } from '../types';

export const adminRoutes = new Hono<HonoEnv>();

// Strict Dual Server-Side Gate on EVERY /api/admin/* route
adminRoutes.use('*', requireAdmin);

interface SnapshotRow {
  version_id: string;
  config_json: string;
  published_by: string;
  notes: string;
  created_at: string;
}

interface AuditRow {
  id: string;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  payload_json: string;
  created_at: string;
}

interface AdminLapRow {
  id: string;
  user_id: string;
  email: string;
  track_id: string;
  balance_version_id: string;
  lap_time_ms: number;
  chassis_id: string;
  peak_speed_kph: number;
  pwr_ratio: number;
  is_ai_assisted: number;
  created_at: string;
}

adminRoutes.get('/config', async (c) => {
  const activeConfig = await getActiveBalanceConfig(c.env);

  const [snapRes, auditRes, lapsRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT version_id, config_json, published_by, notes, created_at
       FROM balance_snapshots
       ORDER BY created_at DESC
       LIMIT 20`
    ),
    c.env.DB.prepare(
      `SELECT id, admin_email, action, target_user_id, payload_json, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 40`
    ),
    c.env.DB.prepare(
      `SELECT l.id, l.user_id, u.email, l.track_id, l.balance_version_id, l.lap_time_ms,
              l.chassis_id, l.peak_speed_kph, l.pwr_ratio, l.is_ai_assisted, l.created_at
       FROM lap_records l
       INNER JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC
       LIMIT 30`
    ),
  ]);

  const snapshots: IBalanceSnapshotRecord[] = [];
  for (const row of (snapRes.results ?? []) as SnapshotRow[]) {
    try {
      const parsed = JSON.parse(row.config_json) as IGlobalBalanceConfig;
      snapshots.push({
        versionId: row.version_id,
        config: parsed,
        publishedBy: row.published_by,
        notes: row.notes,
        createdAt: row.created_at,
      });
    } catch {
      // Skip malformed snapshot
    }
  }

  const auditLogs: IAuditLogRecord[] = ((auditRes.results ?? []) as AuditRow[]).map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      adminEmail: row.admin_email,
      action: row.action,
      targetUserId: row.target_user_id,
      payload,
      createdAt: row.created_at,
    };
  });

  const recentLaps = ((lapsRes.results ?? []) as AdminLapRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    trackId: row.track_id,
    balanceVersionId: row.balance_version_id,
    lapTimeMs: row.lap_time_ms,
    chassisId: row.chassis_id,
    peakSpeedKph: row.peak_speed_kph,
    pwrRatio: row.pwr_ratio,
    isAiAssisted: row.is_ai_assisted === 1,
    createdAt: row.created_at,
  }));

  return c.json({
    activeConfig,
    snapshots,
    auditLogs,
    recentLaps,
  });
});

adminRoutes.put('/config', async (c) => {
  const admin = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const parsed = AdminPublishConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid balance config payload' },
      400
    );
  }

  const currentConfig = await getActiveBalanceConfig(c.env);
  const { config: incoming, notes } = parsed.data;
  const physicsChanged = didPhysicsBiasChange(currentConfig.physics_bias, incoming.physics_bias);

  let nextVersionId = incoming.version_id.trim();
  if (physicsChanged && nextVersionId === currentConfig.version_id) {
    nextVersionId = incrementSemverPatch(currentConfig.version_id);
  }

  // Ensure snapshot primary key won't collide if user didn't bump version
  const existingSnap = await c.env.DB.prepare(
    'SELECT version_id FROM balance_snapshots WHERE version_id = ? LIMIT 1'
  )
    .bind(nextVersionId)
    .first<{ version_id: string }>();

  if (existingSnap && nextVersionId === currentConfig.version_id) {
    nextVersionId = incrementSemverPatch(nextVersionId);
  }

  const nowIso = new Date().toISOString();
  const finalConfig: IGlobalBalanceConfig = {
    ...incoming,
    version_id: nextVersionId,
    updated_at: nowIso,
  };

  await c.env.MODULUS_KV.put(KV_BALANCE_CONFIG_KEY, JSON.stringify(finalConfig));

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO balance_snapshots (version_id, config_json, published_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(nextVersionId, JSON.stringify(finalConfig), admin.email, notes, nowIso),
    prepareAuditLogStatement(c.env.DB, admin.email, 'config.publish', null, {
      previousVersionId: currentConfig.version_id,
      versionId: nextVersionId,
      physicsChanged,
      notes,
    }),
  ]);

  return c.json({
    ok: true,
    activeConfig: finalConfig,
    physicsChanged,
  });
});

adminRoutes.post('/config/rollback/:version_id', async (c) => {
  const admin = c.get('user')!;
  const versionId = decodeURIComponent(c.req.param('version_id'));

  const snap = await c.env.DB.prepare(
    'SELECT version_id, config_json FROM balance_snapshots WHERE version_id = ? LIMIT 1'
  )
    .bind(versionId)
    .first<{ version_id: string; config_json: string }>();

  if (!snap) {
    return c.json({ error: `Snapshot ${versionId} not found` }, 404);
  }

  let parsedConfig: IGlobalBalanceConfig;
  try {
    const raw = JSON.parse(snap.config_json);
    const validated = GlobalBalanceConfigSchema.safeParse(raw);
    if (!validated.success) {
      return c.json({ error: 'Stored snapshot failed schema validation' }, 500);
    }
    parsedConfig = {
      ...validated.data,
      updated_at: new Date().toISOString(),
    };
  } catch {
    return c.json({ error: 'Failed to parse snapshot JSON' }, 500);
  }

  await c.env.MODULUS_KV.put(KV_BALANCE_CONFIG_KEY, JSON.stringify(parsedConfig));
  await prepareAuditLogStatement(c.env.DB, admin.email, 'config.rollback', null, {
    restoredVersionId: versionId,
  }).run();

  return c.json({ ok: true, activeConfig: parsedConfig });
});

interface AdminUserRow {
  id: string;
  email: string;
  role: 'player' | 'admin';
  credits: number;
  unlock_all: number;
  created_at: string;
  builds_count: number;
}

adminRoutes.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();

  const usersRes = q
    ? await c.env.DB.prepare(
        `SELECT u.id, u.email, u.role, u.credits, u.unlock_all, u.created_at,
                (SELECT COUNT(*) FROM builds b WHERE b.user_id = u.id) AS builds_count
         FROM users u
         WHERE u.email LIKE ? OR u.id = ?
         ORDER BY u.created_at DESC
         LIMIT 50`
      )
        .bind(`%${q}%`, q)
        .all<AdminUserRow>()
    : await c.env.DB.prepare(
        `SELECT u.id, u.email, u.role, u.credits, u.unlock_all, u.created_at,
                (SELECT COUNT(*) FROM builds b WHERE b.user_id = u.id) AS builds_count
         FROM users u
         ORDER BY u.created_at DESC
         LIMIT 50`
      ).all<AdminUserRow>();

  const rows = usersRes.results ?? [];
  if (rows.length === 0) {
    return c.json({ users: [] });
  }

  // Fetch inventories for matched users in a single batch using idx_inventory_user_id
  const invBatch = await c.env.DB.batch(
    rows.map((u) =>
      c.env.DB.prepare('SELECT part_id FROM inventory WHERE user_id = ?').bind(u.id)
    )
  );

  const users: IAdminUserSummary[] = rows.map((row, idx) => {
    const invRows = (invBatch[idx]?.results ?? []) as Array<{ part_id: string }>;
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      credits: row.credits,
      unlockAll: row.unlock_all === 1,
      buildsCount: Number(row.builds_count ?? 0),
      ownedPartIds: invRows.map((r) => r.part_id),
      createdAt: row.created_at,
    };
  });

  return c.json({ users });
});

adminRoutes.post('/users/:id/grant', async (c) => {
  const admin = c.get('user')!;
  const targetUserId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = AdminUserGrantBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid grant payload' }, 400);
  }

  const target = await c.env.DB.prepare(
    'SELECT id, email, role, credits, unlock_all, created_at FROM users WHERE id = ? LIMIT 1'
  )
    .bind(targetUserId)
    .first<Omit<AdminUserRow, 'builds_count'>>();

  if (!target) {
    return c.json({ error: 'Target user not found' }, 404);
  }

  const data = parsed.data;
  const nowIso = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  let nextCredits = target.credits;
  if (typeof data.credits_exact === 'number') {
    nextCredits = Math.max(0, Math.min(10_000_000, data.credits_exact));
  } else if (typeof data.credits_delta === 'number') {
    nextCredits = Math.max(0, Math.min(10_000_000, target.credits + data.credits_delta));
  }

  const nextUnlockAll =
    typeof data.unlock_all === 'boolean' ? (data.unlock_all ? 1 : 0) : target.unlock_all;

  if (nextCredits !== target.credits || nextUnlockAll !== target.unlock_all) {
    statements.push(
      c.env.DB.prepare(
        'UPDATE users SET credits = ?, unlock_all = ?, updated_at = ? WHERE id = ?'
      ).bind(nextCredits, nextUnlockAll, nowIso, targetUserId)
    );
  }

  if (data.grant_part_ids && data.grant_part_ids.length > 0) {
    for (const partId of data.grant_part_ids) {
      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO inventory (id, user_id, part_id, acquired_via, acquired_at)
           VALUES (?, ?, ?, 'admin_grant', ?)`
        ).bind(`inv_${crypto.randomUUID()}`, targetUserId, partId, nowIso)
      );
    }
  }

  if (data.revoke_part_ids && data.revoke_part_ids.length > 0) {
    for (const partId of data.revoke_part_ids) {
      statements.push(
        c.env.DB.prepare('DELETE FROM inventory WHERE user_id = ? AND part_id = ?').bind(
          targetUserId,
          partId
        )
      );
    }
  }

  statements.push(
    prepareAuditLogStatement(c.env.DB, admin.email, 'user.grant', targetUserId, {
      targetEmail: target.email,
      previousCredits: target.credits,
      nextCredits,
      unlockAll: nextUnlockAll === 1,
      grantedParts: data.grant_part_ids ?? [],
      revokedParts: data.revoke_part_ids ?? [],
    })
  );

  await c.env.DB.batch(statements);

  const [invRes, countRes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT part_id FROM inventory WHERE user_id = ?').bind(targetUserId),
    c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM builds WHERE user_id = ?').bind(targetUserId),
  ]);

  const ownedPartIds = ((invRes.results ?? []) as Array<{ part_id: string }>).map(
    (r) => r.part_id
  );
  const buildsCount = Number(
    ((countRes.results ?? [])[0] as { cnt?: number } | undefined)?.cnt ?? 0
  );

  const summary: IAdminUserSummary = {
    id: target.id,
    email: target.email,
    role: target.role,
    credits: nextCredits,
    unlockAll: nextUnlockAll === 1,
    buildsCount,
    ownedPartIds,
    createdAt: target.created_at,
  };

  return c.json({ ok: true, user: summary });
});

adminRoutes.delete('/leaderboards/:record_id', async (c) => {
  const admin = c.get('user')!;
  const recordId = c.req.param('record_id');

  const existing = await c.env.DB.prepare(
    'SELECT id, user_id, track_id, balance_version_id, lap_time_ms FROM lap_records WHERE id = ? LIMIT 1'
  )
    .bind(recordId)
    .first<{
      id: string;
      user_id: string;
      track_id: string;
      balance_version_id: string;
      lap_time_ms: number;
    }>();

  if (!existing) {
    return c.json({ error: 'Lap record not found' }, 404);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM lap_records WHERE id = ?').bind(recordId),
    prepareAuditLogStatement(c.env.DB, admin.email, 'leaderboard.delete', existing.user_id, {
      recordId: existing.id,
      trackId: existing.track_id,
      balanceVersionId: existing.balance_version_id,
      lapTimeMs: existing.lap_time_ms,
    }),
  ]);

  return c.json({ ok: true, deletedId: recordId });
});
