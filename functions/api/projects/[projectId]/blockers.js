/**
 * Cloudflare Pages function: GET /api/projects/:projectId/blockers
 *
 * Returns blockers scoped to a single project. All queries join through
 * `checkins` so the response always carries the reporter's name and the
 * check-in date — what the dashboards need to render the blocker list.
 *
 * Query modes:
 *   (no query)     → all *open* blockers for this project.
 *   ?general=true  → blockers for this project where `task` is null/empty.
 *                    Used by the "General blockers" rail variant.
 *   ?task=<name>   → blockers tagged with that task name in this project.
 *
 * Response shape (all modes):
 *   {
 *     blockers: [{ blocker_id, task, blocked, helper, description,
 *                  reported_by, checkin_id, checkin_date, is_resolved }]
 *   }
 *
 * @param {{ env: { DB?: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const url = new URL(request.url);
  const task = url.searchParams.get("task")?.trim();
  const general = url.searchParams.get("general");

  // Shared columns: every mode returns the same row shape so callers
  // never have to branch on which query they used.
  const SELECT_COLS = `b.blocker_id, b.task, b.description, b.helper, b.is_resolved,
                       b.checkin_id, c.checkin_date, u.user_id, u.full_name`;

  const mapRow = (row) => ({
    blocker_id: row.blocker_id,
    task: row.task,
    description: row.description,
    helper: row.helper || null,
    is_resolved: Boolean(row.is_resolved),
    blocked: !row.is_resolved,
    checkin_id: row.checkin_id,
    checkin_date: row.checkin_date,
    reported_by: row.full_name || null,
    user_id: row.user_id,
    full_name: row.full_name || null,
  });

  try {
    let results;

    if (general === "true" || task === "general" || task === "") {
      ({ results } = await env.DB.prepare(
        `SELECT ${SELECT_COLS}
         FROM blockers b
         JOIN checkins c ON b.checkin_id = c.checkin_id
         LEFT JOIN users u ON c.user_id = u.user_id
         WHERE c.project_id = ? AND (b.task IS NULL OR b.task = '')
         ORDER BY b.blocker_id DESC`
      )
        .bind(projectId)
        .all());

      return Response.json({
        general: true,
        blocked: results.some((row) => !row.is_resolved),
        blockers: results.map(mapRow),
      });
    }

    if (task) {
      ({ results } = await env.DB.prepare(
        `SELECT ${SELECT_COLS}
         FROM blockers b
         JOIN checkins c ON b.checkin_id = c.checkin_id
         LEFT JOIN users u ON c.user_id = u.user_id
         WHERE c.project_id = ? AND b.task = ?
         ORDER BY b.blocker_id DESC`
      )
        .bind(projectId, task)
        .all());

      return Response.json({
        task,
        blocked: results.some((row) => !row.is_resolved),
        blockers: results.map(mapRow),
      });
    }

    // Default: every open blocker for this project (what scrum.js wants).
    ({ results } = await env.DB.prepare(
      `SELECT ${SELECT_COLS}
       FROM blockers b
       JOIN checkins c ON b.checkin_id = c.checkin_id
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE c.project_id = ? AND b.is_resolved = 0
       ORDER BY b.blocker_id DESC`
    )
      .bind(projectId)
      .all());

    return Response.json({ blockers: results.map(mapRow) });
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

  const { checkin_id, description, task = null, helper = null } = body;

  if (checkin_id === undefined || checkin_id === null) {
    return Response.json({ error: "checkin_id is required" }, { status: 400 });
  }
  if (!description || typeof description !== "string" || description.trim() === "") {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  try {
    const checkin = await env.DB.prepare(
      "SELECT checkin_id FROM checkins WHERE checkin_id = ? AND project_id = ?"
    )
      .bind(checkin_id, projectId)
      .first();

    if (!checkin) {
      return Response.json(
        { error: "checkin_id does not belong to this project" },
        { status: 400 }
      );
    }

    const result = await env.DB.prepare(
      `INSERT INTO blockers (checkin_id, description, task, helper)
       VALUES (?, ?, ?, ?)`
    )
      .bind(checkin_id, description.trim(), task, helper)
      .run();

    const blocker = await env.DB.prepare("SELECT * FROM blockers WHERE blocker_id = ?")
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ blocker }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
