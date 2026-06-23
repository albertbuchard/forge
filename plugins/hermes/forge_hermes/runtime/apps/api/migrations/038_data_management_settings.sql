CREATE TABLE IF NOT EXISTS data_management_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  preferred_data_root TEXT NOT NULL DEFAULT '',
  backup_directory TEXT NOT NULL DEFAULT '',
  backup_frequency_hours INTEGER,
  auto_repair_enabled INTEGER NOT NULL DEFAULT 1,
  last_auto_backup_at TEXT,
  last_manual_backup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
