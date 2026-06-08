-- Adds urgency + creation-time tracking to tasks so the dashboards can show
-- (and persist) a priority and a "Created · how long ago" strip on each card.
--
-- priority defaults to 'medium' so existing rows get a sensible urgency.
-- created_at is added nullable because SQLite's ALTER TABLE ... ADD COLUMN
-- forbids a CURRENT_TIMESTAMP default; we backfill existing rows here and the
-- POST /tasks handler sets created_at explicitly on insert.
ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'medium'
    CHECK(priority IN ('urgent', 'high', 'medium', 'low'));

ALTER TABLE tasks ADD COLUMN created_at TIMESTAMP;

UPDATE tasks SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
