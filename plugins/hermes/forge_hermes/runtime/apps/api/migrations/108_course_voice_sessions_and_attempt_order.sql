-- Add privacy-safe voice learning sessions, stable attempt ordering, and
-- idempotent course submissions. Voice sessions store scope and expiry only;
-- they never store audio or a separate transcript.

ALTER TABLE course_attempts
  ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'visual'
    CHECK (delivery_mode IN ('visual', 'voice'));

ALTER TABLE course_attempts
  ADD COLUMN lesson_attempt_ordinal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE course_attempts
  ADD COLUMN activity_attempt_ordinal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE course_attempts
  ADD COLUMN idempotency_key TEXT;

ALTER TABLE course_attempts
  ADD COLUMN request_content_hash TEXT NOT NULL DEFAULT '';

UPDATE course_attempts AS target
SET lesson_attempt_ordinal = (
      SELECT COUNT(*)
      FROM course_attempts AS prior
      WHERE prior.course_id = target.course_id
        AND prior.course_version = target.course_version
        AND prior.user_id = target.user_id
        AND prior.lesson_id = target.lesson_id
        AND (
          prior.submitted_at < target.submitted_at
          OR (
            prior.submitted_at = target.submitted_at
            AND prior.rowid <= target.rowid
          )
        )
    ),
    activity_attempt_ordinal = (
      SELECT COUNT(*)
      FROM course_attempts AS prior
      WHERE prior.course_id = target.course_id
        AND prior.course_version = target.course_version
        AND prior.user_id = target.user_id
        AND prior.lesson_id = target.lesson_id
        AND prior.activity_id = target.activity_id
        AND (
          prior.submitted_at < target.submitted_at
          OR (
            prior.submitted_at = target.submitted_at
            AND prior.rowid <= target.rowid
          )
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_attempts_lesson_ordinal
  ON course_attempts (
    course_id,
    course_version,
    user_id,
    lesson_id,
    lesson_attempt_ordinal
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_attempts_activity_ordinal
  ON course_attempts (
    course_id,
    course_version,
    user_id,
    lesson_id,
    activity_id,
    activity_attempt_ordinal
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_attempts_idempotency
  ON course_attempts (
    course_id,
    course_version,
    user_id,
    lesson_id,
    activity_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS course_voice_sessions (
  token TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  course_version TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (course_id, lesson_id)
    REFERENCES course_lessons(course_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_voice_sessions_scope
  ON course_voice_sessions (
    course_id,
    course_version,
    user_id,
    lesson_id,
    expires_at
  );
