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
        {
          task_id: 1,
          assigned_to: 2,
          reviewer_id: null,
          review_status: "not-required",
        },
      ],
    });
    const res = await patchTask(ctx({ body: { assigned_to: null } }, db));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/assigned to a project member/);
  });
});
