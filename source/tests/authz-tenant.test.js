/**
 * Tenant isolation: every protected object, both directions.
 *
 * These run against a real SQLite database with the real migrations applied
 * (source/tests/helpers/d1-harness.js) and drive requests through the same
 * middleware chain Cloudflare Pages does, because an ordered mock D1 cannot
 * distinguish "the guard let the caller through" from "the mock returned the
 * row the test queued".
 *
 * Fixtures: two identities that share nothing.
 *   alice   - creator and member of project A, with a task, check-in,
 *             blocker, sprint and agent inside it.
 *   mallory - creator and member of project M only. Every request mallory
 *             makes against A's objects must be refused.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { callApi, freshDb, seedProject, seedTask, seedUser } from "./helpers/d1-harness.js";

// `it.each` builds its table at collection time, before beforeEach runs, so the
// request paths cannot close over ids assigned in beforeEach. The harness starts
// from an empty database with AUTOINCREMENT keys, so the seed order fixes every
// id - these constants are asserted against the real inserts in beforeEach, and
// the suite fails loudly if the seeding order ever changes.
const ALICE = 1;
const MALLORY = 2;
const AGENT_A = 3;
const PROJECT_A = 1;
const PROJECT_M = 2;
const TASK_A = 1;
const CHECKIN_A = 1;
const BLOCKER_A = 1;
const SPRINT_A = 1;

let env;
let alice;
let mallory;

beforeEach(() => {
  env = freshDb();
  alice = seedUser(env, { email: "alice@example.com", name: "Alice" });
  mallory = seedUser(env, { email: "mallory@example.com", name: "Mallory" });

  // Agent user is seeded before the projects so AGENT_A === 3 holds.
  const agentUser = seedUser(env, { email: "agent-a@example.com", name: "Agent A" });

  const projectA = seedProject(env, { name: "Alice Project", ownerId: alice.userId });
  const projectM = seedProject(env, { name: "Mallory Project", ownerId: mallory.userId });

  const taskA = seedTask(env, {
    projectId: projectA,
    title: "Alice secret task",
    assignedTo: alice.userId,
  });

  const checkinA = Number(
    env.raw
      .prepare(
        "INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned) VALUES (?, ?, 'ok', 'a', 'b')"
      )
      .run(alice.userId, projectA).lastInsertRowid
  );
  const blockerA = Number(
    env.raw
      .prepare(
        "INSERT INTO blockers (checkin_id, description, task) VALUES (?, 'alice blocker', 'T')"
      )
      .run(checkinA).lastInsertRowid
  );
  const sprintA = Number(
    env.raw
      .prepare(
        "INSERT INTO sprints (project_id, number, start_date, end_date, goal) VALUES (?, 1, date('now'), date('now','+14 days'), 'ship it')"
      )
      .run(projectA).lastInsertRowid
  );

  // An AI agent that is a member of project A (agents are users + a row in agents).
  env.raw
    .prepare("INSERT INTO agents (user_id, agent_type, owner_user_id) VALUES (?, 'general', ?)")
    .run(agentUser.userId, alice.userId);
  env.raw
    .prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)")
    .run(projectA, agentUser.userId);

  // Fail loudly if the seed order drifts away from the constants above.
  expect([alice.userId, mallory.userId, agentUser.userId]).toEqual([ALICE, MALLORY, AGENT_A]);
  expect([projectA, projectM, taskA, checkinA, blockerA, sprintA]).toEqual([
    PROJECT_A,
    PROJECT_M,
    TASK_A,
    CHECKIN_A,
    BLOCKER_A,
    SPRINT_A,
  ]);
});

/** Status codes that mean "the request was refused". */
const DENIED = [401, 403, 404];

/**
 * Every request mallory can aim at project A's objects.
 * `expectAllowed` marks the caller's own project as a control.
 * @returns {Array<{ name: string, req: object }>}
 */
function crossTenantRequests() {
  return [
    { name: "GET project record", req: { path: `/api/projects/${PROJECT_A}` } },
    { name: "DELETE project", req: { method: "DELETE", path: `/api/projects/${PROJECT_A}` } },
    { name: "GET members", req: { path: `/api/projects/${PROJECT_A}/members` } },
    {
      name: "POST members (self-join)",
      req: {
        method: "POST",
        path: `/api/projects/${PROJECT_A}/members`,
        body: { email: "mallory@example.com" },
      },
    },
    { name: "GET tasks", req: { path: `/api/projects/${PROJECT_A}/tasks` } },
    {
      name: "POST task",
      req: {
        method: "POST",
        path: `/api/projects/${PROJECT_A}/tasks`,
        body: { title: "injected" },
      },
    },
    { name: "GET dashboard", req: { path: `/api/projects/${PROJECT_A}/dashboard` } },
    { name: "GET checkins", req: { path: `/api/projects/${PROJECT_A}/checkins` } },
    {
      name: "POST checkin",
      req: {
        method: "POST",
        path: `/api/projects/${PROJECT_A}/checkins`,
        body: { user_id: 1, status_mood: "x", work_done: "y", work_planned: "z" },
      },
    },
    { name: "GET blockers", req: { path: `/api/projects/${PROJECT_A}/blockers` } },
    { name: "GET agents", req: { path: `/api/projects/${PROJECT_A}/agents` } },
    { name: "GET sprints", req: { path: `/api/projects/${PROJECT_A}/sprints` } },
    { name: "GET current sprint", req: { path: `/api/projects/${PROJECT_A}/sprints/current` } },
    {
      name: "PATCH sprint",
      req: {
        method: "PATCH",
        path: `/api/projects/${PROJECT_A}/sprints/${SPRINT_A}`,
        body: { goal: "pwned" },
      },
    },
    { name: "GET weekly-report", req: { path: `/api/projects/${PROJECT_A}/weekly-report` } },
    { name: "GET pairs", req: { path: `/api/projects/${PROJECT_A}/pairs` } },
    {
      name: "PATCH task",
      req: { method: "PATCH", path: `/api/tasks/${TASK_A}`, body: { title: "pwned" } },
    },
    { name: "DELETE task", req: { method: "DELETE", path: `/api/tasks/${TASK_A}` } },
    {
      name: "PATCH blocker",
      req: { method: "PATCH", path: `/api/blockers/${BLOCKER_A}`, body: { is_resolved: true } },
    },
    { name: "DELETE blocker", req: { method: "DELETE", path: `/api/blockers/${BLOCKER_A}` } },
    { name: "DELETE checkin", req: { method: "DELETE", path: `/api/checkins/${CHECKIN_A}` } },
    { name: "GET agent", req: { path: `/api/agents/${AGENT_A}` } },
    {
      name: "PATCH agent",
      req: { method: "PATCH", path: `/api/agents/${AGENT_A}`, body: { description: "pwned" } },
    },
  ];
}

describe("C05 - cross-tenant access is refused on every protected object", () => {
  it.each(crossTenantRequests().map((c) => [c.name, c.req]))(
    "mallory cannot %s in alice's project",
    async (_name, req) => {
      const res = await callApi(env, { ...req, token: mallory.token });
      expect(DENIED, `got ${res.status}: ${await res.clone().text()}`).toContain(res.status);
    }
  );
});

describe("C05 - an unauthenticated caller is refused on every protected object", () => {
  it.each(crossTenantRequests().map((c) => [c.name, c.req]))(
    "anonymous cannot %s",
    async (_name, req) => {
      const res = await callApi(env, { ...req, token: null });
      expect(DENIED, `got ${res.status}: ${await res.clone().text()}`).toContain(res.status);
    }
  );
});

describe("C05 - positive control: the legitimate member is not broken", () => {
  it("alice can read her own project", async () => {
    const res = await callApi(env, { path: `/api/projects/${PROJECT_A}`, token: alice.token });
    expect(res.status).toBe(200);
    const { project } = await res.json();
    expect(project.name).toBe("Alice Project");
  });

  it("alice can list and patch her own task", async () => {
    const list = await callApi(env, {
      path: `/api/projects/${PROJECT_A}/tasks`,
      token: alice.token,
    });
    expect(list.status).toBe(200);

    const patch = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${TASK_A}`,
      token: alice.token,
      body: { status: "in-progress" },
    });
    expect(patch.status).toBe(200);
    const { task } = await patch.json();
    expect(task.status).toBe("in-progress");
  });

  it("GET /api/projects lists only the caller's projects", async () => {
    const res = await callApi(env, { path: "/api/projects", token: mallory.token });
    const { projects } = await res.json();
    expect(projects.map((p) => p.project_id)).toEqual([PROJECT_M]);
  });

  it("alice can invite a teammate to her own project", async () => {
    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${PROJECT_A}/members`,
      token: alice.token,
      body: { email: "newbie@example.com" },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("pending");
  });
});

describe("C05 - cross-project data does not leak through the cross-project routes", () => {
  it("GET /api/blockers returns only blockers from the caller's projects", async () => {
    const res = await callApi(env, { path: "/api/blockers?general=true", token: mallory.token });
    expect(res.status).toBe(200);
    const { blockers } = await res.json();
    expect(blockers).toEqual([]);
  });

  it("GET /api/invites returns only the caller's own invites", async () => {
    env.raw
      .prepare("INSERT INTO project_invites (project_id, email) VALUES (?, ?)")
      .run(PROJECT_A, "alice@example.com");
    const res = await callApi(env, { path: "/api/invites", token: mallory.token });
    expect((await res.json()).invites).toEqual([]);
  });
});

describe("C05 - invite redemption is the only non-member path into a project", () => {
  /** Give mallory a pending invite to project A. */
  function inviteMallory() {
    env.raw
      .prepare("INSERT INTO project_invites (project_id, email) VALUES (?, ?)")
      .run(PROJECT_A, "mallory@example.com");
  }

  it("an invited user can redeem their own invite and becomes a member", async () => {
    inviteMallory();
    const join = await callApi(env, {
      method: "POST",
      path: `/api/projects/${PROJECT_A}/members`,
      token: mallory.token,
      body: { email: "mallory@example.com" },
    });
    expect(join.status).toBe(201);
    expect((await join.json()).status).toBe("added");

    // …and the membership is real: the next protected action now succeeds.
    const after = await callApi(env, {
      path: `/api/projects/${PROJECT_A}/tasks`,
      token: mallory.token,
    });
    expect(after.status).toBe(200);
  });

  it("an invited user cannot redeem an invite addressed to someone else", async () => {
    env.raw
      .prepare("INSERT INTO project_invites (project_id, email) VALUES (?, ?)")
      .run(PROJECT_A, "someone-else@example.com");
    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${PROJECT_A}/members`,
      token: mallory.token,
      body: { email: "someone-else@example.com" },
    });
    expect(res.status).toBe(403);
  });

  it("an invite to one project does not authorize joining another", async () => {
    env.raw
      .prepare("INSERT INTO project_invites (project_id, email) VALUES (?, ?)")
      .run(PROJECT_M, "mallory@example.com");
    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${PROJECT_A}/members`,
      token: mallory.token,
      body: { email: "mallory@example.com" },
    });
    expect(res.status).toBe(403);
  });
});

describe("C05 - membership removal takes effect on the next protected action", () => {
  /**
   * Put mallory in project A, then take her out again. There is no member
   * removal endpoint in the API today (see RECORD), so removal is modelled the
   * only way it can currently happen: a direct delete from project_members.
   * Her session row is deliberately left intact - the point of the test is
   * that a still-valid session confers nothing once membership is gone.
   */
  function addMallory() {
    env.raw
      .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)")
      .run(PROJECT_A, MALLORY);
  }
  function removeMallory() {
    env.raw
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(PROJECT_A, MALLORY);
  }

  it("her session stays valid but every project route is refused", async () => {
    addMallory();
    expect(
      (await callApi(env, { path: `/api/projects/${PROJECT_A}/tasks`, token: mallory.token }))
        .status
    ).toBe(200);

    removeMallory();

    // The session itself is untouched - a route that only needs a login works.
    const stillLoggedIn = await callApi(env, { path: "/api/projects", token: mallory.token });
    expect(stillLoggedIn.status).toBe(200);

    // …but everything scoped to the project she was removed from is refused.
    for (const path of [
      `/api/projects/${PROJECT_A}`,
      `/api/projects/${PROJECT_A}/tasks`,
      `/api/projects/${PROJECT_A}/members`,
      `/api/projects/${PROJECT_A}/dashboard`,
      `/api/projects/${PROJECT_A}/checkins`,
    ]) {
      const res = await callApi(env, { path, token: mallory.token });
      expect(res.status, `${path} should be refused after removal`).toBe(403);
    }
  });

  it("an in-flight task mutation started before removal cannot land after it", async () => {
    addMallory();

    // Step 1: mallory loads the board and holds the task in client state.
    const read = await callApi(env, { path: `/api/tasks/${TASK_A}`, token: mallory.token });
    // (GET /api/tasks/:id is not a route; the board reads through the project
    // list, which she can do while she is a member.)
    expect([200, 405]).toContain(read.status);
    const before = env.raw.prepare("SELECT title, status FROM tasks WHERE task_id = ?").get(TASK_A);

    // Step 2: she is removed while the edit dialog is open.
    removeMallory();

    // Step 3: the mutation she already had queued in the UI fires.
    const patch = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${TASK_A}`,
      token: mallory.token,
      body: { title: "landed after removal", status: "done" },
    });
    expect(patch.status).toBe(403);

    const del = await callApi(env, {
      method: "DELETE",
      path: `/api/tasks/${TASK_A}`,
      token: mallory.token,
    });
    expect(del.status).toBe(403);

    // The row is untouched: authorization is rechecked at the write, not cached
    // from whenever the client last loaded.
    const after = env.raw.prepare("SELECT title, status FROM tasks WHERE task_id = ?").get(TASK_A);
    expect({ ...after }).toEqual({ ...before });
  });

  it("a removed member cannot re-add themselves through the members route", async () => {
    addMallory();
    removeMallory();
    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${PROJECT_A}/members`,
      token: mallory.token,
      body: { email: "mallory@example.com" },
    });
    expect(res.status).toBe(403);
    const rows = env.raw
      .prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(PROJECT_A, MALLORY);
    expect(rows.n).toBe(0);
  });

  it("removal is enforced on the cross-project blocker feed too", async () => {
    addMallory();
    const before = await callApi(env, { path: "/api/blockers?general=true", token: mallory.token });
    expect((await before.json()).blockers).toHaveLength(1);

    removeMallory();

    const after = await callApi(env, { path: "/api/blockers?general=true", token: mallory.token });
    expect((await after.json()).blockers).toEqual([]);
  });
});

describe("C05 - the middleware skip list stays exactly one route", () => {
  it("only POST /members bypasses the membership guard", async () => {
    // Every other method on /members, and every other route in the subtree, must
    // still go through requireProjectMember. This is a regression fence: the
    // hole this suite closed was a route waved past the guard that then forgot
    // to authorize itself.
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const res = await callApi(env, {
        method,
        path: `/api/projects/${PROJECT_A}/members`,
        token: mallory.token,
        ...(method === "GET" ? {} : { body: {} }),
      });
      expect([403, 405], `${method} /members`).toContain(res.status);
    }
  });
});
