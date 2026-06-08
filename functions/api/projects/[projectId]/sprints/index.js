/**
 * Cloudflare Pages function: POST /api/projects/:projectId/sprints
 *
 * Creates a sprint row for the project. The scrum dashboard's sprint
 * picker calls this so the chosen window is persisted server-side rather
 * than only sitting in localStorage — without this, the `sprints` table
 * was never written to and `sprint_id` on tasks was always null.
 *
 * Membership is enforced by the parent `_middleware.js`; this handler
 * trusts that `context.data.userId` is a member of `:projectId`.
 *
 * Request body: { number: integer >= 1, start_date: 'YYYY-MM-DD',
 *                 end_date: 'YYYY-MM-DD', goal?: string|null }
 *
 * Response 201: { sprint: { sprint_id, number, start_date, end_date, goal } }
 *
 * Also exposes GET so the dashboard can list sprints if/when the UI grows a
 * picker dropdown. Returns rows sorted by sprint number for stable order.
 *
 * @param {{ env: { DB?: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT sprint_id, number, start_date, end_date, goal
       FROM sprints
       WHERE project_id = ?
       ORDER BY number ASC`
    )
      .bind(params.projectId)
      .all();
    return Response.json({ sprints: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { env, params, request } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { number, start_date, end_date, goal = null } = body ?? {};

  if (!Number.isInteger(number) || number < 1) {
    return Response.json({ error: "number must be a positive integer" }, { status: 400 });
  }
  if (typeof start_date !== "string" || !ISO_DATE.test(start_date)) {
    return Response.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (typeof end_date !== "string" || !ISO_DATE.test(end_date)) {
    return Response.json({ error: "end_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (end_date < start_date) {
    return Response.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }
  if (goal != null && typeof goal !== "string") {
    return Response.json({ error: "goal must be a string or null" }, { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO sprints (project_id, number, start_date, end_date, goal)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(params.projectId, number, start_date, end_date, goal)
      .run();

    const sprint = await env.DB.prepare(
      "SELECT sprint_id, number, start_date, end_date, goal FROM sprints WHERE sprint_id = ?"
    )
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ sprint }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
