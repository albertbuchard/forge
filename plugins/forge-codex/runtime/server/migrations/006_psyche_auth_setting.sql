-- Add optional psyche auth enforcement setting.
-- When 0 (default), psyche routes are open like goals/tasks routes.
-- When 1, psyche routes require scoped token or operator session.
ALTER TABLE app_settings ADD COLUMN psyche_auth_required INTEGER NOT NULL DEFAULT 0;
