import { describe, it, expect, vi } from "vitest";
import {
  requireUser,
  requireProjectMember,
  requireReferencedMember,
} from "../../../functions/api/_auth.js";

/**
 * Minimal D1 mock whose `first()` resolves to `firstResult` (default null),
 * or throws when `throws` is set — enough to exercise the membership lookups.
 */
function mockDb({ firstResult = null, throws = false } = {}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (throws) throw new Error("db down");
          return firstResult;
        }),
      })),
    })),
  };
}

const ctx = (overrides = {}) => ({
  env: { DB: mockDb() },
  data: { userId: 1 },
  ...overrides,
});

describe("requireUser", () => {
  it("returns null when a user is present", () => {
    expect(requireUser(ctx())).toBeNull();
  });

  it("401s when there is no user", () => {
    expect(requireUser(ctx({ data: { userId: null } })).status).toBe(401);
  });

  it("401s when context.data is absent", () => {
    expect(requireUser({ env: {} }).status).toBe(401);
  });
});

describe("requireProjectMember", () => {
  it("returns null when the user is a member", async () => {
    const res = await requireProjectMember(
      ctx({ env: { DB: mockDb({ firstResult: { ok: 1 } }) } }),
      5
    );
    expect(res).toBeNull();
  });

  it("403s when the user is not a member", async () => {
    const res = await requireProjectMember(ctx({ env: { DB: mockDb({ firstResult: null }) } }), 5);
    expect(res.status).toBe(403);
  });

  it("401s when unauthenticated", async () => {
    const res = await requireProjectMember(ctx({ data: { userId: null } }), 5);
    expect(res.status).toBe(401);
  });

  it("400s on a non-positive / non-numeric project id", async () => {
    expect((await requireProjectMember(ctx(), "abc")).status).toBe(400);
    expect((await requireProjectMember(ctx(), 0)).status).toBe(400);
  });

  it("500s when the DB binding is missing", async () => {
    const res = await requireProjectMember({ env: {}, data: { userId: 1 } }, 5);
    expect(res.status).toBe(500);
  });

  it("500s when the membership lookup throws", async () => {
    const res = await requireProjectMember(ctx({ env: { DB: mockDb({ throws: true }) } }), 5);
    expect(res.status).toBe(500);
  });
});

describe("requireReferencedMember", () => {
  it("returns null when the reference is absent (optional field)", async () => {
    expect(await requireReferencedMember(ctx(), 1, null, "assigned_to")).toBeNull();
    expect(await requireReferencedMember(ctx(), 1, undefined, "assigned_to")).toBeNull();
  });

  it("returns null when the referenced user is a member", async () => {
    const res = await requireReferencedMember(
      ctx({ env: { DB: mockDb({ firstResult: { ok: 1 } }) } }),
      1,
      2,
      "assigned_to"
    );
    expect(res).toBeNull();
  });

  it("400s with the field label when the referenced user is not a member", async () => {
    const res = await requireReferencedMember(
      ctx({ env: { DB: mockDb({ firstResult: null }) } }),
      1,
      2,
      "assigned_to"
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/assigned_to/);
  });

  it("500s when the lookup throws", async () => {
    const res = await requireReferencedMember(
      ctx({ env: { DB: mockDb({ throws: true }) } }),
      1,
      2,
      "assigned_to"
    );
    expect(res.status).toBe(500);
  });
});
