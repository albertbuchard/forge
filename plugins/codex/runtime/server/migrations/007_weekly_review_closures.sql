CREATE TABLE IF NOT EXISTS weekly_review_closures (
  id TEXT PRIMARY KEY,
  week_key TEXT NOT NULL UNIQUE,
  week_start_date TEXT NOT NULL,
  week_end_date TEXT NOT NULL,
  window_label TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  activity_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reward_id) REFERENCES reward_ledger(id) ON DELETE RESTRICT,
  FOREIGN KEY (activity_event_id) REFERENCES activity_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_weekly_review_closures_created_at
  ON weekly_review_closures(created_at DESC);
