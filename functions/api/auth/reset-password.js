import bcryptjs from "bcryptjs";

const SALT_ROUNDS = 10;

/**
 * Cloudflare Pages function: POST /api/auth/reset-password
 *
 * Step 2 of the reset flow. Consumes a `password_resets` token issued by
 * /api/auth/forgot-password and updates the matching user's password
 * hash. The token is marked `used_at` and every active session for that
 * user is deleted so any logged-in tabs are forced to re-authenticate.
 *
 * Request body: { token: string, new_password: string }
 * Response 200: { ok: true }
 * Response 400: invalid input
 * Response 401: token unknown, expired, or already used
 */

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { token, new_password } = body;
  if (!token || typeof token !== "string") {
    return Response.json({ error: "Reset token is required." }, { status: 400 });
  }
  if (!validatePassword(new_password)) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // Single SELECT covers all the failure modes (unknown token, expired
  // token, already-redeemed token) so the handler responds with a single
  // generic 401 — same enumeration-safety reasoning as login.js.
  let row;
  try {
    row = await env.DB.prepare(
      `SELECT token, user_id, expires_at, used_at
         FROM password_resets
         WHERE token = ?
           AND used_at IS NULL
           AND expires_at > datetime('now')`
    )
      .bind(token)
      .first();
  } catch (err) {
    console.error("reset-password lookup failed", err);
    return Response.json({ error: "Failed to reset password." }, { status: 500 });
  }

  if (!row) {
    return Response.json({ error: "Reset link is invalid or expired." }, { status: 401 });
  }

  const hash = await bcryptjs.hash(new_password, SALT_ROUNDS);

  try {
    // Three writes, all keyed off the row we just resolved. D1 batches
    // commit atomically when sent in one batch() call; fall back to
    // sequential .run() in environments where .batch isn't available
    // (the test harness's mock DB).
    const statements = [
      env.DB.prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").bind(
        hash,
        row.user_id
      ),
      env.DB.prepare(
        "UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE token = ?"
      ).bind(token),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    ];
    if (typeof env.DB.batch === "function") {
      await env.DB.batch(statements);
    } else {
      for (const s of statements) await s.run();
    }
  } catch (err) {
    console.error("reset-password write failed", err);
    return Response.json({ error: "Failed to reset password." }, { status: 500 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
