CREATE INDEX IF NOT EXISTS idx_health_mobile_sync_chunks_completion_cover
  ON health_mobile_sync_chunks(
    sync_session_id,
    sequence,
    id,
    chunk_id,
    family,
    checksum_sha256,
    record_count,
    byte_count,
    payload_summary_json,
    received_at,
    applied_at,
    created_at,
    updated_at
  );
