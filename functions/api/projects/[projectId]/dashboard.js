/** Number of calendar days of check-ins included in the dashboard payload. */
const CHECKIN_DAYS = 2;

/** Window size for the "agent contributions this week" rollup in `meta`. */
const WEEKLY_WINDOW_DAYS = 7;

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
      is_agent: row.is_agent === 1,
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
      is_agent: row.is_agent === 1,
    },
  };
}

/**
 * Maps a raw task row from D1 into the dashboard task shape. Surfaces the
 * reviewer + review_status fields so the task-card can render the review
 * pill without a second request.
 * @param {Record<string, unknown>} row
 * @returns {object}
 */
export function mapTask(row) {
  return {
    task_id: row.task_id,
    title: row.title,
    status: row.status,
    github_issue_url: row.github_issue_url,
    assigned_to: row.assigned_to,
    full_name: row.full_name,
    is_agent: row.is_agent === 1,
    reviewer_id: row.reviewer_id ?? null,
    reviewer_name: row.reviewer_name ?? null,
    review_status: row.review_status ?? "not-required",
  };
}

/**
 * Maps a raw agents row into the dashboard agents[] shape. Each agent
 * carries its current task (if any) and the count of unresolved blockers
 * tied to its tasks so the dashboard card can render those without
 * cross-referencing other arrays.
 * @param {Record<string, unknown>} row
 * @returns {object}
 */
export function mapAgent(row) {
  return {
    user_id: row.user_id,
    full_name: row.full_name,
    email: row.email,
    agent_type: row.agent_type,
    description: row.description,
    last_active_at: row.last_active_at,
    owner: {
      user_id: row.owner_user_id,
      full_name: row.owner_name,
    },
    current_task: row.current_task_id
      ? {
          task_id: row.current_task_id,
          title: row.current_task_title,
          status: row.current_task_status,
          review_status: row.current_task_review_status,
        }
      : null,
    open_blocker_count: row.open_blocker_count ?? 0,
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
 * @param {Record<string, unknown>[]} data.agents
 * @param {Record<string, unknown>} [data.weekly]
 * @returns {object}
 */
export function buildDashboardPayload({
  project,
  members,
  tasks,
  blockers,
  checkins,
  agents,
  weekly,
}) {
  const dateRange = getCheckinDateRange();

  return {
    project,
    members,
    agents: (agents ?? []).map(mapAgent),
    tasks: (tasks ?? []).map(mapTask),
    open_blockers: blockers.map(mapOpenBlocker),
    checkins: {
      date_range: dateRange,
      entries: checkins.map(mapCheckinEntry),
    },
    meta: {
      generated_at: new Date().toISOString(),
      checkin_days: CHECKIN_DAYS,
      weekly_window_days: WEEKLY_WINDOW_DAYS,
      agent_contributions: weekly ?? { tasks_completed: 0, checkins: 0, agent_count: 0 },
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

    const [membersResult, tasksResult, blockersResult, checkinsResult, agentsResult, weeklyResult] =
      await Promise.all([
        env.DB.prepare(
          `SELECT u.user_id, u.full_name, u.email, u.role, pm.joined_at,
                  CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent
             FROM project_members pm
             JOIN users u ON pm.user_id = u.user_id
             LEFT JOIN agents a ON a.user_id = u.user_id
             WHERE pm.project_id = ?
             ORDER BY u.full_name ASC`
        )
          .bind(projectId)
          .all(),
        env.DB.prepare(
          `SELECT t.task_id, t.title, t.status, t.github_issue_url,
                  t.assigned_to, t.reviewer_id, t.review_status, t.sprint_id,
                  u.full_name,
                  CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent,
                  r.full_name AS reviewer_name
             FROM tasks t
             LEFT JOIN users u  ON t.assigned_to = u.user_id
             LEFT JOIN agents a ON a.user_id = u.user_id
             LEFT JOIN users r  ON t.reviewer_id = r.user_id
             WHERE t.project_id = ?
             ORDER BY t.task_id ASC`
        )
          .bind(projectId)
          .all(),
        env.DB.prepare(
          `SELECT b.blocker_id, b.description, b.task, b.helper, b.checkin_id,
                  c.checkin_date, c.user_id, u.full_name,
                  CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent
             FROM blockers b
             JOIN checkins c ON b.checkin_id = c.checkin_id
             JOIN users u ON c.user_id = u.user_id
             LEFT JOIN agents a ON a.user_id = u.user_id
             WHERE c.project_id = ? AND b.is_resolved = 0
             ORDER BY b.blocker_id DESC`
        )
          .bind(projectId)
          .all(),
        env.DB.prepare(
          `SELECT c.checkin_id, c.checkin_date, c.status_mood, c.work_done, c.work_planned,
                  u.user_id, u.full_name,
                  CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent
             FROM checkins c
             JOIN users u ON c.user_id = u.user_id
             LEFT JOIN agents a ON a.user_id = u.user_id
             WHERE c.project_id = ?
               AND c.checkin_date >= date('now', '-1 day')
             ORDER BY c.checkin_date DESC, u.full_name ASC`
        )
          .bind(projectId)
          .all(),
        // Agents on this project, with their current (most recently
        // touched in-progress) task and a count of open task-scoped
        // blockers. Both are LEFT-joined so agents without a task or
        // without blockers still come back.
        env.DB.prepare(
          `SELECT ag.user_id, u.full_name, u.email,
                  ag.agent_type, ag.description, ag.last_active_at,
                  ag.owner_user_id, owner.full_name AS owner_name,
                  ct.task_id    AS current_task_id,
                  ct.title      AS current_task_title,
                  ct.status     AS current_task_status,
                  ct.review_status AS current_task_review_status,
                  COALESCE(bc.open_count, 0) AS open_blocker_count
             FROM agents ag
             JOIN users u           ON u.user_id = ag.user_id
             JOIN project_members m ON m.user_id = ag.user_id AND m.project_id = ?
             JOIN users owner       ON owner.user_id = ag.owner_user_id
             LEFT JOIN (
               SELECT assigned_to, task_id, title, status, review_status,
                      ROW_NUMBER() OVER (PARTITION BY assigned_to
                                         ORDER BY (status = 'in-progress') DESC, task_id DESC) AS rn
                 FROM tasks
                 WHERE project_id = ? AND status != 'done'
             ) ct ON ct.assigned_to = ag.user_id AND ct.rn = 1
             LEFT JOIN (
               SELECT c.user_id, COUNT(*) AS open_count
                 FROM blockers b
                 JOIN checkins c ON b.checkin_id = c.checkin_id
                 WHERE c.project_id = ? AND b.is_resolved = 0
                 GROUP BY c.user_id
             ) bc ON bc.user_id = ag.user_id
             ORDER BY u.full_name ASC`
        )
          .bind(projectId, projectId, projectId)
          .all(),
        // Weekly agent contributions for the meta block. Two scalars +
        // an agent count so the (planned) weekly-report page can render
        // a one-liner without an extra round-trip.
        env.DB.prepare(
          `SELECT
             (SELECT COUNT(*) FROM tasks t
                JOIN agents a ON a.user_id = t.assigned_to
                WHERE t.project_id = ? AND t.status = 'done')              AS tasks_completed,
             (SELECT COUNT(*) FROM checkins c
                JOIN agents a ON a.user_id = c.user_id
                WHERE c.project_id = ?
                  AND c.checkin_date >= date('now', ?))                    AS checkins,
             (SELECT COUNT(*) FROM agents a
                JOIN project_members m ON m.user_id = a.user_id
                WHERE m.project_id = ?)                                    AS agent_count`
        )
          .bind(projectId, projectId, `-${WEEKLY_WINDOW_DAYS - 1} days`, projectId)
          .first(),
      ]);

    const payload = buildDashboardPayload({
      project,
      members: membersResult.results,
      tasks: tasksResult.results,
      blockers: blockersResult.results,
      checkins: checkinsResult.results,
      agents: agentsResult.results,
      weekly: weeklyResult,
    });

    return Response.json(payload);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
