/**
 * Cloudflare Pages function: POST /api/auth/forgot-password
 *
 * Step 1 of the reset flow. Accepts an email, and — if the address belongs
 * to an active user — issues a one-hour reset token, persists it in
 * `password_resets`, and (in production) would email the user a link
 * containing the token. To prevent account enumeration we always return
 * 200 with the same body whether or not the email exists; only timing
 * differs (DB lookup + insert vs. lookup only), which is acceptable for
 * this product.
 *
 * In local dev / CI we return the token in the response body under
 * `dev_token` so the user can copy it directly into the reset form.
 * Production should omit this by setting `env.HIDE_DEV_TOKEN = "1"` (or
 * similar) so the token is never visible client-side.
 *
 * Request body: { email: string }
 * Response 200: { ok: true, dev_token?: string }
 */

const TOKEN_TTL_SECONDS = 60 * 60;

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * 64-char hex token, 256 bits of entropy. Same shape as the session token
 * generator in login/signup; kept local rather than imported because the
 * auth handlers historically duplicate this helper.
 * @returns {string}
 */
export function generateResetToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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

  const { email } = body;
  if (!email || typeof email !== "string" || !validateEmail(email.trim())) {
    return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();

  // Always-OK response shape — returned whether or not the user exists.
  const okResponse = (extra = {}) => Response.json({ ok: true, ...extra }, { status: 200 });

  let user;
  try {
    user = await env.DB.prepare("SELECT user_id, is_active FROM users WHERE email = ?")
      .bind(normalized)
      .first();
  } catch (err) {
    console.error("forgot-password lookup failed", err);
    // Even on DB failure we don't leak — return ok and log server-side.
    return okResponse();
  }

  if (!user || !user.is_active) {
    // Don't insert a token for a nonexistent / inactive user.
    return okResponse();
  }

  const token = generateResetToken();
  try {
    await env.DB.prepare(
      "INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))"
    )
      .bind(token, user.user_id)
      .run();
  } catch (err) {
    console.error("forgot-password insert failed", err);
    return okResponse();
  }

  // In production we'd email a link like:
  //   https://sitrep.app/reset-password?token=<token>
  // Here we expose it directly so local dev can complete the flow without
  // an email provider. Production deployments should set HIDE_DEV_TOKEN.
  if (env.HIDE_DEV_TOKEN) {
    return okResponse();
  }
  return okResponse({ dev_token: token, expires_in_seconds: TOKEN_TTL_SECONDS });
}
