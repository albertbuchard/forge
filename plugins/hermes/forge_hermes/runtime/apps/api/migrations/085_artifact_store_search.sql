CREATE INDEX IF NOT EXISTS idx_artifacts_updated_id
  ON artifacts (updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_artifacts_state_updated_id
  ON artifacts (artifact_state, updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_artifacts_danger_format_updated_id
  ON artifacts (danger_level, format_family, updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_artifacts_format_updated_id
  ON artifacts (format_family, updated_at DESC, id ASC);

CREATE VIRTUAL TABLE IF NOT EXISTS artifact_search USING fts5(
  title,
  short_description,
  description,
  original_file_name,
  source_label,
  metadata_json,
  content = 'artifacts',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO artifact_search(artifact_search) VALUES ('rebuild');

CREATE TRIGGER IF NOT EXISTS artifacts_search_insert
AFTER INSERT ON artifacts
BEGIN
  INSERT INTO artifact_search(
    rowid,
    title,
    short_description,
    description,
    original_file_name,
    source_label,
    metadata_json
  ) VALUES (
    new.rowid,
    new.title,
    new.short_description,
    new.description,
    new.original_file_name,
    new.source_label,
    new.metadata_json
  );
END;

CREATE TRIGGER IF NOT EXISTS artifacts_search_delete
AFTER DELETE ON artifacts
BEGIN
  INSERT INTO artifact_search(
    artifact_search,
    rowid,
    title,
    short_description,
    description,
    original_file_name,
    source_label,
    metadata_json
  ) VALUES (
    'delete',
    old.rowid,
    old.title,
    old.short_description,
    old.description,
    old.original_file_name,
    old.source_label,
    old.metadata_json
  );
END;

CREATE TRIGGER IF NOT EXISTS artifacts_search_update
AFTER UPDATE OF title, short_description, description, original_file_name,
  source_label, metadata_json ON artifacts
BEGIN
  INSERT INTO artifact_search(
    artifact_search,
    rowid,
    title,
    short_description,
    description,
    original_file_name,
    source_label,
    metadata_json
  ) VALUES (
    'delete',
    old.rowid,
    old.title,
    old.short_description,
    old.description,
    old.original_file_name,
    old.source_label,
    old.metadata_json
  );
  INSERT INTO artifact_search(
    rowid,
    title,
    short_description,
    description,
    original_file_name,
    source_label,
    metadata_json
  ) VALUES (
    new.rowid,
    new.title,
    new.short_description,
    new.description,
    new.original_file_name,
    new.source_label,
    new.metadata_json
  );
END;
