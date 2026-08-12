ALTER TABLE users
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active', 'inactive'));

ALTER TABLE users
  ADD COLUMN deactivated_at TEXT;

ALTER TABLE users
  ADD COLUMN lifecycle_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE users
  ADD COLUMN lifecycle_actor TEXT;

ALTER TABLE users
  ADD COLUMN lifecycle_source TEXT;

CREATE TABLE IF NOT EXISTS user_ownership_defaults (
  subject_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_actor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO user_ownership_defaults (
  subject_user_id,
  owner_user_id,
  created_at,
  updated_at
)
SELECT id, id, datetime('now'), datetime('now')
FROM users;

CREATE TABLE IF NOT EXISTS user_lifecycle_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  replacement_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('deactivate', 'reactivate', 'ownership_default')),
  actor_key TEXT NOT NULL,
  actor_label TEXT,
  source TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (actor_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_users_lifecycle
  ON users(lifecycle_status, kind, display_name);

CREATE INDEX IF NOT EXISTS idx_user_ownership_defaults_owner
  ON user_ownership_defaults(owner_user_id, subject_user_id);

CREATE INDEX IF NOT EXISTS idx_user_lifecycle_receipts_user
  ON user_lifecycle_receipts(user_id, created_at DESC);
