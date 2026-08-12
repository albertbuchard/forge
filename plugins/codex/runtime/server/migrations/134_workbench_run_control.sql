ALTER TABLE ai_connector_runs
  ADD COLUMN deadline_at TEXT;

ALTER TABLE ai_connector_runs
  ADD COLUMN cancellation_requested_at TEXT;

ALTER TABLE ai_connector_runs
  ADD COLUMN cancellation_actor TEXT;

ALTER TABLE ai_connector_runs
  ADD COLUMN cancellation_source TEXT CHECK (
    cancellation_source IS NULL OR cancellation_source IN ('ui', 'openclaw', 'agent', 'system')
  );

ALTER TABLE ai_connector_runs
  ADD COLUMN cancellation_reason TEXT CHECK (
    cancellation_reason IS NULL OR length(cancellation_reason) <= 500
  );

CREATE INDEX idx_ai_connector_runs_deadline
  ON ai_connector_runs(status, deadline_at)
  WHERE status = 'running';
