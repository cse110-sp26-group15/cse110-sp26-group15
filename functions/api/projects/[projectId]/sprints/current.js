/**
 * Cloudflare Pages function: GET /api/projects/:projectId/sprints/current
 *
 * Returns the sprint that contains today's date for the given project,
 * or the most recently-ended sprint if none are in flight. Returns
 * { sprint: null } (200, not 404) when the project has no sprints yet,
 * so the dashboard can render its empty state without treating absence
 * as an error.
 *
 * Response 200:
 *   { sprint: { sprint_id, number, start_date, end_date, goal } | null }
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
    // Prefer a sprint that contains today; fall back to the most recent.
    let sprint = await env.DB.prepare(
      `SELECT sprint_id, number, start_date, end_date, goal
       FROM sprints
       WHERE project_id = ?
         AND start_date <= date('now')
         AND end_date >= date('now')
       ORDER BY start_date DESC
       LIMIT 1`
    )
      .bind(params.projectId)
      .first();

    if (!sprint) {
      sprint = await env.DB.prepare(
        `SELECT sprint_id, number, start_date, end_date, goal
         FROM sprints
         WHERE project_id = ?
         ORDER BY end_date DESC
         LIMIT 1`
      )
        .bind(params.projectId)
        .first();
    }

    return Response.json({ sprint: sprint ?? null });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
