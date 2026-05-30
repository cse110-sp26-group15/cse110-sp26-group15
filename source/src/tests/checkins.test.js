import { describe, it, expect, vi } from "vitest";
import {
  onRequestGet,
  onRequestPost,
} from "../../../functions/api/projects/[projectId]/checkins.js";

function createMockDb({ allResult, firstResult, runResult } = {}) {
  const bound = {
    all: vi.fn(async () => allResult ?? { results: [] }),
    first: vi.fn(async () => firstResult ?? null),
    run: vi.fn(async () => runResult ?? { meta: { last_row_id: 1 } }),
  };
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })),
  };
}

function createContext({ projectId = "1", body, db } = {}) {
  const ctx = { env: { DB: db }, params: { projectId } };
  if (body !== undefined) {
    ctx.request = new Request("http://localhost/", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return ctx;
}

describe("GET /projects/:projectId/checkins", () => {
  it("returns checkins for the project", async () => {
    const rows = [
      {
        checkin_id: 1,
        status_mood: "Productive",
        work_done: "x",
        work_planned: "y",
        checkin_date: "2026-05-18",
        user_id: 1,
        full_name: "Alex Rivera",
      },
    ];
    const db = createMockDb({ allResult: { results: rows } });

    const res = await onRequestGet(createContext({ db }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ checkins: rows });
  });

  it("returns 500 when the DB throws", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => {
            throw new Error("boom");
          }),
        })),
      })),
    };

    const res = await onRequestGet(createContext({ db }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("boom");
  });
});

describe("POST /projects/:projectId/checkins", () => {
  it("creates a checkin and returns 201", async () => {
    const created = {
      checkin_id: 4,
      user_id: 1,
      project_id: 1,
      status_mood: "Focused",
      work_done: "wrote tests",
      work_planned: "ship them",
      checkin_date: "2026-05-18",
    };
    const db = createMockDb({
      runResult: { meta: { last_row_id: 4 } },
      firstResult: created,
    });

    const res = await onRequestPost(
      createContext({
        db,
        body: {
          user_id: 1,
          status_mood: "Focused",
          work_done: "wrote tests",
          work_planned: "ship them",
        },
      })
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data).toEqual({ checkin: created });
  });

  it("returns 400 when user_id is missing", async () => {
    const db = createMockDb();

    const res = await onRequestPost(createContext({ db, body: { work_done: "oops" } }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("user_id is required");
  });

  it("returns 400 on invalid JSON", async () => {
    const ctx = {
      env: { DB: createMockDb() },
      params: { projectId: "1" },
      request: new Request("http://localhost/", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
    };

    const res = await onRequestPost(ctx);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Invalid JSON body");
  });

  it("accepts a body with only user_id (optional fields default to null)", async () => {
    const db = createMockDb({
      runResult: { meta: { last_row_id: 5 } },
      firstResult: {
        checkin_id: 5,
        user_id: 7,
        project_id: 1,
        status_mood: null,
        work_done: null,
        work_planned: null,
        checkin_date: "2026-05-18",
      },
    });

    const res = await onRequestPost(createContext({ db, body: { user_id: 7 } }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.checkin.checkin_id).toBe(5);
    expect(data.checkin.status_mood).toBeNull();
  });
});
