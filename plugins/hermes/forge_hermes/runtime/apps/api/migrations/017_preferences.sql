CREATE TABLE IF NOT EXISTS preference_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  default_context_id TEXT,
  model_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, domain)
);

CREATE TABLE IF NOT EXISTS preference_contexts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  share_mode TEXT NOT NULL DEFAULT 'blended' CHECK (share_mode IN ('shared', 'isolated', 'blended')),
  active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  decay_days INTEGER NOT NULL DEFAULT 90,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preference_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  feature_weights_json TEXT NOT NULL DEFAULT '{}',
  source_entity_type TEXT,
  source_entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairwise_judgments (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES preference_contexts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  left_item_id TEXT NOT NULL REFERENCES preference_items(id) ON DELETE CASCADE,
  right_item_id TEXT NOT NULL REFERENCES preference_items(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('left', 'right', 'tie', 'skip')),
  strength REAL NOT NULL DEFAULT 1,
  response_time_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'ui',
  reason_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS absolute_signals (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES preference_contexts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES preference_items(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('favorite', 'veto', 'must_have', 'bookmark', 'neutral', 'compare_later')),
  strength REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'ui',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preference_item_scores (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES preference_contexts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES preference_items(id) ON DELETE CASCADE,
  latent_score REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  uncertainty REAL NOT NULL DEFAULT 1,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  pairwise_wins INTEGER NOT NULL DEFAULT 0,
  pairwise_losses INTEGER NOT NULL DEFAULT 0,
  pairwise_ties INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uncertain',
  dominant_dimensions_json TEXT NOT NULL DEFAULT '[]',
  explanation_json TEXT NOT NULL DEFAULT '[]',
  manual_status TEXT,
  manual_score REAL,
  confidence_lock REAL,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  compare_later INTEGER NOT NULL DEFAULT 0,
  frozen INTEGER NOT NULL DEFAULT 0,
  last_inferred_at TEXT NOT NULL,
  last_judgment_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (context_id, item_id)
);

CREATE TABLE IF NOT EXISTS preference_dimension_summaries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES preference_contexts(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL,
  leaning REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  movement REAL NOT NULL DEFAULT 0,
  context_sensitivity REAL NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (context_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS preference_snapshots (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES preference_contexts(id) ON DELETE CASCADE,
  summary_metrics_json TEXT NOT NULL DEFAULT '{}',
  serialized_model_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preference_profiles_user_domain
  ON preference_profiles(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_preference_contexts_profile_active
  ON preference_contexts(profile_id, active, is_default);
CREATE INDEX IF NOT EXISTS idx_preference_items_profile
  ON preference_items(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pairwise_judgments_context_created
  ON pairwise_judgments(context_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_absolute_signals_context_created
  ON absolute_signals(context_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_preference_scores_context
  ON preference_item_scores(context_id, status, confidence DESC, latent_score DESC);
CREATE INDEX IF NOT EXISTS idx_preference_snapshots_context
  ON preference_snapshots(context_id, created_at DESC);
