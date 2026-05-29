import { describe, it, expect, vi } from "vitest";
import { onRequestPatch } from "../../../functions/api/blockers/[blockerId].js";

function createMockDb({ firstResult, runResult } = {}) {
  const sqlCalls = [];
  const db = {
    prepare: vi.fn((sql) => {
      sqlCalls.push(sql);
      return {
        bind: vi.fn(() => ({
          run: vi.fn(async () => runResult ?? { meta: { changes: 1 } }),
          first: vi.fn(async () => firstResult ?? null),
        })),
      };
    }),
  };
  db._sqlCalls = sqlCalls;
  return db;
}

function createContext({ blockerId = "1", body, db } = {}) {
  return {
    env: { DB: db },
    params: { blockerId },
    request: new Request("http://localhost/", {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("PATCH /blockers/:blockerId", () => {
  it("resolving a blocker stamps resolved_at via SQL", async () => {
    const updated = {
      blocker_id: 1,
      checkin_id: 2,
      description: "x",
      is_resolved: 1,
      resolved_at: "2026-05-18 17:00:00",
      task: null,
      helper: null,
    };
    const db = createMockDb({ firstResult: updated });

    const res = await onRequestPatch(createContext({ db, body: { is_resolved: true } }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocker.is_resolved).toBe(1);
    expect(data.blocker.resolved_at).not.toBeNull();
    expect(db._sqlCalls[0]).toContain("resolved_at = CURRENT_TIMESTAMP");
  });

  it("re-opening a blocker clears resolved_at via SQL", async () => {
    const updated = {
      blocker_id: 1,
      checkin_id: 2,
      description: "x",
      is_resolved: 0,
      resolved_at: null,
      task: null,
      helper: null,
    };
    const db = createMockDb({ firstResult: updated });

    const res = await onRequestPatch(createContext({ db, body: { is_resolved: false } }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocker.is_resolved).toBe(0);
    expect(data.blocker.resolved_at).toBeNull();
    expect(db._sqlCalls[0]).toContain("resolved_at = NULL");
  });

  it("updates a single field without touching others", async () => {
    const updated = {
      blocker_id: 1,
      checkin_id: 2,
      description: "x",
      is_resolved: 0,
      resolved_at: null,
      task: null,
      helper: "Sam",
    };
    const db = createMockDb({ firstResult: updated });

    const res = await onRequestPatch(createContext({ db, body: { helper: "Sam" } }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocker.helper).toBe("Sam");
    expect(db._sqlCalls[0]).toContain("helper = ?");
    expect(db._sqlCalls[0]).not.toContain("resolved_at");
  });

  it("returns 400 when body has no valid fields", async () => {
    const db = createMockDb();

    const res = await onRequestPatch(createContext({ db, body: {} }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("No valid fields to update");
  });

  it("returns 400 when description is an empty string", async () => {
    const db = createMockDb();

    const res = await onRequestPatch(createContext({ db, body: { description: "   " } }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("description must be a non-empty string");
  });

  it("returns 404 when the blocker does not exist", async () => {
    const db = createMockDb({ firstResult: null });

    const res = await onRequestPatch(
      createContext({ blockerId: "9999", db, body: { is_resolved: true } })
    );
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe("Blocker not found");
  });
});
