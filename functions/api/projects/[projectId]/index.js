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
