import { requireReferencedMember } from "../../_auth.js";

const VALID_STATUSES = ["todo", "in-progress", "done"];
const VALID_REVIEW_STATUSES = ["not-required", "pending", "approved", "needs-revision"];
const VALID_PRIORITIES = ["urgent", "high", "medium", "low"];

/**
 * Resolve a user_id to "human" / "agent" / "missing" along with the
 * agent's owner_user_id when applicable. Used by both POST and PATCH to
 * enforce the "agent-assigned tasks need a human reviewer" rule.
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
  // Decide on the *presence* of an agents row, not on owner_user_id.
  // owner is NOT NULL in the schema today but bad data shouldn't make a
  // bot suddenly look like a human.
  return row.agent_user_id != null
    ? { kind: "agent", owner_user_id: row.owner_user_id ?? null }
    : { kind: "human", owner_user_id: null };
}

const MAX_CLIENT_TOKEN_LENGTH = 128;

/**
 * Read one task back in the shape both POST responses use (the created row and
 * an idempotent replay of it). Extracted so the replay path cannot drift from
 * the create path.
 *
 * @param {object} db
 * @param {number|string} taskId
 * @returns {Promise<object|null>}
 */
async function readTask(db, taskId) {
  return db
    .prepare(
      `SELECT t.task_id, t.title, t.description, t.status, t.github_issue_url,
              t.reviewer_id, t.review_status, t.priority, t.created_at, t.pair_assignee,
              t.sprint_id, t.version,
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
}

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/tasks
 *
 * Returns every task on a project. Joins the assignee + reviewer so the
 * UI can render both names without follow-up requests. `is_agent` is
 * derived from the agents table so the task-card component can render
 * the AI badge directly off the API payload.
 *
 * @param {{ env: { DB: object }, params: { projectId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { projectId } = params;

  try {
    const { results } = await env.DB.prepare(
      `SELECT t.task_id, t.title, t.description, t.status, t.github_issue_url,
              t.reviewer_id, t.review_status, t.priority, t.created_at, t.pair_assignee,
              t.sprint_id, t.version,
              u.user_id, u.full_name,
              CASE WHEN a.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_agent,
              r.full_name AS reviewer_name
         FROM tasks t
         LEFT JOIN users u   ON t.assigned_to = u.user_id
         LEFT JOIN agents a  ON a.user_id = u.user_id
         LEFT JOIN users r   ON t.reviewer_id = r.user_id
         WHERE t.project_id = ?
         ORDER BY t.task_id ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ tasks: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: POST /api/projects/:projectId/tasks
 *
 * Creates a task. `status` defaults to 'todo' but the caller can pick
 * any value from VALID_STATUSES so the kanban "+" buttons land tasks in
 * the right column without a follow-up PATCH. `description` is optional.
 *
 * Agent-assignee oversight rule:
 *   When `assigned_to` is an AI agent, `reviewer_id` is required and
 *   must reference a non-agent user. If the client omits `reviewer_id`,
 *   we auto-default to the agent's owner so the "default but editable"
 *   UX from the task-form modal works on the API side too.
 *   `review_status` is auto-promoted from 'not-required' → 'pending'
 *   for agent-assigned tasks unless the caller passes another value.
 *
 * Idempotency:
 *   An offline client (android/) queues creates and replays them from a
 *   background job, so it can re-send a POST the server already committed but
 *   whose response never arrived. Passing `client_token` - an opaque id that
 *   stays the same across retries of the same queued op - makes the create
 *   at-most-once: the first delivery inserts, later deliveries return 200 with
 *   `idempotent_replay: true` and the row as it stands now. Omitting the token
 *   keeps the previous behaviour, so the web client is unaffected.
 *
 * @param {{ env: { DB: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    title,
    description = null,
    assigned_to = null,
    github_issue_url = null,
    status = "todo",
    priority = "medium",
    pair_assignee = null,
    sprint_id = null,
    client_token = null,
  } = body;
  let { reviewer_id = null, review_status = null } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return Response.json(
      { error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (review_status !== null && !VALID_REVIEW_STATUSES.includes(review_status)) {
    return Response.json(
      { error: `review_status must be one of: ${VALID_REVIEW_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  if (assigned_to === null || assigned_to === undefined || assigned_to === "") {
    return Response.json(
      { error: "A task must be assigned to a project member." },
      { status: 400 }
    );
  }

  // Bounded so a client cannot use the idempotency key as free storage, and
  // so the unique index stays on short values.
  if (
    client_token !== null &&
    (typeof client_token !== "string" ||
      client_token.trim() === "" ||
      client_token.length > MAX_CLIENT_TOKEN_LENGTH)
  ) {
    return Response.json(
      {
        error: `client_token must be a non-empty string of at most ${MAX_CLIENT_TOKEN_LENGTH} characters`,
      },
      { status: 400 }
    );
  }

  try {
    // Replay of a create that already landed. This is a read, not a write: the
    // caller gets the row as it stands now, so a replay can never resurrect the
    // original payload over edits somebody made in between.
    if (client_token !== null) {
      const prior = await env.DB.prepare(
        "SELECT task_id FROM tasks WHERE project_id = ? AND client_token = ?"
      )
        .bind(projectId, client_token)
        .first();
      if (prior) {
        return Response.json(
          { task: await readTask(env.DB, prior.task_id), idempotent_replay: true },
          { status: 200 }
        );
      }
    }

    const assignee = await classifyUser(env.DB, assigned_to);
    if (assigned_to && assignee.kind === "missing") {
      return Response.json({ error: "assigned_to references unknown user" }, { status: 400 });
    }

    // Keep the assignee contained to this project - a member can't assign a
    // task to a user (or agent) who isn't on the project.
    const assigneeContained = await requireReferencedMember(
      context,
      projectId,
      assigned_to,
      "assigned_to"
    );
    if (assigneeContained) return assigneeContained;

    if (assignee.kind === "agent") {
      // Default reviewer to the agent's owner when client omits it.
      if (reviewer_id == null) reviewer_id = assignee.owner_user_id;

      if (reviewer_id == null) {
        return Response.json(
          { error: "reviewer_id is required when assignee is an AI agent" },
          { status: 400 }
        );
      }
      const reviewer = await classifyUser(env.DB, reviewer_id);
      if (reviewer.kind !== "human") {
        return Response.json(
          { error: "reviewer_id must reference a non-agent user" },
          { status: 400 }
        );
      }
      // Agent tasks always start in a review state - never 'not-required'.
      if (!review_status || review_status === "not-required") review_status = "pending";
    } else {
      // Non-agent assignee. Reviewer is optional; if supplied it must be
      // a human and we move out of 'not-required' so the UI shows a pill.
      if (reviewer_id != null) {
        const reviewer = await classifyUser(env.DB, reviewer_id);
        if (reviewer.kind !== "human") {
          return Response.json(
            { error: "reviewer_id must reference a non-agent user" },
            { status: 400 }
          );
        }
        if (!review_status || review_status === "not-required") review_status = "pending";
      } else if (review_status == null) {
        review_status = "not-required";
      }
    }

    // sprint_id is silently dropped if it doesn't belong to this project -
    // safer than 400ing for a stale id sent by an open kanban tab.
    let resolvedSprintId = null;
    if (sprint_id != null) {
      const sprint = await env.DB.prepare(
        "SELECT sprint_id FROM sprints WHERE sprint_id = ? AND project_id = ?"
      )
        .bind(sprint_id, projectId)
        .first();
      resolvedSprintId = sprint ? sprint.sprint_id : null;
    }

    const insert = env.DB.prepare(
      `INSERT INTO tasks (project_id, assigned_to, title, description, status,
                          github_issue_url, reviewer_id, review_status, priority,
                          pair_assignee, sprint_id, client_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      projectId,
      assigned_to,
      title.trim(),
      description,
      status,
      github_issue_url,
      reviewer_id,
      review_status,
      priority,
      pair_assignee,
      resolvedSprintId,
      client_token
    );

    let result;
    try {
      result = await insert.run();
    } catch (err) {
      // Two deliveries of the same queued create can both miss the lookup
      // above and race to the INSERT. The partial unique index on
      // (project_id, client_token) settles it: the loser reads the winner's
      // row instead of failing, so the retry is still at-most-once.
      const prior =
        client_token === null
          ? null
          : await env.DB.prepare(
              "SELECT task_id FROM tasks WHERE project_id = ? AND client_token = ?"
            )
              .bind(projectId, client_token)
              .first();
      if (!prior) throw err;
      return Response.json(
        { task: await readTask(env.DB, prior.task_id), idempotent_replay: true },
        { status: 200 }
      );
    }

    const task = await readTask(env.DB, result.meta.last_row_id);

    return Response.json({ task }, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
