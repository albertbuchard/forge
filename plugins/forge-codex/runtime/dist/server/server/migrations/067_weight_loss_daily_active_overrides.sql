CREATE TABLE IF NOT EXISTS nutrition_daily_energy_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  active_calories_kcal REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_daily_energy_overrides_user_day
  ON nutrition_daily_energy_overrides(user_id, day_key DESC);
