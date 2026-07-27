-- Preserve immutable course packages and the exact assessment definition used
-- for every learner attempt.

CREATE TABLE IF NOT EXISTS course_releases (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (course_id, version),
  UNIQUE (course_id, content_hash)
);

ALTER TABLE course_enrollments
  ADD COLUMN course_version TEXT NOT NULL DEFAULT '';

UPDATE course_enrollments
SET course_version = (
  SELECT version FROM courses WHERE courses.id = course_enrollments.course_id
)
WHERE course_version = '';

ALTER TABLE course_attempts
  ADD COLUMN course_version TEXT NOT NULL DEFAULT '';

ALTER TABLE course_attempts
  ADD COLUMN activity_revision TEXT NOT NULL DEFAULT '1';

ALTER TABLE course_attempts
  ADD COLUMN activity_content_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE course_attempts
  ADD COLUMN activity_snapshot_json TEXT NOT NULL DEFAULT '{}';

UPDATE course_attempts
SET course_version = (
  SELECT version FROM courses WHERE courses.id = course_attempts.course_id
)
WHERE course_version = '';

CREATE INDEX IF NOT EXISTS idx_course_attempts_release_activity
  ON course_attempts (
    user_id,
    course_id,
    course_version,
    activity_id,
    submitted_at DESC
  );

CREATE TABLE IF NOT EXISTS course_enrollment_upgrade_receipts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  carried_activity_ids_json TEXT NOT NULL DEFAULT '[]',
  remaining_activity_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
