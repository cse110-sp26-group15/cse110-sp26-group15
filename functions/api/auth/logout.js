/**
 * Cloudflare Pages function: POST /api/auth/logout
 *
 * Revokes the caller's session server-side by deleting its row from `sessions`
 * (the token is read from the `sitrep_token` cookie, exposed on `context.data`
 * by the middleware), then clears the cookie with Max-Age=0. Idempotent: a
 * missing/expired token simply deletes nothing and still returns success.
 *
 * @param {{ env: { DB?: object }, data?: { token?: string|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env } = context;
  const token = context.data?.token;

  // Best-effort revocation — never let a DB hiccup block the user from
  // logging out. The cookie is cleared regardless below.
  if (token && env?.DB) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    } catch (err) {
      console.error("Logout: failed to delete session row", err);
    }
  }

  const response = Response.json({ success: true }, { status: 200 });

  // Clear httpOnly cookie
  response.headers.set(
    "Set-Cookie",
    "sitrep_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  );

  return response;
}
