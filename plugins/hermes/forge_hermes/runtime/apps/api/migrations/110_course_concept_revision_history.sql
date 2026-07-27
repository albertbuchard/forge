-- Permit an owning course to publish an explicit, auditable improvement to a
-- canonical concept while preserving the definition learners previously used.

CREATE TABLE IF NOT EXISTS course_concept_revisions (
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  source_course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_course_version TEXT NOT NULL,
  replaced_by_content_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  upgraded_at TEXT NOT NULL,
  PRIMARY KEY (concept_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_course_concept_revisions_source
  ON course_concept_revisions (
    source_course_id,
    source_course_version,
    upgraded_at
  );
