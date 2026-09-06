-- Idempotency key for task creation.
--
-- 0015 made UPDATE safe to replay (compare-and-swap on `version`: a second
-- delivery of the same edit is refused with 409 instead of applied twice).
-- CREATE had no equivalent. A client that queues writes while offline - the
-- Android companion in android/ - can lose the response to a POST the server
-- already committed, and its retry would insert a second task.
--
-- `client_token` is a caller-supplied opaque id, stable across retries of the
-- same queued create. The partial unique index makes "one task per token per
-- project" a database invariant rather than a check the handler could race
-- past, and the WHERE clause keeps every existing row (and every caller that
-- sends no token, including the whole web client) out of the index entirely.
ALTER TABLE tasks ADD COLUMN client_token TEXT;

CREATE UNIQUE INDEX idx_tasks_client_token
    ON tasks (project_id, client_token)
    WHERE client_token IS NOT NULL;
