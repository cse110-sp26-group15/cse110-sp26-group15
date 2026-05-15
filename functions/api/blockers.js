export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const task = url.searchParams.get("task")?.trim();
  const general = url.searchParams.get("general");

  const db = env.BLOCKER_DB; // D1 database binding
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database binding not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const shouldQueryGeneral = general === "true" || task === "general" || task === "";

  // If the blocker is a general one rather than something related to a specific task
  if (shouldQueryGeneral) {
    const result = await db
      .prepare(
        `SELECT task, blocked, helper FROM blocker WHERE task IS NULL OR task = '' ORDER BY id DESC`
      )
      .all();

    return new Response(
      JSON.stringify({
        general: true,
        blocked: result.results.length > 0,
        blockers: result.results.map((row) => ({
          task: row.task,
          blocked: !!row.blocked,
          helper: row.helper || null,
        })),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // If the task does not exist in the query
  if (!task) {
    return new Response(
      JSON.stringify({
        error: "Missing task query. Use ?task=TaskName or ?general=true.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await db
    .prepare("SELECT task, blocked, helper FROM blocker WHERE task = ? ORDER BY id DESC LIMIT 1")
    .bind(task)
    .first();

  if (!result) {
    return new Response(
      JSON.stringify({
        task,
        blocked: false,
        helper: null,
        message: "No blocker data found for this task.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      task: result.task,
      blocked: !!result.blocked,
      helper: result.helper || null,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
