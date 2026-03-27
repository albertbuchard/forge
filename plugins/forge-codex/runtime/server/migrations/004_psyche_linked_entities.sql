ALTER TABLE behavior_patterns
ADD COLUMN linked_mode_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE behavior_patterns
ADD COLUMN linked_belief_ids_json TEXT NOT NULL DEFAULT '[]';
