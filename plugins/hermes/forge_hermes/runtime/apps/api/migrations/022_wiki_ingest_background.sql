ALTER TABLE wiki_ingest_jobs
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued';

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN processed_files INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN created_page_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN created_entity_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN accepted_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN rejected_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN latest_message TEXT NOT NULL DEFAULT '';

ALTER TABLE wiki_ingest_jobs
  ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS wiki_ingest_job_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES wiki_ingest_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wiki_ingest_job_logs_job
  ON wiki_ingest_job_logs (job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS wiki_ingest_job_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  source_kind TEXT NOT NULL,
  source_locator TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES wiki_ingest_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wiki_ingest_job_assets_job
  ON wiki_ingest_job_assets (job_id, created_at ASC);

CREATE TABLE IF NOT EXISTS wiki_ingest_job_candidates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_asset_id TEXT,
  candidate_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  target_key TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  published_note_id TEXT,
  published_entity_type TEXT,
  published_entity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES wiki_ingest_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_asset_id) REFERENCES wiki_ingest_job_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (published_note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_ingest_job_candidates_job
  ON wiki_ingest_job_candidates (job_id, created_at ASC);
