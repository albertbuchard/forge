-- Store only the terminal result needed to settle an offline task-status edit.
-- Records are isolated by authenticated browser session and bounded by the
-- service to 30 days and the 500 newest records for each session.
-- The migration is additive: rolling the application back leaves this table
-- unused and does not change or delete any existing task data.

CREATE TABLE offline_mutation_outbox (
  session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND
    request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  terminal_status TEXT NOT NULL CHECK (
    terminal_status IN ('accepted', 'conflicted', 'rejected')
  ),
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, idempotency_key)
);

CREATE INDEX offline_mutation_outbox_session_created
  ON offline_mutation_outbox(session_id, created_at DESC, idempotency_key DESC);

CREATE INDEX offline_mutation_outbox_created
  ON offline_mutation_outbox(created_at);
