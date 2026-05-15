export async function onRequestPatch(context) {
  const { env, params, request } = context;
  const { taskId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const VALID_STATUSES = ["todo", "in-progress", "done"];
  const { status, assigned_to } = body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const fields = [];
  const values = [];

  if (status !== undefined) {
    fields.push("status = ?");
    values.push(status);
  }
  if (assigned_to !== undefined) {
    fields.push("assigned_to = ?");
    values.push(assigned_to);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(taskId);

  try {
    await env.DB.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE task_id = ?`)
      .bind(...values)
      .run();

    const task = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.status, t.github_issue_url,
              u.user_id, u.full_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.task_id = ?`
    )
      .bind(taskId)
      .first();

    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    return Response.json({ task });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { taskId } = params;

  try {
    const task = await env.DB.prepare("SELECT task_id FROM tasks WHERE task_id = ?")
      .bind(taskId)
      .first();

    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    await env.DB.prepare("DELETE FROM tasks WHERE task_id = ?").bind(taskId).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
