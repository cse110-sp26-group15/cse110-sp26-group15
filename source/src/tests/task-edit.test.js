import { describe, it, expect, vi } from "vitest";
import {
  onRequestPatch as patchTask,
  onRequestDelete as deleteTaskHandler,
} from "../../../functions/api/tasks/[taskId].js";
import { onRequestPost as postTask } from "../../../functions/api/projects/[projectId]/tasks.js";

/**
 * Mock D1 that returns first()/run() results in the order given. Mirrors the
 * pattern in task-reviewer.test.js — handlers issue several queries per
 * request, so we hand back ordered responses.
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
      return v ?? { meta: { changes: 1 } };
    }),
    all: vi.fn(async () => ({ results: [] })),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

function ctx({ taskId = "1", projectId = "1", body, userId = 1 } = {}, db) {
  return {
    env: { DB: db },
    params: { taskId, projectId },
    // The global middleware resolves the session cookie to context.data.userId;
    // the _auth guards read it and check project_members. Provide it so an
    // authenticated, project-member caller passes the guards.
    data: { userId },
    request: new Request("http://localhost/", {
      method: "PATCH",
      body: JSON.stringify(body ?? {}),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("PATCH /tasks/:taskId title editing", () => {
  it("updates the title on an unassigned task", async () => {
    const db = createMockDb({
      firstResults: [
        // existing task — unassigned, no reviewer
        {
          task_id: 5,
          project_id: 1,
          assigned_to: null,
          reviewer_id: null,
          review_status: "not-required",
        },
        { ok: 1 }, // requireProjectMember membership check
        // post-update SELECT
        {
          task_id: 5,
          title: "New Title",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: null,
          review_status: "not-required",
          user_id: null,
          full_name: null,
          is_agent: 0,
          reviewer_name: null,
        },
      ],
    });
    const res = await patchTask(ctx({ body: { title: "New Title" } }, db));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.title).toBe("New Title");
  });

  it("rejects an empty/whitespace title", async () => {
    const db = createMockDb();
    const res = await patchTask(ctx({ body: { title: "   " } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/title/);
  });
});

describe("task priority (urgency)", () => {
  it("PATCH updates the priority", async () => {
    const db = createMockDb({
      firstResults: [
        // existing task — unassigned
        {
          task_id: 5,
          project_id: 1,
          assigned_to: null,
          reviewer_id: null,
          review_status: "not-required",
        },
        { ok: 1 }, // requireProjectMember membership check
        // post-update SELECT
        {
          task_id: 5,
          title: "x",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: null,
          review_status: "not-required",
          priority: "urgent",
          created_at: "2026-06-01 12:00:00",
          user_id: null,
          full_name: null,
          is_agent: 0,
          reviewer_name: null,
        },
      ],
    });
    const res = await patchTask(ctx({ body: { priority: "urgent" } }, db));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.priority).toBe("urgent");
  });

  it("PATCH rejects an invalid priority", async () => {
    const db = createMockDb();
    const res = await patchTask(ctx({ body: { priority: "super-urgent" } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/priority/);
  });

  it("POST rejects an invalid priority", async () => {
    const db = createMockDb();
    const res = await postTask(ctx({ body: { title: "x", priority: "meh" } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/priority/);
  });

  it("POST stores a valid priority", async () => {
    const db = createMockDb({
      firstResults: [
        // assignee classify → human (a task must be assigned to a member)
        { user_id: 1, agent_user_id: null, owner_user_id: null },
        { ok: 1 }, // assignee containment check (member of project)
        // post-insert SELECT
        {
          task_id: 10,
          title: "x",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: null,
          review_status: "not-required",
          priority: "high",
          created_at: "2026-06-05 00:00:00",
          user_id: 1,
          full_name: "Alex",
          is_agent: 0,
          reviewer_name: null,
        },
      ],
      runResults: [{ meta: { last_row_id: 10 } }],
    });
    const res = await postTask(ctx({ body: { title: "x", assigned_to: 1, priority: "high" } }, db));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.task.priority).toBe("high");
  });
});

describe("task pair assignee", () => {
  it("PATCH updates the pair_assignee", async () => {
    const db = createMockDb({
      firstResults: [
        // existing task
        {
          task_id: 5,
          project_id: 1,
          assigned_to: 2,
          reviewer_id: null,
          review_status: "not-required",
        },
        { ok: 1 }, // requireProjectMember membership check
        // assignee classify → human (assigned_to=2 unchanged, so classifyUser runs)
        { user_id: 2, agent_user_id: null, owner_user_id: null },
        { ok: 1 }, // requireReferencedMember (assignee contained in project)
        // post-update SELECT
        {
          task_id: 5,
          title: "x",
          description: null,
          status: "todo",
          github_issue_url: null,
          reviewer_id: null,
          review_status: "not-required",
          priority: "medium",
          created_at: "2026-06-01 12:00:00",
          pair_assignee: "Sam Chen",
          user_id: 2,
          full_name: "Jordan Smith",
          is_agent: 0,
          reviewer_name: null,
        },
      ],
    });
    const res = await patchTask(ctx({ body: { pair_assignee: "Sam Chen" } }, db));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task.pair_assignee).toBe("Sam Chen");
  });
});

describe("DELETE /tasks/:taskId", () => {
  it("deletes an existing task", async () => {
    const db = createMockDb({
      firstResults: [
        { task_id: 7, project_id: 1 }, // existing task lookup
        { ok: 1 }, // requireProjectMember membership check
      ],
    });
    const res = await deleteTaskHandler(ctx({ taskId: "7" }, db));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 404 when the task is missing", async () => {
    const db = createMockDb({ firstResults: [null] });
    const res = await deleteTaskHandler(ctx({ taskId: "999" }, db));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/not found/i);
  });
});
