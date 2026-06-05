# Project Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project membership project-specific and durable — store members + pending invites in D1, resolve the active project from onboarding (no hard-coded id), surface members across dashboards, and forbid blank task assignees.

**Architecture:** Cloudflare Pages Functions (D1/SQLite) for the API; vanilla ES-module front-end. New `project_invites` table holds invites for not-yet-registered users. The active project is stored client-side in `localStorage` (consistent with the existing `sitrep_user` stop-gap; no server sessions table). Backend handlers are pure functions tested with the existing ordered-mock-D1 Vitest harness; front-end DOM modules expose pure helpers tested in Node and gate DOM wiring behind `typeof document !== "undefined"`.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Wrangler, vanilla JS ES modules, Vitest (unit), Playwright (e2e), Prettier/ESLint.

**Reference spec (ADR):** `specs/adrs/manage-project-members.md`

**Workflow note (user preference):** Pause after EACH task so the user can commit. Each task's final step is a ready-to-use commit message — do not commit automatically; wait for the user before starting the next task.

**Conventions:**

- Every backend API function and JS function gets a JSDoc block.
- Every new/modified backend handler ships Vitest unit tests under `source/src/tests/`.
- Front-end lives in `source/`; `dist/` is a build copy. Run `npm run build` before Playwright (it serves `dist`).
- After editing, run `npm run format` and `npm run lint` before committing.

---

## File Structure

**Create:**

- `db/migrations/0008_add_project_invites.sql` — new `project_invites` table.
- `functions/api/invites/index.js` — `GET /api/invites?email=` (pending invites for an email).
- `source/shared/team-panel.js` — shared Team-view roster + add-member UI (pure `buildTeamPanelHtml` + DOM `renderTeamPanel`).
- `source/src/tests/projects-create.test.js` — tests for `POST /api/projects` pending invites.
- `source/src/tests/project-members.test.js` — tests for members GET (+pending) and POST.
- `source/src/tests/invites.test.js` — tests for `GET /api/invites`.
- `source/src/tests/tasks-assignee.test.js` — tests for the blank-assignee rule.
- `source/src/tests/project-context.test.js` — tests for `utils.js` project/invite helpers.
- `source/src/tests/team-panel.test.js` — tests for `buildTeamPanelHtml`.
- `e2e/project-invites.spec.js` — e2e for pending-invite Join flow + login routing.

**Modify:**

- `db/reset.sql` — clear `project_invites`.
- `db/seed.sql` — one demo pending invite.
- `functions/api/projects/index.js` — store unknown emails as invites; return `pending`.
- `functions/api/projects/[projectId]/members.js` — add `onRequestPost`; GET also returns `pending_invites`.
- `functions/api/projects/[projectId]/tasks.js` — reject blank `assigned_to` (POST).
- `functions/api/tasks/[taskId].js` — reject blank `assigned_to` (PATCH).
- `source/shared/utils.js` — `getCurrentProject`/`setCurrentProject`/`dashboardPathFor`/`apiGetProjects`/`apiGetInvites`/`apiAddMember`.
- `source/login/script.js` — route to the user's most-recent project after login.
- `source/project-setup/index.html` + `script.js` — store real `project_id`; render "You've been invited" section.
- `source/dashboard/main.js`, `source/dashboard/scrum.js`, `source/check-in/check-in.js`, `source/dashboard/kanban.js` — `PROJECT_ID = getCurrentProject()?.project_id ?? 1`.
- `source/task-form/task-form.js` — remove blank assignee option; default + submit guard; gate self-init.
- `source/dashboard/main.js` — `buildAssigneeOptions` drops the blank option; mount Team panel in `switchView`.
- `source/dashboard/scrum.js` — drop blank option in its create-task modal; mount Team panel in `switchView`.

---

## Task 1: Database — `project_invites` table

**Files:**

- Create: `db/migrations/0008_add_project_invites.sql`
- Modify: `db/reset.sql`, `db/seed.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/0008_add_project_invites.sql`:

```sql
-- Pending project invites for emails that don't yet have a user account.
-- Resolved into project_members when the invitee signs up and joins.
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

- [ ] **Step 2: Clear the table on reset**

In `db/reset.sql`, add a line immediately above `DELETE FROM project_members;`:

```sql
DELETE FROM project_invites;
```

- [ ] **Step 3: Seed one demo pending invite**

Append to the end of `db/seed.sql` (the email is intentionally NOT in the `users` insert, so it shows as "Pending" on project 1's Team view):

```sql
-- ── Pending invite ────────────────────────────────────────────────────
-- Invited to the scrum project but has no account yet; appears as
-- "Pending" in the Team view until they sign up and join.
INSERT INTO project_invites (project_id, email, invited_by) VALUES
  (1, 'newteammate@ucsd.edu', 1);
```

- [ ] **Step 4: Apply + reseed locally to verify the SQL is valid**

Run:

```bash
npm run db:reset:local && npm run db:migrate:local && npm run db:seed:local
```

Expected: all three commands succeed with no SQL errors; the seed step reports rows written.

- [ ] **Step 5: Commit**

Commit message:

```
feat(db): add project_invites table for pending invites

New project_invites(project_id, email, invited_by) with UNIQUE(project_id,
email) to hold invites for emails without an account yet. Wire into
reset.sql and add one demo pending invite to seed.sql.
```

**PAUSE for user to commit.**

---

## Task 2: `POST /api/projects` — store unknown emails as pending invites

**Files:**

- Modify: `functions/api/projects/index.js`
- Test: `source/src/tests/projects-create.test.js`

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/projects-create.test.js`. The handler takes a single `context` argument (built by `ctx`), and issues queries in this order for an unknown email with no `created_by`: user lookup for the email (null) → final project SELECT.

```js
import { describe, it, expect, vi } from "vitest";
import { onRequestPost as createProject } from "../../../functions/api/projects/index.js";

/**
 * Ordered-result mock D1 (same pattern as agents.test.js). `first()` and
 * `run()` return queued values in order; unspecified calls fall back to a
 * sensible default.
 * @param {{ firstResults?: any[], runResults?: any[] }} [opts]
 * @returns {object} a mock D1 binding
 */
function createMockDb({ firstResults = [], runResults = [] } = {}) {
  let firstIdx = 0;
  let runIdx = 0;
  const bound = {
    first: vi.fn(async () => firstResults[firstIdx++] ?? null),
    run: vi.fn(async () => runResults[runIdx++] ?? { meta: { last_row_id: 10 } }),
    all: vi.fn(async () => ({ results: [] })),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a POST /api/projects context.
 * @param {object} body
 * @param {object} db
 * @returns {object}
 */
function ctx(body, db) {
  return {
    env: { DB: db },
    request: new Request("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("POST /api/projects pending invites", () => {
  it("stores an unknown member email as a pending invite", async () => {
    const db = createMockDb({
      firstResults: [
        null, // user lookup for unknown email → not found
        { project_id: 10, name: "P", workflow: "scrum", created_by: null }, // final SELECT
      ],
      runResults: [
        { meta: { last_row_id: 10 } }, // INSERT project
        { meta: {} }, // INSERT project_invites
      ],
    });
    const res = await createProject(
      ctx({ name: "P", workflow: "scrum", members: ["ghost@x.com"] }, db)
    );
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.pending).toEqual(["ghost@x.com"]);
    expect(data.invited).toEqual([]);
  });

  it("adds an existing-user email to invited (not pending)", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 2, email: "real@x.com" }, // user lookup → found
        { project_id: 11, name: "Q", workflow: "kanban", created_by: null }, // final SELECT
      ],
      runResults: [
        { meta: { last_row_id: 11 } }, // INSERT project
        { meta: {} }, // INSERT project_members
      ],
    });
    const res = await createProject(
      ctx({ name: "Q", workflow: "kanban", members: ["real@x.com"] }, db)
    );
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.invited).toEqual([{ user_id: 2, email: "real@x.com" }]);
    expect(data.pending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/projects-create.test.js`
Expected: FAIL — `data.pending` is `undefined` (handler still returns `not_found`).

- [ ] **Step 3: Modify the handler**

In `functions/api/projects/index.js`, inside `onRequestPost`, replace the invited-resolution block. Change the declaration:

```js
const invited = [];
const notFound = [];
```

to:

```js
const invited = [];
const pending = [];
```

Replace the `if (!user) { notFound.push(email); continue; }` branch with an invite insert:

```js
      if (!user) {
        // No account yet — record a pending invite so they're linked when
        // they sign up and join. INSERT OR IGNORE + UNIQUE(project_id,email)
        // makes this idempotent and duplicate-safe.
        await env.DB.prepare(
          `INSERT OR IGNORE INTO project_invites (project_id, email, invited_by)
           VALUES (?, ?, ?)`
        )
          .bind(projectId, email, creatorId)
          .run();
        pending.push(email);
        continue;
      }
```

Update the JSDoc `@returns` line and the final response:

```js
return Response.json({ project, invited, pending }, { status: 201 });
```

Update the handler's JSDoc `Response 201:` line to:

```
 *   { project, invited: [{ user_id, email }], pending: string[] }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/projects-create.test.js`
Expected: PASS (both cases).

- [ ] **Step 5: Format, lint, full unit run**

Run: `npm run format && npm run lint && npm run test:ci`
Expected: no lint errors; all unit tests pass.

- [ ] **Step 6: Commit**

Commit message:

```
feat(api): store unknown invite emails as pending invites

POST /api/projects now inserts emails with no matching user into
project_invites (idempotent via INSERT OR IGNORE) and returns them as
`pending` instead of dropping them in `not_found`. Adds projects-create
unit tests.
```

**PAUSE for user to commit.**

---

## Task 3: `POST /api/projects/:projectId/members` — add member after creation

**Files:**

- Modify: `functions/api/projects/[projectId]/members.js`
- Test: `source/src/tests/project-members.test.js`

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/project-members.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import {
  onRequestGet as getMembers,
  onRequestPost as addMember,
} from "../../../functions/api/projects/[projectId]/members.js";

/**
 * Ordered-result mock D1 (same pattern as agents.test.js).
 * @param {{ firstResults?: any[], allResults?: any[], runResults?: any[] }} [opts]
 * @returns {object}
 */
function createMockDb({ firstResults = [], allResults = [], runResults = [] } = {}) {
  let f = 0,
    a = 0,
    r = 0;
  const bound = {
    first: vi.fn(async () => firstResults[f++] ?? null),
    all: vi.fn(async () => allResults[a++] ?? { results: [] }),
    run: vi.fn(async () => runResults[r++] ?? { meta: {} }),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a context for the members endpoint.
 * @param {{ projectId?: string, body?: object, db: object }} opts
 * @returns {object}
 */
function ctx({ projectId = "1", body, db }) {
  const c = { env: { DB: db }, params: { projectId } };
  if (body !== undefined) {
    c.request = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return c;
}

describe("POST /api/projects/:projectId/members", () => {
  it("400s on an invalid email", async () => {
    const res = await addMember(ctx({ body: { email: "nope" }, db: createMockDb() }));
    expect(res.status).toBe(400);
  });

  it("adds an existing user as a member and returns status added", async () => {
    const db = createMockDb({
      firstResults: [{ user_id: 5, email: "real@x.com", full_name: "Real User" }],
    });
    const res = await addMember(ctx({ body: { email: "real@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("added");
    expect(data.member.user_id).toBe(5);
  });

  it("records a pending invite when the email has no account", async () => {
    const db = createMockDb({ firstResults: [null] });
    const res = await addMember(ctx({ body: { email: "ghost@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
  });
});

describe("GET /api/projects/:projectId/members", () => {
  it("returns members and pending_invites", async () => {
    const db = createMockDb({
      allResults: [
        { results: [{ user_id: 1, full_name: "Alex" }] }, // members
        { results: [{ email: "ghost@x.com" }] }, // pending invites
      ],
    });
    const res = await getMembers(ctx({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(1);
    expect(data.pending_invites).toEqual([{ email: "ghost@x.com" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/project-members.test.js`
Expected: FAIL — `addMember` is not exported; `pending_invites` undefined.

- [ ] **Step 3: Implement the new POST handler + extend GET**

Rewrite `functions/api/projects/[projectId]/members.js`:

```js
/**
 * Returns true when `email` matches the basic local@domain.tld shape.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/members
 *
 * Returns the project's members joined with their user record, plus any
 * pending invites (emails invited that don't yet have an account).
 *
 * @param {{ env: { DB: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results: members } = await env.DB.prepare(
      `SELECT u.user_id, u.full_name, u.email, u.role
       FROM project_members pm
       JOIN users u ON pm.user_id = u.user_id
       WHERE pm.project_id = ?
       ORDER BY u.full_name ASC`
    )
      .bind(projectId)
      .all();

    const { results: pending } = await env.DB.prepare(
      `SELECT email FROM project_invites WHERE project_id = ? ORDER BY created_at ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ members, pending_invites: pending });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: POST /api/projects/:projectId/members
 *
 * Adds a member to a project by email. If the email already has a user
 * account, the user is added to `project_members` (and any matching
 * pending invite is cleared). Otherwise the email is recorded in
 * `project_invites` and linked when they sign up and join. Duplicate
 * members/invites are prevented by INSERT OR IGNORE + table constraints.
 *
 * Request body: { email: string }
 * Response 201: { status: "added", member } | { status: "already_member" }
 *               | { status: "pending" }
 *
 * @param {{ env: { DB: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawEmail = body?.email;
  if (!rawEmail || typeof rawEmail !== "string" || !validateEmail(rawEmail)) {
    return Response.json({ error: "A valid email is required." }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  try {
    const user = await env.DB.prepare(
      "SELECT user_id, email, full_name, role FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_invites (project_id, email) VALUES (?, ?)`
      )
        .bind(projectId, email)
        .run();
      return Response.json({ status: "pending", email }, { status: 201 });
    }

    const existing = await env.DB.prepare(
      `SELECT 1 AS found FROM project_members WHERE project_id = ? AND user_id = ?`
    )
      .bind(projectId, user.user_id)
      .first();
    if (existing) {
      return Response.json({ status: "already_member", member: user }, { status: 201 });
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
    )
      .bind(projectId, user.user_id)
      .run();

    // Clear any pending invite now that the user is a real member.
    await env.DB.prepare(`DELETE FROM project_invites WHERE project_id = ? AND email = ?`)
      .bind(projectId, email)
      .run();

    return Response.json({ status: "added", member: user }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/project-members.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Format, lint, full unit run**

Run: `npm run format && npm run lint && npm run test:ci`
Expected: pass.

- [ ] **Step 6: Commit**

Commit message:

```
feat(api): add POST members endpoint + pending invites in GET

POST /api/projects/:id/members adds an existing user to project_members
(clearing any matching invite) or records a pending invite for unknown
emails; returns added/already_member/pending. GET now also returns
pending_invites and members' email/role. Adds project-members tests.
```

**PAUSE for user to commit.**

---

## Task 4: `GET /api/invites?email=` — pending invites for a user

**Files:**

- Create: `functions/api/invites/index.js`
- Test: `source/src/tests/invites.test.js`

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/invites.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { onRequestGet as getInvites } from "../../../functions/api/invites/index.js";

/**
 * Mock D1 returning a single `all()` result set.
 * @param {any[]} rows
 * @returns {object}
 */
function dbWith(rows) {
  const bound = { all: vi.fn(async () => ({ results: rows })) };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a GET /api/invites context for the given query string.
 * @param {string} query e.g. "?email=ghost@x.com"
 * @param {object} db
 * @returns {object}
 */
function ctx(query, db) {
  return { env: { DB: db }, request: new Request(`http://localhost/api/invites${query}`) };
}

describe("GET /api/invites", () => {
  it("400s when email is missing", async () => {
    const res = await getInvites(ctx("", dbWith([])));
    expect(res.status).toBe(400);
  });

  it("returns pending invites with project info for the email", async () => {
    const rows = [{ invite_id: 1, project_id: 3, project_name: "Research Spike", workflow: "xp" }];
    const res = await getInvites(ctx("?email=ghost@x.com", dbWith(rows)));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].project_name).toBe("Research Spike");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/invites.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the handler**

Create `functions/api/invites/index.js`:

```js
/**
 * Cloudflare Pages function: GET /api/invites?email=<email>
 *
 * Returns the pending project invites for a given email, joined with the
 * project name and workflow so the onboarding page can render a "join"
 * prompt without a second round-trip. Email is matched case-insensitively
 * (normalized to lowercase), consistent with the auth handlers.
 *
 * Response 200: { invites: [{ invite_id, project_id, project_name, workflow }] }
 *
 * @param {{ env: { DB: object }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const rawEmail = url.searchParams.get("email");

  if (!rawEmail || rawEmail.trim() === "") {
    return Response.json({ error: "email query parameter is required" }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  try {
    const { results } = await env.DB.prepare(
      `SELECT i.invite_id, i.project_id, p.name AS project_name, p.workflow
       FROM project_invites i
       JOIN projects p ON p.project_id = i.project_id
       WHERE i.email = ?
       ORDER BY i.created_at ASC`
    )
      .bind(email)
      .all();

    return Response.json({ invites: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/invites.test.js`
Expected: PASS.

- [ ] **Step 5: Format, lint, full unit run**

Run: `npm run format && npm run lint && npm run test:ci`
Expected: pass.

- [ ] **Step 6: Commit**

Commit message:

```
feat(api): add GET /api/invites for pending invites by email

Returns a user's pending project invites joined with project name +
workflow, used by onboarding to show a join prompt. Adds invites tests.
```

**PAUSE for user to commit.**

---

## Task 5: Forbid blank task assignees (POST + PATCH)

**Files:**

- Modify: `functions/api/projects/[projectId]/tasks.js`
- Modify: `functions/api/tasks/[taskId].js`
- Test: `source/src/tests/tasks-assignee.test.js`

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/tasks-assignee.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { onRequestPost as postTask } from "../../../functions/api/projects/[projectId]/tasks.js";
import { onRequestPatch as patchTask } from "../../../functions/api/tasks/[taskId].js";

/**
 * Ordered-result mock D1.
 * @param {{ firstResults?: any[], runResults?: any[] }} [opts]
 * @returns {object}
 */
function createMockDb({ firstResults = [], runResults = [] } = {}) {
  let f = 0,
    r = 0;
  const bound = {
    first: vi.fn(async () => firstResults[f++] ?? null),
    run: vi.fn(async () => runResults[r++] ?? { meta: { last_row_id: 1 } }),
    all: vi.fn(async () => ({ results: [] })),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a task-endpoint context.
 * @param {{ projectId?: string, taskId?: string, body: object }} p
 * @param {object} db
 * @returns {object}
 */
function ctx({ projectId = "1", taskId = "1", body }, db) {
  return {
    env: { DB: db },
    params: { projectId, taskId },
    request: new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("blank assignee rule", () => {
  it("POST rejects a task with no assignee", async () => {
    const res = await postTask(ctx({ body: { title: "x" } }, createMockDb()));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/assigned to a project member/);
  });

  it("POST rejects a task with a null assignee", async () => {
    const res = await postTask(ctx({ body: { title: "x", assigned_to: null } }, createMockDb()));
    expect(res.status).toBe(400);
  });

  it("PATCH rejects clearing the assignee to null", async () => {
    // existing task lookup returns a row; assigned_to:null is an explicit clear
    const db = createMockDb({
      firstResults: [
        { task_id: 1, assigned_to: 2, reviewer_id: null, review_status: "not-required" },
      ],
    });
    const res = await patchTask(ctx({ body: { assigned_to: null } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/assigned to a project member/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/tasks-assignee.test.js`
Expected: FAIL — POST currently allows null assignee (returns 201); PATCH allows null.

- [ ] **Step 3a: Enforce on POST**

In `functions/api/projects/[projectId]/tasks.js` `onRequestPost`, immediately after the `title` validation block (right after the `if (!title ...) { ... }` check), add:

```js
if (assigned_to === null || assigned_to === undefined || assigned_to === "") {
  return Response.json({ error: "A task must be assigned to a project member." }, { status: 400 });
}
```

- [ ] **Step 3b: Enforce on PATCH**

In `functions/api/tasks/[taskId].js` `onRequestPatch`, after `const { status, assigned_to, reviewer_id, review_status, description } = body;` and the existing `status`/`review_status` validation, add a guard that only fires when the caller is explicitly setting the assignee:

```js
if (assigned_to !== undefined && (assigned_to === null || assigned_to === "")) {
  return Response.json({ error: "A task must be assigned to a project member." }, { status: 400 });
}
```

(Place it before the `try {` block. Updates that omit `assigned_to` are unaffected.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/tasks-assignee.test.js`
Expected: PASS.

- [ ] **Step 5: Confirm existing task tests still pass**

Run: `npx vitest run source/src/tests/task-reviewer.test.js`
Expected: PASS. (Reviewer-rule tests all supply `assigned_to`, so the new guard doesn't disturb them. If any seed/test created a deliberately unassigned task via POST, it must now supply an assignee — check the output and update only such cases.)

- [ ] **Step 6: Format, lint, full unit run**

Run: `npm run format && npm run lint && npm run test:ci`
Expected: pass.

- [ ] **Step 7: Commit**

Commit message:

```
feat(api): reject blank task assignees on create and update

POST /api/projects/:id/tasks now requires assigned_to; PATCH
/api/tasks/:id rejects an explicit null/empty assigned_to. Returns
"A task must be assigned to a project member." Adds tasks-assignee tests.
```

**PAUSE for user to commit.**

---

## Task 6: Client project-context helpers in `utils.js`

**Files:**

- Modify: `source/shared/utils.js`
- Test: `source/src/tests/project-context.test.js`

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/project-context.test.js`:

```js
import { describe, it, expect } from "vitest";
import { dashboardPathFor, setCurrentProject, getCurrentProject } from "../../shared/utils.js";

/**
 * Minimal in-memory Storage stand-in for Node (no real localStorage).
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe("dashboardPathFor", () => {
  it("maps each workflow to its dashboard page", () => {
    expect(dashboardPathFor("scrum")).toMatch(/scrum\.html$/);
    expect(dashboardPathFor("kanban")).toMatch(/kanban\.html$/);
    expect(dashboardPathFor("xp")).toMatch(/xp\.html$/);
  });
  it("falls back to scrum for an unknown workflow", () => {
    expect(dashboardPathFor("nope")).toMatch(/scrum\.html$/);
  });
});

describe("current project storage", () => {
  it("round-trips a project through the injected store", () => {
    const store = memStore();
    setCurrentProject({ project_id: 7, name: "P", workflow: "xp" }, store);
    expect(getCurrentProject(store)).toEqual({ project_id: 7, name: "P", workflow: "xp" });
  });
  it("returns null when nothing is stored", () => {
    expect(getCurrentProject(memStore())).toBeNull();
  });
  it("clears when given null", () => {
    const store = memStore();
    setCurrentProject({ project_id: 1, name: "A", workflow: "scrum" }, store);
    setCurrentProject(null, store);
    expect(getCurrentProject(store)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/project-context.test.js`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add helpers to `utils.js`**

Append to `source/shared/utils.js` (after the existing current-user helpers):

```js
// ── Current project helpers ─────────────────────────────

const CURRENT_PROJECT_KEY = "sitrep_project";

/** Workflow → dashboard page path (relative to a page under source/<dir>/). */
const DASHBOARD_PATHS = {
  scrum: "../dashboard/scrum.html",
  kanban: "../dashboard/kanban.html",
  xp: "../dashboard/xp.html",
};

/**
 * Map a project workflow to its dashboard page path. Unknown workflows
 * fall back to the scrum dashboard.
 * @param {string} workflow - "scrum" | "kanban" | "xp"
 * @returns {string}
 */
export function dashboardPathFor(workflow) {
  return DASHBOARD_PATHS[workflow] ?? DASHBOARD_PATHS.scrum;
}

/**
 * Best-effort access to localStorage; returns null in non-browser envs
 * (e.g. Vitest under Node) so callers degrade gracefully.
 * @returns {Storage|null}
 */
function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Persist the active project so dashboards can scope their API calls to it
 * without an auth round-trip. Stop-gap mirroring {@link saveCurrentUser}.
 * @param {{ project_id: number, name: string, workflow: string }|null} project
 * @param {Storage|null} [storage] - injectable for tests
 */
export function setCurrentProject(project, storage = safeLocalStorage()) {
  if (!storage) return;
  try {
    if (project) {
      storage.setItem(
        CURRENT_PROJECT_KEY,
        JSON.stringify({
          project_id: project.project_id,
          name: project.name,
          workflow: project.workflow,
        })
      );
    } else {
      storage.removeItem(CURRENT_PROJECT_KEY);
    }
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Read the active project previously stored by {@link setCurrentProject}.
 * @param {Storage|null} [storage] - injectable for tests
 * @returns {{ project_id: number, name: string, workflow: string }|null}
 */
export function getCurrentProject(storage = safeLocalStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CURRENT_PROJECT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/projects?user_id=N — the projects a user belongs to
 * (most-recent first).
 * @param {number} userId
 * @returns {Promise<{ projects: object[] }>}
 */
export async function apiGetProjects(userId) {
  return apiFetch(`/api/projects?user_id=${encodeURIComponent(userId)}`);
}

/**
 * GET /api/invites?email=… — a user's pending project invites.
 * @param {string} email
 * @returns {Promise<{ invites: object[] }>}
 */
export async function apiGetInvites(email) {
  return apiFetch(`/api/invites?email=${encodeURIComponent(email)}`);
}

/**
 * POST /api/projects/:projectId/members — add a member by email.
 * @param {number|string} projectId
 * @param {string} email
 * @returns {Promise<{ status: string, member?: object }>}
 */
export async function apiAddMember(projectId, email) {
  return apiFetch(`/api/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/project-context.test.js`
Expected: PASS.

- [ ] **Step 5: Format, lint, full unit run**

Run: `npm run format && npm run lint && npm run test:ci`
Expected: pass.

- [ ] **Step 6: Commit**

Commit message:

```
feat(client): add project-context + invite helpers to utils

setCurrentProject/getCurrentProject (localStorage, injectable for tests),
dashboardPathFor, apiGetProjects, apiGetInvites, apiAddMember. Adds
project-context unit tests.
```

**PAUSE for user to commit.**

---

## Task 7: Route to the user's project after login

**Files:**

- Modify: `source/login/script.js`

- [ ] **Step 1: Add imports**

In `source/login/script.js`, extend the import from `../shared/utils.js` to add:
`apiGetProjects, setCurrentProject, dashboardPathFor`.

- [ ] **Step 2: Add a routing helper**

Add near the top of the module (after imports):

```js
/**
 * After a successful login, send the user to their most-recent project's
 * dashboard, or to onboarding if they have none. Falls back to onboarding
 * on any lookup error so login never dead-ends.
 * @param {{ user_id: number }} user
 * @returns {Promise<void>}
 */
async function routeAfterAuth(user) {
  try {
    const { projects = [] } = await apiGetProjects(user.user_id);
    if (projects.length > 0) {
      const project = projects[0]; // API returns most-recent first
      setCurrentProject(project);
      navigateTo(dashboardPathFor(project.workflow));
      return;
    }
  } catch (err) {
    console.warn("[login] project lookup failed; routing to onboarding", err);
  }
  navigateTo("../project-setup/");
}
```

- [ ] **Step 3: Call it from submit**

In the submit handler, replace `navigateTo("../project-setup/");` (the post-login redirect) with:

```js
await routeAfterAuth(user);
```

- [ ] **Step 4: Build for e2e**

Run: `npm run build`
Expected: `dist/` updated.

- [ ] **Step 5: Add e2e coverage (combined with Task 9's spec)**

The login-routing assertion is added in Task 9's `e2e/project-invites.spec.js` (it needs the same project/invite mocks). For now verify the existing login spec still passes:

Run: `npm run build && npx playwright test e2e/login.spec.js`
Expected: PASS (existing login behavior — redirect to project-setup still happens when the projects lookup returns none/unmocked).

- [ ] **Step 6: Format, lint**

Run: `npm run format && npm run lint`
Expected: pass.

- [ ] **Step 7: Commit**

Commit message:

```
feat(client): route to most-recent project after login

login fetches the user's projects and redirects to the matching workflow
dashboard (most recent first), or to onboarding when they have none.
```

**PAUSE for user to commit.**

---

## Task 8: Onboarding — store real project_id + "You've been invited"

**Files:**

- Modify: `source/project-setup/index.html`
- Modify: `source/project-setup/script.js`
- Test: `e2e/project-invites.spec.js` (created here)

- [ ] **Step 1: Add the invites section to the HTML**

In `source/project-setup/index.html`, immediately after the `<div class="form-error-banner" ...></div>` line and before `<form id="setup-form" ...>`, insert:

```html
<!-- Pending invitations for the signed-in user (populated by script.js) -->
<section class="invites-section" id="invites-section" hidden>
  <h2 class="invites-title">You've been invited</h2>
  <ul class="invites-list" id="invites-list" aria-label="Pending invitations"></ul>
  <p class="invites-divider"><span>or create a new project</span></p>
</section>
```

- [ ] **Step 2: Update the script — imports + helpers + create flow**

In `source/project-setup/script.js`, extend the `../shared/utils.js` import to add:
`getCurrentUser` is already imported — also add `setCurrentProject, dashboardPathFor, apiGetInvites, apiAddMember`. Remove the now-redundant inline `dashMap`.

Replace the create-success block:

```js
const result = await apiCreateProject({ name, workflow, members: [...members], created_by });
const projectData = result?.project ?? { name, workflow };
localStorage.setItem(
  "sitrep_project",
  JSON.stringify({ name: projectData.name ?? name, workflow: projectData.workflow ?? workflow })
);
const dashMap = {
  scrum: "../dashboard/scrum.html",
  kanban: "../dashboard/kanban.html",
  xp: "../dashboard/xp.html",
};
navigateTo(dashMap[workflow] ?? "../dashboard/scrum.html");
```

with:

```js
const result = await apiCreateProject({ name, workflow, members: [...members], created_by });
const project = result?.project ?? { name, workflow };
setCurrentProject({
  project_id: project.project_id,
  name: project.name ?? name,
  workflow: project.workflow ?? workflow,
});
navigateTo(dashboardPathFor(project.workflow ?? workflow));
```

- [ ] **Step 3: Add the pending-invites renderer**

Append to `source/project-setup/script.js`:

```js
// ── Pending invitations ─────────────────────────────────
const invitesSection = document.getElementById("invites-section");
const invitesList = document.getElementById("invites-list");

/**
 * Join a project from a pending invite: add the current user as a member,
 * store the project, and navigate to its dashboard.
 * @param {{ project_id: number, project_name: string, workflow: string }} invite
 * @param {string} email
 * @returns {Promise<void>}
 */
async function joinProject(invite, email) {
  try {
    await apiAddMember(invite.project_id, email);
    setCurrentProject({
      project_id: invite.project_id,
      name: invite.project_name,
      workflow: invite.workflow,
    });
    navigateTo(dashboardPathFor(invite.workflow));
  } catch (err) {
    showBanner(banner, err.message || "Could not join the project. Please try again.");
  }
}

/**
 * Fetch and render the signed-in user's pending invitations, if any.
 * No-op when there is no current user or no invites.
 * @returns {Promise<void>}
 */
async function loadInvites() {
  const user = getCurrentUser();
  if (!user?.email || !invitesSection || !invitesList) return;
  let invites = [];
  try {
    ({ invites = [] } = await apiGetInvites(user.email));
  } catch (err) {
    console.warn("[project-setup] invite lookup failed", err);
    return;
  }
  if (invites.length === 0) return;

  invitesList.innerHTML = "";
  for (const invite of invites) {
    const li = document.createElement("li");
    li.className = "invite-item";

    const span = document.createElement("span");
    span.className = "invite-item-name";
    span.textContent = invite.project_name;

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn-add-member";
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => joinProject(invite, user.email));

    li.appendChild(span);
    li.appendChild(joinBtn);
    invitesList.appendChild(li);
  }
  invitesSection.hidden = false;
}

loadInvites();
```

- [ ] **Step 4: Add minimal styles**

Append to `source/project-setup/style.css`:

```css
/* Pending invitations */
.invites-section {
  margin-bottom: 1.5rem;
}
.invites-title {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.invites-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.invite-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
}
.invites-divider {
  text-align: center;
  color: var(--text-muted, #64748b);
  font-size: 0.85rem;
  margin: 1rem 0 0;
}
```

- [ ] **Step 5: Write the e2e spec**

Create `e2e/project-invites.spec.js`:

```js
import { test, expect } from "@playwright/test";

const SETUP_URL = "/project-setup/";

/**
 * Seed a current user in sessionStorage before the page's module runs.
 * @param {import('@playwright/test').Page} page
 */
async function seedUser(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sitrep_user",
      JSON.stringify({ user_id: 9, email: "ghost@x.com", full_name: "Ghost" })
    );
  });
}

test.describe("Onboarding pending invites", () => {
  test("shows pending invitations and joins on click", async ({ page }) => {
    await seedUser(page);
    await page.route("**/api/invites**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invites: [
            { invite_id: 1, project_id: 3, project_name: "Research Spike", workflow: "xp" },
          ],
        }),
      })
    );
    await page.route("**/api/projects/3/members", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ status: "added", member: { user_id: 9 } }),
      })
    );

    await page.goto(SETUP_URL);
    await expect(page.locator("#invites-section")).toBeVisible();
    await expect(page.locator("#invites-list")).toContainText("Research Spike");

    await page.getByRole("button", { name: "Join" }).click();
    await expect(page).toHaveURL(/\/xp/);
  });

  test("hides the invites section when there are none", async ({ page }) => {
    await seedUser(page);
    await page.route("**/api/invites**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invites: [] }),
      })
    );
    await page.goto(SETUP_URL);
    await expect(page.locator("#invites-section")).toBeHidden();
  });
});
```

- [ ] **Step 6: Build + run the e2e spec**

Run: `npm run build && npx playwright test e2e/project-invites.spec.js`
Expected: PASS (both tests). Also re-run the existing onboarding spec: `npx playwright test e2e/project-setup.spec.js` — Expected: PASS (the success mock returns `project_id`, so `setCurrentProject` + redirect still work).

- [ ] **Step 7: Format, lint**

Run: `npm run format && npm run lint`
Expected: pass.

- [ ] **Step 8: Commit**

Commit message:

```
feat(client): onboarding stores project_id + shows pending invites

project-setup now persists the real project_id via setCurrentProject and
renders a "You've been invited" section (GET /api/invites) with Join
buttons that add the user (POST members) and open the project's dashboard.
Adds e2e coverage.
```

**PAUSE for user to commit.**

---

## Task 9: Dashboards + check-in read the active project

**Files:**

- Modify: `source/dashboard/main.js`, `source/dashboard/scrum.js`, `source/check-in/check-in.js`, `source/dashboard/kanban.js`

- [ ] **Step 1: main.js**

In `source/dashboard/main.js`: add `getCurrentProject` to the `../shared/utils.js` import, and replace `const PROJECT_ID = 1;` with:

```js
const PROJECT_ID = getCurrentProject()?.project_id ?? 1;
```

- [ ] **Step 2: scrum.js**

In `source/dashboard/scrum.js`: add `getCurrentProject` to its `../shared/utils.js` import, and replace `export const PROJECT_ID = 1;` with:

```js
export const PROJECT_ID = getCurrentProject()?.project_id ?? 1;
```

- [ ] **Step 3: check-in.js**

In `source/check-in/check-in.js`: add `getCurrentProject` to its `../shared/utils.js` import, and replace `export const PROJECT_ID = 1;` with:

```js
export const PROJECT_ID = getCurrentProject()?.project_id ?? 1;
```

- [ ] **Step 4: kanban.js (dead code, kept consistent)**

In `source/dashboard/kanban.js`: add `getCurrentProject` to its `../shared/utils.js` import and replace `export const PROJECT_ID = 1;` with the same `getCurrentProject()?.project_id ?? 1`. (No HTML loads kanban.js today, but keep it correct.)

- [ ] **Step 5: Run unit tests (PROJECT_ID fallback must hold)**

Run: `npx vitest run source/src/tests/scrum.test.js source/src/tests/checkin.test.js`
Expected: PASS — under Node `getCurrentProject()` returns null, so `?? 1` yields `1` and the `typeof === "number"` / `> 0` assertions hold.

- [ ] **Step 6: Build + smoke the full e2e + unit suites**

Run: `npm run build && npm run test:ci && npm run lint`
Expected: pass.

- [ ] **Step 7: Commit**

Commit message:

```
feat(client): scope dashboards + check-in to the active project

Replace hard-coded PROJECT_ID = 1 with getCurrentProject()?.project_id ?? 1
in main, scrum, kanban, and check-in. The ?? 1 fallback keeps Node unit
tests green and is a safe default.
```

**PAUSE for user to commit.**

---

## Task 10: Remove the blank assignee option (client)

**Files:**

- Modify: `source/task-form/task-form.js`
- Modify: `source/dashboard/main.js` (`buildAssigneeOptions`)
- Modify: `source/dashboard/scrum.js` (its create-task modal's assignee select)
- Test: `source/src/tests/project-context.test.js` extended OR a new pure-helper test (see Step 1)

- [ ] **Step 1: Add and test a pure default-assignee helper in utils.js**

Append to `source/shared/utils.js`:

```js
/**
 * Pick the default assignee id for a new task: the current user when they
 * are a project member, otherwise the first member, otherwise null.
 * @param {Array<{ user_id: number }>} members
 * @param {{ user_id: number }|null} currentUser
 * @returns {number|null}
 */
export function defaultAssigneeId(members, currentUser) {
  if (!Array.isArray(members) || members.length === 0) return null;
  if (currentUser && members.some((m) => Number(m.user_id) === Number(currentUser.user_id))) {
    return Number(currentUser.user_id);
  }
  return Number(members[0].user_id);
}
```

Add to `source/src/tests/project-context.test.js`:

```js
import { defaultAssigneeId } from "../../shared/utils.js";

describe("defaultAssigneeId", () => {
  const members = [{ user_id: 1 }, { user_id: 2 }];
  it("prefers the current user when a member", () => {
    expect(defaultAssigneeId(members, { user_id: 2 })).toBe(2);
  });
  it("falls back to the first member otherwise", () => {
    expect(defaultAssigneeId(members, { user_id: 99 })).toBe(1);
  });
  it("returns null when there are no members", () => {
    expect(defaultAssigneeId([], { user_id: 1 })).toBeNull();
  });
});
```

Run: `npx vitest run source/src/tests/project-context.test.js`
Expected: FAIL first (helper missing), then PASS after the helper is added.

- [ ] **Step 2: task-form.js — imports + gate self-init**

In `source/task-form/task-form.js`, add at the very top:

```js
import { getCurrentUser, defaultAssigneeId } from "../shared/utils.js";
```

Wrap the self-init block at the bottom so it can be imported under Node:

```js
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    // ...existing body unchanged...
  });
}
```

- [ ] **Step 3: task-form.js — remove blank option + default selection**

Remove these lines that create the blank option:

```js
const unassignedOpt = document.createElement("option");
unassignedOpt.value = "";
unassignedOpt.textContent = "Unassigned";
assigneeSelect.appendChild(unassignedOpt);
```

After the members loop that appends options, set the default selection:

```js
const defaultId = defaultAssigneeId(members, getCurrentUser());
if (defaultId != null) assigneeSelect.value = String(defaultId);
```

- [ ] **Step 4: task-form.js — submit guard + error element**

Where the reviewer error element is created, add a sibling assignee error under the assignee field. After `assigneeField.appendChild(assigneeSelect);` add:

```js
const assigneeError = document.createElement("p");
assigneeError.className = "tf-error";
assigneeError.hidden = true;
assigneeError.textContent = "Please select an assignee.";
assigneeField.appendChild(assigneeError);
```

In `submit()`, before computing `isAgent`, add:

```js
if (!assigneeSelect.value) {
  assigneeError.hidden = false;
  assigneeSelect.focus();
  return;
}
assigneeError.hidden = true;
```

- [ ] **Step 5: main.js — buildAssigneeOptions drops the blank option**

In `source/dashboard/main.js`, replace the body of `buildAssigneeOptions` so it no longer emits the `Unassigned` option:

```js
function buildAssigneeOptions(selectedUserId) {
  return projectMembers
    .map(
      (m) =>
        `<option value="${m.user_id}"${m.user_id === selectedUserId ? " selected" : ""}>${m.full_name}</option>`
    )
    .join("");
}
```

And in `populateCreateFormAssignees`, default to the first member when none is pre-selected:

```js
function populateCreateFormAssignees() {
  const sel = document.getElementById("new-task-assignee");
  if (!sel) return;
  sel.innerHTML = buildAssigneeOptions(projectMembers[0]?.user_id ?? null);
}
```

- [ ] **Step 6: scrum.js — drop the blank option in its create-task modal**

In `source/dashboard/scrum.js`, find the create-task modal's assignee `<select>` construction (search for `Unassigned`). Remove the blank/unassigned `<option>` and default the select to the first member after options are appended (mirror Step 3's approach using the modal's local members list). If scrum.js builds options as an HTML string, drop the `<option value="">…</option>` entry; if it builds DOM nodes, remove the unassigned node and set `.value` to the first member id.

- [ ] **Step 7: Run unit + build + e2e**

Run: `npx vitest run source/src/tests/project-context.test.js && npm run build && npm run test:ci`
Expected: pass.

- [ ] **Step 8: Manual check**

Run: `npm run dev:pages` (or open the built dashboard), open "New task": the assignee select shows real members only (no "Unassigned"), defaults to you, and submitting with members present always carries an assignee. Stop the server when done.

- [ ] **Step 9: Format, lint**

Run: `npm run format && npm run lint`
Expected: pass.

- [ ] **Step 10: Commit**

Commit message:

```
feat(client): remove blank assignee option; default to a real member

task-form and the dashboard create-form drop the "Unassigned" option,
default to the current user (else first member), and block submit with
"Please select an assignee." Adds a tested defaultAssigneeId helper and
gates task-form self-init for Node imports.
```

**PAUSE for user to commit.**

---

## Task 11: Team view — roster + pending + add-member (shared)

**Files:**

- Create: `source/shared/team-panel.js`
- Test: `source/src/tests/team-panel.test.js`
- Modify: `source/dashboard/main.js` (`switchView`), `source/dashboard/scrum.js` (`switchView`)
- Modify: `source/shared/components.css` (panel styles)

- [ ] **Step 1: Write the failing test**

Create `source/src/tests/team-panel.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildTeamPanelHtml } from "../../shared/team-panel.js";

describe("buildTeamPanelHtml", () => {
  it("renders members with name and email", () => {
    const html = buildTeamPanelHtml({
      members: [{ user_id: 1, full_name: "Alex Rivera", email: "a@x.com", role: "Lead" }],
      pending_invites: [],
    });
    expect(html).toContain("Alex Rivera");
    expect(html).toContain("a@x.com");
  });

  it("tags pending invites", () => {
    const html = buildTeamPanelHtml({
      members: [],
      pending_invites: [{ email: "ghost@x.com" }],
    });
    expect(html).toContain("ghost@x.com");
    expect(html).toMatch(/Pending/i);
  });

  it("escapes HTML in names", () => {
    const html = buildTeamPanelHtml({
      members: [{ user_id: 1, full_name: "<script>", email: "a@x.com" }],
      pending_invites: [],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run source/src/tests/team-panel.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `source/shared/team-panel.js`:

```js
import { apiFetch, apiAddMember } from "./utils.js";

/**
 * Escape the five HTML metacharacters for safe interpolation.
 * @param {unknown} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Up to two uppercase initials from a display name.
 * @param {string} name
 * @returns {string}
 */
function initials(name) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Build the Team panel markup: a member roster, pending invites, and an
 * add-member form. Pure (no DOM access) so it is unit-testable.
 * @param {{ members: object[], pending_invites: object[] }} data
 * @returns {string} HTML string
 */
export function buildTeamPanelHtml({ members = [], pending_invites = [] } = {}) {
  const memberRows = members
    .map(
      (m) => `
      <li class="team-member">
        <div class="avatar team-avatar">${esc(initials(m.full_name))}</div>
        <div class="team-member-info">
          <p class="team-member-name">${esc(m.full_name)}</p>
          <p class="team-member-meta">${esc(m.email ?? "")}${m.role ? " · " + esc(m.role) : ""}</p>
        </div>
      </li>`
    )
    .join("");

  const pendingRows = pending_invites
    .map(
      (i) => `
      <li class="team-member team-member--pending">
        <div class="avatar team-avatar team-avatar--pending">?</div>
        <div class="team-member-info">
          <p class="team-member-name">${esc(i.email)}</p>
          <p class="team-member-meta">Pending</p>
        </div>
      </li>`
    )
    .join("");

  return `
    <div class="team-panel">
      <h2 class="team-panel-title">Team members</h2>
      <ul class="team-list">${memberRows || `<li class="team-empty">No members yet.</li>`}${pendingRows}</ul>
      <form class="team-add" id="team-add-form">
        <input type="email" id="team-add-email" class="team-add-input"
               placeholder="teammate@example.com" autocomplete="off" />
        <button type="submit" class="btn-add-member">Add member</button>
        <p class="team-add-status" id="team-add-status" aria-live="polite"></p>
      </form>
    </div>`;
}

/**
 * Fetch members + pending invites for a project and render the Team panel
 * into `container`, wiring the add-member form to POST and re-render.
 * @param {HTMLElement} container
 * @param {{ projectId: number|string }} opts
 * @returns {Promise<void>}
 */
export async function renderTeamPanel(container, { projectId }) {
  if (!container) return;
  let data = { members: [], pending_invites: [] };
  try {
    data = await apiFetch(`/api/projects/${projectId}/members`);
  } catch (err) {
    container.innerHTML = `<p class="team-empty">Failed to load team: ${esc(err.message)}</p>`;
    return;
  }
  container.innerHTML = buildTeamPanelHtml(data);

  const form = container.querySelector("#team-add-form");
  const input = container.querySelector("#team-add-email");
  const status = container.querySelector("#team-add-status");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    try {
      const res = await apiAddMember(projectId, email);
      status.textContent =
        res.status === "pending"
          ? "Invited — they'll join once they sign up."
          : res.status === "already_member"
            ? "Already a member."
            : "Member added.";
      await renderTeamPanel(container, { projectId });
    } catch (err) {
      status.textContent = err.message || "Could not add member.";
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run source/src/tests/team-panel.test.js`
Expected: PASS.

- [ ] **Step 5: Mount in main.js `switchView`**

In `source/dashboard/main.js`: add `import { renderTeamPanel } from "../shared/team-panel.js";` at the top. In `switchView`, after the view element is shown, mount the panel when the Team tab is selected:

```js
if (label === "Team") {
  renderTeamPanel(view, { projectId: PROJECT_ID });
}
```

(Place this just before the final `view.classList.remove("hidden");` so `view` exists, then keep the unhide line.)

- [ ] **Step 6: Mount in scrum.js `switchView`**

In `source/dashboard/scrum.js`: add the same import. In its `switchView(navSlug, label)`, when `navSlug === "team"`, after resolving/creating the `team-view` element, call:

```js
renderTeamPanel(view, { projectId: PROJECT_ID });
```

(Match scrum.js's existing variable name for the resolved view element.)

- [ ] **Step 7: Add styles**

Append to `source/shared/components.css`:

```css
/* Team panel */
.team-panel {
  max-width: 640px;
}
.team-panel-title {
  font-size: 1.1rem;
  margin: 0 0 1rem;
}
.team-list {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.team-member {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
}
.team-member--pending {
  opacity: 0.7;
}
.team-avatar {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft, #e0e7ff);
  font-size: 0.8rem;
  font-weight: 600;
}
.team-avatar--pending {
  background: var(--border, #e2e8f0);
}
.team-member-name {
  margin: 0;
  font-weight: 600;
}
.team-member-meta {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
}
.team-empty {
  color: var(--text-muted, #64748b);
}
.team-add {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.team-add-input {
  flex: 1 1 220px;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
}
.team-add-status {
  flex-basis: 100%;
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted, #64748b);
}
```

- [ ] **Step 8: Build + manual check**

Run: `npm run build && npm run test:ci && npm run lint`
Expected: pass. Then `npm run dev:pages`, open a dashboard, click "Team": roster lists members; the seeded pending invite shows "Pending"; adding an existing-user email shows "Member added" and it appears; adding an unknown email shows the invited message and a "Pending" row. Stop the server.

- [ ] **Step 9: Format, lint**

Run: `npm run format && npm run lint`
Expected: pass.

- [ ] **Step 10: Commit**

Commit message:

```
feat(client): add shared Team view with roster + add-member

New team-panel.js (tested pure buildTeamPanelHtml + renderTeamPanel) shows
project members and pending invites and lets users add members; mounted in
the Team tab on main and scrum dashboards. Adds team-panel tests + styles.
```

**PAUSE for user to commit.**

---

## Task 12: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm run test:ci`
Expected: all Vitest tests pass.

- [ ] **Step 2: Build + full e2e**

Run: `npm run build && npm run test:e2e:ci`
Expected: all Playwright specs pass (`project-setup`, `project-invites`, `login`, `signup`, `navigation`, `check-in`).

- [ ] **Step 3: Lint + format check**

Run: `npm run lint && npm run format:check`
Expected: no issues.

- [ ] **Step 4: Acceptance-criteria walkthrough**

Confirm against `specs/adrs/manage-project-members.md` mapping table: members in assignee dropdowns (no blank), blank assignee blocked (client + server), members persist (DB), team data project-specific (active project), members shown in Team view, duplicates prevented, current user in footer, invites linked to the right project. Note any gap.

- [ ] **Step 5: Commit (only if Step 4 required a fix)**

Commit message (if needed):

```
test: verify project member management end-to-end

Final unit + e2e + lint pass and acceptance-criteria walkthrough.
```

**PAUSE for user.**

---

## Self-Review

**Spec coverage:** Every ADR requirement maps to a task — DB/invites (Task 1–4), blank-assignee server+client (Task 5, 10), project scoping (Task 6, 7, 9), onboarding invites + project_id (Task 8), Team view across dashboards (Task 11), duplicates (Task 1 UNIQUE + Task 3 INSERT OR IGNORE), current user footer (existing, confirmed in Task 12). No gaps found.

**Placeholders:** All steps contain complete, runnable code. Two steps require matching an existing in-file variable name (the code to insert is given verbatim): Task 10 Step 6 (scrum.js create-task modal's assignee select) and Task 11 Step 6 (scrum.js `switchView` resolved view element) — scrum.js is ~1100 lines, so these are search-and-edit, not new structure.

**Type consistency:** Helper names are stable across tasks — `getCurrentProject`/`setCurrentProject`/`dashboardPathFor`/`apiGetProjects`/`apiGetInvites`/`apiAddMember`/`defaultAssigneeId`/`buildTeamPanelHtml`/`renderTeamPanel`. Response shapes are consistent: `POST /api/projects` → `{ project, invited, pending }`; members POST → `{ status, member? }`; `GET members` → `{ members, pending_invites }`; `GET /api/invites` → `{ invites }`.
