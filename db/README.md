## Local Development

Use `npm run db:migrate:local` to update your local d1 database with the latest schema. Remember, schema files are applied in order, so if your database already has `001_initial_schema.sql` applied, running the command will only apply the next unapplied files (e.g. `002_add_blockers.sql`). Treat already applied schemas as immutable.

Use `npm run db:seed:local` to seed your database with example data. Note that if you update the schema, you MUST make sure that `seed.sql` is also formatted accordingly.

Use `npm run db:reset:local` to reset your local database. This will delete all rows, but leave the tables.

## Remote Development

Use `db:migrate:remote` to update the remote d1 database with the latest schema.

Use `npm run db:seed:remote` to seed the remote database with the data in `seed.sql`. Again, make sure that `seed.sql` is formatted correctly with the latest schema.

Use `npm run db:reset:remote` to reset the remote database. Be careful running this command.
