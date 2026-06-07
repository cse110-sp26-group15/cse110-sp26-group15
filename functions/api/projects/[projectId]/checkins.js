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

  const { status_mood = null, work_done = null, work_planned = null, checkin_date = null } = body;

  // The author is the authenticated caller (the project-scoped middleware has
  // already confirmed they are a member), never a client-supplied user_id — so
  // a member cannot post a check-in as a teammate.
  const user_id = context.data.userId;

  try {
    // Enforce one check-in per user per day, scoped to this project (a user
    // can still check in to other projects the same day). checkin_date is
    // stored as a full timestamp, so we compare on the calendar date via
    // SQLite's date(): an existing row whose date matches the new check-in's
    // date (or today, when the client sends none) blocks the insert.
    const existing = await env.DB.prepare(
      `SELECT checkin_id FROM checkins
        WHERE user_id = ? AND project_id = ?
          AND date(checkin_date) = date(COALESCE(?, 'now'))`
    )
      .bind(user_id, projectId, checkin_date)
      .first();

    if (existing) {
      return Response.json({ error: "You've already checked in today." }, { status: 409 });
    }

    // Persist the exact moment the check-in was completed. The client sends an
    // ISO timestamp (its local "now"); when it's missing we fall back to the
    // server clock. The column default was date-only (CURRENT_DATE), which lost
    // the time of day — storing the full timestamp keeps the card's date AND
    // time accurate and lets the "already checked in today" check compare real
    // moments rather than midnight-stamped dates.
    const result = await env.DB.prepare(
      `INSERT INTO checkins (user_id, project_id, status_mood, work_done, work_planned, checkin_date)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
      .bind(user_id, projectId, status_mood, work_done, work_planned, checkin_date)
      .run();

    const checkin = await env.DB.prepare("SELECT * FROM checkins WHERE checkin_id = ?")
      .bind(result.meta.last_row_id)
      .first();

    return Response.json({ checkin }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
