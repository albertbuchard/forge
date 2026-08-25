-- Durable Project and tag authority for Work records.
--
-- Work records created before this migration stored their selected Project and
-- tag scope in JSON columns. Restricted credentials now derive authority from
-- direct entity_links instead. Backfill only targets that still exist and are
-- either shared or owned by the same Forge user as the Work record. Invalid,
-- missing, and cross-owner identifiers remain inert historical input.

WITH scoped_records (
  entity_type,
  entity_id,
  owner_user_id,
  scope_ids_json,
  recorded_at
) AS (
  SELECT 'work_organization', id, owner_user_id, scope_project_ids_json, updated_at
  FROM work_organizations
  UNION ALL
  SELECT 'work_engagement', id, owner_user_id, scope_project_ids_json, updated_at
  FROM work_engagements
  UNION ALL
  SELECT 'opportunity_campaign', id, owner_user_id, scope_project_ids_json, updated_at
  FROM opportunity_campaigns
  UNION ALL
  SELECT 'job_opportunity', id, owner_user_id, scope_project_ids_json, updated_at
  FROM job_opportunities
  UNION ALL
  SELECT 'job_application', id, owner_user_id, scope_project_ids_json, updated_at
  FROM job_applications
  UNION ALL
  SELECT 'work_outreach', id, owner_user_id, scope_project_ids_json, updated_at
  FROM work_outreach
  UNION ALL
  SELECT 'candidate_positioning_profile', id, owner_user_id, scope_project_ids_json, updated_at
  FROM candidate_positioning_profiles
  UNION ALL
  SELECT 'candidate_document_set', id, owner_user_id, scope_project_ids_json, updated_at
  FROM candidate_document_sets
  UNION ALL
  SELECT 'application_response_template', id, owner_user_id, scope_project_ids_json, updated_at
  FROM application_response_templates
)
INSERT OR IGNORE INTO entity_links (
  source_entity_type,
  source_entity_id,
  target_entity_type,
  target_entity_id,
  anchor_key,
  relationship,
  created_by_actor,
  created_at
)
SELECT
  scoped_records.entity_type,
  scoped_records.entity_id,
  'project',
  projects.id,
  'work_scope',
  'project_context',
  NULL,
  scoped_records.recorded_at
FROM scoped_records
CROSS JOIN json_each(
  CASE
    WHEN json_valid(scoped_records.scope_ids_json)
    THEN scoped_records.scope_ids_json
    ELSE '[]'
  END
) AS scope_entry
JOIN projects ON projects.id = scope_entry.value
LEFT JOIN entity_owners target_owner
  ON target_owner.entity_type = 'project'
 AND target_owner.entity_id = projects.id
WHERE scope_entry.type = 'text'
  AND (
    target_owner.user_id IS NULL
    OR target_owner.user_id = scoped_records.owner_user_id
  );

WITH scoped_records (
  entity_type,
  entity_id,
  owner_user_id,
  scope_ids_json,
  recorded_at
) AS (
  SELECT 'work_organization', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM work_organizations
  UNION ALL
  SELECT 'work_engagement', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM work_engagements
  UNION ALL
  SELECT 'opportunity_campaign', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM opportunity_campaigns
  UNION ALL
  SELECT 'job_opportunity', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM job_opportunities
  UNION ALL
  SELECT 'job_application', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM job_applications
  UNION ALL
  SELECT 'work_outreach', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM work_outreach
  UNION ALL
  SELECT 'candidate_positioning_profile', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM candidate_positioning_profiles
  UNION ALL
  SELECT 'candidate_document_set', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM candidate_document_sets
  UNION ALL
  SELECT 'application_response_template', id, owner_user_id, scope_tag_ids_json, updated_at
  FROM application_response_templates
)
INSERT OR IGNORE INTO entity_links (
  source_entity_type,
  source_entity_id,
  target_entity_type,
  target_entity_id,
  anchor_key,
  relationship,
  created_by_actor,
  created_at
)
SELECT
  scoped_records.entity_type,
  scoped_records.entity_id,
  'tag',
  tags.id,
  'work_scope',
  'tag_context',
  NULL,
  scoped_records.recorded_at
FROM scoped_records
CROSS JOIN json_each(
  CASE
    WHEN json_valid(scoped_records.scope_ids_json)
    THEN scoped_records.scope_ids_json
    ELSE '[]'
  END
) AS scope_entry
JOIN tags ON tags.id = scope_entry.value
LEFT JOIN entity_owners target_owner
  ON target_owner.entity_type = 'tag'
 AND target_owner.entity_id = tags.id
WHERE scope_entry.type = 'text'
  AND (
    target_owner.user_id IS NULL
    OR target_owner.user_id = scoped_records.owner_user_id
  );
