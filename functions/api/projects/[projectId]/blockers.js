export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const task = url.searchParams.get("task")?.trim();
  const general = url.searchParams.get("general");

  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database binding not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const shouldQueryGeneral = general === "true" || task === "general" || task === "";

  // If the task parameter is "general", empty, or if the general flag is set, return all general blockers
  if (shouldQueryGeneral) {
    const result = await db
      .prepare(
        `SELECT task, is_resolved, helper, description
         FROM blockers
         WHERE task IS NULL OR task = ''
         ORDER BY blocker_id DESC`
      )
      .all();

    return new Response(
      JSON.stringify({
        general: true,
        blocked: result.results.some((row) => !row.is_resolved),
        blockers: result.results.map((row) => ({
          task: row.task,
          blocked: !row.is_resolved,
          helper: row.helper || null,
          description: row.description,
        })),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // If the task doesn't exist, return an error
  if (!task) {
    return new Response(
      JSON.stringify({
        error: "Missing task query. Use ?task=TaskName or ?general=true.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await db
    .prepare(
      `SELECT task, is_resolved, helper, description
       FROM blockers
       WHERE task = ?
       ORDER BY blocker_id DESC
       LIMIT 1`
    )
    .bind(task)
    .all();

  // If no blocker data is found for the task, return a response indicating that the task is not blocked
  if (!result) {
    return new Response(
      JSON.stringify({
        task,
        blocked: false,
        helper: null,
        description: null,
        message: "No blocker data found for this task.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Return the blocker status for the specified task
  return new Response(
    JSON.stringify({
      task,
      blocked: result.results.some((row) => !row.is_resolved),
      blockers: result.results.map((row) => ({
        blocked: !row.is_resolved,
        helper: row.helper || null,
        description: row.description,
      })),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
