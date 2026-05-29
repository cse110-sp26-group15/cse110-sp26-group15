import { describe, it, expect, vi } from "vitest";
import { onRequestGet } from "../../../functions/api/projects/[projectId]/checkins/recent.js";

function createMockDb({ allResult, throws } = {}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => {
          if (throws) throw new Error(throws);
          return allResult ?? { results: [] };
        }),
      })),
    })),
  };
}

function createContext(db, projectId = "1") {
  return { env: { DB: db }, params: { projectId } };
}

describe("GET /projects/:projectId/checkins/recent", () => {
  it("returns recent checkins for the project", async () => {
    const rows = [
      {
        checkin_id: 4,
        status_mood: "Focused",
        work_done: "wrote tests",
        work_planned: "ship them",
        checkin_date: "2026-05-18",
        user_id: 1,
        full_name: "Alex Rivera",
      },
    ];
    const db = createMockDb({ allResult: { results: rows } });

    const res = await onRequestGet(createContext(db));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ checkins: rows });
  });

  it("returns an empty list when no recent checkins exist", async () => {
    const db = createMockDb({ allResult: { results: [] } });

    const res = await onRequestGet(createContext(db));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ checkins: [] });
  });

  it("uses the projectId param when querying", async () => {
    const bindSpy = vi.fn(() => ({ all: vi.fn(async () => ({ results: [] })) }));
    const db = { prepare: vi.fn(() => ({ bind: bindSpy })) };

    await onRequestGet(createContext(db, "42"));

    expect(bindSpy).toHaveBeenCalledWith("42");
  });

  it("returns 500 when the DB throws", async () => {
    const db = createMockDb({ throws: "db down" });

    const res = await onRequestGet(createContext(db));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("db down");
  });
});
