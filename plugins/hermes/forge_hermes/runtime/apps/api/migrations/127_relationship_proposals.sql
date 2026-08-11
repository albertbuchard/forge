CREATE TABLE IF NOT EXISTS relationship_proposals (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  source_entity_type TEXT NOT NULL CHECK (length(trim(source_entity_type)) BETWEEN 1 AND 64),
  source_entity_id TEXT NOT NULL CHECK (length(trim(source_entity_id)) BETWEEN 1 AND 256),
  target_entity_type TEXT NOT NULL CHECK (length(trim(target_entity_type)) BETWEEN 1 AND 64),
  target_entity_id TEXT NOT NULL CHECK (length(trim(target_entity_id)) BETWEEN 1 AND 256),
  canonical_pair_key TEXT NOT NULL CHECK (length(canonical_pair_key) BETWEEN 3 AND 650),
  relationship TEXT NOT NULL CHECK (relationship IN ('supports', 'informs', 'related')),
  evidence_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array' AND length(evidence_json) <= 4096),
  explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 800),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  generator_id TEXT NOT NULL CHECK (length(generator_id) BETWEEN 1 AND 80),
  generator_version TEXT NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 80),
  generation_epoch TEXT NOT NULL CHECK (length(generation_epoch) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at TEXT NOT NULL CHECK (julianday(expires_at) IS NOT NULL),
  resolved_by_actor TEXT,
  resolved_at TEXT CHECK (resolved_at IS NULL OR julianday(resolved_at) IS NOT NULL),
  link_created INTEGER NOT NULL DEFAULT 0 CHECK (link_created IN (0, 1)),
  created_at TEXT NOT NULL CHECK (julianday(created_at) IS NOT NULL),
  updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
  CHECK (source_entity_type <> target_entity_type OR source_entity_id <> target_entity_id),
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by_actor IS NULL AND link_created = 0)
    OR (status = 'accepted' AND resolved_at IS NOT NULL AND link_created = 1)
    OR (status IN ('rejected', 'expired') AND resolved_at IS NOT NULL AND link_created = 0)
  ),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_proposals_generation_pair
  ON relationship_proposals (
    owner_user_id,
    generator_version,
    generation_epoch,
    canonical_pair_key,
    relationship
  );

CREATE INDEX IF NOT EXISTS idx_relationship_proposals_owner_pending
  ON relationship_proposals (owner_user_id, status, confidence DESC, created_at ASC, id);

CREATE INDEX IF NOT EXISTS idx_relationship_proposals_owner_pair_history
  ON relationship_proposals (
    owner_user_id,
    canonical_pair_key,
    relationship,
    created_at DESC,
    id
  );
