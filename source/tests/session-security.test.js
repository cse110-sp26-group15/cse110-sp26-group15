/**
 * C06 - browser session security, end to end.
 *
 * auth.test.js and password-reset.test.js already cover these handlers against
 * an ordered mock D1: cookie flags, the 401 shapes, "token cannot be redeemed
 * twice". What a mock cannot show is whether the *system* honours them - a mock
 * returns the row the test queued, so "logout deletes the session" and "the
 * deleted session no longer authenticates" are two unrelated assertions there.
 *
 * These tests run the real handlers and the real middleware against a real
 * database, so each claim is end-to-end: issue a credential, use it, revoke it,
 * try to use it again.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  callApi,
  freshDb,
  parseSetCookie,
  seedProject,
  tokenFromResponse,
} from "./helpers/d1-harness.js";

const EMAIL = "user@example.com";
const PASSWORD = "correct-horse-battery";

let env;

/** Sign up the fixture user and return their session token. */
async function signup() {
  const res = await callApi(env, {
    method: "POST",
    path: "/api/auth/signup",
    body: { email: EMAIL, password: PASSWORD, full_name: "Test User" },
  });
  expect(res.status).toBe(201);
  return { res, token: tokenFromResponse(res) };
}

/** Log the fixture user in and return their session token. */
async function login(password = PASSWORD) {
  const res = await callApi(env, {
    method: "POST",
    path: "/api/auth/login",
    body: { email: EMAIL, password },
  });
  return { res, token: tokenFromResponse(res) };
}

/** A route that requires a live session, used as the "is this token good?" probe. */
async function probe(token) {
  return callApi(env, { path: "/api/projects", token });
}

beforeEach(() => {
  env = freshDb();
});

describe("C06 - cookie flags", () => {
  it("signup sets an HttpOnly, Secure, SameSite=Strict, path-scoped cookie", async () => {
    const { res } = await signup();
    const { value, attrs } = parseSetCookie(res);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(attrs.httponly).toBe(true);
    expect(attrs.secure).toBe(true);
    expect(attrs.samesite).toBe("Strict");
    expect(attrs.path).toBe("/");
    expect(Number(attrs["max-age"])).toBe(604800);
  });

  it("login sets the same flags", async () => {
    await signup();
    const { res } = await login();
    const { attrs } = parseSetCookie(res);
    expect(attrs.httponly).toBe(true);
    expect(attrs.secure).toBe(true);
    expect(attrs.samesite).toBe("Strict");
  });

  it("logout clears the cookie with Max-Age=0 and keeps the flags", async () => {
    const { token } = await signup();
    const res = await callApi(env, { method: "POST", path: "/api/auth/logout", token });
    const { value, attrs } = parseSetCookie(res);
    expect(value).toBe("");
    expect(Number(attrs["max-age"])).toBe(0);
    expect(attrs.httponly).toBe(true);
    expect(attrs.samesite).toBe("Strict");
  });

  it("no API response carries a permissive CORS header", async () => {
    // SameSite=Strict is the entire CSRF defense here (there is no CSRF token),
    // so an Access-Control-Allow-Origin that let another origin read responses
    // would be a material regression. Assert none of the auth or data routes
    // emits one.
    const { token } = await signup();
    for (const req of [
      { method: "POST", path: "/api/auth/login", body: { email: EMAIL, password: PASSWORD } },
      { path: "/api/projects", token },
      { path: "/api/invites", token },
      { method: "POST", path: "/api/auth/logout", token },
    ]) {
      const res = await callApi(env, req);
      expect(res.headers.get("Access-Control-Allow-Origin"), req.path).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Credentials"), req.path).toBeNull();
    }
  });
});

describe("C06 - logout revokes the session server-side", () => {
  it("the same token stops working after logout", async () => {
    const { token } = await signup();
    expect((await probe(token)).status).toBe(200);

    const out = await callApi(env, { method: "POST", path: "/api/auth/logout", token });
    expect(out.status).toBe(200);

    // Replaying the cookie an attacker (or a restored tab) still holds.
    expect((await probe(token)).status).toBe(401);

    const rows = env.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token = ?").get(token);
    expect(rows.n).toBe(0);
  });

  it("logging out one session leaves the user's other sessions alone", async () => {
    const { token: first } = await signup();
    const { token: second } = await login();
    expect(first).not.toBe(second);

    await callApi(env, { method: "POST", path: "/api/auth/logout", token: first });
    expect((await probe(first)).status).toBe(401);
    expect((await probe(second)).status).toBe(200);
  });

  it("logout with no session is a harmless no-op", async () => {
    const res = await callApi(env, { method: "POST", path: "/api/auth/logout" });
    expect(res.status).toBe(200);
  });
});

describe("C06 - session lifetime is enforced server-side", () => {
  it("an expired session row does not authenticate, even with a valid cookie", async () => {
    const { token } = await signup();
    expect((await probe(token)).status).toBe(200);

    env.raw
      .prepare("UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE token = ?")
      .run(token);

    expect((await probe(token)).status).toBe(401);
  });

  it("a forged token that was never issued does not authenticate", async () => {
    await signup();
    expect((await probe("f".repeat(64))).status).toBe(401);
  });

  it("each login mints a fresh token (no session fixation)", async () => {
    await signup();
    const a = (await login()).token;
    const b = (await login()).token;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("C06 - password reset tokens expire and are single-use", () => {
  /** Run forgot-password with the dev opt-in so the test can see the token. */
  async function requestReset(email = EMAIL) {
    const res = await callApi(env, {
      method: "POST",
      path: "/api/auth/forgot-password",
      body: { email },
      envVars: { ALLOW_DEV_RESET_TOKEN: "1" },
    });
    return (await res.json()).dev_token ?? null;
  }

  it("does not return the token unless the dev opt-in is set", async () => {
    await signup();
    const res = await callApi(env, {
      method: "POST",
      path: "/api/auth/forgot-password",
      body: { email: EMAIL },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });

    // The token still exists server-side; it just isn't handed to the caller.
    const row = env.raw.prepare("SELECT COUNT(*) AS n FROM password_resets").get();
    expect(row.n).toBe(1);
  });

  it("a token works once and the replay is refused", async () => {
    await signup();
    const token = await requestReset();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const first = await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token, new_password: "first-new-password" },
    });
    expect(first.status).toBe(200);

    // Replay with a *different* password: if the token were reusable an
    // attacker who saw the reset link could take the account back later.
    const replay = await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token, new_password: "attacker-chosen-pass" },
    });
    expect(replay.status).toBe(401);

    // The account still has the password the legitimate reset set.
    expect((await login("first-new-password")).res.status).toBe(200);
    expect((await login("attacker-chosen-pass")).res.status).toBe(401);
  });

  it("an expired token is refused and the password is unchanged", async () => {
    await signup();
    const token = await requestReset();
    env.raw
      .prepare(
        "UPDATE password_resets SET expires_at = datetime('now', '-1 minute') WHERE token = ?"
      )
      .run(token);

    const res = await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token, new_password: "should-not-apply" },
    });
    expect(res.status).toBe(401);
    expect((await login(PASSWORD)).res.status).toBe(200);
    expect((await login("should-not-apply")).res.status).toBe(401);
  });

  it("completing a reset kills every existing session for that user", async () => {
    const { token: sessionA } = await signup();
    const { token: sessionB } = await login();
    expect((await probe(sessionA)).status).toBe(200);
    expect((await probe(sessionB)).status).toBe(200);

    const resetToken = await requestReset();
    const done = await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token: resetToken, new_password: "brand-new-password" },
    });
    expect(done.status).toBe(200);

    expect((await probe(sessionA)).status).toBe(401);
    expect((await probe(sessionB)).status).toBe(401);
  });

  it("one user's reset token cannot be used against a different account", async () => {
    await signup();
    await callApi(env, {
      method: "POST",
      path: "/api/auth/signup",
      body: { email: "victim@example.com", password: "victim-password-1", full_name: "Victim" },
    });

    // The token is bound to the user it was issued for; there is no user field
    // in the request body to override, which is the property being pinned here.
    const token = await requestReset(EMAIL);
    await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token, new_password: "attacker-set-this" },
    });

    const victim = await callApi(env, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: "victim@example.com", password: "victim-password-1" },
    });
    expect(victim.status).toBe(200);
  });

  it("no reset token is issued for an address with no account", async () => {
    const res = await callApi(env, {
      method: "POST",
      path: "/api/auth/forgot-password",
      body: { email: "nobody@example.com" },
      envVars: { ALLOW_DEV_RESET_TOKEN: "1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(env.raw.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n).toBe(0);
  });
});

describe("C06 - credentials never appear in a response body", () => {
  it("signup, login and the session-backed routes omit the password and its hash", async () => {
    const { res: signupRes } = await signup();
    const { res: loginRes } = await login();

    for (const [label, res] of [
      ["signup", signupRes],
      ["login", loginRes],
    ]) {
      const text = await res.clone().text();
      expect(text, label).not.toContain(PASSWORD);
      expect(text, label).not.toContain("password_hash");
      expect(text, label).not.toContain("$2b$");
      expect(text, label).not.toContain("$2a$");
    }
  });

  it("the members list does not expose password hashes", async () => {
    const { token } = await signup();
    const userId = env.raw.prepare("SELECT user_id FROM users WHERE email = ?").get(EMAIL).user_id;
    const projectId = seedProject(env, { name: "P", ownerId: userId });

    const res = await callApi(env, { path: `/api/projects/${projectId}/members`, token });
    const text = await res.text();
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("$2b$");
  });

  it("a failed login says nothing about which half was wrong", async () => {
    await signup();
    const wrongPass = await login("definitely-not-the-password");
    const noSuchUser = await callApi(env, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: "ghost@example.com", password: PASSWORD },
    });
    expect(wrongPass.res.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(await wrongPass.res.json()).toEqual(await noSuchUser.json());
  });
});

describe("C06 - positive control: the legitimate flows still work", () => {
  it("signup, logout, log back in, and use the session", async () => {
    const { token: t1 } = await signup();
    expect((await probe(t1)).status).toBe(200);

    await callApi(env, { method: "POST", path: "/api/auth/logout", token: t1 });
    expect((await probe(t1)).status).toBe(401);

    const { res, token: t2 } = await login();
    expect(res.status).toBe(200);
    expect((await probe(t2)).status).toBe(200);
  });

  it("forgot -> reset -> log in with the new password", async () => {
    await signup();
    const res = await callApi(env, {
      method: "POST",
      path: "/api/auth/forgot-password",
      body: { email: EMAIL },
      envVars: { ALLOW_DEV_RESET_TOKEN: "1" },
    });
    const { dev_token } = await res.json();
    const done = await callApi(env, {
      method: "POST",
      path: "/api/auth/reset-password",
      body: { token: dev_token, new_password: "my-new-password" },
    });
    expect(done.status).toBe(200);
    expect((await login("my-new-password")).res.status).toBe(200);
  });
});
