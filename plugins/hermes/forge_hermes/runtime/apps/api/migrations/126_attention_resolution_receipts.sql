-- Persist explicit operator resolution attempts separately from the short-lived
-- SYS-18 Undo receipts. These rows contain only safe queue identity, display,
-- status, and evidence-summary fields: never source payloads, health bytes,
-- runtime commands or errors, credentials, or arbitrary source detail.
--
-- The service retains the newest 5,000 records per actor for 365 days. Exact
-- idempotent replay is guaranteed while the corresponding record remains in
-- that published window. The migration is additive, so older Forge builds
-- ignore these tables without changing prior Attention state.

CREATE TABLE attention_resolution_attempts (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  owner_user_id TEXT,
  scoped_user_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(scoped_user_ids_json) AND json_type(scoped_user_ids_json) = 'array'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND
    request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  item_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('approval', 'insight', 'task', 'companion_sync', 'agent_session')
  ),
  kind TEXT NOT NULL CHECK (
    kind IN ('decision', 'review', 'blocked_work', 'overdue_work', 'sync_problem', 'runtime_problem')
  ),
  action_key TEXT NOT NULL CHECK (
    action_key IN ('review_decision', 'review_insight', 'resolve_blocker', 'review_due_work', 'recover_companion_sync', 'reconnect_runtime')
  ),
  source_ref TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  source_anchor_at TEXT NOT NULL,
  source_provider TEXT,
  source_agent_label_normalized TEXT,
  title TEXT NOT NULL,
  target_label TEXT NOT NULL,
  target_href TEXT NOT NULL CHECK (
    substr(target_href, 1, 1) = '/' AND substr(target_href, 1, 2) <> '//'
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'resolved', 'unavailable')
  ),
  started_at TEXT NOT NULL,
  checked_at TEXT,
  UNIQUE (actor_key, idempotency_key)
);

CREATE INDEX attention_resolution_attempts_actor_status_started
  ON attention_resolution_attempts(actor_key, status, started_at DESC, id DESC);

CREATE INDEX attention_resolution_attempts_actor_owner_started
  ON attention_resolution_attempts(actor_key, owner_user_id, started_at DESC, id DESC);

CREATE TABLE attention_resolution_receipts (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  owner_user_id TEXT,
  scoped_user_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(scoped_user_ids_json) AND json_type(scoped_user_ids_json) = 'array'
  ),
  attempt_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('approval', 'insight', 'task', 'companion_sync', 'agent_session')
  ),
  kind TEXT NOT NULL CHECK (
    kind IN ('decision', 'review', 'blocked_work', 'overdue_work', 'sync_problem', 'runtime_problem')
  ),
  action_key TEXT NOT NULL CHECK (
    action_key IN ('review_decision', 'review_insight', 'resolve_blocker', 'review_due_work', 'recover_companion_sync', 'reconnect_runtime')
  ),
  source_ref TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  target_label TEXT NOT NULL,
  target_href TEXT NOT NULL CHECK (
    substr(target_href, 1, 1) = '/' AND substr(target_href, 1, 2) <> '//'
  ),
  evidence_code TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  activity_event_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attention_resolution_attempts(id)
);

CREATE INDEX attention_resolution_receipts_actor_resolved
  ON attention_resolution_receipts(actor_key, resolved_at DESC, id DESC);

CREATE INDEX attention_resolution_receipts_actor_owner_resolved
  ON attention_resolution_receipts(actor_key, owner_user_id, resolved_at DESC, id DESC);

CREATE TABLE attention_resolution_check_idempotency (
  actor_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND
    request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, idempotency_key)
);

CREATE INDEX attention_resolution_check_actor_created
  ON attention_resolution_check_idempotency(actor_key, created_at DESC, idempotency_key DESC);
