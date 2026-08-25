-- Permanent Work and Job Search product model.
-- This migration is additive. Subjective Work metrics are never seeded or inferred.

CREATE TABLE work_settings (
  owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  looking_for_opportunities INTEGER NOT NULL DEFAULT 0 CHECK (looking_for_opportunities IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE work_organizations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 240),
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  domain TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  location_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(location_json) AND json_type(location_json) = 'object'),
  organization_facts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(organization_facts_json) AND json_type(organization_facts_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'target', 'excluded', 'past', 'archived')),
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, normalized_name)
) STRICT;

CREATE INDEX idx_work_organizations_owner_status
  ON work_organizations (owner_user_id, status, updated_at DESC, id);

CREATE TABLE work_engagements (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES work_organizations(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  role_function TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'current', 'on_leave', 'transitioning', 'ended', 'archived')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  engagement_type TEXT NOT NULL DEFAULT 'employment' CHECK (engagement_type IN ('employment', 'appointment', 'contract', 'freelance', 'fractional', 'shift', 'self_employment', 'advisory', 'internship', 'seasonal', 'other')),
  start_date TEXT,
  expected_end_date TEXT,
  actual_end_date TEXT,
  probation_end_date TEXT,
  renewal_date TEXT,
  contract_deadline TEXT,
  notice_period_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(notice_period_json) AND json_type(notice_period_json) = 'object'),
  earliest_departure_date TEXT,
  workload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(workload_json) AND json_type(workload_json) = 'object'),
  schedule_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(schedule_json) AND json_type(schedule_json) = 'object'),
  location_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(location_json) AND json_type(location_json) = 'object'),
  work_model TEXT NOT NULL DEFAULT 'unknown' CHECK (work_model IN ('remote', 'hybrid', 'on_site', 'variable', 'unknown')),
  role_facts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(role_facts_json) AND json_type(role_facts_json) = 'object'),
  responsibilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(responsibilities_json) AND json_type(responsibilities_json) = 'array'),
  success_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array'),
  compensation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(compensation_json) AND json_type(compensation_json) = 'object'),
  benefits_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(benefits_json) AND json_type(benefits_json) = 'array'),
  purpose TEXT NOT NULL DEFAULT '',
  desired_outcomes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(desired_outcomes_json) AND json_type(desired_outcomes_json) = 'array'),
  risks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risks_json) AND json_type(risks_json) = 'array'),
  constraints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(constraints_json) AND json_type(constraints_json) = 'array'),
  transition_intentions TEXT NOT NULL DEFAULT '',
  exit_reason TEXT NOT NULL DEFAULT '',
  exit_outcome TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_work_engagements_owner_status
  ON work_engagements (owner_user_id, status, updated_at DESC, id);
CREATE INDEX idx_work_engagements_organization
  ON work_engagements (organization_id, status, updated_at DESC);

CREATE TABLE work_engagement_events (
  id TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES work_engagements(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  prior_status TEXT,
  new_status TEXT,
  factual_description TEXT NOT NULL DEFAULT '',
  changes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(changes_json) AND json_type(changes_json) = 'object'),
  occurred_at TEXT NOT NULL,
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_work_engagement_events_timeline
  ON work_engagement_events (engagement_id, occurred_at DESC, id DESC);

CREATE TABLE work_metric_definitions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  value_kind TEXT NOT NULL DEFAULT 'ordinal' CHECK (value_kind IN ('ordinal', 'numeric', 'categorical')),
  scale_json TEXT NOT NULL CHECK (json_valid(scale_json) AND json_type(scale_json) = 'object'),
  target_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_json) AND json_type(target_json) = 'object'),
  warning_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(warning_json) AND json_type(warning_json) = 'object'),
  review_cadence TEXT NOT NULL DEFAULT 'monthly',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, canonical_key, version)
) STRICT;

CREATE INDEX idx_work_metric_definitions_owner
  ON work_metric_definitions (owner_user_id, enabled DESC, canonical_key, version DESC);

CREATE TABLE work_check_ins (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  engagement_id TEXT NOT NULL REFERENCES work_engagements(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json) AND json_type(context_json) = 'object'),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user_entered', 'imported', 'agent_suggested')),
  confirmation_state TEXT NOT NULL DEFAULT 'confirmed' CHECK (confirmation_state IN ('suggested', 'confirmed', 'rejected')),
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_work_check_ins_engagement
  ON work_check_ins (engagement_id, observed_at DESC, id DESC);

CREATE TABLE work_metric_observations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  engagement_id TEXT NOT NULL REFERENCES work_engagements(id) ON DELETE CASCADE,
  check_in_id TEXT REFERENCES work_check_ins(id) ON DELETE CASCADE,
  metric_definition_id TEXT NOT NULL REFERENCES work_metric_definitions(id),
  metric_key TEXT NOT NULL,
  metric_version INTEGER NOT NULL CHECK (metric_version >= 1),
  observed_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  numeric_value REAL,
  categorical_value TEXT,
  missing_state TEXT NOT NULL DEFAULT 'observed' CHECK (missing_state IN ('observed', 'unknown', 'skipped', 'not_applicable')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  note TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json) AND json_type(context_json) = 'object'),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user_entered', 'imported', 'agent_suggested')),
  confirmation_state TEXT NOT NULL DEFAULT 'confirmed' CHECK (confirmation_state IN ('suggested', 'confirmed', 'rejected')),
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  CHECK (
    (missing_state = 'observed' AND ((numeric_value IS NOT NULL) != (categorical_value IS NOT NULL)))
    OR (missing_state != 'observed' AND numeric_value IS NULL AND categorical_value IS NULL)
  )
) STRICT;

CREATE INDEX idx_work_metric_observations_trend
  ON work_metric_observations (engagement_id, metric_key, observed_at DESC, id DESC);

CREATE TABLE opportunity_campaigns (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_engagement_id TEXT REFERENCES work_engagements(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  purpose TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'active', 'paused', 'completed', 'abandoned', 'archived')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  search_intent TEXT NOT NULL DEFAULT 'full_time_employment' CHECK (search_intent IN ('full_time_employment', 'part_time_employment', 'contract', 'freelance', 'fractional', 'internship', 'shift_work', 'seasonal', 'board_advisory', 'other')),
  active_from TEXT,
  active_until TEXT,
  target_start_date TEXT,
  search_deadline TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
  review_cadence TEXT NOT NULL DEFAULT 'weekly',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  completion_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(completion_criteria_json) AND json_type(completion_criteria_json) = 'array'),
  long_term_destination TEXT NOT NULL DEFAULT '',
  intermediate_roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(intermediate_roles_json) AND json_type(intermediate_roles_json) = 'array'),
  capabilities_to_acquire_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_to_acquire_json) AND json_type(capabilities_to_acquire_json) = 'array'),
  stepping_stone_assessment TEXT NOT NULL DEFAULT 'unknown' CHECK (stepping_stone_assessment IN ('stepping_stone', 'neutral', 'dead_end_risk', 'unknown')),
  current_stage TEXT NOT NULL DEFAULT 'defining',
  health TEXT NOT NULL DEFAULT 'unknown' CHECK (health IN ('healthy', 'attention', 'blocked', 'unknown')),
  next_action TEXT NOT NULL DEFAULT '',
  blockers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blockers_json) AND json_type(blockers_json) = 'array'),
  last_meaningful_activity_at TEXT,
  current_criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL,
  primary_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_opportunity_campaigns_owner_status
  ON opportunity_campaigns (owner_user_id, status, priority, updated_at DESC, id);

CREATE TABLE campaign_criteria_versions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json) AND json_type(criteria_json) = 'object' AND length(criteria_json) <= 1048576),
  rationale TEXT NOT NULL DEFAULT '',
  effective_at TEXT NOT NULL,
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (campaign_id, version)
) STRICT;

CREATE INDEX idx_campaign_criteria_versions_campaign
  ON campaign_criteria_versions (campaign_id, version DESC);

CREATE TABLE campaign_role_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  title_family TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  seniority TEXT NOT NULL DEFAULT '',
  function_name TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  responsibilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(responsibilities_json) AND json_type(responsibilities_json) = 'array'),
  technologies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(technologies_json) AND json_type(technologies_json) = 'array'),
  required_qualifications_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_qualifications_json) AND json_type(required_qualifications_json) = 'array'),
  desired_qualifications_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(desired_qualifications_json) AND json_type(desired_qualifications_json) = 'array'),
  transferable_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transferable_evidence_json) AND json_type(transferable_evidence_json) = 'array'),
  known_gaps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(known_gaps_json) AND json_type(known_gaps_json) = 'array'),
  evidence_actions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_actions_json) AND json_type(evidence_actions_json) = 'array'),
  search_terms_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(search_terms_json) AND json_type(search_terms_json) = 'array'),
  query_fragments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(query_fragments_json) AND json_type(query_fragments_json) = 'array'),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_campaign_role_targets_campaign
  ON campaign_role_targets (campaign_id, priority DESC, updated_at DESC);

CREATE TABLE campaign_organization_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES work_organizations(id),
  target_tier TEXT NOT NULL DEFAULT 'explore',
  rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watching', 'contacting', 'paused', 'excluded', 'completed')),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  warm_paths_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warm_paths_json) AND json_type(warm_paths_json) = 'array'),
  exclusions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exclusions_json) AND json_type(exclusions_json) = 'array'),
  prior_applications_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prior_applications_json) AND json_type(prior_applications_json) = 'array'),
  next_action TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (campaign_id, organization_id)
) STRICT;

CREATE TABLE job_opportunities (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES work_organizations(id) ON DELETE SET NULL,
  canonical_url TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_identifier TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  employer_name TEXT NOT NULL DEFAULT '',
  role_family TEXT NOT NULL DEFAULT '',
  seniority TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  responsibilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(responsibilities_json) AND json_type(responsibilities_json) = 'array'),
  requirements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requirements_json) AND json_type(requirements_json) = 'array'),
  preferred_qualifications_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preferred_qualifications_json) AND json_type(preferred_qualifications_json) = 'array'),
  skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json) AND json_type(skills_json) = 'array'),
  technologies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(technologies_json) AND json_type(technologies_json) = 'array'),
  sector TEXT NOT NULL DEFAULT '',
  location_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(location_json) AND json_type(location_json) = 'object'),
  work_model TEXT NOT NULL DEFAULT 'unknown' CHECK (work_model IN ('remote', 'hybrid', 'on_site', 'variable', 'unknown')),
  travel_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(travel_json) AND json_type(travel_json) = 'object'),
  sponsorship_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(sponsorship_json) AND json_type(sponsorship_json) = 'object'),
  employment_type TEXT NOT NULL DEFAULT 'unknown',
  weekly_hours_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(weekly_hours_json) AND json_type(weekly_hours_json) = 'object'),
  duration_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(duration_json) AND json_type(duration_json) = 'object'),
  start_date TEXT,
  compensation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(compensation_json) AND json_type(compensation_json) = 'object'),
  benefits_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(benefits_json) AND json_type(benefits_json) = 'array'),
  application_route_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(application_route_json) AND json_type(application_route_json) = 'object'),
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  application_deadline TEXT,
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('live', 'stale', 'closed', 'filled', 'unknown')),
  disposition TEXT NOT NULL DEFAULT 'discovered' CHECK (disposition IN ('discovered', 'reviewing', 'shortlisted', 'qualified', 'rejected_by_user', 'disqualified', 'applied', 'stale', 'closed', 'archived')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  unknowns_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(unknowns_json) AND json_type(unknowns_json) = 'array'),
  red_flags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(red_flags_json) AND json_type(red_flags_json) = 'array'),
  eligibility_uncertainties_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(eligibility_uncertainties_json) AND json_type(eligibility_uncertainties_json) = 'array'),
  excitement INTEGER CHECK (excitement IS NULL OR excitement BETWEEN 1 AND 5),
  decision TEXT NOT NULL DEFAULT '',
  decision_rationale TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, dedupe_key)
) STRICT;

CREATE INDEX idx_job_opportunities_owner_disposition
  ON job_opportunities (owner_user_id, disposition, availability_status, updated_at DESC, id);
CREATE INDEX idx_job_opportunities_deadline
  ON job_opportunities (owner_user_id, application_deadline, disposition);

CREATE TABLE job_opportunity_sources (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_identifier TEXT NOT NULL DEFAULT '',
  snapshot_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'changed', 'stale', 'closed', 'failed', 'unknown')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  claims_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(claims_json) AND json_type(claims_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (opportunity_id, source_name, source_identifier, source_url)
) STRICT;

CREATE TABLE campaign_opportunity_evaluations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id),
  evaluation_version INTEGER NOT NULL CHECK (evaluation_version >= 1),
  evaluated_at TEXT NOT NULL,
  evaluator_json TEXT NOT NULL CHECK (json_valid(evaluator_json) AND json_type(evaluator_json) = 'object'),
  model_provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(model_provenance_json) AND json_type(model_provenance_json) = 'object'),
  evidence_sources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_sources_json) AND json_type(evidence_sources_json) = 'array'),
  overall_score REAL CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  hard_gate_result TEXT NOT NULL DEFAULT 'unknown' CHECK (hard_gate_result IN ('pass', 'fail', 'unknown', 'needs_review')),
  criterion_scores_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(criterion_scores_json) AND json_type(criterion_scores_json) = 'array'),
  matched_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(matched_evidence_json) AND json_type(matched_evidence_json) = 'array'),
  gaps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(gaps_json) AND json_type(gaps_json) = 'array'),
  failure_reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failure_reasons_json) AND json_type(failure_reasons_json) = 'array'),
  tradeoffs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tradeoffs_json) AND json_type(tradeoffs_json) = 'array'),
  recommendation TEXT NOT NULL DEFAULT '',
  human_override_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(human_override_json) AND json_type(human_override_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (campaign_id, opportunity_id, evaluation_version)
) STRICT;

CREATE INDEX idx_campaign_opportunity_evaluations_latest
  ON campaign_opportunity_evaluations (campaign_id, opportunity_id, evaluation_version DESC);

CREATE TABLE candidate_positioning_profiles (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  target_roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(target_roles_json) AND json_type(target_roles_json) = 'array'),
  evidence_claims_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_claims_json) AND json_type(evidence_claims_json) = 'array'),
  skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json) AND json_type(skills_json) = 'array'),
  accomplishments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(accomplishments_json) AND json_type(accomplishments_json) = 'array'),
  languages_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(languages_json) AND json_type(languages_json) = 'array'),
  public_links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(public_links_json) AND json_type(public_links_json) = 'array'),
  preferred_default_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  valid_from TEXT,
  valid_until TEXT,
  approval_state TEXT NOT NULL DEFAULT 'draft' CHECK (approval_state IN ('draft', 'reviewed', 'approved', 'retired')),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE candidate_document_sets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES candidate_positioning_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  artifact_versions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_versions_json) AND json_type(artifact_versions_json) = 'array'),
  target_profile_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(target_profile_json) AND json_type(target_profile_json) = 'object'),
  approval_state TEXT NOT NULL DEFAULT 'draft' CHECK (approval_state IN ('draft', 'reviewed', 'approved', 'retired')),
  sealed INTEGER NOT NULL DEFAULT 0 CHECK (sealed IN (0, 1)),
  confidentiality TEXT NOT NULL DEFAULT 'private' CHECK (confidentiality IN ('private', 'restricted', 'shareable')),
  retention_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(retention_policy_json) AND json_type(retention_policy_json) = 'object'),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  valid_from TEXT,
  valid_until TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, title, version)
) STRICT;

CREATE TABLE application_response_templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exact_question TEXT NOT NULL,
  normalized_category TEXT NOT NULL,
  answer TEXT NOT NULL,
  limit_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limit_json) AND json_type(limit_json) = 'object'),
  language TEXT NOT NULL DEFAULT 'en',
  evidence_links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_links_json) AND json_type(evidence_links_json) = 'array'),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'private', 'protected')),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'reviewed', 'approved', 'retired')),
  usage_history_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(usage_history_json) AND json_type(usage_history_json) = 'array'),
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE job_applications (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES job_opportunities(id),
  primary_campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id),
  criteria_version_id TEXT NOT NULL REFERENCES campaign_criteria_versions(id),
  candidate_user_id TEXT NOT NULL REFERENCES users(id),
  application_route_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(application_route_json) AND json_type(application_route_json) = 'object'),
  account_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'preparing', 'blocked_on_user_input', 'ready_for_review', 'ready_to_submit', 'submitted', 'acknowledged', 'screening', 'interviewing', 'assessment', 'references', 'offer', 'accepted', 'declined_by_candidate', 'withdrawn', 'rejected', 'ghosted', 'closed')),
  started_at TEXT,
  submitted_at TEXT,
  acknowledged_at TEXT,
  last_contact_at TEXT,
  next_follow_up_at TEXT,
  decision_deadline TEXT,
  expected_response_at TEXT,
  closed_at TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  owner_label TEXT NOT NULL DEFAULT '',
  blocker TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  referral_state TEXT NOT NULL DEFAULT 'none',
  private_contacts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(private_contacts_json) AND json_type(private_contacts_json) = 'array'),
  positioning_profile_id TEXT REFERENCES candidate_positioning_profiles(id) ON DELETE SET NULL,
  document_set_id TEXT REFERENCES candidate_document_sets(id) ON DELETE SET NULL,
  representations_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(representations_json) AND json_type(representations_json) = 'object'),
  unresolved_user_facts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(unresolved_user_facts_json) AND json_type(unresolved_user_facts_json) = 'array'),
  confirmation_receipt TEXT NOT NULL DEFAULT '',
  tracking_identifier TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  reapplication_of_application_id TEXT REFERENCES job_applications(id) ON DELETE SET NULL,
  reapplication_reason TEXT NOT NULL DEFAULT '',
  reapplication_reviewed_at TEXT,
  employer_reason TEXT NOT NULL DEFAULT '',
  inferred_explanation TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  reapplication_date TEXT,
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  import_receipt_id TEXT,
  CHECK (deleted_at IS NOT NULL OR criteria_version_id IS NOT NULL)
) STRICT;

CREATE INDEX idx_job_applications_owner_status
  ON job_applications (owner_user_id, status, priority, updated_at DESC, id);
CREATE UNIQUE INDEX idx_job_applications_active_duplicate_guard
  ON job_applications (owner_user_id, opportunity_id, account_reference)
  WHERE deleted_at IS NULL AND status NOT IN ('declined_by_candidate', 'withdrawn', 'rejected', 'ghosted', 'closed');

CREATE TABLE application_questions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  exact_question TEXT NOT NULL,
  normalized_category TEXT NOT NULL DEFAULT '',
  limit_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limit_json) AND json_type(limit_json) = 'object'),
  language TEXT NOT NULL DEFAULT 'en',
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'private', 'protected')),
  reusable_response_id TEXT REFERENCES application_response_templates(id) ON DELETE SET NULL,
  approved_answer TEXT NOT NULL DEFAULT '',
  evidence_links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_links_json) AND json_type(evidence_links_json) = 'array'),
  review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'reviewed', 'approved', 'submitted')),
  use_history_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(use_history_json) AND json_type(use_history_json) = 'array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  prior_status TEXT,
  new_status TEXT,
  occurred_at TEXT NOT NULL,
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  source_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  factual_description TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE INDEX idx_application_events_timeline
  ON application_events (application_id, occurred_at DESC, id DESC);

CREATE TABLE application_artifact_uses (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  artifact_version_id TEXT REFERENCES artifact_versions(id),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  use_kind TEXT NOT NULL CHECK (use_kind IN ('preparation', 'review', 'transmission', 'verified_submission')),
  approval_state TEXT NOT NULL DEFAULT 'draft' CHECK (approval_state IN ('draft', 'reviewed', 'approved', 'sealed')),
  used_at TEXT NOT NULL,
  transmission_preview_id TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (application_id, artifact_id, artifact_version_id, use_kind, used_at)
) STRICT;

CREATE TABLE job_interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'interview',
  scheduled_start_at TEXT,
  scheduled_end_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  format TEXT NOT NULL DEFAULT 'unknown',
  private_location_or_link TEXT NOT NULL DEFAULT '',
  participant_links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(participant_links_json) AND json_type(participant_links_json) = 'array'),
  focus_areas_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(focus_areas_json) AND json_type(focus_areas_json) = 'array'),
  preparation_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  question_bank_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(question_bank_json) AND json_type(question_bank_json) = 'array'),
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE job_offers (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('expected', 'received', 'negotiating', 'revised', 'accepted', 'declined', 'expired', 'withdrawn')),
  terms_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(terms_json) AND json_type(terms_json) = 'object'),
  private_compensation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(private_compensation_json) AND json_type(private_compensation_json) = 'object'),
  contingencies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contingencies_json) AND json_type(contingencies_json) = 'array'),
  negotiation_asks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negotiation_asks_json) AND json_type(negotiation_asks_json) = 'array'),
  response TEXT NOT NULL DEFAULT '',
  artifact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_ids_json) AND json_type(artifact_ids_json) = 'array'),
  expires_at TEXT,
  decision TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL,
  planned_engagement_id TEXT REFERENCES work_engagements(id) ON DELETE SET NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE job_offer_revisions (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('expected', 'received', 'negotiating', 'revised', 'accepted', 'declined', 'expired', 'withdrawn')),
  terms_json TEXT NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'object'),
  private_compensation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(private_compensation_json) AND json_type(private_compensation_json) = 'object'),
  contingencies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contingencies_json) AND json_type(contingencies_json) = 'array'),
  negotiation_asks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negotiation_asks_json) AND json_type(negotiation_asks_json) = 'array'),
  response TEXT NOT NULL DEFAULT '',
  artifact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_ids_json) AND json_type(artifact_ids_json) = 'array'),
  expires_at TEXT,
  decision TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  criteria_version_id TEXT REFERENCES campaign_criteria_versions(id) ON DELETE SET NULL,
  planned_engagement_id TEXT REFERENCES work_engagements(id) ON DELETE SET NULL,
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (offer_id, version)
) STRICT;

CREATE TABLE job_search_sources (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'website',
  canonical_url TEXT NOT NULL DEFAULT '',
  reliability REAL CHECK (reliability IS NULL OR reliability BETWEEN 0 AND 1),
  cost_constraints_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cost_constraints_json) AND json_type(cost_constraints_json) = 'object'),
  rate_constraints_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rate_constraints_json) AND json_type(rate_constraints_json) = 'object'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE job_saved_queries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES job_search_sources(id) ON DELETE SET NULL,
  criteria_version_id TEXT NOT NULL REFERENCES campaign_criteria_versions(id),
  title TEXT NOT NULL,
  query_text TEXT NOT NULL,
  geography_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(geography_json) AND json_type(geography_json) = 'object'),
  filters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters_json) AND json_type(filters_json) = 'object'),
  cadence TEXT NOT NULL DEFAULT 'weekly',
  freshness_hours INTEGER NOT NULL DEFAULT 168 CHECK (freshness_hours BETWEEN 1 AND 8760),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE job_automation_policies (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  criteria_version_id TEXT NOT NULL REFERENCES campaign_criteria_versions(id),
  research_authority TEXT NOT NULL DEFAULT 'allowed' CHECK (research_authority IN ('disabled', 'allowed', 'review_required')),
  preparation_authority TEXT NOT NULL DEFAULT 'review_required' CHECK (preparation_authority IN ('disabled', 'allowed', 'review_required')),
  upload_authority TEXT NOT NULL DEFAULT 'review_required' CHECK (upload_authority IN ('disabled', 'allowed', 'review_required')),
  submission_authority TEXT NOT NULL DEFAULT 'review_required' CHECK (submission_authority IN ('disabled', 'review_required')),
  review_required_classes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(review_required_classes_json) AND json_type(review_required_classes_json) = 'array'),
  automatic_eligibility_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(automatic_eligibility_json) AND json_type(automatic_eligibility_json) = 'object'),
  default_profile_id TEXT REFERENCES candidate_positioning_profiles(id) ON DELETE SET NULL,
  default_document_set_id TEXT REFERENCES candidate_document_sets(id) ON DELETE SET NULL,
  compensation_gates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(compensation_gates_json) AND json_type(compensation_gates_json) = 'array'),
  legal_answer_gates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(legal_answer_gates_json) AND json_type(legal_answer_gates_json) = 'array'),
  maximum_applications INTEGER CHECK (maximum_applications IS NULL OR maximum_applications BETWEEN 1 AND 10000),
  duplicate_prevention INTEGER NOT NULL DEFAULT 1 CHECK (duplicate_prevention IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (campaign_id, criteria_version_id)
) STRICT;

CREATE TABLE job_search_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES opportunity_campaigns(id) ON DELETE CASCADE,
  criteria_version_id TEXT NOT NULL REFERENCES campaign_criteria_versions(id),
  agent_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(agent_json) AND json_type(agent_json) = 'object'),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled')),
  sources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sources_json) AND json_type(sources_json) = 'array'),
  queries_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(queries_json) AND json_type(queries_json) = 'array'),
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json) AND json_type(counts_json) = 'object'),
  failures_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failures_json) AND json_type(failures_json) = 'array'),
  cost_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cost_json) AND json_type(cost_json) = 'object'),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array'),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, idempotency_key)
) STRICT;

CREATE INDEX idx_job_search_runs_campaign
  ON job_search_runs (campaign_id, started_at DESC, id DESC);

CREATE TABLE job_search_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES job_search_runs(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES job_opportunities(id) ON DELETE SET NULL,
  result_kind TEXT NOT NULL CHECK (result_kind IN ('new', 'changed', 'duplicate', 'stale', 'closed', 'failed')),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

CREATE TABLE work_outreach (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES opportunity_campaigns(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES work_organizations(id) ON DELETE SET NULL,
  person_id TEXT,
  proposal TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'drafted', 'ready', 'sent', 'replied', 'follow_up', 'closed')),
  message_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  sent_at TEXT,
  follow_up_at TEXT,
  response TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  scope_project_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_project_ids_json) AND json_type(scope_project_ids_json) = 'array'),
  scope_tag_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_tag_ids_json) AND json_type(scope_tag_ids_json) = 'array'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT
) STRICT;

-- Immutable snapshots for revisioned supporting records. Specialized domain
-- histories (such as job_offer_revisions) remain authoritative for their
-- structured semantics; this table preserves every accepted supporting-data
-- mutation for audit and conflict reconstruction.
CREATE TABLE work_supporting_revisions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'object'),
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (record_kind, record_id, version)
) STRICT;

CREATE INDEX idx_work_supporting_revisions_record
  ON work_supporting_revisions (record_kind, record_id, version DESC);

CREATE TABLE application_transmission_previews (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  requesting_agent_id TEXT,
  requesting_token_id TEXT,
  requesting_client_identity TEXT NOT NULL DEFAULT '',
  destination_json TEXT NOT NULL CHECK (json_valid(destination_json) AND json_type(destination_json) = 'object'),
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json) AND json_type(fields_json) = 'object'),
  answers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(answers_json) AND json_type(answers_json) = 'array'),
  artifact_versions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artifact_versions_json) AND json_type(artifact_versions_json) = 'array'),
  representations_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(representations_json) AND json_type(representations_json) = 'object'),
  unresolved_gates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(unresolved_gates_json) AND json_type(unresolved_gates_json) = 'array'),
  guard_context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(guard_context_json) AND json_type(guard_context_json) = 'object'),
  preview_digest TEXT NOT NULL CHECK (length(preview_digest) = 64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approval_pending', 'authorized', 'rejected', 'expired', 'consumed', 'failed')),
  approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
  agent_action_id TEXT REFERENCES agent_actions(id) ON DELETE SET NULL,
  authorization_identity TEXT,
  authorized_principal_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(authorized_principal_json) AND json_type(authorized_principal_json) = 'object'),
  authorized_at TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  completion_evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(completion_evidence_json) AND json_type(completion_evidence_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (owner_user_id, preview_digest)
) STRICT;

CREATE INDEX idx_application_transmission_previews_application
  ON application_transmission_previews (application_id, status, created_at DESC);

CREATE TABLE work_operation_receipts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  response_status INTEGER NOT NULL DEFAULT 200,
  response_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_json)),
  created_records_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(created_records_json) AND json_type(created_records_json) = 'array'),
  rollback_classification_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rollback_classification_json) AND json_type(rollback_classification_json) = 'object'),
  dependency_fingerprint TEXT NOT NULL DEFAULT '' CHECK (dependency_fingerprint = '' OR length(dependency_fingerprint) = 64),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rollback_conflict', 'rolled_back')),
  rollback_tombstone_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rollback_tombstone_json) AND json_type(rollback_tombstone_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rolled_back_at TEXT,
  UNIQUE (owner_user_id, operation_kind, idempotency_key)
) STRICT;

CREATE INDEX idx_work_operation_receipts_owner
  ON work_operation_receipts (owner_user_id, operation_kind, created_at DESC);

CREATE TRIGGER trg_work_engagement_revision_history
AFTER UPDATE ON work_engagements
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'work engagement revision must increase');
END;

CREATE TRIGGER trg_opportunity_campaign_revision_history
AFTER UPDATE ON opportunity_campaigns
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'opportunity campaign revision must increase');
END;

CREATE TRIGGER trg_job_opportunity_revision_history
AFTER UPDATE ON job_opportunities
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'job opportunity revision must increase');
END;

CREATE TRIGGER trg_job_application_revision_history
AFTER UPDATE ON job_applications
WHEN NEW.revision <= OLD.revision
BEGIN
  SELECT RAISE(ABORT, 'job application revision must increase');
END;
