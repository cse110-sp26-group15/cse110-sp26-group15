import { describe, it, expect, vi } from "vitest";
import {
  onRequestGet as getMembers,
  onRequestPost as addMember,
} from "../../functions/api/projects/[projectId]/members.js";

/**
 * Ordered-result mock D1 (same pattern as agents.test.js).
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

/**
 * Build a context for the members endpoint.
 * @param {{ projectId?: string, body?: object, db: object }} opts
 * @returns {object}
 */
function ctx({ projectId = "1", body, db }) {
  const c = { env: { DB: db }, params: { projectId }, data: { userId: 1 } };
  if (body !== undefined) {
    c.request = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return c;
}

describe("POST /api/projects/:projectId/members", () => {
  it("400s on an invalid email", async () => {
    const res = await addMember(ctx({ body: { email: "nope" }, db: createMockDb() }));
    expect(res.status).toBe(400);
  });

  it("adds an existing user as a member and returns status added", async () => {
    const db = createMockDb({
      firstResults: [{ user_id: 5, email: "real@x.com", full_name: "Real User" }],
    });
    const res = await addMember(ctx({ body: { email: "real@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("added");
    expect(data.member.user_id).toBe(5);
  });

  it("records a pending invite when the email has no account", async () => {
    const db = createMockDb({ firstResults: [null] });
    const res = await addMember(ctx({ body: { email: "ghost@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
  });
});

describe("GET /api/projects/:projectId/members", () => {
  it("returns members and pending_invites", async () => {
    const db = createMockDb({
      allResults: [
        { results: [{ user_id: 1, full_name: "Alex" }] }, // members
        { results: [{ email: "ghost@x.com" }] }, // pending invites
      ],
    });
    const res = await getMembers(ctx({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(1);
    expect(data.pending_invites).toEqual([{ email: "ghost@x.com" }]);
  });
});
