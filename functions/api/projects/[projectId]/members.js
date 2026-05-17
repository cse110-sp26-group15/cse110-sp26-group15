export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results } = await env.DB.prepare(
      `SELECT u.user_id, u.full_name
       FROM project_members pm
       JOIN users u ON pm.user_id = u.user_id
       WHERE pm.project_id = ?
       ORDER BY u.full_name ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ members: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
