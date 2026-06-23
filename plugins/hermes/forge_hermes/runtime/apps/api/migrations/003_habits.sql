CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  polarity TEXT NOT NULL DEFAULT 'positive',
  frequency TEXT NOT NULL DEFAULT 'daily',
  target_count INTEGER NOT NULL DEFAULT 1,
  week_days_json TEXT NOT NULL DEFAULT '[]',
  linked_behavior_id TEXT REFERENCES psyche_behaviors(id) ON DELETE SET NULL,
  reward_xp INTEGER NOT NULL DEFAULT 12,
  penalty_xp INTEGER NOT NULL DEFAULT 8,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_check_ins (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  delta_xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (habit_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_habits_status ON habits(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_habit_check_ins_habit_date ON habit_check_ins(habit_id, date_key DESC);
