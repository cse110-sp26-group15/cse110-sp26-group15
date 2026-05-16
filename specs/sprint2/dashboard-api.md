# Dashboard API

Aggregate read endpoint for a single project. Returns project info, team members, tasks, open blockers, and check-ins from the last two calendar days in one response.

**Implementation:** [`functions/api/projects/[projectId]/dashboard.js`](../../functions/api/projects/[projectId]/dashboard.js)

## Endpoint

| Method | Path                                 | Description                            |
| ------ | ------------------------------------ | -------------------------------------- |
| `GET`  | `/api/projects/:projectId/dashboard` | Full dashboard payload for one project |

`:projectId` is the numeric project ID from the `projects` table.

## Usage

### From the browser or frontend

```javascript
const projectId = 1;
const res = await fetch(`/api/projects/${projectId}/dashboard`);

if (!res.ok) {
  const { error } = await res.json();
  throw new Error(error);
}

const data = await res.json();
// data.project, data.members, data.tasks, ...
```

### Local development

1. Apply migrations and seed data (or use the test fixture):

   ```bash
   npm run db:migrate:local
   npm run db:seed:local
   ```

2. Build and run Pages with D1:

   ```bash
   npm run build
   npm run dev:pages
   ```

3. Request the endpoint, e.g. `http://localhost:8788/api/projects/1/dashboard`.

### Integration tests

Tests load [`db/dashboard-test-seed.sql`](../../db/dashboard-test-seed.sql) into local D1 via wrangler, call `onRequestGet` with a real D1 binding (`getPlatformProxy`), then clear the DB with `reset.sql`. See [`source/src/tests/dashboard.test.js`](../../source/src/tests/dashboard.test.js).

## Response format (`200`)

All fields use **snake_case**. Empty collections are `[]`, not omitted.

```json
{
  "project": {
    "project_id": 1,
    "name": "SE SitRep Prototype",
    "description": "A tool for tracking status.",
    "created_at": "2026-05-10T12:00:00.000Z"
  },
  "members": [
    {
      "user_id": 1,
      "full_name": "Alex Rivera",
      "email": "arivera@ucsd.edu",
      "role": "Lead Developer",
      "joined_at": "2026-05-10T12:00:00.000Z"
    }
  ],
  "tasks": [
    {
      "task_id": 1,
      "title": "Create User Personas",
      "status": "done",
      "github_issue_url": "https://github.com/org/repo/issues/1",
      "assigned_to": 2,
      "full_name": "Sam Chen"
    }
  ],
  "open_blockers": [
    {
      "blocker_id": 1,
      "description": "Waiting for approval",
      "task": null,
      "helper": null,
      "checkin_id": 4,
      "reported_by": {
        "user_id": 2,
        "full_name": "Sam Chen"
      },
      "checkin_date": "2026-05-16"
    }
  ],
  "checkins": {
    "date_range": {
      "from": "2026-05-15",
      "to": "2026-05-16"
    },
    "entries": [
      {
        "checkin_id": 1,
        "checkin_date": "2026-05-16",
        "status_mood": "Productive",
        "work_done": "Setup repo.",
        "work_planned": "Initialize DB.",
        "user": {
          "user_id": 1,
          "full_name": "Alex Rivera"
        }
      }
    ]
  },
  "meta": {
    "generated_at": "2026-05-16T18:30:00.000Z",
    "checkin_days": 2
  }
}
```

### Field reference

| Field                         | Description                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `project`                     | Project row: `project_id`, `name`, `description`, `created_at`                    |
| `members`                     | Users on this project via `project_members`                                       |
| `tasks`                       | All tasks for the project; `full_name` is the assignee (null if unassigned)       |
| `open_blockers`               | Unresolved blockers (`is_resolved = 0`) linked through a check-in on this project |
| `open_blockers[].task`        | Task name string, or `null` for a general blocker                                 |
| `open_blockers[].helper`      | Suggested helper, or `null`                                                       |
| `open_blockers[].reported_by` | User who submitted the linked check-in                                            |
| `checkins.date_range`         | Inclusive window: today and yesterday (`YYYY-MM-DD`)                              |
| `checkins.entries`            | Check-ins where `checkin_date >= date('now', '-1 day')`                           |
| `meta.generated_at`           | ISO timestamp when the response was built                                         |
| `meta.checkin_days`           | Always `2`                                                                        |

`tasks` matches the shape returned by `GET /api/projects/:projectId/tasks`.

## Error responses

| Status | Body                                                 | When                                                 |
| ------ | ---------------------------------------------------- | ---------------------------------------------------- |
| `404`  | `{ "error": "Project not found" }`                   | No project with the given `projectId`                |
| `500`  | `{ "error": "D1 database binding not configured." }` | `env.DB` is missing (misconfigured Pages/D1 binding) |
| `500`  | `{ "error": "<message>" }`                           | Database or other server error                       |

Example error handling:

```javascript
const res = await fetch(`/api/projects/${projectId}/dashboard`);
const body = await res.json();

if (res.status === 404) {
  // project does not exist
}
if (!res.ok) {
  console.error(body.error);
}
```

## Exported helpers (for tests)

These are exported from the same module for unit tests; clients should use the HTTP endpoint only.

| Function                      | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| `onRequestGet(context)`       | Cloudflare Pages handler                            |
| `buildDashboardPayload(data)` | Assembles the JSON shape from query results         |
| `mapOpenBlocker(row)`         | Maps a blocker DB row to `open_blockers[]` item     |
| `mapCheckinEntry(row)`        | Maps a check-in DB row to `checkins.entries[]` item |
| `getCheckinDateRange()`       | Returns `{ from, to }` for the two-day window       |
