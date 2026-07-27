-- Persist the verified principal and policy boundary for privileged background
-- effects so restarts cannot silently replace client authority with network or
-- process-local trust.

CREATE TABLE IF NOT EXISTS security_background_job_authorizations (
  job_id TEXT PRIMARY KEY,
  principal_json TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'running', 'completed', 'failed', 'denied')
  ),
  denial_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_background_job_state
  ON security_background_job_authorizations (state, updated_at);
