/**
 * Cloudflare Pages function: GET /api/blockers
 *
 * Cross-project blocker lookup used by the dashboard blocker rail
 * (source/blocker-card/blocker-card-init.js). The rail mounts on any
 * page that has a `#dashboard-view` container and doesn't know what
 * project it lives under, so this endpoint serves blockers across
 * every project rather than scoping by `:projectId`.
 *
 * Query params:
 *   ?general=true  → return every blocker (resolved + unresolved)
 *                    enriched with reporter/task info for the rail.
 *   ?task=<name>   → return blockers tagged with that task name.
 *
 * Response shape mirrors the project-scoped GET so the rail's
 * `mapApiBlocker` helper accepts either source.
 *
 * @param {{ request: Request, env: { DB?: object } }} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const url = new URL(request.url);
  const task = url.searchParams.get("task")?.trim();
  const general = url.searchParams.get("general");

  const wantGeneral = general === "true" || task === "general" || task === "";

  try {
    if (wantGeneral) {
      const { results } = await env.DB.prepare(
        `SELECT b.blocker_id, b.task, b.description, b.helper, b.is_resolved,
                b.checkin_id, c.checkin_date, u.user_id, u.full_name
         FROM blockers b
         LEFT JOIN checkins c ON b.checkin_id = c.checkin_id
         LEFT JOIN users u ON c.user_id = u.user_id
         ORDER BY b.blocker_id DESC`
      ).all();

      return Response.json({
        general: true,
        blocked: results.some((row) => !row.is_resolved),
        blockers: results.map((row) => ({
          blocker_id: row.blocker_id,
          task: row.task,
          blocked: !row.is_resolved,
          helper: row.helper || null,
          description: row.description,
          reported_by: row.full_name || null,
          checkin_id: row.checkin_id,
          checkin_date: row.checkin_date,
        })),
      });
    }

    if (!task) {
      return Response.json(
        { error: "Missing task query. Use ?task=TaskName or ?general=true." },
        { status: 400 }
      );
    }

    const { results } = await env.DB.prepare(
      `SELECT b.blocker_id, b.task, b.description, b.helper, b.is_resolved,
              c.checkin_date, u.full_name
       FROM blockers b
       LEFT JOIN checkins c ON b.checkin_id = c.checkin_id
       LEFT JOIN users u ON c.user_id = u.user_id
       WHERE b.task = ?
       ORDER BY b.blocker_id DESC`
    )
      .bind(task)
      .all();

    return Response.json({
      task,
      blocked: results.some((row) => !row.is_resolved),
      blockers: results.map((row) => ({
        blocker_id: row.blocker_id,
        blocked: !row.is_resolved,
        helper: row.helper || null,
        description: row.description,
        reported_by: row.full_name || null,
      })),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
