import { requireUser } from "../_auth.js";

/**
 * Cloudflare Pages function: GET /api/invites
 *
 * Returns the pending project invites for the *authenticated caller*, joined
 * with the project name and workflow so the onboarding / Projects page can
 * render a "join" prompt without a second round-trip.
 *
 * The earlier shape accepted `?email=<email>` and trusted the value, which
 * meant anyone could probe whether an arbitrary address had pending invites
 * (an information-disclosure leak). We now resolve the email from the
 * session-bound user record instead.
 *
 * Response 200: { invites: [{ invite_id, project_id, project_name, workflow }] }
 *
 * @param {{ env: { DB: object }, data?: { userId?: number|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env } = context;

  const denied = requireUser(context);
  if (denied) return denied;

  try {
    const user = await env.DB.prepare("SELECT email FROM users WHERE user_id = ?")
      .bind(context.data.userId)
      .first();
    if (!user?.email) {
      // Session referenced a user that no longer exists. Treat as no invites.
      return Response.json({ invites: [] });
    }
    const email = user.email.trim().toLowerCase();

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
