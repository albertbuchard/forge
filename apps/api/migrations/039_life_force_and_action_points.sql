ALTER TABLE tasks
  ADD COLUMN resolution_kind TEXT;

ALTER TABLE tasks
  ADD COLUMN split_parent_task_id TEXT;

CREATE TABLE IF NOT EXISTS life_force_profiles (
  user_id TEXT PRIMARY KEY,
  base_daily_ap INTEGER NOT NULL DEFAULT 200,
  readiness_multiplier REAL NOT NULL DEFAULT 1.0,
  life_force_level INTEGER NOT NULL DEFAULT 1,
  activation_level INTEGER NOT NULL DEFAULT 1,
  focus_level INTEGER NOT NULL DEFAULT 1,
  vigor_level INTEGER NOT NULL DEFAULT 1,
  composure_level INTEGER NOT NULL DEFAULT 1,
  flow_level INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS life_force_weekday_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  baseline_daily_ap INTEGER NOT NULL DEFAULT 200,
  points_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, weekday)
);

CREATE TABLE IF NOT EXISTS life_force_day_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  daily_budget_ap REAL NOT NULL,
  sleep_recovery_multiplier REAL NOT NULL DEFAULT 1.0,
  readiness_multiplier REAL NOT NULL DEFAULT 1.0,
  fatigue_debt_carry REAL NOT NULL DEFAULT 0,
  points_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, date_key)
);

CREATE TABLE IF NOT EXISTS action_profile_templates (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL UNIQUE,
  entity_type TEXT,
  title TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_action_profiles (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS ap_ledger_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  total_ap REAL NOT NULL,
  rate_ap_per_hour REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ap_ledger_user_date
  ON ap_ledger_events(user_id, date_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ap_ledger_entity
  ON ap_ledger_events(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stat_xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stat_key TEXT NOT NULL,
  delta_xp REAL NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stat_xp_user_stat
  ON stat_xp_events(user_id, stat_key, created_at DESC);

CREATE TABLE IF NOT EXISTS fatigue_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  delta REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fatigue_signals_user_date
  ON fatigue_signals(user_id, date_key, observed_at DESC);
