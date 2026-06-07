import { requireProjectMember, requireReferencedMember } from "../_auth.js";

const VALID_STATUSES = ["todo", "in-progress", "done"];
const VALID_REVIEW_STATUSES = ["not-required", "pending", "approved", "needs-revision"];
const VALID_PRIORITIES = ["urgent", "high", "medium", "low"];

/**
 * Resolve a user_id to "human" / "agent" / "missing". See the matching
 * helper in projects/[projectId]/tasks.js for context.
 *
 * @param {object} db
 * @param {number} userId
 * @returns {Promise<{ kind: "human"|"agent"|"missing", owner_user_id: number|null }>}
 */
async function classifyUser(db, userId) {
  if (!userId) return { kind: "missing", owner_user_id: null };
  const row = await db
    .prepare(
      `SELECT u.user_id, a.user_id AS agent_user_id, a.owner_user_id
         FROM users u
         LEFT JOIN agents a ON a.user_id = u.user_id
         WHERE u.user_id = ?`
    )
    .bind(userId)
    .first();
  if (!row) return { kind: "missing", owner_user_id: null };
  return row.agent_user_id != null
    ? { kind: "agent", owner_user_id: row.owner_user_id ?? null }
    : { kind: "human", owner_user_id: null };
}

/**
 * Cloudflare Pages function: PATCH /api/tasks/:taskId
 *
 * Updates mutable task fields. Accepts any subset of:
 *   status, assigned_to, reviewer_id, review_status, description.
 *
 * Two invariants the API enforces (mirrors POST in tasks.js):
 *   1. If the new assignee is an AI agent and no reviewer is set
 *      (existing or incoming), the request is rejected.
 *   2. reviewer_id must point at a non-agent user. Agents cannot review
 *      other agents — that would defeat human accountability.
 */
export async function onRequestPatch(context) {
  const { env, params, request } = context;
  const { taskId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, assigned_to, reviewer_id, review_status, description, title, priority } = body;
  const { pair_assignee } = body;

  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return Response.json(
      { error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (review_status !== undefined && !VALID_REVIEW_STATUSES.includes(review_status)) {
    return Response.json(
      { error: `review_status must be one of: ${VALID_REVIEW_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  if (assigned_to !== undefined && (assigned_to === null || assigned_to === "")) {
    return Response.json(
      { error: "A task must be assigned to a project member." },
      { status: 400 }
    );
  }

  try {
    const existing = await env.DB.prepare(
      `SELECT task_id, project_id, assigned_to, reviewer_id, review_status FROM tasks WHERE task_id = ?`
    )
      .bind(taskId)
      .first();
    if (!existing) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    // The task carries the only project context this route has (no :projectId
    // in the URL), so resolve membership off the row before mutating it.
    const denied = await requireProjectMember(context, existing.project_id);
    if (denied) return denied;

    // Compute the post-update assignee/reviewer so we can validate as a
    // single coherent state rather than field-by-field.
    const nextAssigned = assigned_to === undefined ? existing.assigned_to : assigned_to;
    let nextReviewer = reviewer_id === undefined ? existing.reviewer_id : reviewer_id;
    let nextReviewStatus = review_status === undefined ? existing.review_status : review_status;

    const assignee = await classifyUser(env.DB, nextAssigned);
    if (nextAssigned && assignee.kind === "missing") {
      return Response.json({ error: "assigned_to references unknown user" }, { status: 400 });
    }

    // Keep a reassigned task's assignee contained to the task's project.
    const assigneeContained = await requireReferencedMember(
      context,
      existing.project_id,
      nextAssigned,
      "assigned_to"
    );
    if (assigneeContained) return assigneeContained;

    if (assignee.kind === "agent") {
      // If the caller didn't provide a reviewer and the existing reviewer
      // is empty, default to the agent's owner. This mirrors the POST
      // behavior and prevents PATCH from creating a no-reviewer agent task.
      if (nextReviewer == null) nextReviewer = assignee.owner_user_id;
      if (nextReviewer == null) {
        return Response.json(
          { error: "reviewer_id is required when assignee is an AI agent" },
          { status: 400 }
        );
      }
      const reviewer = await classifyUser(env.DB, nextReviewer);
      if (reviewer.kind !== "human") {
        return Response.json(
          { error: "reviewer_id must reference a non-agent user" },
          { status: 400 }
        );
      }
      if (!nextReviewStatus || nextReviewStatus === "not-required") {
        nextReviewStatus = "pending";
      }
    } else {
      if (nextReviewer != null) {
        const reviewer = await classifyUser(env.DB, nextReviewer);
        if (reviewer.kind !== "human") {
          return Response.json(
            { error: "reviewer_id must reference a non-agent user" },
            { status: 400 }
          );
        }
      } else if (!nextReviewStatus) {
        nextReviewStatus = "not-required";
      }
    }

    const fields = [];
    const values = [];
    if (title !== undefined) {
      fields.push("title = ?");
      values.push(title.trim());
    }
    if (priority !== undefined) {
      fields.push("priority = ?");
      values.push(priority);
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (assigned_to !== undefined) {
      fields.push("assigned_to = ?");
      values.push(assigned_to);
    }
    if (description !== undefined) {
      fields.push("description = ?");
      values.push(description);
    }
    if (pair_assignee !== undefined) {
      fields.push("pair_assignee = ?");
      values.push(pair_assignee);
    }
    // Always write the resolved reviewer/review_status so defaults stick.
    if (nextReviewer !== existing.reviewer_id) {
      fields.push("reviewer_id = ?");
      values.push(nextReviewer);
    }
    if (nextReviewStatus !== existing.review_status) {
      fields.push("review_status = ?");
      values.push(nextReviewStatus);
    }

    if (fields.length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    values.push(taskId);

    await env.DB.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE task_id = ?`)
      .bind(...values)
      .run();

    const task = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.description, t.status, t.github_issue_url,
              t.reviewer_id, t.review_status, t.priority, t.created_at, t.pair_assignee,
              u.user_id, u.full_name,
              CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent,
              r.full_name AS reviewer_name
         FROM tasks t
         LEFT JOIN users u  ON t.assigned_to = u.user_id
         LEFT JOIN agents a ON a.user_id = u.user_id
         LEFT JOIN users r  ON t.reviewer_id = r.user_id
         WHERE t.task_id = ?`
    )
      .bind(taskId)
      .first();

    return Response.json({ task });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { taskId } = params;

  try {
    const task = await env.DB.prepare("SELECT task_id, project_id FROM tasks WHERE task_id = ?")
      .bind(taskId)
      .first();

    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }

    const denied = await requireProjectMember(context, task.project_id);
    if (denied) return denied;

    await env.DB.prepare("DELETE FROM tasks WHERE task_id = ?").bind(taskId).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
