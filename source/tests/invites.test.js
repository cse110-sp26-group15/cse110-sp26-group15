import { describe, it, expect, vi } from "vitest";
import { onRequestGet as getInvites } from "../../functions/api/invites/index.js";

/**
 * Mock D1: first() returns the seeded user row (for the email lookup), all()
 * returns the seeded invite rows. Mirrors the order the handler queries in.
 *
 * @param {{ user?: object|null, invites?: any[] }} [opts]
 * @returns {object}
 */
function makeDb({ user = null, invites = [] } = {}) {
  const bound = {
    first: vi.fn(async () => user),
    all: vi.fn(async () => ({ results: invites })),
  };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a GET /api/invites context. Seeds data.userId for auth.
 * @param {{ db: object, userId?: number|null }} opts
 * @returns {object}
 */
function ctx({ db, userId = 1 }) {
  return {
    env: { DB: db },
    request: new Request("http://localhost/api/invites"),
    data: { userId },
  };
}

describe("GET /api/invites", () => {
  it("401s when unauthenticated", async () => {
    const res = await getInvites(ctx({ db: makeDb(), userId: null }));
    expect(res.status).toBe(401);
  });

  it("returns the caller's own pending invites with project info", async () => {
    const db = makeDb({
      user: { email: "ghost@x.com" },
      invites: [{ invite_id: 1, project_id: 3, project_name: "Research Spike", workflow: "xp" }],
    });
    const res = await getInvites(ctx({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].project_name).toBe("Research Spike");
  });

  it("returns empty list when session points at a missing user", async () => {
    const db = makeDb({ user: null });
    const res = await getInvites(ctx({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.invites).toEqual([]);
  });
});
