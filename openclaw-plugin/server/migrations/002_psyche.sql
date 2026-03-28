CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme_color TEXT NOT NULL,
  sensitive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO domains (id, slug, title, description, theme_color, sensitive, created_at, updated_at) VALUES
  ('domain_health', 'health', 'Health', 'Physical vitality, recovery, and body stewardship.', '#ef4444', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_mastery', 'mastery', 'Mastery', 'Skill building, deliberate practice, and craft.', '#f5efe6', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_love', 'love', 'Love', 'Relationships, intimacy, attachment, and shared life.', '#7dd3fc', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_wealth', 'wealth', 'Wealth', 'Financial stability, leverage, and freedom.', '#f59e0b', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_creativity', 'creativity', 'Creativity', 'Original work, authorship, and expression.', '#c0c1ff', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_contribution', 'contribution', 'Contribution', 'Service, meaning, and impact on others.', '#4edea3', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_spirituality', 'spirituality', 'Spirituality', 'Inner life, ritual, meaning, and transcendence.', '#8b5cf6', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_adventure', 'adventure', 'Adventure', 'Novelty, courage, movement, and lived expansion.', '#fb7185', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('domain_psyche', 'psyche', 'Psyche', 'Values-led therapeutic reflection, pattern change, and trigger analysis.', '#6ee7b7', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS psyche_values (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  valued_direction TEXT NOT NULL DEFAULT '',
  why_it_matters TEXT NOT NULL DEFAULT '',
  linked_goal_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_project_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_task_ids_json TEXT NOT NULL DEFAULT '[]',
  committed_actions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS behavior_patterns (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_behavior TEXT NOT NULL DEFAULT '',
  cue_contexts_json TEXT NOT NULL DEFAULT '[]',
  short_term_payoff TEXT NOT NULL DEFAULT '',
  long_term_cost TEXT NOT NULL DEFAULT '',
  preferred_response TEXT NOT NULL DEFAULT '',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_schema_labels_json TEXT NOT NULL DEFAULT '[]',
  linked_mode_labels_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trigger_reports (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  event_situation TEXT NOT NULL DEFAULT '',
  occurred_at TEXT,
  emotions_json TEXT NOT NULL DEFAULT '[]',
  thoughts_json TEXT NOT NULL DEFAULT '[]',
  behaviors_json TEXT NOT NULL DEFAULT '[]',
  consequences_json TEXT NOT NULL DEFAULT '{}',
  linked_pattern_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_goal_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_project_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_task_ids_json TEXT NOT NULL DEFAULT '[]',
  mode_overlays_json TEXT NOT NULL DEFAULT '[]',
  schema_links_json TEXT NOT NULL DEFAULT '[]',
  next_moves_json TEXT NOT NULL DEFAULT '[]',
  event_type_id TEXT REFERENCES event_types(id) ON DELETE SET NULL,
  custom_event_type TEXT NOT NULL DEFAULT '',
  linked_behavior_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_belief_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_mode_ids_json TEXT NOT NULL DEFAULT '[]',
  mode_timeline_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_catalog (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  family TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_catalog (id, slug, title, family, description, created_at, updated_at) VALUES
  ('schema_abandonment', 'abandonment', 'Abandonment', 'disconnection_rejection', 'Expectation that close connection will not remain stable or available.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_mistrust', 'mistrust_abuse', 'Mistrust / Abuse', 'disconnection_rejection', 'Expectation that others will hurt, humiliate, manipulate, or exploit.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_emotional_deprivation', 'emotional_deprivation', 'Emotional Deprivation', 'disconnection_rejection', 'Expectation that emotional support, empathy, or protection will not be met.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_defectiveness', 'defectiveness_shame', 'Defectiveness / Shame', 'disconnection_rejection', 'Sense of being bad, unlovable, inferior, or shameful at the core.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_social_isolation', 'social_isolation', 'Social Isolation', 'disconnection_rejection', 'Sense of being fundamentally different, outside, or not belonging.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_failure', 'failure', 'Failure', 'impaired_autonomy', 'Expectation of inevitable failure or inadequacy relative to peers.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_dependence', 'dependence_incompetence', 'Dependence / Incompetence', 'impaired_autonomy', 'Belief that one cannot handle responsibilities competently without help.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_vulnerability', 'vulnerability_to_harm', 'Vulnerability to Harm', 'impaired_autonomy', 'Exaggerated fear that catastrophe or collapse is always near.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_subjugation', 'subjugation', 'Subjugation', 'other_directedness', 'Chronic surrender of needs or preferences to avoid conflict, guilt, or retaliation.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_self_sacrifice', 'self_sacrifice', 'Self-Sacrifice', 'other_directedness', 'Excessive focus on meeting others'' needs at the cost of one''s own.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_unrelenting', 'unrelenting_standards', 'Unrelenting Standards', 'overvigilance_inhibition', 'Pressure to meet very high standards and avoid mistakes at all costs.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('schema_punitiveness', 'punitiveness', 'Punitiveness', 'overvigilance_inhibition', 'Belief that mistakes deserve harsh punishment rather than repair.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS event_types (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO event_types (id, domain_id, label, description, system, created_at, updated_at) VALUES
  ('event_feedback', 'domain_psyche', 'Feedback', 'Performance feedback, correction, or evaluation from someone important.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event_silence', 'domain_psyche', 'Silence after outreach', 'A meaningful delay or silence after vulnerability, initiative, or contact.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event_conflict', 'domain_psyche', 'Conflict', 'Tension, disagreement, rupture, or perceived relational threat.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event_performance', 'domain_psyche', 'Performance pressure', 'Moments where competence, output, or comparison felt sharply relevant.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event_change', 'domain_psyche', 'Unexpected change', 'Plans shifted or certainty collapsed faster than the system could adapt.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event_intimacy', 'domain_psyche', 'Intimacy', 'Closeness, exposure, or emotional contact that stirred vulnerability.', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS emotion_definitions (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO emotion_definitions (id, domain_id, label, description, category, system, created_at, updated_at) VALUES
  ('emotion_fear', 'domain_psyche', 'Fear', 'Alarm, danger, dread, or anticipatory threat.', 'threat', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_sadness', 'domain_psyche', 'Sadness', 'Loss, grief, emptiness, or heaviness.', 'loss', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_shame', 'domain_psyche', 'Shame', 'Exposure, defectiveness, humiliation, or collapse of worth.', 'self_evaluation', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_guilt', 'domain_psyche', 'Guilt', 'Sense of having failed, harmed, or violated a value.', 'self_evaluation', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_anger', 'domain_psyche', 'Anger', 'Boundary activation, protest, frustration, or heat.', 'boundary', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_loneliness', 'domain_psyche', 'Loneliness', 'Disconnection, distance, or lack of emotional contact.', 'attachment', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_relief', 'domain_psyche', 'Relief', 'Release after pressure, fear, or ambiguity.', 'release', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_joy', 'domain_psyche', 'Joy', 'Warmth, pleasure, delight, or expansion.', 'positive', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_frustration', 'domain_psyche', 'Frustration', 'Blocked movement, thwarted desire, or pressure build-up.', 'boundary', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('emotion_disgust', 'domain_psyche', 'Disgust', 'Repulsion, contamination, or recoil.', 'threat', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS psyche_behaviors (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  common_cues_json TEXT NOT NULL DEFAULT '[]',
  urge_story TEXT NOT NULL DEFAULT '',
  short_term_payoff TEXT NOT NULL DEFAULT '',
  long_term_cost TEXT NOT NULL DEFAULT '',
  replacement_move TEXT NOT NULL DEFAULT '',
  repair_plan TEXT NOT NULL DEFAULT '',
  linked_pattern_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_schema_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_mode_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS belief_entries (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  schema_id TEXT REFERENCES schema_catalog(id) ON DELETE SET NULL,
  statement TEXT NOT NULL,
  belief_type TEXT NOT NULL,
  origin_note TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 60,
  evidence_for_json TEXT NOT NULL DEFAULT '[]',
  evidence_against_json TEXT NOT NULL DEFAULT '[]',
  flexible_alternative TEXT NOT NULL DEFAULT '',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_behavior_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_mode_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_report_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mode_profiles (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  archetype TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  imagery TEXT NOT NULL DEFAULT '',
  symbolic_form TEXT NOT NULL DEFAULT '',
  facial_expression TEXT NOT NULL DEFAULT '',
  fear TEXT NOT NULL DEFAULT '',
  burden TEXT NOT NULL DEFAULT '',
  protective_job TEXT NOT NULL DEFAULT '',
  origin_context TEXT NOT NULL DEFAULT '',
  first_appearance_at TEXT,
  linked_pattern_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_behavior_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_value_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mode_guide_sessions (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_psyche_values_domain ON psyche_values(domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_domain ON behavior_patterns(domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_reports_domain ON trigger_reports(domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_reports_status ON trigger_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_types_domain ON event_types(domain_id, system DESC, label);
CREATE INDEX IF NOT EXISTS idx_emotion_definitions_domain ON emotion_definitions(domain_id, system DESC, label);
CREATE INDEX IF NOT EXISTS idx_psyche_behaviors_domain ON psyche_behaviors(domain_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_belief_entries_domain ON belief_entries(domain_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_belief_entries_schema ON belief_entries(schema_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mode_profiles_domain ON mode_profiles(domain_id, family, updated_at DESC);

ALTER TABLE behavior_patterns
ADD COLUMN linked_mode_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE behavior_patterns
ADD COLUMN linked_belief_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE schema_catalog
ADD COLUMN schema_type TEXT NOT NULL DEFAULT 'maladaptive';

UPDATE schema_catalog
SET schema_type = 'maladaptive'
WHERE schema_type IS NULL OR trim(schema_type) = '';

INSERT OR IGNORE INTO schema_catalog (
  id,
  slug,
  title,
  family,
  description,
  schema_type,
  created_at,
  updated_at
) VALUES
  (
    'schema_adaptive_stable_attachment',
    'stable_attachment',
    'Stable Attachment',
    'disconnection_rejection',
    'The belief that your close relationships are stable, loyal, and enduring.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_emotional_fulfilment',
    'emotional_fulfilment',
    'Emotional Fulfilment',
    'disconnection_rejection',
    'The belief that someone in your life can meet your needs for care, attachment, and emotional safety.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_social_belonging',
    'social_belonging',
    'Social Belonging',
    'disconnection_rejection',
    'The belief that you belong, fit in, and are accepted in groups and relationships.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_competence',
    'competence',
    'Competence',
    'impaired_autonomy',
    'The belief that you can handle daily problems, make decisions, and function capably in ordinary life.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_developed_self',
    'developed_self',
    'Developed Self',
    'impaired_autonomy',
    'The belief that you can live as your own person with mature boundaries and healthy independence from your parents.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_success',
    'success',
    'Success',
    'impaired_autonomy',
    'The belief that you are capable, effective, and able to do well in work, study, and achievement settings.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_empathic_consideration',
    'empathic_consideration',
    'Empathic Consideration',
    'other_directedness',
    'The belief that other people matter too and that you can respect different views without losing yourself.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_healthy_self_discipline',
    'healthy_self_discipline',
    'Healthy Self-Discipline',
    'overvigilance_inhibition',
    'The ability to stay with routines, persist through difficulty, and trade short-term comfort for long-term aims.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_healthy_self_care',
    'healthy_self_care',
    'Healthy Self-Care',
    'other_directedness',
    'The belief that your own needs matter too and that making room for rest, care, and boundaries is legitimate.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_self_directedness',
    'self_directedness',
    'Self-Directedness',
    'healthy_selfhood',
    'The belief that your own view of yourself matters more than performing for approval or admiration.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_optimism',
    'optimism',
    'Optimism',
    'healthy_selfhood',
    'The belief that good outcomes are possible and that life does not need to be ruled by catastrophe.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_emotional_openness',
    'emotional_openness',
    'Emotional Openness',
    'healthy_selfhood',
    'The willingness to express feelings, affection, and emotional truth with people you trust.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_realistic_expectations',
    'realistic_expectations',
    'Realistic Expectations',
    'overvigilance_inhibition',
    'The belief that good enough is acceptable, goals can be realistic, and mistakes do not cancel your worth.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'schema_adaptive_self_compassion',
    'self_compassion',
    'Self-Compassion',
    'overvigilance_inhibition',
    'The belief that you deserve kindness, forgiveness, and humane self-talk when you struggle or make mistakes.',
    'adaptive',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
