-- Add bounded execution metadata without rewriting the already-released
-- background authorization migration. Existing rows receive a conservative
-- single-effect budget derived from their persisted action.

ALTER TABLE security_background_job_authorizations
  ADD COLUMN budget_json TEXT;

UPDATE security_background_job_authorizations
SET budget_json = json_object(
  'maximumRuntimeMilliseconds', 1800000,
  'maximumEffectInvocations', 1,
  'capabilities', json_array(action)
)
WHERE budget_json IS NULL;

CREATE TRIGGER security_background_job_budget_required_insert
BEFORE INSERT ON security_background_job_authorizations
WHEN NEW.budget_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'background authorization budget required');
END;

CREATE TRIGGER security_background_job_budget_required_update
BEFORE UPDATE OF budget_json ON security_background_job_authorizations
WHEN NEW.budget_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'background authorization budget required');
END;
