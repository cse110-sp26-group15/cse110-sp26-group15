import { requireProjectMember } from "../_auth.js";

/**
 * Resolve a blocker to the project that owns it, via its check-in
 * (blocker → checkin → project), and gate on membership. A blocker has no
 * project_id column today, so the check-in is the only link; an orphaned
 * blocker (no/deleted check-in) resolves to a null project and is denied.
 * Returns a Response to abort (404 missing / 401/403/400 from the guard), or
 * null when the caller is authorized.
 *
 * @param {{ env: { DB: object }, userId?: number|null }} context
 * @param {string} blockerId
 * @returns {Promise<Response|null>}
 */
async function authorizeBlocker(context, blockerId) {
  const { env } = context;
  const owner = await env.DB.prepare(
    `SELECT b.blocker_id, c.project_id
       FROM blockers b
       LEFT JOIN checkins c ON b.checkin_id = c.checkin_id
      WHERE b.blocker_id = ?`
  )
    .bind(blockerId)
    .first();

  if (!owner) {
    return Response.json({ error: "Blocker not found" }, { status: 404 });
  }
  return requireProjectMember(context, owner.project_id);
}

export async function onRequestPatch(context) {
  const { env, params, request } = context;
  const { blockerId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { is_resolved, description, task, helper } = body;

  const fields = [];
  const values = [];

  if (is_resolved !== undefined) {
    const resolved = is_resolved ? 1 : 0;
    fields.push("is_resolved = ?");
    values.push(resolved);
    fields.push(resolved ? "resolved_at = CURRENT_TIMESTAMP" : "resolved_at = NULL");
  }
  if (description !== undefined) {
    if (typeof description !== "string" || description.trim() === "") {
      return Response.json({ error: "description must be a non-empty string" }, { status: 400 });
    }
    fields.push("description = ?");
    values.push(description.trim());
  }
  if (task !== undefined) {
    fields.push("task = ?");
    values.push(task);
  }
  if (helper !== undefined) {
    fields.push("helper = ?");
    values.push(helper);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(blockerId);

  try {
    const denied = await authorizeBlocker(context, blockerId);
    if (denied) return denied;

    await env.DB.prepare(`UPDATE blockers SET ${fields.join(", ")} WHERE blocker_id = ?`)
      .bind(...values)
      .run();

    const blocker = await env.DB.prepare("SELECT * FROM blockers WHERE blocker_id = ?")
      .bind(blockerId)
      .first();

    if (!blocker) {
      return Response.json({ error: "Blocker not found" }, { status: 404 });
    }

    return Response.json({ blocker });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: DELETE /api/blockers/:blockerId
 *
 * Hard-deletes a blocker row. Returns 404 when the row does not exist so
 * callers can distinguish "already gone" from "succeeded". Symmetric with
 * DELETE /api/tasks/:taskId.
 *
 * @param {{ env: { DB: object }, params: { blockerId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { blockerId } = params;

  try {
    const denied = await authorizeBlocker(context, blockerId);
    if (denied) return denied;

    await env.DB.prepare("DELETE FROM blockers WHERE blocker_id = ?").bind(blockerId).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
