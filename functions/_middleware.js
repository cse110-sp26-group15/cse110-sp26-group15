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
