ALTER TABLE calendar_calendars
ADD COLUMN source_id TEXT;

ALTER TABLE calendar_calendars
ADD COLUMN source_title TEXT;

ALTER TABLE calendar_calendars
ADD COLUMN source_type TEXT;

ALTER TABLE calendar_calendars
ADD COLUMN calendar_type TEXT;

ALTER TABLE calendar_calendars
ADD COLUMN host_calendar_id TEXT;

ALTER TABLE calendar_calendars
ADD COLUMN canonical_key TEXT;

UPDATE calendar_calendars
SET canonical_key = remote_id
WHERE canonical_key IS NULL OR TRIM(canonical_key) = '';
