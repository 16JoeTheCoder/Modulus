-- MODULUS D1 Migration 0002: Lap Record Versioning & Result Integrity
-- Additive migration preserving all historical lap records with legacy defaults.
-- Apply locally with: npm run db:migrate:local (NEVER --remote without release approval).

ALTER TABLE lap_records ADD COLUMN track_version TEXT NOT NULL DEFAULT 'v1.0.0';
ALTER TABLE lap_records ADD COLUMN physics_version TEXT NOT NULL DEFAULT 'phys-1.0.0';
ALTER TABLE lap_records ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT 'rules-1.0.0';
ALTER TABLE lap_records ADD COLUMN weather_key TEXT NOT NULL DEFAULT 'clear_dry';
ALTER TABLE lap_records ADD COLUMN assist_preset TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE lap_records ADD COLUMN transmission_mode TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE lap_records ADD COLUMN session_mode TEXT NOT NULL DEFAULT 'time_trial';
ALTER TABLE lap_records ADD COLUMN verification_level TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE lap_records ADD COLUMN checkpoint_mask INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lap_records ADD COLUMN submission_fingerprint TEXT;

-- Segregate historical AI-assisted rows from official manual Time Trial records while keeping them archived
UPDATE lap_records
SET session_mode = 'ai_race'
WHERE is_ai_assisted = 1 AND session_mode = 'time_trial';

-- Indexed official Time Trial leaderboard lookup (Cloudflare D1 free-tier safe, no full-table scans)
CREATE INDEX IF NOT EXISTS idx_lap_records_official_board
  ON lap_records(
    track_id,
    track_version,
    balance_version_id,
    session_mode,
    is_ai_assisted,
    lap_time_ms ASC
  );

CREATE INDEX IF NOT EXISTS idx_lap_records_version_partition
  ON lap_records(
    track_id,
    track_version,
    physics_version,
    ruleset_version,
    session_mode,
    lap_time_ms ASC
  );

-- Indexed duplicate-submission guard per user
CREATE INDEX IF NOT EXISTS idx_lap_records_user_fingerprint
  ON lap_records(user_id, submission_fingerprint);
