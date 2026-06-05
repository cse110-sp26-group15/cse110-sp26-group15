---
# Configuration for the Jekyll template "Just the Docs"
parent: Decisions
nav_order: 102
title: Project Member Management

status: proposed
date: 2026-06-05
decision-makers: Team 15
---

# Project Member Management

## Context and Problem Statement

Project members do not reliably surface as task assignees, the invite flow is incomplete, and
every dashboard is hard-coded to a single project. Concretely: each dashboard and the check-in
page set `PROJECT_ID = 1`, so team data is not project-specific; invited emails without an
existing account are silently dropped; the assignee dropdown offers a blank "Unassigned" option
that conflicts with the requirement that tasks cannot be assigned to a blank user; there is no
way to add members after a project is created; and the "Team" tab is only a placeholder. How do
we make membership project-specific, persistent, and consistent across all dashboards without
overhauling the existing (cookie-based, sessionless) auth flow?

## Decision Drivers

- Team data must be project-specific (no hard-coded project id).
- Members and invites must persist across refreshes (database-backed).
- Invites must reach people who do not yet have an account, then link them once they join.
- Tasks must always be assigned to a real project member.
- Duplicate members/invites must be prevented.
- Must stay consistent with existing pages, appearance, and code architecture; avoid an auth
  overhaul (no server-side sessions table in this change).
- Every backend API function and JS function carries JSDoc (existing repo convention).
- Every backend JS function implemented or modified ships with Vitest unit tests
  (under `source/src/tests/`, matching the existing `auth`/`agents`/`checkins` suites).

## Considered Options

- **Project scoping:** (a) resolve the active project client-side from onboarding/creation;
  (b) add a server-side sessions table to resolve the cookie to a user/project; (c) keep it
  hard-coded.
- **Pending invites:** (a) store as pending and link at join time; (b) require an existing
  account and warn on unknown emails; (c) auto-create placeholder user rows.
- **Blank assignee:** (a) remove the blank option and require a real member; (b) keep
  "Unassigned" as a valid backlog state.
- **Add-member surface:** (a) onboarding only; (b) onboarding and after creation.

## Decision Outcome

Chosen options: **client-side project scoping**, **pending invites linked at join time**,
**remove the blank assignee option**, and **add members both at onboarding and after creation**.

Project scoping reuses the existing `localStorage`/`sessionStorage` stop-gap (already used for
`sitrep_user`), so it does not require the larger sessions-table change to auth; the dashboard
type stays consistent with the project's workflow (scrum→scrum, kanban→kanban, xp→xp). When a
returning user belongs to more than one project, login opens the most-recent project (a project
switcher is a deliberate follow-up). Pending invites are stored even for emails without an
account and the person joins by completing onboarding after signup, satisfying "invites still
send" without auto-joining. Removing the blank option (enforced on client and server) directly
implements the requirement. Add-member works in both places so teams are not locked at creation.

### Consequences

- Good, because team data becomes project-specific without touching the auth/session flow.
- Good, because invites are durable and reach not-yet-registered users.
- Good, because tasks can no longer be created/updated with a blank assignee.
- Good, because membership reuses existing tables/constraints, preventing duplicates.
- Bad, because client-side project resolution is a stop-gap until a real sessions table exists
  (a user with stale `localStorage` could point at a project they have left).
- Bad, because the no-blank rule changes existing assignee UI and tests, which must be updated.

### Confirmation

Confirmed via: Vitest unit tests for **every** new or modified backend API handler
(`projects` POST, `projects/:id/members` GET+POST, `invites` GET, `tasks` POST, `tasks/:id`
PATCH) under `source/src/tests/`, plus the new `utils.js` helpers, the assignee guard, and the
`PROJECT_ID` fallback; Playwright coverage for the pending-invite "You've been invited" / Join
flow and the no-blank-assignee rule; and a code review verifying each acceptance criterion in
the mapping table below is met and existing specs stay green.

## Pros and Cons of the Options

### Project scoping — client-side resolution (chosen)

- Good, because no change to the cookie-based auth flow (small blast radius).
- Good, because it mirrors the existing `getCurrentUser`/`sitrep_user` pattern (consistency).
- Neutral, because the dashboard workflow is derived from the stored project's `workflow`.
- Bad, because it is a stop-gap; correctness depends on client storage being current.

### Project scoping — server sessions table

- Good, because the server could authoritatively resolve cookie → user → project.
- Bad, because it touches login, signup, and middleware — out of scope for this issue.

### Pending invites — store and link at join (chosen)

- Good, because invites reach users without accounts and link them when they onboard.
- Neutral, because it adds one table (`project_invites`).
- Bad, because it introduces a small two-state model (member vs pending invite) to maintain.

### Pending invites — require existing account / auto-create placeholder

- Bad (require account), because it cannot satisfy "invite still sends" for new users.
- Bad (placeholder users), because half-real user rows complicate auth and uniqueness.

### Blank assignee — remove option (chosen) vs keep "Unassigned"

- Good (remove), because it matches the stated requirement and is enforced server-side.
- Bad (keep), because a backlog "Unassigned" state contradicts "cannot be blank".

## More Information

### Database — migration `db/migrations/0008_add_project_invites.sql`

```sql
CREATE TABLE project_invites (
    invite_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL,
    email       TEXT NOT NULL,
    invited_by  INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, email),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (invited_by) REFERENCES users(user_id)
);
```

`project_members`'s composite PK already prevents duplicate memberships; `UNIQUE(project_id,
email)` prevents duplicate invites. Emails are normalized (trimmed + lowercased), matching the
auth handlers.

### Backend APIs (every function carries JSDoc)

- `POST /api/projects` (modify): unknown emails go into `project_invites` instead of being
  dropped; response returns `{ project, invited, pending }` (replaces `not_found`).
- `POST /api/projects/:projectId/members` (new): body `{ email }`. Existing user → `INSERT OR
  IGNORE` into `project_members` and clear any matching invite (`{ status: "added" }` or
  `"already_member"`); unknown email → `project_invites` (`{ status: "pending" }`).
- `GET /api/projects/:projectId/members` (modify): return `{ members, pending_invites }`
  (backward compatible — existing callers still read `members`).
- `GET /api/invites?email=` (new): pending invites + project info for an email, used by
  onboarding.
- `POST /api/projects/:projectId/tasks` and `PATCH /api/tasks/:taskId` (modify): reject
  null/blank `assigned_to` with `400 { error: "A task must be assigned to a project member." }`
  (PATCH only enforces when `assigned_to` is present in the body).

### Client

- `source/shared/utils.js`: add `setCurrentProject`/`getCurrentProject`
  (`localStorage.sitrep_project = { project_id, name, workflow }`), `dashboardPathFor(workflow)`,
  `apiGetProjects(userId)`, `apiGetInvites(email)`, `apiAddMember(projectId, email)`.
- `login/script.js`: after login fetch the user's projects — 0 → onboarding; ≥1 → store the
  most-recent and redirect via `dashboardPathFor(workflow)`.
- `project-setup/script.js`: store the real `project_id` on create; render a "You've been
  invited" section (from `GET /api/invites`) with Join buttons that call `apiAddMember`, store
  the project, and route to its dashboard.
- `source/dashboard/{main,scrum,kanban}.js` and `source/check-in/check-in.js`: replace
  `PROJECT_ID = 1` with `getCurrentProject()?.project_id ?? 1` (the `?? 1` fallback keeps unit
  tests green and is a safe default outside the browser).
- `source/task-form/task-form.js` + inline create-form assignee builders: remove the blank
  `Unassigned` option, default to the current user (else first member), and block submit with
  `"Please select an assignee."` if none is selected.
- `source/shared/team-panel.js` (new): `renderTeamPanel(container, { projectId })` renders the
  member roster + pending invites + an Add-member input; mounted by each dashboard's
  view-switcher into the existing `team-view` container (replacing the placeholder).

### Out of scope

- Server-side sessions table / real cookie→user resolution.
- A multi-project switcher in the dashboard shell.
- Email delivery for invites (in-app/pending only).
- Removing members or editing roles.

### Acceptance criteria mapping

| Criterion | Covered by |
|---|---|
| Members appear in assignee dropdowns | Assignee dropdown (already populated; blank removed) |
| Tasks cannot be assigned to blank users | Server 400 + client submit guard |
| Member list persists across refreshes | DB-backed `project_members` + `project_invites` |
| Team data is project-specific | Client project scoping + dashboards drop hard-coded id |
| Members stored in DB | existing `project_members` + new `project_invites` |
| Members displayed across dashboards | Team view (`team-panel.js`) |
| Assignee dropdown populated from members | Assignee dropdown |
| No blank assignee option | task-form + inline builders |
| Duplicate members prevented | composite PK + `UNIQUE(project_id,email)` + client guard |
| Current user in sidebar/footer | existing `user-menu.js` (verify still wired) |
| Invited members associated with correct project | invites carry `project_id`; linked on join |

### Implementation workflow

Implementation pauses after **each task** for the user to commit, and each task ends with a
ready-to-use commit message.
