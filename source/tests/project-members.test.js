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

// The handler now authorizes via requireMemberOrInvitee before it writes, and
// that guard's membership lookup is the first `.first()` the mock serves - so
// every happy-path case has to lead with a row saying "the caller is a member".
// (Cross-tenant behaviour itself is covered end-to-end against a real database
// in authz-tenant.test.js; these stay unit tests of the handler's shapes.)
const CALLER_IS_MEMBER = { ok: 1 };

describe("POST /api/projects/:projectId/members", () => {
  it("400s on an invalid email", async () => {
    const res = await addMember(ctx({ body: { email: "nope" }, db: createMockDb() }));
    expect(res.status).toBe(400);
  });

  it("adds an existing user as a member and returns status added", async () => {
    const db = createMockDb({
      firstResults: [CALLER_IS_MEMBER, { user_id: 5, email: "real@x.com", full_name: "Real User" }],
    });
    const res = await addMember(ctx({ body: { email: "real@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("added");
    expect(data.member.user_id).toBe(5);
  });

  it("records a pending invite when the email has no account", async () => {
    const db = createMockDb({ firstResults: [CALLER_IS_MEMBER, null] });
    const res = await addMember(ctx({ body: { email: "ghost@x.com" }, db }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
  });

  it("403s when the caller is neither a member nor the named invitee", async () => {
    // Not a member, and the caller's own address doesn't match the one being
    // added - so there is no invite to redeem.
    const db = createMockDb({ firstResults: [null, { email: "someone@else.com" }] });
    const res = await addMember(ctx({ body: { email: "victim@x.com" }, db }));
    expect(res.status).toBe(403);
  });

  it("401s when there is no session", async () => {
    const c = ctx({ body: { email: "real@x.com" }, db: createMockDb() });
    c.data = { userId: null };
    const res = await addMember(c);
    expect(res.status).toBe(401);
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
