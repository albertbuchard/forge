CREATE TABLE IF NOT EXISTS work_adjustment_idempotency (
  authority_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint TEXT NOT NULL,
  adjustment_id TEXT NOT NULL REFERENCES work_adjustments(id),
  reward_id TEXT REFERENCES reward_ledger(id),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (authority_scope, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_adjustment_idempotency_adjustment
  ON work_adjustment_idempotency(adjustment_id);
