export async function onRequestPatch(context) {
  const { env, params, request } = context;
  const { blockerId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { is_resolved, description, task, helper } = body;

  const fields = [];
  const values = [];

  if (is_resolved !== undefined) {
    const resolved = is_resolved ? 1 : 0;
    fields.push("is_resolved = ?");
    values.push(resolved);
    fields.push(resolved ? "resolved_at = CURRENT_TIMESTAMP" : "resolved_at = NULL");
  }
  if (description !== undefined) {
    if (typeof description !== "string" || description.trim() === "") {
      return Response.json({ error: "description must be a non-empty string" }, { status: 400 });
    }
    fields.push("description = ?");
    values.push(description.trim());
  }
  if (task !== undefined) {
    fields.push("task = ?");
    values.push(task);
  }
  if (helper !== undefined) {
    fields.push("helper = ?");
    values.push(helper);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(blockerId);

  try {
    await env.DB.prepare(`UPDATE blockers SET ${fields.join(", ")} WHERE blocker_id = ?`)
      .bind(...values)
      .run();

    const blocker = await env.DB.prepare("SELECT * FROM blockers WHERE blocker_id = ?")
      .bind(blockerId)
      .first();

    if (!blocker) {
      return Response.json({ error: "Blocker not found" }, { status: 404 });
    }

    return Response.json({ blocker });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
