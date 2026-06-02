CREATE TABLE IF NOT EXISTS nutrition_targets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calorie_target REAL,
  protein_grams_target REAL,
  fiber_grams_target REAL,
  carbohydrate_grams_target REAL,
  fat_grams_target REAL,
  weight_goal_kg REAL,
  weekly_rate_goal_kg REAL,
  diet_style TEXT NOT NULL DEFAULT '',
  body_goal TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_targets_user
  ON nutrition_targets(user_id);

CREATE TABLE IF NOT EXISTS nutrition_food_catalog (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  serving_label TEXT NOT NULL DEFAULT '',
  serving_grams REAL,
  calories REAL,
  protein_grams REAL,
  carbohydrate_grams REAL,
  fat_grams REAL,
  fiber_grams REAL,
  sugar_grams REAL,
  sodium_mg REAL,
  potassium_mg REAL,
  caffeine_mg REAL,
  alcohol_grams REAL,
  nova_group INTEGER,
  nutri_score TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  nutrients_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.65,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_food_catalog_source
  ON nutrition_food_catalog(source, source_id);

CREATE INDEX IF NOT EXISTS idx_nutrition_food_catalog_barcode
  ON nutrition_food_catalog(barcode);

CREATE TABLE IF NOT EXISTS nutrition_food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at TEXT NOT NULL,
  meal_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  confirmation_state TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT NOT NULL DEFAULT '',
  place_id TEXT,
  stay_id TEXT,
  workout_id TEXT,
  sleep_id TEXT,
  day_key TEXT NOT NULL,
  image_refs_json TEXT NOT NULL DEFAULT '[]',
  parser_provenance_json TEXT NOT NULL DEFAULT '{}',
  links_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_food_logs_user_time
  ON nutrition_food_logs(user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_nutrition_food_logs_day
  ON nutrition_food_logs(user_id, day_key);

CREATE TABLE IF NOT EXISTS nutrition_meal_items (
  id TEXT PRIMARY KEY,
  log_id TEXT NOT NULL REFERENCES nutrition_food_logs(id) ON DELETE CASCADE,
  food_id TEXT REFERENCES nutrition_food_catalog(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'serving',
  grams REAL,
  calories REAL,
  protein_grams REAL,
  carbohydrate_grams REAL,
  fat_grams REAL,
  fiber_grams REAL,
  sugar_grams REAL,
  sodium_mg REAL,
  potassium_mg REAL,
  caffeine_mg REAL,
  alcohol_grams REAL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  nutrients_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.65,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_meal_items_log
  ON nutrition_meal_items(log_id);

CREATE TABLE IF NOT EXISTS nutrition_body_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  weight_kg REAL,
  waist_cm REAL,
  hip_cm REAL,
  neck_cm REAL,
  chest_cm REAL,
  arm_cm REAL,
  thigh_cm REAL,
  body_fat_percent REAL,
  clothing_fit_score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_body_checkins_user_time
  ON nutrition_body_checkins(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_appearance_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  photo_refs_json TEXT NOT NULL DEFAULT '[]',
  face_puffiness INTEGER,
  leanness INTEGER,
  muscularity INTEGER,
  posture INTEGER,
  bloating_look INTEGER,
  confidence_score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_appearance_checkins_user_time
  ON nutrition_appearance_checkins(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_subjective_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  meal_log_id TEXT REFERENCES nutrition_food_logs(id) ON DELETE SET NULL,
  time_relation TEXT NOT NULL DEFAULT 'unspecified',
  hunger INTEGER,
  fullness INTEGER,
  cravings INTEGER,
  mood INTEGER,
  energy INTEGER,
  focus INTEGER,
  stress INTEGER,
  sleepiness INTEGER,
  crash_score INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_subjective_checkins_user_time
  ON nutrition_subjective_checkins(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_gut_checkins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  meal_log_id TEXT REFERENCES nutrition_food_logs(id) ON DELETE SET NULL,
  bristol_stool_type INTEGER,
  stool_frequency INTEGER,
  bloating INTEGER,
  gas INTEGER,
  reflux INTEGER,
  abdominal_pain INTEGER,
  urgency INTEGER,
  nausea INTEGER,
  constipation INTEGER,
  diarrhea INTEGER,
  trigger_tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_gut_checkins_user_time
  ON nutrition_gut_checkins(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_hypotheses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  confidence REAL NOT NULL DEFAULT 0.25,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  signal_key TEXT NOT NULL DEFAULT '',
  outcome_key TEXT NOT NULL DEFAULT '',
  lag_window TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  confounders_json TEXT NOT NULL DEFAULT '[]',
  suggested_action TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_hypotheses_user_status
  ON nutrition_hypotheses(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS nutrition_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hypothesis_id TEXT REFERENCES nutrition_hypotheses(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  baseline_start TEXT,
  baseline_end TEXT,
  intervention_start TEXT,
  intervention_end TEXT,
  tracked_outcomes_json TEXT NOT NULL DEFAULT '[]',
  protocol_json TEXT NOT NULL DEFAULT '{}',
  adherence_json TEXT NOT NULL DEFAULT '{}',
  result_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nutrition_experiments_user_status
  ON nutrition_experiments(user_id, status, updated_at DESC);
