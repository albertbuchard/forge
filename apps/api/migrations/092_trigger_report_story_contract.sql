ALTER TABLE trigger_reports
  ADD COLUMN body_cues_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE trigger_reports
  ADD COLUMN memory_clarity TEXT NOT NULL DEFAULT 'unspecified'
  CHECK (memory_clarity IN ('unspecified', 'clear', 'partial', 'uncertain'));

ALTER TABLE trigger_reports
  ADD COLUMN reflection TEXT NOT NULL DEFAULT '';

ALTER TABLE trigger_reports
  ADD COLUMN hypothesis TEXT NOT NULL DEFAULT '';

ALTER TABLE trigger_reports
  ADD COLUMN hypothesis_fit TEXT NOT NULL DEFAULT 'not_reviewed'
  CHECK (hypothesis_fit IN ('not_reviewed', 'fits', 'partly_fits', 'does_not_fit'));

ALTER TABLE trigger_reports
  ADD COLUMN hypothesis_correction TEXT NOT NULL DEFAULT '';

ALTER TABLE trigger_reports
  ADD COLUMN interpretation_consent INTEGER NOT NULL DEFAULT 0
  CHECK (interpretation_consent IN (0, 1));

ALTER TABLE trigger_reports
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
  CHECK (revision >= 1);

CREATE INDEX IF NOT EXISTS idx_trigger_reports_created_page
  ON trigger_reports (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trigger_report_create_idempotency (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES trigger_reports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_report_idempotency_report
  ON trigger_report_create_idempotency (report_id);

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'event_type', event_types.id,
  '', 'event_context', NULL, trigger_reports.updated_at
FROM trigger_reports
JOIN event_types ON event_types.id = trigger_reports.event_type_id
WHERE trigger_reports.event_type_id IS NOT NULL;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'behavior_pattern', behavior_patterns.id,
  '', 'pattern_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_pattern_ids_json)
    THEN trigger_reports.linked_pattern_ids_json
    ELSE '[]'
  END
) AS linked
JOIN behavior_patterns ON behavior_patterns.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'psyche_value', psyche_values.id,
  '', 'value_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_value_ids_json)
    THEN trigger_reports.linked_value_ids_json
    ELSE '[]'
  END
) AS linked
JOIN psyche_values ON psyche_values.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'goal', goals.id,
  '', 'goal_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_goal_ids_json)
    THEN trigger_reports.linked_goal_ids_json
    ELSE '[]'
  END
) AS linked
JOIN goals ON goals.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'project', projects.id,
  '', 'project_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_project_ids_json)
    THEN trigger_reports.linked_project_ids_json
    ELSE '[]'
  END
) AS linked
JOIN projects ON projects.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'task', tasks.id,
  '', 'task_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_task_ids_json)
    THEN trigger_reports.linked_task_ids_json
    ELSE '[]'
  END
) AS linked
JOIN tasks ON tasks.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'behavior', psyche_behaviors.id,
  '', 'behavior_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_behavior_ids_json)
    THEN trigger_reports.linked_behavior_ids_json
    ELSE '[]'
  END
) AS linked
JOIN psyche_behaviors ON psyche_behaviors.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'belief_entry', belief_entries.id,
  '', 'belief_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_belief_ids_json)
    THEN trigger_reports.linked_belief_ids_json
    ELSE '[]'
  END
) AS linked
JOIN belief_entries ON belief_entries.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'mode_profile', mode_profiles.id,
  '', 'mode_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.linked_mode_ids_json)
    THEN trigger_reports.linked_mode_ids_json
    ELSE '[]'
  END
) AS linked
JOIN mode_profiles ON mode_profiles.id = linked.value;

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'emotion_definition', emotion_definitions.id,
  '', 'emotion_context', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.emotions_json)
    THEN trigger_reports.emotions_json
    ELSE '[]'
  END
) AS entry
JOIN emotion_definitions
  ON emotion_definitions.id = json_extract(
    CASE WHEN entry.type = 'object' THEN entry.value ELSE '{}' END,
    '$.emotionDefinitionId'
  );

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'belief_entry', belief_entries.id,
  '', 'thought_belief', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.thoughts_json)
    THEN trigger_reports.thoughts_json
    ELSE '[]'
  END
) AS entry
JOIN belief_entries
  ON belief_entries.id = json_extract(
    CASE WHEN entry.type = 'object' THEN entry.value ELSE '{}' END,
    '$.beliefId'
  );

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'behavior', psyche_behaviors.id,
  '', 'observed_behavior', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.behaviors_json)
    THEN trigger_reports.behaviors_json
    ELSE '[]'
  END
) AS entry
JOIN psyche_behaviors
  ON psyche_behaviors.id = json_extract(
    CASE WHEN entry.type = 'object' THEN entry.value ELSE '{}' END,
    '$.behaviorId'
  );

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  'trigger_report', trigger_reports.id, 'mode_profile', mode_profiles.id,
  '', 'mode_timeline', NULL, trigger_reports.updated_at
FROM trigger_reports
CROSS JOIN json_each(
  CASE
    WHEN json_valid(trigger_reports.mode_timeline_json)
    THEN trigger_reports.mode_timeline_json
    ELSE '[]'
  END
) AS entry
JOIN mode_profiles
  ON mode_profiles.id = json_extract(
    CASE WHEN entry.type = 'object' THEN entry.value ELSE '{}' END,
    '$.modeId'
  );
