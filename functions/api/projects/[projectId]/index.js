/**
 * Cloudflare Pages function: GET /api/projects/:projectId
 *
 * Returns the project record plus its member list. Lighter-weight than
 * /api/projects/:projectId/dashboard for callers that only need the
 * "what project am I on?" header data.
 *
 * @param {{ env: { DB?: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  try {
    const project = await env.DB.prepare(
      `SELECT project_id, name, description, workflow, created_by, created_at
       FROM projects WHERE project_id = ?`
    )
      .bind(params.projectId)
      .first();

    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const { results: members } = await env.DB.prepare(
      `SELECT u.user_id, u.full_name, u.email, u.role, pm.joined_at
       FROM project_members pm
       JOIN users u ON pm.user_id = u.user_id
       WHERE pm.project_id = ?
       ORDER BY u.full_name ASC`
    )
      .bind(params.projectId)
      .all();

    return Response.json({ project, members });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: DELETE /api/projects/:projectId
 *
 * Permanently deletes a project and everything scoped to it (check-ins and
 * their blockers, tasks, sprints, and the membership rows). Only the user who
 * created the project may delete it — membership alone (already enforced by the
 * scoped middleware) is not enough, since a shared project shouldn't be
 * destroyable by every member.
 *
 * The deletes are issued as a single D1 batch so they apply atomically: either
 * the whole project and its dependents go, or nothing does. Child rows are
 * removed before the parent `projects` row because SQLite/D1 enforces the
 * foreign keys (blockers → checkins → project, tasks/sprints/members → project).
 *
 * @param {{ env: { DB?: object }, params: { projectId: string }, data?: { userId?: number|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestDelete(context) {
  const { env, params, data } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const userId = data?.userId;
  const projectId = params.projectId;

  try {
    // The scoped middleware already confirmed the caller is a member; here we
    // additionally require that they are the creator before destroying it.
    const project = await env.DB.prepare("SELECT created_by FROM projects WHERE project_id = ?")
      .bind(projectId)
      .first();

    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.created_by !== userId) {
      return Response.json(
        { error: "Only the project creator can delete this project." },
        { status: 403 }
      );
    }

    // Order matters: clear the rows that reference this project (and the
    // blockers that reference its check-ins) before the project row itself.
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM blockers
         WHERE checkin_id IN (SELECT checkin_id FROM checkins WHERE project_id = ?)`
      ).bind(projectId),
      env.DB.prepare("DELETE FROM checkins WHERE project_id = ?").bind(projectId),
      env.DB.prepare("DELETE FROM tasks WHERE project_id = ?").bind(projectId),
      env.DB.prepare("DELETE FROM sprints WHERE project_id = ?").bind(projectId),
      env.DB.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId),
      env.DB.prepare("DELETE FROM projects WHERE project_id = ?").bind(projectId),
    ]);

    return Response.json({ success: true });
  } catch (err) {
    console.error("Delete project error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
