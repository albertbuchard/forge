ALTER TABLE task_timeboxes ADD COLUMN deletion_requested_at TEXT;

CREATE TABLE IF NOT EXISTS task_timebox_create_idempotency (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  timebox_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_task_timebox_create_idempotency_timebox
  ON task_timebox_create_idempotency(timebox_id);

CREATE TABLE IF NOT EXISTS task_timebox_provider_operations (
  timebox_id TEXT PRIMARY KEY REFERENCES task_timeboxes(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'applied', 'error')),
  target_connection_id TEXT,
  target_calendar_id TEXT,
  remote_event_id TEXT,
  claim_token TEXT,
  claim_version INTEGER NOT NULL DEFAULT 0 CHECK (claim_version >= 0),
  needs_retry INTEGER NOT NULL DEFAULT 0 CHECK (needs_retry IN (0, 1)),
  claimed_at TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (state = 'claimed' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state != 'claimed' AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_task_timebox_provider_operations_claim
  ON task_timebox_provider_operations(state, lease_expires_at, target_connection_id, operation);

CREATE INDEX IF NOT EXISTS idx_task_timeboxes_deletion_requested
  ON task_timeboxes(deletion_requested_at, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_task_timeboxes_entity_search
  ON task_timeboxes(deletion_requested_at, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_task_timeboxes_entity_status_search
  ON task_timeboxes(deletion_requested_at, status, updated_at DESC, id);

CREATE VIRTUAL TABLE IF NOT EXISTS task_timebox_search USING fts5(
  title,
  override_reason,
  task_id,
  project_id,
  source,
  content = 'task_timeboxes',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO task_timebox_search(task_timebox_search) VALUES ('rebuild');

CREATE TRIGGER IF NOT EXISTS task_timebox_search_insert
AFTER INSERT ON task_timeboxes
BEGIN
  INSERT INTO task_timebox_search(
    rowid, title, override_reason, task_id, project_id, source
  ) VALUES (
    new.rowid, new.title, new.override_reason, new.task_id, new.project_id, new.source
  );
END;

CREATE TRIGGER IF NOT EXISTS task_timebox_search_delete
AFTER DELETE ON task_timeboxes
BEGIN
  INSERT INTO task_timebox_search(
    task_timebox_search, rowid, title, override_reason, task_id, project_id, source
  ) VALUES (
    'delete', old.rowid, old.title, old.override_reason, old.task_id, old.project_id, old.source
  );
END;

CREATE TRIGGER IF NOT EXISTS task_timebox_search_update
AFTER UPDATE OF title, override_reason, task_id, project_id, source ON task_timeboxes
BEGIN
  INSERT INTO task_timebox_search(
    task_timebox_search, rowid, title, override_reason, task_id, project_id, source
  ) VALUES (
    'delete', old.rowid, old.title, old.override_reason, old.task_id, old.project_id, old.source
  );
  INSERT INTO task_timebox_search(
    rowid, title, override_reason, task_id, project_id, source
  ) VALUES (
    new.rowid, new.title, new.override_reason, new.task_id, new.project_id, new.source
  );
END;

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'calendar_connection',
  connection.id,
  'user_operator',
  'owner',
  connection.created_at,
  connection.updated_at
FROM calendar_connections connection
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'user_operator')
ON CONFLICT(entity_type, entity_id) DO NOTHING;

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'calendar_event',
  event.id,
  COALESCE(connection_owner.user_id, 'user_operator'),
  'owner',
  event.created_at,
  event.updated_at
FROM forge_events event
LEFT JOIN entity_owners connection_owner
  ON connection_owner.entity_type = 'calendar_connection'
 AND connection_owner.entity_id = event.preferred_connection_id
WHERE event.ownership = 'external'
  AND EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = COALESCE(connection_owner.user_id, 'user_operator')
  )
ON CONFLICT(entity_type, entity_id) DO UPDATE SET
  user_id = excluded.user_id,
  updated_at = excluded.updated_at;

UPDATE task_timeboxes
SET project_id = (
  SELECT tasks.project_id
  FROM tasks
  WHERE tasks.id = task_timeboxes.task_id
)
WHERE EXISTS (
  SELECT 1
  FROM tasks
  WHERE tasks.id = task_timeboxes.task_id
    AND tasks.project_id IS NOT task_timeboxes.project_id
);

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'task_timebox',
  timebox.id,
  task_owner.user_id,
  'owner',
  timebox.created_at,
  timebox.updated_at
FROM task_timeboxes timebox
JOIN entity_owners task_owner
  ON task_owner.entity_type = 'task'
 AND task_owner.entity_id = timebox.task_id
WHERE true
ON CONFLICT(entity_type, entity_id) DO UPDATE SET
  user_id = excluded.user_id,
  updated_at = excluded.updated_at;

INSERT INTO task_timebox_provider_operations (
  timebox_id,
  operation,
  state,
  target_connection_id,
  target_calendar_id,
  remote_event_id,
  created_at,
  updated_at
)
SELECT
  timebox.id,
  CASE WHEN timebox.status = 'cancelled' THEN 'delete' ELSE 'upsert' END,
  'pending',
  timebox.connection_id,
  timebox.calendar_id,
  timebox.remote_event_id,
  timebox.created_at,
  timebox.updated_at
FROM task_timeboxes timebox
WHERE timebox.remote_event_id IS NOT NULL
   OR timebox.status != 'completed'
ON CONFLICT(timebox_id) DO NOTHING;
