# cse110-sp26-group15

cse110 group15

Team Page: [page url](admin/team.md)
Status Video Link: [Video](https://youtu.be/kwu5zS6MOk0)

Deployed Project url: [https://cse110-sp26-group15.pages.dev/](https://cse110-sp26-group15.pages.dev/)

Developer onboarding and handoff guide: [docs/onboard.md](docs/onboard.md)

Final Project Video: [public video](https://youtu.be/ckD-YzR-Mno) and [private video](https://youtu.be/6UlZmQ1AGFc)

## Instructions for Running Locally

### Install Dependencies

`npm install`

### Build

`npm run build`

### Set Up the Local DB

`npm run db:migrate:local` then `npm run db:seed:local`

Seeding is what makes a fresh clone worth opening. `db/seed.sql` builds one
example of every surface in the app: three projects (scrum, kanban and XP), five
people, two AI agents, tasks in every status, sprints, check-ins and blockers.
Every seeded account uses the password `TestPassword123`, so signing in as
`arivera@ucsd.edu` lands on a populated dashboard instead of an empty one.

To start from an empty database instead, `npm run db:reset:local` deletes the
rows and leaves the schema in place; `npm run db:seed:local` puts the sample
data back.

### Start Server

`npm run dev:pages` and hit `b` to open up the window automatically. Wrangler
serves it on http://localhost:8788.
