ALTER TABLE ai_connectors
ADD COLUMN public_inputs_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE ai_connector_runs
ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '{}';
