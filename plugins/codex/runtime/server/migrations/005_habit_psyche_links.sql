ALTER TABLE habits
ADD COLUMN linked_value_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_pattern_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_behavior_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_belief_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_mode_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_report_ids_json TEXT NOT NULL DEFAULT '[]';

UPDATE habits
SET linked_behavior_ids_json = CASE
  WHEN linked_behavior_id IS NULL OR trim(linked_behavior_id) = '' THEN '[]'
  ELSE json_array(linked_behavior_id)
END
WHERE linked_behavior_ids_json = '[]';
