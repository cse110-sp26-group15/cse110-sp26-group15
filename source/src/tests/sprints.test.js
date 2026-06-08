import { describe, it, expect, vi } from "vitest";
import {
  onRequestGet as listSprints,
  onRequestPost as createSprint,
} from "../../../functions/api/projects/[projectId]/sprints/index.js";
import { onRequestPatch as patchSprint } from "../../../functions/api/projects/[projectId]/sprints/[sprintId].js";

/**
 * Ordered-result mock D1. Same shape as the other handler tests in this dir.
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

function ctx({ projectId = "1", sprintId, body, db }) {
  const c = { env: { DB: db }, params: { projectId } };
  if (sprintId !== undefined) c.params.sprintId = sprintId;
  if (body !== undefined) {
    c.request = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return c;
}

describe("GET /api/projects/:id/sprints", () => {
  it("returns the project's sprints ordered by number", async () => {
    const db = createMockDb({
      allResults: [
        {
          results: [
            { sprint_id: 1, number: 1, start_date: "2026-01-01", end_date: "2026-01-14", goal: null },
            { sprint_id: 2, number: 2, start_date: "2026-01-15", end_date: "2026-01-28", goal: "Ship" },
          ],
        },
      ],
    });
    const res = await listSprints(ctx({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.sprints).toHaveLength(2);
    expect(data.sprints[0].number).toBe(1);
  });
});

describe("POST /api/projects/:id/sprints", () => {
  it("creates a sprint and echoes the new row", async () => {
    const db = createMockDb({
      runResults: [{ meta: { last_row_id: 7 } }],
      firstResults: [
        { sprint_id: 7, number: 3, start_date: "2026-02-01", end_date: "2026-02-14", goal: "Test" },
      ],
    });
    const res = await createSprint(
      ctx({
        db,
        body: { number: 3, start_date: "2026-02-01", end_date: "2026-02-14", goal: "Test" },
      })
    );
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.sprint.sprint_id).toBe(7);
    expect(data.sprint.number).toBe(3);
  });

  it("rejects a non-positive sprint number", async () => {
    const res = await createSprint(
      ctx({
        db: createMockDb(),
        body: { number: 0, start_date: "2026-02-01", end_date: "2026-02-14" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed dates", async () => {
    const res = await createSprint(
      ctx({
        db: createMockDb(),
        body: { number: 1, start_date: "2026/01/01", end_date: "2026-01-14" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an end_date before start_date", async () => {
    const res = await createSprint(
      ctx({
        db: createMockDb(),
        body: { number: 1, start_date: "2026-02-10", end_date: "2026-02-01" },
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/projects/:id/sprints/:sprintId", () => {
  it("updates the dates and returns the updated row", async () => {
    const db = createMockDb({
      firstResults: [
        // existence check
        { sprint_id: 5, project_id: 1, start_date: "2026-03-01", end_date: "2026-03-14" },
        // re-read after update
        { sprint_id: 5, number: 1, start_date: "2026-03-01", end_date: "2026-03-21", goal: null },
      ],
    });
    const res = await patchSprint(
      ctx({ db, sprintId: "5", body: { end_date: "2026-03-21" } })
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.sprint.end_date).toBe("2026-03-21");
  });

  it("404s when the sprint does not belong to the project", async () => {
    const db = createMockDb({
      firstResults: [{ sprint_id: 5, project_id: 99, start_date: "x", end_date: "y" }],
    });
    const res = await patchSprint(
      ctx({ db, sprintId: "5", body: { end_date: "2026-03-21" } })
    );
    expect(res.status).toBe(404);
  });

  it("rejects an update that flips end before start", async () => {
    const db = createMockDb({
      firstResults: [
        { sprint_id: 5, project_id: 1, start_date: "2026-03-10", end_date: "2026-03-14" },
      ],
    });
    const res = await patchSprint(
      ctx({ db, sprintId: "5", body: { end_date: "2026-03-05" } })
    );
    expect(res.status).toBe(400);
  });
});
