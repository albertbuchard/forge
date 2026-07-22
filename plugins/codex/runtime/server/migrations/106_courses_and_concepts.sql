-- Courses are reusable paths through globally stable concept entities.
-- Learner mastery is concept-scoped so evidence can transfer across courses.

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  authors_json TEXT NOT NULL DEFAULT '[]',
  license TEXT NOT NULL,
  estimated_weeks INTEGER NOT NULL CHECK (estimated_weeks > 0),
  minutes_per_week INTEGER NOT NULL CHECK (minutes_per_week > 0),
  tags_json TEXT NOT NULL DEFAULT '[]',
  entry_lesson_id TEXT NOT NULL,
  featured_lesson_id TEXT,
  source_url TEXT,
  content_hash TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  definition_markdown TEXT NOT NULL,
  example_markdown TEXT NOT NULL DEFAULT '',
  non_example_markdown TEXT NOT NULL DEFAULT '',
  prerequisite_ids_json TEXT NOT NULL DEFAULT '[]',
  related_ids_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_concepts (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'required' CHECK (
    status IN ('required', 'required_proof', 'proof_not_required', 'activity_only', 'out_of_scope')
  ),
  delivery_owner TEXT NOT NULL DEFAULT 'course' CHECK (
    delivery_owner IN ('course', 'shared', 'assessment_only')
  ),
  PRIMARY KEY (course_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_course_concepts_concept
  ON course_concepts (concept_id, course_id);

CREATE TABLE IF NOT EXISTS course_modules (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  start_week INTEGER NOT NULL,
  end_week INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  PRIMARY KEY (course_id, id)
);

CREATE TABLE IF NOT EXISTS course_lessons (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  week INTEGER NOT NULL,
  day INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  PRIMARY KEY (course_id, id),
  FOREIGN KEY (course_id, module_id)
    REFERENCES course_modules(course_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_order
  ON course_lessons (course_id, order_index);

CREATE TABLE IF NOT EXISTS course_enrollments (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_lesson_id TEXT,
  points_earned INTEGER NOT NULL DEFAULT 0,
  enrolled_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS course_attempts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_markdown TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('assessing', 'assessed', 'needs_review')),
  score REAL,
  grade TEXT,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  assessed_at TEXT,
  FOREIGN KEY (course_id, lesson_id)
    REFERENCES course_lessons(course_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_attempts_user_activity
  ON course_attempts (user_id, course_id, activity_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS course_assessments (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES course_attempts(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'revise', 'insufficient', 'needs_review')),
  feedback_json TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS concept_mastery (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mastery_score REAL NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 100),
  average_score REAL NOT NULL DEFAULT 0 CHECK (average_score BETWEEN 0 AND 100),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  successful_review_count INTEGER NOT NULL DEFAULT 0,
  review_interval_days INTEGER,
  next_review_at TEXT,
  last_evidence_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_review
  ON concept_mastery (user_id, next_review_at, mastery_score);

CREATE TABLE IF NOT EXISTS concept_evidence (
  attempt_id TEXT NOT NULL REFERENCES course_attempts(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  evidence_markdown TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_evidence_history
  ON concept_evidence (user_id, concept_id, created_at DESC);

CREATE TABLE IF NOT EXISTS concept_mastery_dimensions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL,
  mastery_score REAL NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 100),
  average_score REAL NOT NULL DEFAULT 0 CHECK (average_score BETWEEN 0 AND 100),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_evidence_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, concept_id, dimension_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_dimensions_concept
  ON concept_mastery_dimensions (user_id, concept_id, dimension_id);

CREATE TABLE IF NOT EXISTS concept_dimension_evidence (
  attempt_id TEXT NOT NULL REFERENCES course_attempts(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
  evidence_markdown TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, concept_id, dimension_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_dimension_evidence_history
  ON concept_dimension_evidence (user_id, concept_id, dimension_id, created_at DESC);

CREATE TABLE IF NOT EXISTS learner_misconceptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  misconception_id TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  resolved_at TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, concept_id, misconception_id)
);
