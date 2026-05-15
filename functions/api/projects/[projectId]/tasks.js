export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results } = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.status, t.github_issue_url,
              u.user_id, u.full_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.project_id = ?
       ORDER BY t.task_id ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ tasks: results });
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

  const { title, assigned_to = null, github_issue_url = null } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO tasks (project_id, assigned_to, title, status, github_issue_url)
       VALUES (?, ?, ?, 'todo', ?)`
    )
      .bind(projectId, assigned_to, title.trim(), github_issue_url)
      .run();

    const task = await env.DB.prepare("SELECT * FROM tasks WHERE task_id = ?")
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
