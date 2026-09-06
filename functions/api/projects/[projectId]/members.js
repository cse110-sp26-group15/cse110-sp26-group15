import { requireMemberOrInvitee, requireUser } from "../../_auth.js";

/**
 * Returns true when `email` matches the basic local@domain.tld shape.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/members
 *
 * Returns the project's members joined with their user record, plus any
 * pending invites (emails invited that don't yet have an account).
 *
 * @param {{ env: { DB: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results: members } = await env.DB.prepare(
      `SELECT u.user_id, u.full_name, u.email, u.role
       FROM project_members pm
       JOIN users u ON pm.user_id = u.user_id
       WHERE pm.project_id = ?
       ORDER BY u.full_name ASC`
    )
      .bind(projectId)
      .all();

    const { results: pending } = await env.DB.prepare(
      `SELECT email FROM project_invites WHERE project_id = ? ORDER BY created_at ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ members, pending_invites: pending });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: POST /api/projects/:projectId/members
 *
 * Adds a member to a project by email. If the email already has a user
 * account, the user is added to `project_members` (and any matching
 * pending invite is cleared). Otherwise the email is recorded in
 * `project_invites` and linked when they sign up and join. Duplicate
 * members/invites are prevented by INSERT OR IGNORE + table constraints.
 *
 * Authorization: the caller must already be a member of the project, or be
 * redeeming a pending invite addressed to their own account
 * (requireMemberOrInvitee). Without that, any authenticated user could add
 * themselves to any project id.
 *
 * Request body: { email: string }
 * Response 201: { status: "added", member } | { status: "already_member" }
 *               | { status: "pending" }
 * Response 403: the caller is neither a member nor an invitee
 *
 * @param {{ env: { DB: object }, params: { projectId: string }, request: Request, data?: { userId?: number|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  const denied = requireUser(context);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawEmail = body?.email;
  if (!rawEmail || typeof rawEmail !== "string" || !validateEmail(rawEmail)) {
    return Response.json({ error: "A valid email is required." }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  // The scoped middleware skips this route (an invited user is not a member
  // yet), so the membership decision is made here, immediately before the
  // write: either the caller already belongs to the project, or they are
  // redeeming an invite addressed to their own account.
  const unauthorized = await requireMemberOrInvitee(context, projectId, email);
  if (unauthorized) return unauthorized;

  try {
    const user = await env.DB.prepare(
      "SELECT user_id, email, full_name, role FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_invites (project_id, email) VALUES (?, ?)`
      )
        .bind(projectId, email)
        .run();
      return Response.json({ status: "pending", email }, { status: 201 });
    }

    const existing = await env.DB.prepare(
      `SELECT 1 AS found FROM project_members WHERE project_id = ? AND user_id = ?`
    )
      .bind(projectId, user.user_id)
      .first();
    if (existing) {
      return Response.json({ status: "already_member", member: user }, { status: 201 });
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
    )
      .bind(projectId, user.user_id)
      .run();

    // Clear any pending invite now that the user is a real member.
    await env.DB.prepare(`DELETE FROM project_invites WHERE project_id = ? AND email = ?`)
      .bind(projectId, email)
      .run();

    return Response.json({ status: "added", member: user }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
