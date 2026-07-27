ALTER TABLE security_audit_events
  ADD COLUMN connection_id TEXT;

ALTER TABLE security_audit_events
  ADD COLUMN job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_security_audit_connection_time
  ON security_audit_events(connection_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_job_time
  ON security_audit_events(job_id, occurred_at DESC);

ALTER TABLE security_background_job_authorizations
  ADD COLUMN origin_request_id TEXT;

ALTER TABLE security_background_job_authorizations
  ADD COLUMN origin_connection_id TEXT;
