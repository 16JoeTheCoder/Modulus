-- MODULUS D1 Initial Schema (0001_initial.sql)
-- Cloudflare Free-Tier Optimized: All lookup columns strictly indexed to prevent full-table scans.

PRAGMA foreign_keys = ON;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  credits INTEGER NOT NULL DEFAULT 25000,
  unlock_all INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. Email 6-Digit OTP Challenges
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_expires ON otp_codes(email, expires_at);

-- 3. 30-Day Persistent Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 4. Player Owned Parts Inventory
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  acquired_via TEXT NOT NULL DEFAULT 'shop' CHECK (acquired_via IN ('starter', 'shop', 'admin_grant')),
  acquired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(user_id, part_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user_part ON inventory(user_id, part_id);

-- 5. Saved Vehicle Builds
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  chassis_id TEXT NOT NULL,
  build_json TEXT NOT NULL,
  total_mass_kg REAL NOT NULL DEFAULT 1200,
  peak_power_hp REAL NOT NULL DEFAULT 220,
  pwr_ratio REAL NOT NULL DEFAULT 0.183,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_builds_user_id ON builds(user_id);
CREATE INDEX IF NOT EXISTS idx_builds_user_active ON builds(user_id, is_active);

-- 6. Partitioned Leaderboard Lap Records
CREATE TABLE IF NOT EXISTS lap_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_id TEXT REFERENCES builds(id) ON DELETE SET NULL,
  track_id TEXT NOT NULL,
  balance_version_id TEXT NOT NULL,
  lap_time_ms INTEGER NOT NULL CHECK (lap_time_ms > 0),
  sector_times_json TEXT NOT NULL DEFAULT '[]',
  chassis_id TEXT NOT NULL,
  peak_speed_kph REAL NOT NULL DEFAULT 0,
  pwr_ratio REAL NOT NULL DEFAULT 0,
  is_ai_assisted INTEGER NOT NULL DEFAULT 0,
  credits_awarded INTEGER NOT NULL DEFAULT 0,
  telemetry_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_lap_records_track_version_time ON lap_records(track_id, balance_version_id, lap_time_ms ASC);
CREATE INDEX IF NOT EXISTS idx_lap_records_user_id ON lap_records(user_id);
CREATE INDEX IF NOT EXISTS idx_lap_records_balance_version ON lap_records(balance_version_id);

-- 7. Balance Config Version Snapshots (Rollback Archive)
CREATE TABLE IF NOT EXISTS balance_snapshots (
  version_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  published_by TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_created_at ON balance_snapshots(created_at DESC);

-- 8. Immutable Admin Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_email ON audit_logs(admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id);
