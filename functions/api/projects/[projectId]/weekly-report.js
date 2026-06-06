function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekDay = today.getDay();
  const start = new Date(today);
  start.setDate(today.getDate() - weekDay);
  const end = new Date(today);
  return {
    start: formatDate(start),
    end: formatDate(end) + "T23:59:59.999Z",
  };
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  try {
    const project = await env.DB.prepare(
      `SELECT project_id, name, description, workflow
         FROM projects
         WHERE project_id = ?`
    )
      .bind(projectId)
      .first();

    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const range = formatDateRange();

    const [
      tasksResult,
      openBlockersResult,
      resolvedBlockersResult,
      checkinsResult,
      workloadResult,
      membersResult,
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT t.task_id,
                  t.title,
                  t.status,
                  COALESCE(u.full_name, 'Unassigned') AS assignee
             FROM tasks t
             LEFT JOIN users u ON t.assigned_to = u.user_id
             WHERE t.project_id = ?
             ORDER BY t.task_id ASC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT b.blocker_id,
                  b.task,
                  b.description,
                  b.helper,
                  c.checkin_date,
                  u.full_name AS reported_by
             FROM blockers b
             JOIN checkins c ON b.checkin_id = c.checkin_id
             LEFT JOIN users u ON c.user_id = u.user_id
             WHERE c.project_id = ?
               AND b.is_resolved = 0
               AND DATE(c.checkin_date) BETWEEN ? AND ?
             ORDER BY c.checkin_date DESC`
      )
        .bind(projectId, range.start, range.end)
        .all(),
      env.DB.prepare(
        `SELECT b.blocker_id,
                  b.task,
                  b.description,
                  b.helper,
                  c.checkin_date,
                  u.full_name AS reported_by
             FROM blockers b
             JOIN checkins c ON b.checkin_id = c.checkin_id
             LEFT JOIN users u ON c.user_id = u.user_id
             WHERE c.project_id = ?
               AND b.is_resolved = 1
               AND c.checkin_date BETWEEN ? AND ?
             ORDER BY c.checkin_date DESC`
      )
        .bind(projectId, range.start, range.end)
        .all(),
      env.DB.prepare(
        `SELECT c.checkin_id,
                  c.checkin_date,
                  c.status_mood,
                  c.work_done,
                  c.work_planned,
                  u.user_id,
                  u.full_name
             FROM checkins c
             JOIN users u ON c.user_id = u.user_id
             WHERE c.project_id = ?
               AND c.checkin_date BETWEEN ? AND ?
             ORDER BY c.checkin_date DESC, u.full_name ASC`
      )
        .bind(projectId, range.start, range.end)
        .all(),
      env.DB.prepare(
        `SELECT COALESCE(u.user_id, 0) AS user_id,
                  COALESCE(u.full_name, 'Unassigned') AS full_name,
                  COUNT(*) AS task_count
             FROM tasks t
             LEFT JOIN users u ON t.assigned_to = u.user_id
             WHERE t.project_id = ?
               AND t.status != 'done'
             GROUP BY user_id, full_name
             ORDER BY task_count DESC, full_name ASC`
      )
        .bind(projectId)
        .all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total_team_members
             FROM project_members
             WHERE project_id = ?`
      )
        .bind(projectId)
        .first(),
    ]);

    const tasks = tasksResult.results ?? [];
    const openBlockers = openBlockersResult.results ?? [];
    const resolvedBlockers = resolvedBlockersResult.results ?? [];
    const checkins = checkinsResult.results ?? [];
    const workload = workloadResult.results ?? [];
    const members = membersResult ?? { total_team_members: 0 };

    const completedTasks = tasks.filter((task) => task.status === "done");
    const activeTasks = tasks.filter((task) => task.status !== "done");
    const uniqueParticipants = new Set(checkins.map((row) => row.user_id));

    return Response.json({
      project,
      range,
      counts: {
        completedTaskCount: completedTasks.length,
        activeTaskCount: activeTasks.length,
        openBlockersCount: openBlockers.length,
        resolvedBlockersCount: resolvedBlockers.length,
        totalCheckins: checkins.length,
        participatingMembers: uniqueParticipants.size,
        totalTeamMembers: Number(members.total_team_members) || 0,
      },
      tasks: {
        completed: completedTasks.slice(0, 8),
        active: activeTasks.slice(0, 8),
      },
      blockers: {
        open: openBlockers.slice(0, 8),
        resolved: resolvedBlockers.slice(0, 8),
      },
      checkins,
      workload,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
