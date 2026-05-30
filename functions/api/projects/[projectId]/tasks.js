const VALID_STATUSES = ["todo", "in-progress", "done"];

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/tasks
 *
 * Returns every task on a project, with the assignee joined in so the
 * UI can show "Alex K." without a second round-trip.
 *
 * @param {{ env: { DB: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results } = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.description, t.status, t.github_issue_url,
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

/**
 * Cloudflare Pages function: POST /api/projects/:projectId/tasks
 *
 * Creates a task. `status` defaults to 'todo' but the caller can pick
 * any value from VALID_STATUSES so the kanban "+" buttons land tasks in
 * the right column without a follow-up PATCH. `description` is optional.
 *
 * @param {{ env: { DB: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    title,
    description = null,
    assigned_to = null,
    github_issue_url = null,
    status = "todo",
  } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO tasks (project_id, assigned_to, title, description, status, github_issue_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(projectId, assigned_to, title.trim(), description, status, github_issue_url)
      .run();

    const task = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.description, t.status, t.github_issue_url,
              u.user_id, u.full_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.task_id = ?`
    )
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
