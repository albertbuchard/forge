-- Keep peer delivery claims bounded by the persisted queue order. The retry
-- ceiling is part of the index predicate, and in-flight next_attempt_at stores
-- the lease deadline, so prepared statements do not filter an ordered scan.

-- Fail closed instead of silently accepting identifiers whose byte ordering
-- cannot be reproduced safely across SQLite and Node runtimes.
CREATE TABLE migration_102_peer_outbox_id_guard (
  invalid_count INTEGER NOT NULL CHECK (invalid_count = 0)
);

INSERT INTO migration_102_peer_outbox_id_guard (invalid_count)
SELECT COUNT(*)
FROM peer_outbox
WHERE typeof(envelope_id) <> 'text'
   OR length(CAST(envelope_id AS BLOB)) NOT BETWEEN 1 AND 240
   OR instr(CAST(envelope_id AS BLOB), X'00') > 0
   OR envelope_id GLOB '*[^A-Za-z0-9._:-]*'
HAVING COUNT(*) > 0;

DROP TABLE migration_102_peer_outbox_id_guard;

CREATE TRIGGER peer_outbox_envelope_id_insert_guard
BEFORE INSERT ON peer_outbox
WHEN typeof(NEW.envelope_id) <> 'text'
  OR length(CAST(NEW.envelope_id AS BLOB)) NOT BETWEEN 1 AND 240
  OR instr(CAST(NEW.envelope_id AS BLOB), X'00') > 0
  OR NEW.envelope_id GLOB '*[^A-Za-z0-9._:-]*'
BEGIN
  SELECT RAISE(ABORT, 'peer_outbox envelope_id is not a safe ASCII identifier');
END;

CREATE TRIGGER peer_outbox_envelope_id_update_guard
BEFORE UPDATE OF envelope_id ON peer_outbox
WHEN typeof(NEW.envelope_id) <> 'text'
  OR length(CAST(NEW.envelope_id AS BLOB)) NOT BETWEEN 1 AND 240
  OR instr(CAST(NEW.envelope_id AS BLOB), X'00') > 0
  OR NEW.envelope_id GLOB '*[^A-Za-z0-9._:-]*'
BEGIN
  SELECT RAISE(ABORT, 'peer_outbox envelope_id is not a safe ASCII identifier');
END;

-- The previous runtime derived stale leases from last_attempt_at. Persist the
-- default 60-second deadline once so the ordered key is the eligibility key.
UPDATE peer_outbox
SET next_attempt_at = strftime(
  '%Y-%m-%dT%H:%M:%fZ',
  julianday(COALESCE(last_attempt_at, updated_at, created_at)) + (60.0 / 86400.0)
)
WHERE status = 'in_flight';

-- Exhausted pending/failed rows are terminal. No row or encrypted payload is
-- removed, and delayed valid receipts can still acknowledge canceled rows.
UPDATE peer_outbox
SET status = 'canceled'
WHERE status IN ('pending', 'failed') AND attempt_count >= 12;

CREATE INDEX idx_peer_outbox_active_expiry
  ON peer_outbox (owner_user_id, expires_at, envelope_id)
  WHERE status IN ('pending', 'in_flight', 'failed');

CREATE INDEX idx_peer_outbox_due_claim_order
  ON peer_outbox (
    owner_user_id,
    next_attempt_at,
    created_at,
    envelope_id,
    expires_at
  )
  WHERE status IN ('pending', 'failed') AND attempt_count < 12;

CREATE INDEX idx_peer_outbox_in_flight_claim_order
  ON peer_outbox (
    owner_user_id,
    next_attempt_at,
    created_at,
    envelope_id,
    expires_at
  )
  WHERE status = 'in_flight' AND attempt_count < 12;
