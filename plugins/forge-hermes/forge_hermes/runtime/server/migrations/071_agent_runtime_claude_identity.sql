INSERT OR IGNORE INTO users (
  id, kind, handle, display_name, description, accent_color, created_at, updated_at
) VALUES (
  'user_agent_claude',
  'bot',
  'claude',
  'Claude Code',
  'Claude Code runtime actor linked to Forge agent identity and Kanban ownership.',
  '#f97316',
  datetime('now'),
  datetime('now')
);

UPDATE users
SET kind = 'bot',
    handle = 'claude',
    display_name = 'Claude Code',
    description = 'Claude Code runtime actor linked to Forge agent identity and Kanban ownership.',
    accent_color = '#f97316',
    updated_at = datetime('now')
WHERE id = 'user_agent_claude';

UPDATE agent_identities
SET label = 'Forge Claude Code',
    agent_type = 'claude',
    provider = 'claude',
    identity_key = COALESCE(identity_key, 'runtime:claude:legacy:default'),
    machine_key = COALESCE(machine_key, 'legacy'),
    persona_key = COALESCE(persona_key, 'default'),
    description = 'Forge Claude Code runtime agent with stable Forge identity and linked Kanban user.',
    updated_at = datetime('now')
WHERE lower(agent_type) = 'claude'
   OR lower(label) IN ('forge claude', 'forge claude code', 'claude', 'claude code');

INSERT OR IGNORE INTO agent_identity_users (
  agent_id, user_id, role, created_at, updated_at
)
SELECT id, 'user_agent_claude', 'primary', datetime('now'), datetime('now')
FROM agent_identities
WHERE provider = 'claude';

UPDATE agent_runtime_sessions
SET agent_label = 'Forge Claude Code',
    agent_type = 'claude',
    provider = 'claude',
    updated_at = datetime('now')
WHERE provider = 'claude'
   OR lower(agent_type) = 'claude'
   OR lower(agent_label) IN ('forge claude', 'forge claude code', 'claude', 'claude code');
