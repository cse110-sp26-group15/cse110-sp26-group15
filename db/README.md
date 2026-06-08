## Migration numbering

Every file in `db/migrations/` uses a unique zero-padded 4-digit prefix
(`0001_*.sql`, `0002_*.sql`, …). D1 applies migrations in lexicographic
order; duplicate prefixes left ambiguity about which sibling ran first,
so they were consolidated in June 2026.

When adding a new migration: pick the next unused number and zero-pad
to four digits. The CI test in `source/src/tests/migrations.test.js`
fails the build if a duplicate prefix sneaks in.

### Renumbering an already-applied database

If your local or remote database has migrations applied under the old
names (any `001_*`, two `0007_*`, three `0008_*`), run `db/RENUMBER.sql`
exactly once per environment before the next `db:migrate:*`. This
rewrites the `d1_migrations` tracking table so wrangler doesn't try to
re-run the renamed files. Fresh databases can skip it.

```bash
npx wrangler d1 execute cse110-sp26-group15 --local --file=./db/RENUMBER.sql
npx wrangler d1 execute cse110-sp26-group15 --remote --file=./db/RENUMBER.sql
```

## Local Development

Use `npm run db:migrate:local` to update your local d1 database with the latest schema. Remember, schema files are applied in order, so if your database already has `001_initial_schema.sql` applied, running the command will only apply the next unapplied files (e.g. `002_add_blockers.sql`). Treat already applied schemas as immutable.

Use `npm run db:seed:local` to seed your database with example data. Note that if you update the schema, you MUST make sure that `seed.sql` is also formatted accordingly.

Use `npm run db:reset:local` to reset your local database. This will delete all rows, but leave the tables.

### Dashboard API tests

The dashboard integration tests load fixture data from `dashboard-test-seed.sql` into local D1 via wrangler, then clear it with `reset.sql` when finished. To apply the fixture manually:

```bash
npm run db:reset:local
npx wrangler d1 execute cse110-sp26-group15 --local --file=./db/dashboard-test-seed.sql
```

## Remote Development

Use `db:migrate:remote` to update the remote d1 database with the latest schema.

Use `npm run db:seed:remote` to seed the remote database with the data in `seed.sql`. Again, make sure that `seed.sql` is formatted correctly with the latest schema.

Use `npm run db:reset:remote` to reset the remote database. Be careful running this command.
