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
