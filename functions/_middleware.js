/**
 * Cloudflare Pages global middleware.
 *
 * Extracts the `sitrep_token` cookie and resolves it to the authenticated user
 * via the `sessions` table, exposing both on `context.data` (`context.data.token`
 * and `context.data.userId` — a number, or null when there is no valid/unexpired
 * session). Pages passes a single `data` object down the whole handler chain, so
 * this is how middleware shares state with route handlers — arbitrary properties
 * set directly on `context` do NOT propagate to downstream handlers. Centralizing
 * the lookup here means handlers never re-parse the cookie or query sessions
 * themselves; they read `context.data.userId` and lean on the shared auth helpers
 * (functions/api/_auth.js) to enforce access.
 *
 * This runs for every route, including the public ones (login/signup) where no
 * token exists yet — in that case `userId` is simply null and those handlers
 * ignore it.
 *
 * @param {{ request: Request, env: { DB?: object }, next: () => Promise<Response>, token?: string|null, userId?: number|null }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request, env } = context;

  // Extract token from cookie
  const cookieHeader = request.headers.get("Cookie") || "";
  const tokenMatch = cookieHeader.match(/sitrep_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  // Resolve the token to a user. A missing token, missing DB binding, expired
  // session, or lookup error all collapse to "not authenticated" (null) so a
  // transient failure can never accidentally authorize a request.
  let userId = null;
  if (token && env?.DB) {
    try {
      const row = await env.DB.prepare(
        "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')"
      )
        .bind(token)
        .first();
      userId = row?.user_id ?? null;
    } catch (err) {
      console.error("Middleware: session lookup failed", err);
    }
  }

  // Share with downstream handlers via the chain-wide `data` object.
  context.data.token = token;
  context.data.userId = userId;

  // Continue to the next handler
  return context.next();
}
