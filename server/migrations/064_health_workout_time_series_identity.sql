CREATE TEMP TABLE health_workout_time_series_dedupe AS
SELECT
  workout_id,
  metric_key,
  source_sample_uid,
  MIN(rowid) AS survivor_rowid,
  (
    SELECT latest.rowid
    FROM health_workout_time_series AS latest
    WHERE latest.workout_id = grouped.workout_id
      AND latest.metric_key = grouped.metric_key
      AND latest.source_sample_uid = grouped.source_sample_uid
    ORDER BY latest.updated_at DESC, latest.created_at DESC, latest.rowid DESC
    LIMIT 1
  ) AS latest_rowid,
  (
    SELECT latest.series_index
    FROM health_workout_time_series AS latest
    WHERE latest.workout_id = grouped.workout_id
      AND latest.metric_key = grouped.metric_key
      AND latest.source_sample_uid = grouped.source_sample_uid
    ORDER BY latest.updated_at DESC, latest.created_at DESC, latest.rowid DESC
    LIMIT 1
  ) AS latest_series_index
FROM health_workout_time_series AS grouped
WHERE source_sample_uid IS NOT NULL
  AND source_sample_uid != ''
GROUP BY workout_id, metric_key, source_sample_uid
HAVING COUNT(*) > 1;

UPDATE health_workout_time_series
SET
  label = (
    SELECT latest.label
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  category = (
    SELECT latest.category
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  unit = (
    SELECT latest.unit
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  value = (
    SELECT latest.value
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  started_at = (
    SELECT latest.started_at
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  ended_at = (
    SELECT latest.ended_at
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  source_device = (
    SELECT latest.source_device
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  source_bundle_identifier = (
    SELECT latest.source_bundle_identifier
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  source_product_type = (
    SELECT latest.source_product_type
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  capture_method = (
    SELECT latest.capture_method
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  quality_flags_json = (
    SELECT latest.quality_flags_json
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  metadata_json = (
    SELECT latest.metadata_json
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  provenance_json = (
    SELECT latest.provenance_json
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  ),
  updated_at = (
    SELECT latest.updated_at
    FROM health_workout_time_series AS latest
    JOIN health_workout_time_series_dedupe AS dedupe
      ON dedupe.latest_rowid = latest.rowid
    WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
  )
WHERE rowid IN (
  SELECT survivor_rowid
  FROM health_workout_time_series_dedupe
);

DELETE FROM health_workout_time_series
WHERE rowid IN (
  SELECT duplicate.rowid
  FROM health_workout_time_series AS duplicate
  JOIN health_workout_time_series_dedupe AS dedupe
    ON dedupe.workout_id = duplicate.workout_id
   AND dedupe.metric_key = duplicate.metric_key
   AND dedupe.source_sample_uid = duplicate.source_sample_uid
  WHERE duplicate.rowid != dedupe.survivor_rowid
);

UPDATE health_workout_time_series
SET series_index = (
  SELECT dedupe.latest_series_index
  FROM health_workout_time_series_dedupe AS dedupe
  WHERE dedupe.survivor_rowid = health_workout_time_series.rowid
)
WHERE rowid IN (
  SELECT survivor_rowid
  FROM health_workout_time_series_dedupe
);

DROP TABLE health_workout_time_series_dedupe;

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_workout_time_series_sample_identity
  ON health_workout_time_series(workout_id, metric_key, source_sample_uid);
