CREATE TABLE IF NOT EXISTS psyche_flashcards (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  trigger_sentence TEXT NOT NULL DEFAULT '',
  trigger_situation TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  background_color TEXT NOT NULL DEFAULT '#f8fafc',
  text_color TEXT NOT NULL DEFAULT '#111827',
  accent_color TEXT NOT NULL DEFAULT '#6ee7b7',
  typography TEXT NOT NULL DEFAULT 'serif',
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT 'centered',
  visual_style TEXT NOT NULL DEFAULT 'calm',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_behavior_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_pattern_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_belief_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_mode_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_report_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_psyche_flashcards_domain_updated
  ON psyche_flashcards(domain_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_psyche_flashcards_trigger_sentence
  ON psyche_flashcards(trigger_sentence);
