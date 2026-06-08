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
 * Token delivery is opt-in: by default the token is never returned to the
 * caller — it's logged server-side and (when an email integration is wired
 * up) emailed to the user. Local dev / CI can set
 * `env.ALLOW_DEV_RESET_TOKEN = "1"` to expose `dev_token` in the response
 * for hands-on testing. The previous behavior (opt-out via HIDE_DEV_TOKEN)
 * leaked tokens to anyone hitting the endpoint with a known email, so the
 * default is now secure and prod has to do nothing.
 *
 * TODO(forgot-password): wire a real email provider (Resend / SES / etc.)
 * here. Until that lands, prod users have no way to actually receive the
 * token — the reset flow is effectively staff-only via server logs.
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

  // Server log gives staff a way to recover an account in environments
  // without email wired up. Token is sensitive; never log it on prod stdout
  // once a real email provider is in place.
  console.log(`[forgot-password] issued reset token for user_id=${user.user_id}`);

  // Default response shape contains no token. Local dev / CI can flip
  // ALLOW_DEV_RESET_TOKEN=1 to expose `dev_token` for hands-on flows.
  if (env.ALLOW_DEV_RESET_TOKEN === "1" || env.ALLOW_DEV_RESET_TOKEN === true) {
    return okResponse({ dev_token: token, expires_in_seconds: TOKEN_TTL_SECONDS });
  }
  return okResponse();
}
