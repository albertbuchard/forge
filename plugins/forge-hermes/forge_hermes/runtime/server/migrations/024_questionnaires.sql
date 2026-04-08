CREATE TABLE IF NOT EXISTS questionnaire_instruments (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  symptom_domains_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_class TEXT NOT NULL,
  availability TEXT NOT NULL,
  is_self_report INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  owner_user_id TEXT,
  current_draft_version_id TEXT,
  current_published_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questionnaire_versions (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES questionnaire_instruments(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  scoring_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  is_read_only INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (instrument_id, version_number)
);

CREATE TABLE IF NOT EXISTS questionnaire_runs (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES questionnaire_instruments(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT NOT NULL,
  progress_index INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS questionnaire_answers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES questionnaire_runs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  option_key TEXT,
  value_text TEXT NOT NULL DEFAULT '',
  numeric_value REAL,
  answer_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, item_id)
);

CREATE TABLE IF NOT EXISTS questionnaire_run_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES questionnaire_runs(id) ON DELETE CASCADE,
  score_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value_numeric REAL,
  value_text TEXT,
  band_label TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (run_id, score_key)
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_versions_instrument
  ON questionnaire_versions (instrument_id, version_number);

CREATE INDEX IF NOT EXISTS idx_questionnaire_runs_instrument
  ON questionnaire_runs (instrument_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_questionnaire_runs_version
  ON questionnaire_runs (version_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_questionnaire_runs_user
  ON questionnaire_runs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_questionnaire_answers_run
  ON questionnaire_answers (run_id, item_id);

CREATE INDEX IF NOT EXISTS idx_questionnaire_run_scores_run
  ON questionnaire_run_scores (run_id, sort_order, score_key);
