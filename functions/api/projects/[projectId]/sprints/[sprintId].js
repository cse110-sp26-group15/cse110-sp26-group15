/**
 * Cloudflare Pages function: PATCH /api/projects/:projectId/sprints/:sprintId
 *
 * Updates an existing sprint's window or goal. Backs the scrum picker's
 * "edit current sprint" mode so the user can extend or shorten an in-flight
 * sprint without having to drop the row and re-create it (which would
 * break any tasks already linked to it via sprint_id).
 *
 * Membership is enforced by the parent `_middleware.js`. We additionally
 * verify the sprint belongs to `:projectId` so a member of one project
 * can't tamper with another project's sprint by guessing the id.
 *
 * Request body: any subset of { start_date, end_date, goal }
 *
 * Response 200: { sprint }
 *
 * @param {{ env: { DB?: object }, params: { projectId: string, sprintId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestPatch(context) {
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

  const existing = await env.DB.prepare(
    "SELECT sprint_id, project_id, start_date, end_date FROM sprints WHERE sprint_id = ?"
  )
    .bind(params.sprintId)
    .first();

  if (!existing) {
    return Response.json({ error: "Sprint not found" }, { status: 404 });
  }
  if (String(existing.project_id) !== String(params.projectId)) {
    return Response.json({ error: "Sprint does not belong to this project" }, { status: 404 });
  }

  const fields = [];
  const values = [];

  if (body.start_date !== undefined) {
    if (typeof body.start_date !== "string" || !ISO_DATE.test(body.start_date)) {
      return Response.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
    }
    fields.push("start_date = ?");
    values.push(body.start_date);
  }
  if (body.end_date !== undefined) {
    if (typeof body.end_date !== "string" || !ISO_DATE.test(body.end_date)) {
      return Response.json({ error: "end_date must be YYYY-MM-DD" }, { status: 400 });
    }
    fields.push("end_date = ?");
    values.push(body.end_date);
  }
  if (body.goal !== undefined) {
    if (body.goal != null && typeof body.goal !== "string") {
      return Response.json({ error: "goal must be a string or null" }, { status: 400 });
    }
    fields.push("goal = ?");
    values.push(body.goal);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  // Cross-field validation against the post-update state.
  const nextStart = body.start_date ?? existing.start_date;
  const nextEnd = body.end_date ?? existing.end_date;
  if (nextEnd < nextStart) {
    return Response.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }

  values.push(params.sprintId);

  try {
    await env.DB.prepare(`UPDATE sprints SET ${fields.join(", ")} WHERE sprint_id = ?`)
      .bind(...values)
      .run();

    const sprint = await env.DB.prepare(
      "SELECT sprint_id, number, start_date, end_date, goal FROM sprints WHERE sprint_id = ?"
    )
      .bind(params.sprintId)
      .first();

    return Response.json({ sprint });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
