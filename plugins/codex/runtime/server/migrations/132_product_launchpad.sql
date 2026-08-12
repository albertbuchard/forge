CREATE TABLE IF NOT EXISTS product_onboarding_state (
  owner_user_id TEXT PRIMARY KEY,
  outcome_key TEXT CHECK (outcome_key IS NULL OR outcome_key IN ('plan_week', 'daily_reflection', 'research_project')),
  current_step TEXT NOT NULL DEFAULT 'choose_outcome'
    CHECK (current_step IN ('choose_outcome', 'review_pack', 'install_pack', 'first_result', 'complete')),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'skipped', 'complete')),
  installed_package_id TEXT,
  last_result_href TEXT,
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_package_installs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  package_id TEXT NOT NULL CHECK (length(package_id) BETWEEN 3 AND 120),
  package_version TEXT NOT NULL CHECK (length(package_version) BETWEEN 1 AND 40),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  idempotency_key_hash TEXT NOT NULL CHECK (length(idempotency_key_hash) = 64 AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('installed', 'removed')),
  created_entity_refs_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(created_entity_refs_json) AND json_type(created_entity_refs_json) = 'array' AND length(created_entity_refs_json) <= 32768),
  installed_at TEXT NOT NULL CHECK (julianday(installed_at) IS NOT NULL),
  removed_at TEXT CHECK (removed_at IS NULL OR julianday(removed_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (owner_user_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_product_package_installs_owner
  ON product_package_installs (owner_user_id, status, installed_at DESC, id);

CREATE TABLE IF NOT EXISTS product_import_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('markdown', 'obsidian', 'notion', 'todoist', 'apple_reminders', 'calendar', 'github_issues', 'linear')),
  source_label TEXT NOT NULL CHECK (length(source_label) BETWEEN 1 AND 240),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64 AND payload_fingerprint NOT GLOB '*[^0-9a-f]*'),
  commit_fingerprint TEXT CHECK (commit_fingerprint IS NULL OR (length(commit_fingerprint) = 64 AND commit_fingerprint NOT GLOB '*[^0-9a-f]*')),
  idempotency_key_hash TEXT CHECK (idempotency_key_hash IS NULL OR (length(idempotency_key_hash) = 64 AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*')),
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'rolled_back')),
  preview_json TEXT NOT NULL CHECK (json_valid(preview_json) AND json_type(preview_json) = 'object' AND length(preview_json) <= 8388608),
  receipt_json TEXT CHECK (receipt_json IS NULL OR (json_valid(receipt_json) AND json_type(receipt_json) = 'object' AND length(receipt_json) <= 1048576)),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (owner_user_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_product_import_runs_owner
  ON product_import_runs (owner_user_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS product_review_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('import_conflict', 'capture_classification', 'agent_proposal', 'relationship_proposal', 'offline_conflict', 'artifact_enrichment', 'sync_conflict')),
  source_type TEXT NOT NULL CHECK (length(source_type) BETWEEN 1 AND 80),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 256),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  summary TEXT NOT NULL CHECK (length(summary) <= 2000),
  proposed_action_json TEXT NOT NULL CHECK (json_valid(proposed_action_json) AND json_type(proposed_action_json) = 'object' AND length(proposed_action_json) <= 32768),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array' AND length(evidence_json) <= 32768),
  resolution_json TEXT CHECK (resolution_json IS NULL OR (json_valid(resolution_json) AND json_type(resolution_json) = 'object' AND length(resolution_json) <= 32768)),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  resolved_at TEXT CHECK (resolved_at IS NULL OR julianday(resolved_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (owner_user_id, kind, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_product_review_items_owner_pending
  ON product_review_items (owner_user_id, status, created_at ASC, id);

CREATE TABLE IF NOT EXISTS product_feedback_settings (
  owner_user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  consent_version TEXT,
  consented_at TEXT CHECK (consented_at IS NULL OR julianday(consented_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_feedback_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('onboarding_started', 'onboarding_completed', 'starter_pack_installed', 'import_previewed', 'import_completed', 'feature_opened')),
  outcome_key TEXT CHECK (outcome_key IS NULL OR outcome_key IN ('plan_week', 'daily_reflection', 'research_project')),
  surface_key TEXT CHECK (surface_key IS NULL OR length(surface_key) BETWEEN 1 AND 80),
  success INTEGER CHECK (success IS NULL OR success IN (0, 1)),
  duration_bucket TEXT CHECK (duration_bucket IS NULL OR duration_bucket IN ('under_1m', '1m_to_5m', 'over_5m')),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_feedback_events_owner_created
  ON product_feedback_events (owner_user_id, created_at DESC, id);
