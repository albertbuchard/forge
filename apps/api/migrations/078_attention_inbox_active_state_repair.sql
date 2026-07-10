ALTER TABLE attention_inbox_states
  RENAME TO attention_inbox_states_legacy_078;

CREATE TABLE attention_inbox_states (
  actor_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'snoozed', 'dismissed')),
  snoozed_until TEXT,
  source_updated_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, item_id)
);

INSERT INTO attention_inbox_states (
  actor_key,
  item_id,
  status,
  snoozed_until,
  source_updated_at,
  note,
  created_at,
  updated_at
)
SELECT
  actor_key,
  item_id,
  status,
  snoozed_until,
  source_updated_at,
  note,
  created_at,
  updated_at
FROM attention_inbox_states_legacy_078;

DROP TABLE attention_inbox_states_legacy_078;

CREATE INDEX idx_attention_inbox_states_actor_status
  ON attention_inbox_states(actor_key, status, snoozed_until, updated_at DESC);
