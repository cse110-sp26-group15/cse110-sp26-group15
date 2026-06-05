import { requireUser } from "../_auth.js";

const VALID_AGENT_TYPES = [
  "standup-summarizer",
  "spec-reviewer",
  "code-review",
  "qa-bot",
  "research-assistant",
  "general",
];

/**
 * Authorize access to an agent (by its user_id). An agent is a project member,
 * so the rule is "the caller shares at least one project with this agent" —
 * checked by intersecting both users' rows in project_members. Returns a
 * Response to abort (401 unauthenticated / 403 no shared project / 500 on DB
 * issues) or null when authorized. A non-existent or unshared agent yields 403
 * (the handler's own 404-for-non-agent still applies once authorized, because
 * any agent the UI surfaces comes from a project the caller belongs to).
 *
 * @param {{ env: { DB?: object }, data?: { userId?: number|null } }} context
 * @param {string} agentUserId
 * @returns {Promise<Response|null>}
 */
async function authorizeAgentAccess(context, agentUserId) {
  const unauth = requireUser(context);
  if (unauth) return unauth;

  const { env } = context;
  const callerId = context.data.userId;

  let shared;
  try {
    shared = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM project_members me
         JOIN project_members them ON them.project_id = me.project_id
        WHERE me.user_id = ? AND them.user_id = ?
        LIMIT 1`
    )
      .bind(callerId, agentUserId)
      .first();
  } catch (err) {
    console.error("authorizeAgentAccess: lookup failed", err);
    return Response.json({ error: "Authorization check failed." }, { status: 500 });
  }

  if (!shared) {
    return Response.json({ error: "You do not have access to this agent." }, { status: 403 });
  }
  return null;
}

/**
 * Cloudflare Pages function: GET /api/agents/:userId
 *
 * Fetches one agent (joined with the owning human) for the agent detail
 * panel / settings dialog. 404 when the user_id exists but is not an
 * agent so the UI can fall back cleanly.
 *
 * @param {{ env: { DB?: object }, params: { userId: string } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const { userId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const denied = await authorizeAgentAccess(context, userId);
  if (denied) return denied;

  try {
    const agent = await env.DB.prepare(
      `SELECT a.user_id, u.full_name, u.email, u.role,
              a.agent_type, a.description, a.last_active_at,
              a.owner_user_id, owner.full_name AS owner_name
         FROM agents a
         JOIN users u     ON u.user_id = a.user_id
         JOIN users owner ON owner.user_id = a.owner_user_id
         WHERE a.user_id = ?`
    )
      .bind(userId)
      .first();

    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    return Response.json({ agent });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: PATCH /api/agents/:userId
 *
 * Updates mutable agent fields. owner_user_id may be reassigned but
 * cannot be cleared (every agent must have a human owner — this is the
 * core accountability invariant) and cannot point at another agent.
 * Touching the agent also bumps `last_active_at` so the dashboard's
 * "last activity" line reflects manual edits as well as agent self-updates.
 *
 * Accepts any subset of: agent_type, owner_user_id, description, last_active_at.
 *
 * @param {{ env: { DB?: object }, params: { userId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPatch(context) {
  const { env, params, request } = context;
  const { userId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const denied = await authorizeAgentAccess(context, userId);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agent_type, owner_user_id, description, last_active_at } = body;

  const fields = [];
  const values = [];

  if (agent_type !== undefined) {
    if (!VALID_AGENT_TYPES.includes(agent_type)) {
      return Response.json(
        { error: `agent_type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    fields.push("agent_type = ?");
    values.push(agent_type);
  }

  if (owner_user_id !== undefined) {
    if (owner_user_id === null) {
      return Response.json({ error: "owner_user_id cannot be null" }, { status: 400 });
    }
    const owner = await env.DB.prepare(
      `SELECT u.user_id FROM users u
       LEFT JOIN agents a ON a.user_id = u.user_id
       WHERE u.user_id = ? AND a.user_id IS NULL`
    )
      .bind(Number(owner_user_id))
      .first();
    if (!owner) {
      return Response.json(
        { error: "owner_user_id must reference an existing non-agent user" },
        { status: 400 }
      );
    }
    fields.push("owner_user_id = ?");
    values.push(Number(owner_user_id));
  }

  if (description !== undefined) {
    fields.push("description = ?");
    values.push(description);
  }

  if (last_active_at !== undefined) {
    fields.push("last_active_at = ?");
    values.push(last_active_at);
  }

  if (fields.length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  values.push(userId);

  try {
    const exists = await env.DB.prepare("SELECT user_id FROM agents WHERE user_id = ?")
      .bind(userId)
      .first();
    if (!exists) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }

    await env.DB.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE user_id = ?`)
      .bind(...values)
      .run();

    const agent = await env.DB.prepare(
      `SELECT a.user_id, u.full_name, u.email, u.role,
              a.agent_type, a.description, a.last_active_at,
              a.owner_user_id, owner.full_name AS owner_name
         FROM agents a
         JOIN users u     ON u.user_id = a.user_id
         JOIN users owner ON owner.user_id = a.owner_user_id
         WHERE a.user_id = ?`
    )
      .bind(userId)
      .first();

    return Response.json({ agent });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
