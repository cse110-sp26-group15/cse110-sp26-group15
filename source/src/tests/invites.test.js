import { describe, it, expect, vi } from "vitest";
import { onRequestGet as getInvites } from "../../../functions/api/invites/index.js";

/**
 * Mock D1 returning a single `all()` result set.
 * @param {any[]} rows
 * @returns {object}
 */
function dbWith(rows) {
  const bound = { all: vi.fn(async () => ({ results: rows })) };
  return { prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })) };
}

/**
 * Build a GET /api/invites context for the given query string.
 * @param {string} query e.g. "?email=ghost@x.com"
 * @param {object} db
 * @returns {object}
 */
function ctx(query, db) {
  return { env: { DB: db }, request: new Request(`http://localhost/api/invites${query}`) };
}

describe("GET /api/invites", () => {
  it("400s when email is missing", async () => {
    const res = await getInvites(ctx("", dbWith([])));
    expect(res.status).toBe(400);
  });

  it("returns pending invites with project info for the email", async () => {
    const rows = [{ invite_id: 1, project_id: 3, project_name: "Research Spike", workflow: "xp" }];
    const res = await getInvites(ctx("?email=ghost@x.com", dbWith(rows)));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].project_name).toBe("Research Spike");
  });
});
