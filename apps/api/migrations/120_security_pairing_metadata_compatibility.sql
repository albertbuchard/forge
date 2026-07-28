-- Repair installations that recorded migration 113 while an earlier
-- development shape stored client_type directly on security_pairing_requests.
-- The migration runner performs the conditional legacy-column backfill inside
-- this migration's transaction after this additive table exists.

CREATE TABLE IF NOT EXISTS security_pairing_client_metadata (
  pairing_request_id TEXT PRIMARY KEY
    REFERENCES security_pairing_requests(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('api', 'browser'))
) STRICT;
