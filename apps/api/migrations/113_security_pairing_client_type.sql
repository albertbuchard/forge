-- Distinguish API clients from browsers without rewriting the established
-- credential-foundation table. Pre-upgrade requests safely default to API mode.

CREATE TABLE IF NOT EXISTS security_pairing_client_metadata (
  pairing_request_id TEXT PRIMARY KEY
    REFERENCES security_pairing_requests(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('api', 'browser'))
) STRICT;
