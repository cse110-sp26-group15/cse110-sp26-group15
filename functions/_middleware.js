/**
 * Cloudflare Pages global middleware.
 *
 * Extracts the `sitrep_token` cookie from the incoming request and attaches it
 * to `context.token` so downstream handlers can use it without re-parsing the
 * Cookie header. Does not perform authentication or session lookup — handlers
 * that need an authenticated user must resolve `context.token` themselves.
 *
 * @param {{ request: Request, next: () => Promise<Response>, token?: string|null }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request } = context;

  // Extract token from cookie
  const cookieHeader = request.headers.get("Cookie") || "";
  const tokenMatch = cookieHeader.match(/sitrep_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : null;

  // Attach token to context for downstream handlers
  context.token = token;

  // Continue to the next handler
  return context.next();
}
