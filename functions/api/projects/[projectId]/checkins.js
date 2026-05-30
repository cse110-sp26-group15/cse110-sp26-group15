export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results } = await env.DB.prepare(
      `SELECT c.checkin_id, c.status_mood, c.work_done, c.work_planned, c.checkin_date,
              u.user_id, u.full_name
       FROM checkins c
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE c.project_id = ?
       ORDER BY c.checkin_date DESC, c.checkin_id DESC`
    )
      .bind(projectId)
      .all();

    return Response.json({ checkins: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { user_id, status_mood = null, work_done = null, work_planned = null } = body;

  if (user_id === undefined || user_id === null) {
    return Response.json({ error: "user_id is required" }, { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(user_id, projectId, status_mood, work_done, work_planned)
      .run();

    const checkin = await env.DB.prepare("SELECT * FROM checkins WHERE checkin_id = ?")
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ checkin }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
