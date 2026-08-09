-- Keep a compact integrity identity for large course definitions. Any direct
-- payload update invalidates the identity until the canonical importer has
-- written and verified the replacement definition.

ALTER TABLE courses
  ADD COLUMN definition_sha256 TEXT
  CHECK (
    definition_sha256 IS NULL OR (
      length(definition_sha256) = 64 AND
      definition_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE course_releases
  ADD COLUMN definition_sha256 TEXT
  CHECK (
    definition_sha256 IS NULL OR (
      length(definition_sha256) = 64 AND
      definition_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );

CREATE TRIGGER course_definition_integrity_invalidate
AFTER UPDATE OF definition_json ON courses
WHEN NEW.definition_json IS NOT OLD.definition_json
BEGIN
  UPDATE courses
  SET definition_sha256 = NULL
  WHERE id = NEW.id;
END;

CREATE TRIGGER course_release_definition_integrity_invalidate
AFTER UPDATE OF definition_json ON course_releases
WHEN NEW.definition_json IS NOT OLD.definition_json
BEGIN
  UPDATE course_releases
  SET definition_sha256 = NULL
  WHERE course_id = NEW.course_id AND version = NEW.version;
END;
