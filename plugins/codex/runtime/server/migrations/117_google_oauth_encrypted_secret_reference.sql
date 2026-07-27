-- Add an encrypted-secret reference without copying or reading legacy plaintext
-- during ordinary startup. The explicit owner maintenance migrator performs
-- evacuation later under its own authorization and backup window.

ALTER TABLE app_settings
  ADD COLUMN google_client_secret_id TEXT
  REFERENCES stored_secrets(id);

CREATE INDEX IF NOT EXISTS idx_app_settings_google_client_secret_id
  ON app_settings (google_client_secret_id);
