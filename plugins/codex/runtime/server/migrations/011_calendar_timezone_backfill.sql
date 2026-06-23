UPDATE calendar_calendars
SET timezone = 'UTC'
WHERE TRIM(COALESCE(timezone, '')) = '';

UPDATE forge_events
SET timezone = 'UTC'
WHERE TRIM(COALESCE(timezone, '')) = '';

UPDATE work_block_templates
SET timezone = 'UTC'
WHERE TRIM(COALESCE(timezone, '')) = '';
