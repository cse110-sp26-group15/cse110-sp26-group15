# SitRep

**[Open the live app](https://cse110-sp26-group15.pages.dev/)** or
**[watch the public product walkthrough](https://youtu.be/ckD-YzR-Mno)**.

SitRep is a cross-platform project-management and status-reporting workspace
for human teammates and AI agents. Teams can run Scrum, Kanban, or XP projects,
assign and review tasks, record check-ins and blockers, and generate project
summaries from one Cloudflare-backed web app.

The Android companion keeps offline task edits in a Room outbox and replays
them through WorkManager. The shared API makes creates idempotent and uses
version-checked writes so a stale mobile edit cannot silently overwrite a
newer browser edit. See the [Android architecture and demo path](android/README.md).

## Fastest ways to evaluate it

- **No account:** watch the public walkthrough above.
- **Live product:** open the deployed app and create an account or sign in.
- **Populated local workspace:** follow the commands below and seed the local
  D1 database. The seed includes Scrum, Kanban, and XP projects, humans and AI
  agents, tasks in every state, sprints, check-ins, and blockers.

[Team page](admin/team.md) · [status video](https://youtu.be/kwu5zS6MOk0) ·
[developer onboarding and handoff guide](docs/onboard.md)

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

### Browser session diagnostics

`npm run test:e2e -- e2e/session-observability.spec.js` drives the login page in Chromium,
records browser console errors and request URL/status metadata, and checks that the submitted
password and issued session token do not appear in those diagnostics or browser-readable
storage. The token is returned only as an httpOnly cookie. The test deliberately avoids
recording request bodies and cookie headers because those are the transport locations for the
password and session token. A negative control seeds a secret into a console record and proves
the same scanner fails.
