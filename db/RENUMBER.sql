-- One-time rename map for the `d1_migrations` tracking table.
--
-- D1 records each applied migration by its filename. The June 2026
-- migration consolidation renamed five files to remove duplicate
-- numeric prefixes (two 0007_* files, three 0008_* files). Running
-- `wrangler d1 migrations apply` after that rename would otherwise
-- treat the renamed files as new migrations and try to re-apply them,
-- which fails because the tables already exist.
--
-- Apply this exactly once against each environment whose database has
-- already had any of the old names applied:
--
--   wrangler d1 execute cse110-sp26-group15 --local --file=./db/RENUMBER.sql
--   wrangler d1 execute cse110-sp26-group15 --remote --file=./db/RENUMBER.sql
--
-- Fresh databases can skip this — the migrations apply cleanly under
-- their new names.

UPDATE d1_migrations SET name = '0001_initial_schema.sql'
  WHERE name = '001_initial_schema.sql';
UPDATE d1_migrations SET name = '0008_add_xp_pairs.sql'
  WHERE name = '0007_add_xp_pairs.sql';
UPDATE d1_migrations SET name = '0009_add_sessions.sql'
  WHERE name = '0008_add_sessions.sql';
UPDATE d1_migrations SET name = '0010_add_task_priority_created_at.sql'
  WHERE name = '0008_add_task_priority_created_at.sql';
UPDATE d1_migrations SET name = '0011_add_project_invites.sql'
  WHERE name = '0008_add_project_invites.sql';
UPDATE d1_migrations SET name = '0012_add_task_pair_assignee.sql'
  WHERE name = '0009_add_task_pair_assignee.sql';
UPDATE d1_migrations SET name = '0013_add_password_resets.sql'
  WHERE name = '0010_add_password_resets.sql';
