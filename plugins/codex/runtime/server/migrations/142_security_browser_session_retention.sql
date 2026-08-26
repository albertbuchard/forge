CREATE INDEX IF NOT EXISTS idx_security_browser_sessions_retirement
  ON security_browser_sessions (
    json_extract(principal_json, '$.kind'),
    COALESCE(revoked_at, MIN(idle_expires_at, absolute_expires_at))
  );
