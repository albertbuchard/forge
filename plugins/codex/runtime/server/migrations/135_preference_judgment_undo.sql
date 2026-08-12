ALTER TABLE mutation_receipts RENAME TO mutation_receipts_before_preference_undo;

CREATE TABLE mutation_receipts (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  owner_user_id TEXT,
  operation TEXT NOT NULL CHECK (
    operation IN (
      'entity_update',
      'entity_soft_delete',
      'entity_hard_delete',
      'task_update',
      'preference_judgment',
      'attention_state'
    )
  ),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  summary TEXT NOT NULL,
  inverse_json TEXT,
  expected_json TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('available', 'undone', 'conflicted', 'not_reversible')
  ),
  terminal_explanation TEXT,
  expires_at TEXT,
  undo_idempotency_key TEXT,
  undo_result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  undone_at TEXT,
  CHECK (
    (status = 'available' AND inverse_json IS NOT NULL AND expires_at IS NOT NULL) OR
    (status = 'undone' AND inverse_json IS NOT NULL AND expires_at IS NOT NULL AND undone_at IS NOT NULL) OR
    (status = 'conflicted' AND inverse_json IS NOT NULL AND terminal_explanation IS NOT NULL) OR
    (status = 'not_reversible' AND inverse_json IS NULL AND terminal_explanation IS NOT NULL)
  )
);

INSERT INTO mutation_receipts
SELECT * FROM mutation_receipts_before_preference_undo;

DROP TABLE mutation_receipts_before_preference_undo;

CREATE INDEX mutation_receipts_actor_created
  ON mutation_receipts(actor_key, created_at DESC, id DESC);

CREATE INDEX mutation_receipts_actor_owner_created
  ON mutation_receipts(actor_key, owner_user_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX mutation_receipts_actor_undo_key
  ON mutation_receipts(actor_key, undo_idempotency_key)
  WHERE undo_idempotency_key IS NOT NULL;

ALTER TABLE pairwise_judgments
  ADD COLUMN undone_at TEXT;

ALTER TABLE pairwise_judgments
  ADD COLUMN undone_by_actor TEXT;

ALTER TABLE pairwise_judgments
  ADD COLUMN undone_source TEXT;

CREATE INDEX IF NOT EXISTS idx_pairwise_judgments_active_context_created
  ON pairwise_judgments(context_id, created_at DESC)
  WHERE undone_at IS NULL;
