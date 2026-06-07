/**
 * Cloudflare Pages function: GET /api/invites?email=<email>
 *
 * Returns the pending project invites for a given email, joined with the
 * project name and workflow so the onboarding page can render a "join"
 * prompt without a second round-trip. Email is matched case-insensitively
 * (normalized to lowercase), consistent with the auth handlers.
 *
 * Response 200: { invites: [{ invite_id, project_id, project_name, workflow }] }
 *
 * @param {{ env: { DB: object }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const rawEmail = url.searchParams.get("email");

  if (!rawEmail || rawEmail.trim() === "") {
    return Response.json({ error: "email query parameter is required" }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  try {
    const { results } = await env.DB.prepare(
      `SELECT i.invite_id, i.project_id, p.name AS project_name, p.workflow
       FROM project_invites i
       JOIN projects p ON p.project_id = i.project_id
       WHERE i.email = ?
       ORDER BY i.created_at ASC`
    )
      .bind(email)
      .all();

    return Response.json({ invites: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
