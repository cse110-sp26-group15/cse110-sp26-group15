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
         AND c.checkin_date >= DATE('now', '-2 days')
       ORDER BY c.checkin_date DESC, c.checkin_id DESC`
    )
      .bind(projectId)
      .all();

    return Response.json({ checkins: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
