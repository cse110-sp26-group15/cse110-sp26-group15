import { describe, it, expect, vi } from "vitest";
import { onRequestPost as postTask } from "../../../functions/api/projects/[projectId]/tasks.js";
import { onRequestPatch as patchTask } from "../../../functions/api/tasks/[taskId].js";

/**
 * Mock D1 that returns first() results in the order given. Same pattern
 * as agents.test.js — handlers issue several queries per request so we
 * need ordered responses.
 */
function createMockDb({ firstResults = [], runResults = [] } = {}) {
  let firstIdx = 0;
  let runIdx = 0;
  const bound = {
    first: vi.fn(async () => {
      const v = firstResults[firstIdx];
      firstIdx += 1;
      return v ?? null;
    }),
    run: vi.fn(async () => {
      const v = runResults[runIdx];
      runIdx += 1;
      return v ?? { meta: { last_row_id: 99 } };
    }),
    all: vi.fn(async () => ({ results: [] })),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

function ctx({ projectId = "1", taskId = "1", body, userId = 1 } = {}, db) {
  return {
    env: { DB: db },
    params: { projectId, taskId },
    // PATCH /tasks/:taskId resolves the task → its project and checks
    // membership; the middleware would normally set context.data.userId. The
    // mocks below add project_id to the existing-task row and a truthy
    // membership row so an authenticated caller passes the guard.
    data: { userId },
    request: new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

// classifyUser issues one .first() per user check. The order in
// projects/[projectId]/tasks.js POST is: assignee lookup → (if agent
// and no reviewer) defaulted; reviewer lookup (if either supplied or
// defaulted) → final SELECT for the response.

describe("POST /projects/:projectId/tasks reviewer enforcement", () => {
  it("rejects when assignee is an agent and reviewer cannot be resolved", async () => {
    // classifyUser(assignee=6) → returns agent row with owner_user_id=null
    // (no owner — pretend it was wiped). Reviewer can't be defaulted →
    // the handler should 400.
    const db = createMockDb({
      firstResults: [
        { user_id: 6, agent_user_id: 6, owner_user_id: null }, // assignee classify → agent but owner missing
        { ok: 1 }, // assignee containment check (member of project)
      ],
    });
    const res = await postTask(ctx({ body: { title: "x", assigned_to: 6 } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/reviewer_id is required/);
  });

  it("auto-defaults reviewer to the agent's owner when omitted", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 6, agent_user_id: 6, owner_user_id: 1 }, // assignee = agent owned by user 1
        { ok: 1 }, // assignee containment check
        { user_id: 1, agent_user_id: null, owner_user_id: null }, // reviewer classify → human (no agent row)
        {
          // post-insert SELECT
          task_id: 123,
          title: "x",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: 1,
          review_status: "pending",
          user_id: 6,
          full_name: "SitRep-Bot-v1",
          is_agent: 1,
          reviewer_name: "Alex Rivera",
        },
      ],
      runResults: [{ meta: { last_row_id: 123 } }],
    });
    const res = await postTask(ctx({ body: { title: "x", assigned_to: 6 } }, db));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.task.reviewer_id).toBe(1);
    expect(data.task.review_status).toBe("pending");
  });

  it("rejects reviewer_id that points at another agent", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 6, agent_user_id: 6, owner_user_id: 1 }, // assignee = agent
        { user_id: 7, agent_user_id: 7, owner_user_id: 4 }, // reviewer = also an agent (has owner)
      ],
    });
    const res = await postTask(ctx({ body: { title: "x", assigned_to: 6, reviewer_id: 7 } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/non-agent/);
  });

  it("rejects review_status not in the whitelist", async () => {
    const db = createMockDb();
    const res = await postTask(
      ctx({ body: { title: "x", review_status: "rejected-with-prejudice" } }, db)
    );
    expect(res.status).toBe(400);
  });

  it("non-agent assignee with no reviewer creates fine (review_status='not-required')", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 1, agent_user_id: null, owner_user_id: null }, // assignee = human
        { ok: 1 }, // assignee containment check
        {
          task_id: 200,
          title: "human task",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: null,
          review_status: "not-required",
          user_id: 1,
          full_name: "Alex",
          is_agent: 0,
          reviewer_name: null,
        },
      ],
      runResults: [{ meta: { last_row_id: 200 } }],
    });
    const res = await postTask(ctx({ body: { title: "human task", assigned_to: 1 } }, db));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.task.review_status).toBe("not-required");
    expect(data.task.reviewer_id).toBeNull();
  });
});

describe("PATCH /tasks/:taskId reviewer enforcement", () => {
  it("requires a reviewer when reassigning to an agent", async () => {
    const db = createMockDb({
      firstResults: [
        // existing task — currently human-assigned, no reviewer
        {
          task_id: 5,
          project_id: 1,
          assigned_to: 1,
          reviewer_id: null,
          review_status: "not-required",
        },
        // membership check (caller is a member of the task's project)
        { ok: 1 },
        // new assignee classify → agent with NULL owner_user_id
        { user_id: 6, agent_user_id: 6, owner_user_id: null },
        { ok: 1 }, // assignee containment check
      ],
    });
    const res = await patchTask(ctx({ body: { assigned_to: 6 } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/reviewer_id is required/);
  });

  it("promotes review_status from 'not-required' to 'pending' when reassigned to agent", async () => {
    const db = createMockDb({
      firstResults: [
        {
          task_id: 5,
          project_id: 1,
          assigned_to: 1,
          reviewer_id: null,
          review_status: "not-required",
        }, // existing
        { ok: 1 }, // membership check
        { user_id: 6, agent_user_id: 6, owner_user_id: 1 }, // assignee classify → agent
        { ok: 1 }, // assignee containment check
        { user_id: 1, agent_user_id: null, owner_user_id: null }, // reviewer classify → human
        {
          task_id: 5,
          title: "x",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: 1,
          review_status: "pending",
          user_id: 6,
          full_name: "Bot",
          is_agent: 1,
          reviewer_name: "Alex",
        },
      ],
    });
    const res = await patchTask(ctx({ body: { assigned_to: 6 } }, db));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.review_status).toBe("pending");
    expect(data.task.reviewer_id).toBe(1);
  });

  it("returns 404 when the task does not exist", async () => {
    const db = createMockDb({ firstResults: [null] });
    const res = await patchTask(ctx({ body: { status: "done" } }, db));
    expect(res.status).toBe(404);
  });

  it("rejects review_status outside whitelist", async () => {
    const db = createMockDb();
    const res = await patchTask(ctx({ body: { review_status: "wat" } }, db));
    expect(res.status).toBe(400);
  });
});
