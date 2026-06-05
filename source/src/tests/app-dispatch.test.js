import { describe, it, expect, vi } from "vitest";
import { onRequestGet as dispatch } from "../../../functions/app.js";

/** Mock D1 whose project-count query returns `count`. */
function mockDb(count) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ n: count })),
      })),
    })),
  };
}

function ctx({ userId, db } = {}) {
  return {
    request: new Request("http://localhost/app"),
    env: { DB: db },
    data: { userId },
  };
}

const location = (res) => new URL(res.headers.get("location")).pathname;

describe("GET /app dispatcher", () => {
  it("redirects to /login/ when there is no session", async () => {
    const res = await dispatch(ctx({ userId: null }));
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/login/");
  });

  it("redirects a returning member (>=1 project) to /projects/", async () => {
    const res = await dispatch(ctx({ userId: 1, db: mockDb(2) }));
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/projects/");
  });

  it("redirects a new user (0 projects) to onboarding", async () => {
    const res = await dispatch(ctx({ userId: 8, db: mockDb(0) }));
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/project-setup/");
  });

  it("falls back to onboarding when the DB binding is missing", async () => {
    const res = await dispatch(ctx({ userId: 1, db: undefined }));
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/project-setup/");
  });
});
