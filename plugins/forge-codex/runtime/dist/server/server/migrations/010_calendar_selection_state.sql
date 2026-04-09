ALTER TABLE calendar_calendars
ADD COLUMN selected_for_sync INTEGER NOT NULL DEFAULT 1;

UPDATE calendar_calendars
SET selected_for_sync = 1
WHERE selected_for_sync IS NULL;
