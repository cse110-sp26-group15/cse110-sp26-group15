/**
 * Cloudflare Pages function: POST /api/auth/logout
 *
 * Clears the `sitrep_token` httpOnly cookie by setting it with Max-Age=0.
 * Always returns `{ success: true }` — logout is idempotent and does not
 * verify the caller's session.
 *
 * @returns {Response}
 */
export async function onRequestPost() {
  const response = Response.json({ success: true }, { status: 200 });

  // Clear httpOnly cookie
  response.headers.set(
    "Set-Cookie",
    "sitrep_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  );

  return response;
}
