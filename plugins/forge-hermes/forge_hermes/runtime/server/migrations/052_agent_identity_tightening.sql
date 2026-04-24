ALTER TABLE agent_identities ADD COLUMN identity_key TEXT;
ALTER TABLE agent_identities ADD COLUMN provider TEXT;
ALTER TABLE agent_identities ADD COLUMN machine_key TEXT;
ALTER TABLE agent_identities ADD COLUMN persona_key TEXT;

CREATE TABLE IF NOT EXISTS agent_identity_users (
  agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'linked',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_identity_users_user
  ON agent_identity_users(user_id, role);

INSERT OR IGNORE INTO users (
  id, kind, handle, display_name, description, accent_color, created_at, updated_at
) VALUES
  ('user_agent_openclaw', 'bot', 'openclaw', 'OpenClaw', 'OpenClaw runtime actor linked to Forge agent identity and Kanban ownership.', '#38bdf8', datetime('now'), datetime('now')),
  ('user_agent_hermes', 'bot', 'hermes', 'Hermes', 'Hermes runtime actor linked to Forge agent identity and Kanban ownership.', '#a78bfa', datetime('now'), datetime('now')),
  ('user_agent_codex', 'bot', 'codex', 'Codex', 'Codex runtime actor linked to Forge agent identity and Kanban ownership.', '#22c55e', datetime('now'), datetime('now'));

UPDATE agent_tokens
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
  ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')) > 0;

UPDATE agent_actions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
  ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')) > 0;

UPDATE approval_requests
SET requested_by_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
  ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE requested_by_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')) > 0;

UPDATE insights
SET origin_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
  ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE origin_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')) > 0;

UPDATE agent_runtime_sessions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
  ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')) > 0;

DELETE FROM agent_identities
WHERE (lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel'))
  AND id <> (
    SELECT id FROM agent_identities
    WHERE lower(agent_type) = 'openclaw' OR lower(label) IN ('forge openclaw', 'openclaw', 'aurel')
    ORDER BY CASE WHEN lower(label) = 'forge openclaw' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
  );

UPDATE agent_identities
SET label = 'Forge OpenClaw',
    agent_type = 'openclaw',
    provider = 'openclaw',
    identity_key = 'runtime:openclaw:legacy:default',
    machine_key = 'legacy',
    persona_key = 'default',
    description = 'OpenClaw runtime agent with stable Forge identity and linked Kanban user.',
    updated_at = datetime('now')
WHERE lower(agent_type) = 'openclaw' OR lower(label) = 'forge openclaw';

UPDATE agent_tokens
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
  ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%') > 0;

UPDATE agent_actions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
  ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%') > 0;

UPDATE approval_requests
SET requested_by_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
  ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE requested_by_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%') > 0;

UPDATE insights
SET origin_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
  ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE origin_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%') > 0;

UPDATE agent_runtime_sessions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
  ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%') > 0;

DELETE FROM agent_identities
WHERE (lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%')
  AND id <> (
    SELECT id FROM agent_identities
    WHERE lower(agent_type) = 'hermes' OR lower(label) LIKE 'forge hermes%'
    ORDER BY CASE WHEN lower(label) = 'forge hermes' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
  );

UPDATE agent_identities
SET label = 'Forge Hermes',
    agent_type = 'hermes',
    provider = 'hermes',
    identity_key = 'runtime:hermes:legacy:default',
    machine_key = 'legacy',
    persona_key = 'default',
    description = 'Hermes runtime agent with stable Forge identity and linked Kanban user.',
    updated_at = datetime('now')
WHERE lower(agent_type) = 'hermes' OR lower(label) = 'forge hermes';

UPDATE agent_tokens
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
  ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')) > 0;

UPDATE agent_actions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
  ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')) > 0;

UPDATE approval_requests
SET requested_by_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
  ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE requested_by_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')) > 0;

UPDATE insights
SET origin_agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
  ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE origin_agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')) > 0;

UPDATE agent_runtime_sessions
SET agent_id = (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
  ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1
)
WHERE agent_id IN (
  SELECT id FROM agent_identities
  WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
)
AND (SELECT COUNT(*) FROM agent_identities WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')) > 0;

DELETE FROM agent_identities
WHERE (lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)'))
  AND id <> (
    SELECT id FROM agent_identities
    WHERE lower(agent_type) = 'codex' OR lower(label) IN ('forge codex', 'codex', 'albert (codex)')
    ORDER BY CASE WHEN lower(label) = 'forge codex' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
  );

UPDATE agent_identities
SET label = 'Forge Codex',
    agent_type = 'codex',
    provider = 'codex',
    identity_key = 'runtime:codex:legacy:default',
    machine_key = 'legacy',
    persona_key = 'default',
    description = 'Codex runtime agent with stable Forge identity and linked Kanban user.',
    updated_at = datetime('now')
WHERE lower(agent_type) = 'codex' OR lower(label) = 'forge codex';

INSERT OR IGNORE INTO agent_identity_users (agent_id, user_id, role, created_at, updated_at)
SELECT id, 'user_agent_openclaw', 'primary', datetime('now'), datetime('now')
FROM agent_identities
WHERE provider = 'openclaw';

INSERT OR IGNORE INTO agent_identity_users (agent_id, user_id, role, created_at, updated_at)
SELECT id, 'user_agent_hermes', 'primary', datetime('now'), datetime('now')
FROM agent_identities
WHERE provider = 'hermes';

INSERT OR IGNORE INTO agent_identity_users (agent_id, user_id, role, created_at, updated_at)
SELECT id, 'user_agent_codex', 'primary', datetime('now'), datetime('now')
FROM agent_identities
WHERE provider = 'codex';

UPDATE agent_runtime_sessions
SET agent_label = (
      SELECT label FROM agent_identities WHERE agent_identities.id = agent_runtime_sessions.agent_id
    ),
    agent_type = (
      SELECT agent_type FROM agent_identities WHERE agent_identities.id = agent_runtime_sessions.agent_id
    ),
    updated_at = datetime('now')
WHERE agent_id IN (SELECT id FROM agent_identities WHERE provider IN ('openclaw', 'hermes', 'codex'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_identities_identity_key
  ON agent_identities(identity_key)
  WHERE identity_key IS NOT NULL;
