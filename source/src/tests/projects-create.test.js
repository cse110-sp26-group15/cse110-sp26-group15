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
