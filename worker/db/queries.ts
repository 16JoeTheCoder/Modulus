import { STARTER_OWNED_PART_IDS } from '../../src/content';
import {
  DEFAULT_BALANCE_CONFIG,
  GlobalBalanceConfigSchema,
  type IAuthUser,
  type IGarageSyncResponse,
  type IGlobalBalanceConfig,
  type ISavedBuildRecord,
  type IVehicleBuildConfig,
} from '../../src/core/types';
import type { Env } from '../types';

export const KV_BALANCE_CONFIG_KEY = 'global_balance_config';

export async function getActiveBalanceConfig(env: Env): Promise<IGlobalBalanceConfig> {
  try {
    const raw = await env.MODULUS_KV.get(KV_BALANCE_CONFIG_KEY, 'json');
    if (raw) {
      const parsed = GlobalBalanceConfigSchema.safeParse(raw);
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch (err) {
    console.error('[KV READ ERROR] Falling back to DEFAULT_BALANCE_CONFIG:', err);
  }

  // Seed default config into KV if missing or malformed
  try {
    await env.MODULUS_KV.put(KV_BALANCE_CONFIG_KEY, JSON.stringify(DEFAULT_BALANCE_CONFIG));
  } catch (err) {
    console.error('[KV SEED ERROR]:', err);
  }

  return DEFAULT_BALANCE_CONFIG;
}

interface BuildRow {
  id: string;
  name: string;
  chassis_id: string;
  build_json: string;
  total_mass_kg: number;
  peak_power_hp: number;
  pwr_ratio: number;
  is_active: number;
  updated_at: string;
}

export async function getUserGarageSync(
  db: D1Database,
  user: IAuthUser
): Promise<IGarageSyncResponse> {
  const [invRes, buildsRes] = await db.batch([
    db.prepare('SELECT part_id FROM inventory WHERE user_id = ?').bind(user.id),
    db
      .prepare(
        `SELECT id, name, chassis_id, build_json, total_mass_kg, peak_power_hp, pwr_ratio, is_active, updated_at
         FROM builds
         WHERE user_id = ?
         ORDER BY is_active DESC, updated_at DESC`
      )
      .bind(user.id),
  ]);

  const invRows = (invRes.results ?? []) as Array<{ part_id: string }>;
  const ownedPartIds = Array.from(
    new Set([...STARTER_OWNED_PART_IDS, ...invRows.map((r) => r.part_id)])
  );

  const buildRows = (buildsRes.results ?? []) as BuildRow[];
  const builds: ISavedBuildRecord[] = [];
  for (const row of buildRows) {
    try {
      const parsed = JSON.parse(row.build_json) as IVehicleBuildConfig;
      builds.push({
        id: row.id,
        name: row.name,
        chassisId: row.chassis_id,
        build: parsed,
        totalMassKg: row.total_mass_kg,
        peakPowerHp: row.peak_power_hp,
        pwrRatio: row.pwr_ratio,
        isActive: row.is_active === 1,
        updatedAt: row.updated_at,
      });
    } catch {
      // Skip malformed legacy build JSON
    }
  }

  return {
    user,
    ownedPartIds,
    builds,
  };
}

export function incrementSemverPatch(versionId: string): string {
  const match = versionId.trim().match(/^(v?)(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) {
    return `${versionId.trim()}-1`;
  }
  const [, prefix, major, minor, patch] = match;
  return `${prefix || 'v'}${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

export function prepareAuditLogStatement(
  db: D1Database,
  adminEmail: string,
  action: string,
  targetUserId: string | null,
  payload: Record<string, unknown>
): D1PreparedStatement {
  const id = `aud_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO audit_logs (id, admin_email, action, target_user_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, adminEmail, action, targetUserId, JSON.stringify(payload), createdAt);
}
