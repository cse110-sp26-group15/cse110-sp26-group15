import bcryptjs from "bcryptjs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  onRequestPost as forgotHandler,
  generateResetToken,
} from "../../functions/api/auth/forgot-password.js";
import { onRequestPost as resetHandler } from "../../functions/api/auth/reset-password.js";
import { requestPasswordReset } from "../forgot-password/script.js";
import { submitPasswordReset, tokenFromSearch } from "../reset-password/script.js";

/**
 * In-memory mock D1 binding. Supports the exact queries the two handlers
 * issue and tracks every bind() argument so tests can assert side
 * effects (token insertion, password update, session purge).
 */
function makeDb({ users = [], resets = [], sessions = [] } = {}) {
  const state = { users, resets, sessions };
  const log = [];

  const prepare = vi.fn((sql) => ({
    sql,
    bind(...args) {
      log.push({ sql, args });
      return {
        first: async () => {
          if (sql.includes("FROM users WHERE email")) {
            const email = args[0];
            return state.users.find((u) => u.email === email) ?? null;
          }
          if (sql.includes("FROM password_resets")) {
            const token = args[0];
            const row = state.resets.find(
              (r) => r.token === token && r.used_at == null && r.expires_at > Date.now()
            );
            return row ?? null;
          }
          return null;
        },
        run: async () => {
          if (sql.startsWith("INSERT INTO password_resets")) {
            state.resets.push({
              token: args[0],
              user_id: args[1],
              expires_at: Date.now() + 60 * 60 * 1000,
              used_at: null,
            });
            return { meta: { last_row_id: state.resets.length } };
          }
          if (sql.startsWith("UPDATE users SET password_hash")) {
            const user = state.users.find((u) => u.user_id === args[1]);
            if (user) user.password_hash = args[0];
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE password_resets")) {
            const row = state.resets.find((r) => r.token === args[0]);
            if (row) row.used_at = Date.now();
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM sessions")) {
            const userId = args[0];
            state.sessions = state.sessions.filter((s) => s.user_id !== userId);
            return { meta: { changes: 1 } };
          }
          return { meta: {} };
        },
      };
    },
  }));

  return {
    DB: { prepare, batch: undefined },
    state,
    log,
  };
}

function makeRequest(body) {
  return new Request("http://localhost/", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("forgot-password — token generator", () => {
  it("returns 64 hex chars (256 bits of entropy)", () => {
    const t = generateResetToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(generateResetToken()).not.toBe(t);
  });
});

describe("forgot-password — handler", () => {
  it("rejects an invalid email body with 400", async () => {
    const { DB } = makeDb();
    const res = await forgotHandler({ env: { DB }, request: makeRequest({ email: "not-email" }) });
    expect(res.status).toBe(400);
  });

  it("issues a token server-side without echoing it by default", async () => {
    const db = makeDb({
      users: [{ user_id: 1, email: "alex@example.com", is_active: 1 }],
    });
    const res = await forgotHandler({
      env: { DB: db.DB },
      request: makeRequest({ email: "alex@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Default response carries no token — production must not leak it.
    expect(body.dev_token).toBeUndefined();
    expect(db.state.resets).toHaveLength(1);
    expect(db.state.resets[0].user_id).toBe(1);
  });

  it("returns ok WITHOUT inserting a token for a nonexistent email (no enumeration leak)", async () => {
    const db = makeDb({ users: [] });
    const res = await forgotHandler({
      env: { DB: db.DB },
      request: makeRequest({ email: "ghost@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dev_token).toBeUndefined();
    expect(db.state.resets).toHaveLength(0);
  });

  it("returns ok WITHOUT a token for an inactive user (no enumeration leak)", async () => {
    const db = makeDb({
      users: [{ user_id: 2, email: "old@example.com", is_active: 0 }],
    });
    const res = await forgotHandler({
      env: { DB: db.DB },
      request: makeRequest({ email: "old@example.com" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dev_token).toBeUndefined();
    expect(db.state.resets).toHaveLength(0);
  });

  it("exposes the dev_token when ALLOW_DEV_RESET_TOKEN=1 (local dev opt-in)", async () => {
    const db = makeDb({
      users: [{ user_id: 1, email: "alex@example.com", is_active: 1 }],
    });
    const res = await forgotHandler({
      env: { DB: db.DB, ALLOW_DEV_RESET_TOKEN: "1" },
      request: makeRequest({ email: "alex@example.com" }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dev_token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.state.resets).toHaveLength(1);
  });

  it("normalizes email to lowercase before lookup", async () => {
    const db = makeDb({
      users: [{ user_id: 1, email: "alex@example.com", is_active: 1 }],
    });
    await forgotHandler({
      env: { DB: db.DB },
      request: makeRequest({ email: "  ALEX@Example.COM  " }),
    });
    const lookupCall = db.log.find((c) => c.sql.includes("FROM users WHERE email"));
    expect(lookupCall.args[0]).toBe("alex@example.com");
  });

  it("rejects a non-JSON body with 400", async () => {
    const { DB } = makeDb();
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "not-json{{{",
      headers: { "Content-Type": "application/json" },
    });
    const res = await forgotHandler({ env: { DB }, request: req });
    expect(res.status).toBe(400);
  });
});

describe("reset-password — handler", () => {
  let db;
  let validToken;
  const ORIGINAL_HASH = "$2a$10$oldhashplaceholder...........................";

  beforeEach(() => {
    validToken = "a".repeat(64);
    db = makeDb({
      users: [
        {
          user_id: 1,
          email: "alex@example.com",
          is_active: 1,
          password_hash: ORIGINAL_HASH,
        },
      ],
      resets: [
        {
          token: validToken,
          user_id: 1,
          expires_at: Date.now() + 60 * 60 * 1000,
          used_at: null,
        },
      ],
      sessions: [
        { token: "s1", user_id: 1 },
        { token: "s2", user_id: 1 },
        { token: "s3", user_id: 2 }, // belongs to a different user
      ],
    });
  });

  it("rejects when token is missing", async () => {
    const res = await resetHandler({
      env: db,
      request: makeRequest({ new_password: "longenough" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects when password is too short", async () => {
    const res = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 for an unknown token (no leak about why)", async () => {
    const res = await resetHandler({
      env: db,
      request: makeRequest({ token: "b".repeat(64), new_password: "newpassword123" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    db.state.resets[0].expires_at = Date.now() - 1000;
    const res = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "newpassword123" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an already-used token", async () => {
    db.state.resets[0].used_at = Date.now() - 1000;
    const res = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "newpassword123" }),
    });
    expect(res.status).toBe(401);
  });

  it("hashes the new password, marks the token used, and purges that user's sessions", async () => {
    const res = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "BrandNewPassword!" }),
    });
    expect(res.status).toBe(200);

    const user = db.state.users[0];
    expect(user.password_hash).not.toBe(ORIGINAL_HASH);
    expect(user.password_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcryptjs.compare("BrandNewPassword!", user.password_hash)).toBe(true);

    expect(db.state.resets[0].used_at).not.toBeNull();
    // user 1's sessions gone; user 2's preserved.
    expect(db.state.sessions.map((s) => s.user_id)).toEqual([2]);
  });

  it("a token cannot be redeemed twice", async () => {
    const first = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "FirstNewPass!" }),
    });
    expect(first.status).toBe(200);

    const second = await resetHandler({
      env: db,
      request: makeRequest({ token: validToken, new_password: "SecondNewPass!" }),
    });
    expect(second.status).toBe(401);
  });
});

describe("forgot-password — client requestPasswordReset", () => {
  it("POSTs JSON to the API and returns the parsed body", async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, dev_token: "abc" }), { status: 200 })
    );
    const body = await requestPasswordReset("alex@example.com", fakeFetch);
    expect(body.dev_token).toBe("abc");
    expect(fakeFetch).toHaveBeenCalledWith(
      "/api/auth/forgot-password",
      expect.objectContaining({ method: "POST" })
    );
    const sent = JSON.parse(fakeFetch.mock.calls[0][1].body);
    expect(sent.email).toBe("alex@example.com");
  });

  it("throws the server error message on non-2xx", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "Please enter a valid email address." }), {
        status: 400,
      });
    await expect(requestPasswordReset("bad", fakeFetch)).rejects.toThrow(/valid email/);
  });
});

describe("reset-password — client submitPasswordReset", () => {
  it("POSTs token + new password", async () => {
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const body = await submitPasswordReset("tok", "newpassword123", fakeFetch);
    expect(body.ok).toBe(true);
    const sent = JSON.parse(fakeFetch.mock.calls[0][1].body);
    expect(sent.token).toBe("tok");
    expect(sent.new_password).toBe("newpassword123");
  });

  it("throws on 401 with the server's message", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "Reset link is invalid or expired." }), { status: 401 });
    await expect(submitPasswordReset("tok", "newpassword123", fakeFetch)).rejects.toThrow(
      /invalid or expired/
    );
  });
});

describe("reset-password — tokenFromSearch", () => {
  it("extracts ?token=...", () => {
    expect(tokenFromSearch("?token=abc123")).toBe("abc123");
  });
  it("returns null when token is missing", () => {
    expect(tokenFromSearch("?other=foo")).toBeNull();
  });
  it("returns null on an empty string", () => {
    expect(tokenFromSearch("")).toBeNull();
  });
  it("trims surrounding whitespace", () => {
    expect(tokenFromSearch("?token=%20abc%20")).toBe("abc");
  });
});
