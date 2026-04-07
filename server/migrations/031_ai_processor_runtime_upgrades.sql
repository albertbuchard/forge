ALTER TABLE ai_processors ADD COLUMN slug TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_processors ADD COLUMN agent_config_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_processors ADD COLUMN run_history_json TEXT NOT NULL DEFAULT '[]';

UPDATE ai_processors
SET slug = lower(replace(replace(trim(title), ' ', '-'), '--', '-')) || '-' || substr(id, -6)
WHERE trim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_processors_slug
ON ai_processors(slug);
