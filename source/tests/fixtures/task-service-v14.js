import { requireProjectMember } from "../../../functions/api/_auth.js";

/**
 * Executable compatibility fixture for the task update path at commit
 * d9caffe^, before migration 0015 added optimistic versions. The historical
 * handler updated fields by task id without reading or writing a version.
 * This fixture retains that deployed behavior without copying unrelated task
 * validation into the migration gate.
 */
export async function patchTaskV14(context) {
  const { env, params, request } = context;
  const body = await request.json();
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT task_id, project_id FROM tasks WHERE task_id = ?")
    .bind(params.taskId)
    .first();
  if (!existing) return Response.json({ error: "Task not found" }, { status: 404 });

  const denied = await requireProjectMember(context, existing.project_id);
  if (denied) return denied;

  await env.DB.prepare("UPDATE tasks SET title = ? WHERE task_id = ?")
    .bind(body.title.trim(), params.taskId)
    .run();
  const task = await env.DB.prepare("SELECT task_id, title FROM tasks WHERE task_id = ?")
    .bind(params.taskId)
    .first();
  return Response.json({ task });
}
