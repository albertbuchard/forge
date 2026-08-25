-- Correct an unreleased compatibility upgrade that could copy current campaign
-- or offer state into older records whose exact historical values were never
-- retained. The migration runner rebuilds the affected Work tables from the
-- canonical schema and marks those unavailable historical values as unknown.

SELECT 1;
