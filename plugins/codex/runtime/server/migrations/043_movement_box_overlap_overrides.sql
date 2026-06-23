ALTER TABLE movement_boxes
ADD COLUMN true_started_at TEXT;

ALTER TABLE movement_boxes
ADD COLUMN true_ended_at TEXT;

ALTER TABLE movement_boxes
ADD COLUMN overridden_started_at TEXT;

ALTER TABLE movement_boxes
ADD COLUMN overridden_ended_at TEXT;

ALTER TABLE movement_boxes
ADD COLUMN overridden_by_box_id TEXT;

ALTER TABLE movement_boxes
ADD COLUMN overridden_user_box_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE movement_boxes
ADD COLUMN override_ranges_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE movement_boxes
ADD COLUMN is_overridden INTEGER NOT NULL DEFAULT 0;

ALTER TABLE movement_boxes
ADD COLUMN is_fully_hidden INTEGER NOT NULL DEFAULT 0;
