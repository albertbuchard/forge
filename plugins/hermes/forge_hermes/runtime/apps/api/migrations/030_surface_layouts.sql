CREATE TABLE IF NOT EXISTS surface_layouts (
  surface_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
