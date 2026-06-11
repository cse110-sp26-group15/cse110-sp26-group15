# SitRep Developer Onboarding

This document is for developers taking over or contributing to SitRep, the CSE 110 Spring 2026
Team 15 project. It supplements the root `README.md` with the details needed to understand,
run, test, and extend the application.

> Draft handoff note: sections marked **Team confirmation needed** should be checked by the
> original team before final submission.

## Project Overview

SitRep is a team project-management and status-reporting application. It supports Scrum,
Kanban, and XP workflows and is designed to make work by both human teammates and AI agents
visible in one place.

The implemented application includes:

- Account signup, login, logout, and password reset
- Project creation, selection, membership, and pending invitations
- Scrum, Kanban, and XP dashboard views
- Task creation, assignment, editing, review, and deletion
- Daily check-ins and blocker tracking
- Sprint management and XP pair assignments
- AI agent records alongside human team members
- Project summaries and weekly reports

Production site: <https://cse110-sp26-group15.pages.dev/>

Repository: <https://github.com/cse110-sp26-group15/cse110-sp26-group15>

## Technology Stack

- Frontend: HTML, CSS, and browser-native JavaScript modules
- Backend: Cloudflare Pages Functions in `functions/`
- Database: Cloudflare D1, using SQL migrations in `db/migrations/`
- Authentication: `bcryptjs`, server-side session records, and an HTTP-only cookie
- Unit/integration tests: Vitest
- End-to-end tests: Playwright with Chromium
- Quality checks: ESLint and Prettier
- CI: GitHub Actions
- Hosting: Cloudflare Pages

There is no frontend framework or separate application server. The production build copies the
static entry point and `source/` files into `dist/`; Cloudflare serves those assets and maps
files under `functions/` to server-side routes.

## Prerequisites

Install the following before starting:

- Git
- A current Node.js LTS release and npm
- Chromium for Playwright tests, installed through the command below
- A Cloudflare account with access to the Pages project and D1 database only if deploying or
  changing remote data

**Team confirmation needed:** record the exact Node.js and npm versions used for the final
release. The repository currently has no `.nvmrc` or `engines` field.

## Clone and Install

```bash
git clone https://github.com/cse110-sp26-group15/cse110-sp26-group15.git
cd cse110-sp26-group15
npm install
```

For a reproducible clean install, especially in CI, use `npm ci` instead of `npm install`.

Install the Playwright browser before running end-to-end tests:

```bash
npx playwright install chromium
```

## Run Locally

1. Build the static application:

   ```bash
   npm run build
   ```

2. Apply all migrations to the local D1 database:

   ```bash
   npm run db:migrate:local
   ```

3. Optionally load sample data:

   ```bash
   npm run db:seed:local
   ```

4. Start Cloudflare Pages locally:

   ```bash
   npm run dev:pages
   ```

5. Open the local URL printed by Wrangler. Wrangler also accepts `b` in its interactive
   terminal to open the page in a browser.

The development server uses the D1 binding named `DB` from `wrangler.toml`. No `.env` file is
currently required for ordinary local development.

### Start With an Empty Database

The reset command deletes application rows but leaves the schema in place:

```bash
npm run db:reset:local
```

To restore sample data afterward:

```bash
npm run db:seed:local
```

## Available Commands

| Command                    | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `npm run build`            | Copy the static application into `dist/`               |
| `npm run dev:pages`        | Run the built app and Pages Functions through Wrangler |
| `npm run lint`             | Run ESLint                                             |
| `npm run lint:fix`         | Apply ESLint's automatic fixes                         |
| `npm run format`           | Format supported files with Prettier                   |
| `npm run format:check`     | Check formatting without changing files                |
| `npm run test`             | Run Vitest in watch mode                               |
| `npm run test:ci`          | Run Vitest once                                        |
| `npm run test:e2e`         | Run Playwright tests                                   |
| `npm run test:e2e:ci`      | Run Playwright once with the list reporter             |
| `npm run db:migrate:local` | Apply pending migrations to local D1                   |
| `npm run db:seed:local`    | Insert local sample data                               |
| `npm run db:reset:local`   | Delete all local application data                      |

The package also defines remote migration, seed, and reset commands. Do not run remote database
commands unless the team has explicitly approved the change and a recovery plan exists.
`npm run db:reset:remote` deletes production data.

## Repository Organization

```text
.
|-- admin/                 Team page, meeting notes, feedback, branding, and videos
|-- db/                    D1 migrations, seed data, reset scripts, and DB notes
|-- docs/                  Developer handoff and onboarding documentation
|-- e2e/                   Playwright browser tests
|-- functions/             Cloudflare Pages Functions and API routes
|   |-- _middleware.js     Resolves the session cookie for downstream handlers
|   |-- app.js             Routes authenticated users to onboarding or projects
|   `-- api/                Authentication and project-resource endpoints
|-- source/                Browser HTML, CSS, JavaScript, components, and Vitest tests
|   |-- dashboard/         Scrum, Kanban, XP, and shared dashboard code
|   |-- shared/            Shared styles, utilities, team panel, and user menu
|   |-- task-card/         Reusable task card component
|   |-- blocker-card/      Reusable blocker card component
|   |-- agent-card/        Reusable AI agent card and form
|   `-- tests/             Vitest suites
|-- specs/                 Sprint plans, retrospectives, research, and ADRs
|-- .github/workflows/     GitHub Actions configuration
|-- index.html             Redirects visitors to the login page
|-- package.json           Scripts and dependencies
|-- playwright.config.js   End-to-end test configuration
|-- vitest.config.js       Unit/integration test discovery
`-- wrangler.toml          Pages output and D1 binding configuration
```

Generated directories such as `dist/`, `.wrangler/`, `playwright-report/`, and `test-results/`
should not be committed.

## Application Flow

1. `index.html` redirects a visitor to `/login/`.
2. Signup or login creates a database-backed session and sets the `sitrep_token` cookie.
3. `functions/_middleware.js` resolves that cookie to a user for each request.
4. `/app` sends a new user to project setup and a returning project member to the projects page.
5. The selected project is stored in browser storage and determines which workflow dashboard
   opens.
6. Frontend modules call `/api/...` routes implemented by Cloudflare Pages Functions.
7. Pages Functions validate authentication and project membership, then read or write D1.

Important architecture decisions are recorded in `specs/adrs/`.

## Database Workflow

The database name and Pages binding are both `cse110-sp26-group15` / `DB`. Schema changes belong
in `db/migrations/`.

When adding a migration:

1. Do not edit a migration that has already been applied.
2. Choose the next unused, zero-padded four-digit prefix, such as `0015_description.sql`.
3. Update `db/seed.sql` if the sample data must change with the schema.
4. Apply the migration locally.
5. Run the test suite and verify reset/seed behavior.
6. Apply it remotely only after review and approval.

Older databases may contain the migration filenames that existed before the June 2026
renumbering. Follow `db/README.md` and run `db/RENUMBER.sql` exactly once in an affected
environment before applying newer migrations. Fresh databases must skip that repair step.

## Testing and Local Quality Checks

Before opening a pull request, run:

```bash
npm run lint
npm run format:check
npm run test:ci
npm run build
npm run test:e2e:ci
```

Vitest discovers `source/tests/**/*.test.js`. These tests directly exercise frontend helpers
and Pages Function handlers, often with a test D1 environment.

Playwright discovers tests under `e2e/` and starts a static server on
`http://localhost:3000`. The current Playwright configuration serves `dist/` with `serve`;
therefore, confirm separately through `npm run dev:pages` when a change depends on live Pages
Functions or D1 behavior.

## CI/CD Pipeline

`.github/workflows/ci.yml` runs on every push and pull request. It has five checks:

1. ESLint
2. Prettier formatting
3. Production build
4. Vitest
5. Playwright end-to-end tests in Chromium

The end-to-end job waits for the build job and builds its own copy of `dist/`. A change should
not be merged while any required check is failing.

Cloudflare Pages hosts the deployed application. The repository documents the Pages/D1 design,
but Cloudflare account configuration and deployment permissions live outside Git.

**Team confirmation needed:** document whether production deployment is automatic from `main`,
which Cloudflare branch/environment is used for previews, and who transfers Cloudflare
ownership to the next team.

## Development Workflow

The recommended contribution flow is:

```bash
git switch main
git pull
git switch -c <short-feature-name>
```

Keep changes focused on one issue, add or update tests for changed behavior, run all checks, and
open a pull request. Explain the user story, implementation, test evidence, and any database or
deployment impact in the PR.

Do not commit directly to `main`, commit generated output, or include credentials in source
control.

**Team confirmation needed:** add the final branch naming, review-count, issue-linking, and
merge-strategy rules used by Team 15.

## Configuration and Secrets

- `wrangler.toml` defines the Pages build output and D1 binding.
- `.env` and `.env.local` are ignored and must never contain committed secrets.
- The application currently uses no documented local environment variables.
- Production credentials and Cloudflare account access must be transferred privately, not
  placed in this repository.

If the D1 database is recreated, update its ID in `wrangler.toml` and reapply all migrations.

## Troubleshooting

### The page is missing a recent frontend change

`npm run dev:pages` serves `dist/`, not `source/` directly. Stop the server, run
`npm run build`, and restart it.

### API requests fail or `DB` is undefined

Run the app with `npm run dev:pages`. A generic static file server does not provide Cloudflare
Pages Functions or the D1 binding.

### A table or column is missing

Apply pending migrations:

```bash
npm run db:migrate:local
```

If the database predates the June 2026 migration renumbering, read `db/README.md` before doing
so.

### Sample login or dashboard data is missing

Load the sample dataset:

```bash
npm run db:seed:local
```

Reset first if duplicate or stale fixture data causes conflicts.

### Playwright cannot find Chromium

```bash
npx playwright install chromium
```

### Formatting passes locally but fails in CI

Run `npm run format`, review the resulting changes, and then rerun `npm run format:check`.

## Known Limitations and Handoff Risks

- The exact supported Node.js version is not pinned.
- Playwright uses a static server, so its current coverage does not validate all live API/D1
  paths.
- Cloudflare deployment settings and ownership are not fully represented in the repository.
- Project selection relies partly on browser storage; server authorization remains the source
  of truth for protected project API routes.
- Pending invitations are in-app database records; the project does not send invitation email.
- Some ADR text describes earlier implementation states and should be checked against current
  code before making architectural assumptions.
- Remote database reset and seed scripts can destroy or overwrite production data.

Review open GitHub issues, the latest sprint notes under `specs/`, and the meeting records under
`admin/meetings/` before choosing the next feature.

## Recommended Next Work

1. Pin and document Node.js/npm versions.
2. Add full-stack Playwright coverage using Wrangler so API and D1 flows are tested end to end.
3. Document and transfer Cloudflare Pages/D1 ownership and deployment settings.
4. Audit accessibility, responsive behavior, and UI consistency across all workflows.
5. Review authentication for rate limiting, CSRF protection, and account/session management.
6. Replace remaining client-storage project-state workarounds with authoritative server state.
7. Add real invite delivery and richer project-member/role management.
8. Reconcile ADRs and setup documentation with the final implementation.

## Key References

- `README.md`: short project entry point and basic run instructions
- `db/README.md`: migration numbering, local/remote D1, and renumbering repair
- `specs/adrs/`: architectural decisions
- `specs/sprint1/research/Persona_UserStories.md`: product personas and user stories
- `specs/sprint*/`: sprint plans and retrospectives
- `admin/meetings/`: team meeting records
- `.github/workflows/ci.yml`: CI checks
