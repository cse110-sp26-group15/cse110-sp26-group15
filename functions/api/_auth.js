/**
 * Shared authorization helpers for the API route handlers.
 *
 * The global middleware (functions/_middleware.js) resolves the `sitrep_token`
 * cookie to `context.data.userId` (a number, or null when there is no valid
 * session). Pages shares the `data` object across the whole handler chain, so
 * that — not a property on `context` itself — is where the resolved user lives.
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
 * as a route — it is imported by sibling handlers, not requested directly.
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
 *   - null when the reference is absent (null/undefined) — the field is optional,
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
