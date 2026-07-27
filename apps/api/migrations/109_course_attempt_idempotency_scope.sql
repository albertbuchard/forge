DROP INDEX IF EXISTS idx_course_attempts_idempotency;

CREATE UNIQUE INDEX idx_course_attempts_idempotency
  ON course_attempts (
    course_id,
    user_id,
    lesson_id,
    activity_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;
