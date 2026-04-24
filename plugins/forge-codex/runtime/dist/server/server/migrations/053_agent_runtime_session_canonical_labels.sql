UPDATE agent_runtime_sessions
SET agent_label = (
      SELECT label FROM agent_identities WHERE agent_identities.id = agent_runtime_sessions.agent_id
    ),
    agent_type = (
      SELECT agent_type FROM agent_identities WHERE agent_identities.id = agent_runtime_sessions.agent_id
    ),
    updated_at = datetime('now')
WHERE agent_id IN (SELECT id FROM agent_identities WHERE provider IN ('openclaw', 'hermes', 'codex'));
