/** Number of calendar days of check-ins included in the dashboard payload. */
const CHECKIN_DAYS = 2;

/**
 * Returns the inclusive calendar date range for the check-in window.
 * @returns {{ from: string, to: string }} ISO date strings (YYYY-MM-DD).
 */
export function getCheckinDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (CHECKIN_DAYS - 1));

  return {
    from: formatDate(from),
    to: formatDate(to),
  };
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Maps a raw blocker row from D1 into the dashboard open_blockers shape.
 * @param {Record<string, unknown>} row
 * @returns {object}
 */
export function mapOpenBlocker(row) {
  return {
    blocker_id: row.blocker_id,
    description: row.description,
    task: row.task ?? null,
    helper: row.helper ?? null,
    checkin_id: row.checkin_id,
    reported_by: {
      user_id: row.user_id,
      full_name: row.full_name,
    },
    checkin_date: row.checkin_date,
  };
}

/**
 * Maps a raw check-in row from D1 into the dashboard checkins.entries shape.
 * @param {Record<string, unknown>} row
 * @returns {object}
 */
export function mapCheckinEntry(row) {
  return {
    checkin_id: row.checkin_id,
    checkin_date: row.checkin_date,
    status_mood: row.status_mood,
    work_done: row.work_done,
    work_planned: row.work_planned,
    user: {
      user_id: row.user_id,
      full_name: row.full_name,
    },
  };
}

/**
 * Builds the aggregate dashboard JSON payload from query results.
 * @param {object} data
 * @param {Record<string, unknown>} data.project
 * @param {Record<string, unknown>[]} data.members
 * @param {Record<string, unknown>[]} data.tasks
 * @param {Record<string, unknown>[]} data.blockers
 * @param {Record<string, unknown>[]} data.checkins
 * @returns {object}
 */
export function buildDashboardPayload({ project, members, tasks, blockers, checkins }) {
  const dateRange = getCheckinDateRange();

  return {
    project,
    members,
    tasks,
    open_blockers: blockers.map(mapOpenBlocker),
    checkins: {
      date_range: dateRange,
      entries: checkins.map(mapCheckinEntry),
    },
    meta: {
      generated_at: new Date().toISOString(),
      checkin_days: CHECKIN_DAYS,
    },
  };
}

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/dashboard
 * @param {{ env: { DB?: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  try {
    const project = await env.DB.prepare(
      `SELECT project_id, name, description, created_at
       FROM projects
       WHERE project_id = ?`
    )
      .bind(projectId)
      .first();

    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const [membersResult, tasksResult, blockersResult, checkinsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT u.user_id, u.full_name, u.email, u.role, pm.joined_at
         FROM project_members pm
         JOIN users u ON pm.user_id = u.user_id
         WHERE pm.project_id = ?
         ORDER BY u.full_name ASC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT t.task_id, t.title, t.status, t.github_issue_url,
                t.assigned_to, u.full_name
         FROM tasks t
         LEFT JOIN users u ON t.assigned_to = u.user_id
         WHERE t.project_id = ?
         ORDER BY t.task_id ASC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT b.blocker_id, b.description, b.task, b.helper, b.checkin_id,
                c.checkin_date, c.user_id, u.full_name
         FROM blockers b
         JOIN checkins c ON b.checkin_id = c.checkin_id
         JOIN users u ON c.user_id = u.user_id
         WHERE c.project_id = ? AND b.is_resolved = 0
         ORDER BY b.blocker_id DESC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT c.checkin_id, c.checkin_date, c.status_mood, c.work_done, c.work_planned,
                u.user_id, u.full_name
         FROM checkins c
         JOIN users u ON c.user_id = u.user_id
         WHERE c.project_id = ?
           AND c.checkin_date >= date('now', '-1 day')
         ORDER BY c.checkin_date DESC, u.full_name ASC`
      )
        .bind(projectId)
        .all(),
    ]);

    const payload = buildDashboardPayload({
      project,
      members: membersResult.results,
      tasks: tasksResult.results,
      blockers: blockersResult.results,
      checkins: checkinsResult.results,
    });

    return Response.json(payload);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
