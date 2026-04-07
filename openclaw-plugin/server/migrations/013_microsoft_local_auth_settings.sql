ALTER TABLE app_settings
  ADD COLUMN microsoft_client_id TEXT NOT NULL DEFAULT '';

ALTER TABLE app_settings
  ADD COLUMN microsoft_tenant_id TEXT NOT NULL DEFAULT 'common';

ALTER TABLE app_settings
  ADD COLUMN microsoft_redirect_uri TEXT NOT NULL DEFAULT '';
