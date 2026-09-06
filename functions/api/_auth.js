/**
 * Shared authorization helpers for the API route handlers.
 *
 * The global middleware (functions/_middleware.js) resolves the `sitrep_token`
 * cookie to `context.data.userId` (a number, or null when there is no valid
 * session). Pages shares the `data` object across the whole handler chain, so
 * that - not a property on `context` itself - is where the resolved user lives.
 * These helpers turn that into access decisions.
 *
 * Contract: each helper returns a `Response` the caller should immediately
 * return to abort the request, or `null` when the request is authorized and
 * may proceed. This mirrors the early-return error style the handlers already
 * use, so adopting it is a one-liner at the top of a handler:
 *
 *   const denied = await requireProjectMember(context, params.projectId);
 *   if (denied) return denied;
 *
 * The file name is underscore-prefixed so Cloudflare Pages does not expose it
 * as a route - it is imported by sibling handlers, not requested directly.
 */

/**
 * Require an authenticated user. Use on routes that need a logged-in caller
 * but are not scoped to a single project (e.g. listing the caller's projects).
 *
 * @param {{ data?: { userId?: number|null } }} context
 * @returns {Response|null} 401 Response when unauthenticated, else null.
 */
export function requireUser(context) {
  if (!context.data?.userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  return null;
}

/**
 * Require that the authenticated user is a member of `projectId`.
 *
 * Resolves to:
 *   - 401 when there is no authenticated user,
 *   - 400 when `projectId` is not a positive integer,
 *   - 403 when the user is not in `project_members` for that project,
 *   - 500 when the DB binding is missing or the lookup throws,
 *   - null when the user is a member (authorized to proceed).
 *
 * @param {{ env?: { DB?: object }, data?: { userId?: number|null } }} context
 * @param {number|string} projectId
 * @returns {Promise<Response|null>}
 */
export async function requireProjectMember(context, projectId) {
  const { env } = context;
  const userId = context.data?.userId;

  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!env?.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return Response.json({ error: "Invalid project id." }, { status: 400 });
  }

  let member;
  try {
    member = await env.DB.prepare(
      "SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?"
    )
      .bind(pid, userId)
      .first();
  } catch (err) {
    console.error("requireProjectMember: membership lookup failed", err);
    return Response.json({ error: "Authorization check failed." }, { status: 500 });
  }

  if (!member) {
    return Response.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  return null;
}

/**
 * Containment check for a user referenced in a request body (a task assignee,
 * an agent owner, etc.): if `userId` is provided, it must belong to `projectId`.
 * This keeps a member from pointing project data at users outside the project.
 *
 * Resolves to:
 *   - null when the reference is absent (null/undefined) - the field is optional,
 *   - null when the referenced user is a member of the project,
 *   - 400 when the referenced user is not a member,
 *   - 500 on a DB error.
 *
 * @param {{ env?: { DB?: object } }} context
 * @param {number|string} projectId
 * @param {number|null|undefined} userId
 * @param {string} [label="user"] Field name used in the error message.
 * @returns {Promise<Response|null>}
 */
export async function requireReferencedMember(context, projectId, userId, label = "user") {
  if (userId == null) return null;

  const { env } = context;
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?"
    )
      .bind(Number(projectId), userId)
      .first();
  } catch (err) {
    console.error("requireReferencedMember: lookup failed", err);
    return Response.json({ error: "Authorization check failed." }, { status: 500 });
  }

  if (!row) {
    return Response.json({ error: `${label} must be a member of this project.` }, { status: 400 });
  }
  return null;
}

/**
 * Authorize `POST /api/projects/:projectId/members`.
 *
 * This is the one route the scoped middleware
 * (functions/api/projects/[projectId]/_middleware.js) cannot gate on membership,
 * because it serves two callers: an existing member inviting a teammate, and an
 * invited user who is not a member yet accepting their invitation. The
 * middleware therefore waves it through, and the authorization decision has to
 * be made here - at the execution boundary, immediately before the INSERT.
 *
 * Waving the route through without this check meant any authenticated user
 * could POST their own address to an arbitrary `:projectId` and be added to a
 * project they had never been invited to (project ids are small sequential
 * integers, so they are trivially enumerable). That is the whole tenant
 * boundary, not a corner of it: membership is what every other route in the
 * subtree checks.
 *
 * Authorized when either:
 *   - the caller is already a member of the project (inviting a teammate), or
 *   - the caller is redeeming their own pending invite - the address being
 *     added is the caller's own account email AND a matching row exists in
 *     `project_invites` for this project.
 *
 * The second arm deliberately compares against the email on the *session's*
 * user record rather than trusting the request body, so a caller cannot redeem
 * somebody else's invitation by naming their address.
 *
 * @param {{ env?: { DB?: object }, data?: { userId?: number|null } }} context
 * @param {number|string} projectId
 * @param {string} email Normalized (trimmed, lowercased) address being added.
 * @returns {Promise<Response|null>} A Response to abort with, or null if allowed.
 */
export async function requireMemberOrInvitee(context, projectId, email) {
  const { env } = context;
  const userId = context.data?.userId;

  if (!userId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!env?.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const pid = Number(projectId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return Response.json({ error: "Invalid project id." }, { status: 400 });
  }

  try {
    const member = await env.DB.prepare(
      "SELECT 1 AS ok FROM project_members WHERE project_id = ? AND user_id = ?"
    )
      .bind(pid, userId)
      .first();
    if (member) return null;

    // Not a member - the only other way in is redeeming an invite addressed to
    // this caller's own account.
    const self = await env.DB.prepare("SELECT email FROM users WHERE user_id = ?")
      .bind(userId)
      .first();
    const selfEmail = self?.email?.trim().toLowerCase() ?? null;
    if (!selfEmail || selfEmail !== email) {
      return Response.json({ error: "You do not have access to this project." }, { status: 403 });
    }

    const invite = await env.DB.prepare(
      "SELECT 1 AS ok FROM project_invites WHERE project_id = ? AND email = ?"
    )
      .bind(pid, selfEmail)
      .first();
    if (!invite) {
      return Response.json({ error: "You do not have access to this project." }, { status: 403 });
    }
  } catch (err) {
    console.error("requireMemberOrInvitee: lookup failed", err);
    return Response.json({ error: "Authorization check failed." }, { status: 500 });
  }

  return null;
}
