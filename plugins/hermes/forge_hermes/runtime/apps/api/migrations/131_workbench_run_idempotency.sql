-- Recover execution rows that cannot still be running after a Forge restart.
UPDATE ai_connector_runs
SET
  status = 'failed',
  error = 'Forge restarted before this Workbench run completed.',
  completed_at = COALESCE(completed_at, created_at)
WHERE status = 'running';

ALTER TABLE ai_connector_runs
  ADD COLUMN idempotency_key TEXT CHECK (
    idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 128
  );

ALTER TABLE ai_connector_runs
  ADD COLUMN request_fingerprint TEXT CHECK (
    request_fingerprint IS NULL OR (
      length(request_fingerprint) = 64 AND
      request_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE ai_connector_runs
  ADD COLUMN request_json TEXT CHECK (
    request_json IS NULL OR (
      json_valid(request_json) AND
      json_type(request_json) = 'object' AND
      length(request_json) <= 4194304
    )
  );

CREATE UNIQUE INDEX idx_ai_connector_runs_idempotency
  ON ai_connector_runs(connector_id, mode, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_ai_connector_runs_single_flight
  ON ai_connector_runs(connector_id, mode)
  WHERE status = 'running';
