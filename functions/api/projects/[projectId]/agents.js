import { requireReferencedMember } from "../../_auth.js";

const VALID_AGENT_TYPES = [
  "standup-summarizer",
  "spec-reviewer",
  "code-review",
  "qa-bot",
  "research-assistant",
  "general",
];

/**
 * Cloudflare Pages function: GET /api/projects/:projectId/agents
 *
 * Returns every AI agent that is a member of the project, joined with
 * the owner's display info so the dashboard can render the "managed by"
 * line without a follow-up request. Returns an empty `agents` array
 * (rather than 404) when the project has no agents — keeps the UI's
 * graceful empty-state path simple.
 *
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
    const { results } = await env.DB.prepare(
      `SELECT a.user_id, u.full_name, u.email, u.role,
              a.agent_type, a.description, a.last_active_at,
              a.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email
         FROM agents a
         JOIN users u           ON u.user_id = a.user_id
         JOIN project_members m ON m.user_id = a.user_id
         JOIN users owner       ON owner.user_id = a.owner_user_id
         WHERE m.project_id = ?
         ORDER BY u.full_name ASC`
    )
      .bind(projectId)
      .all();

    return Response.json({ agents: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Cloudflare Pages function: POST /api/projects/:projectId/agents
 *
 * Creates a new AI agent and adds it to the project. An agent is a row
 * in `users` (role='AI-agent') plus a 1:1 row in `agents` carrying the
 * agent metadata. `owner_user_id` is required and must reference an
 * existing non-agent user — every agent must have a human accountable
 * for its work (acceptance criterion: "Teams cannot assign work to an
 * AI agent without human accountability.").
 *
 * Request body:
 *   - full_name {string}      Required. Display name (e.g. 'SitRep-Bot-v1').
 *   - email     {string}      Required. Used only as a unique identifier; agents do not log in.
 *   - agent_type {string}     Required. One of VALID_AGENT_TYPES.
 *   - owner_user_id {number}  Required. The human responsible for the agent.
 *   - description {string|null} Optional.
 *
 * Response 201: { agent: { user_id, full_name, agent_type, owner_user_id, ... } }
 *
 * @param {{ env: { DB?: object }, params: { projectId: string }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { projectId } = params;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { full_name, email, agent_type, owner_user_id, description = null } = body;

  if (!full_name || typeof full_name !== "string" || full_name.trim() === "") {
    return Response.json({ error: "full_name is required" }, { status: 400 });
  }
  if (!email || typeof email !== "string" || email.trim() === "") {
    return Response.json({ error: "email is required" }, { status: 400 });
  }
  if (!agent_type || !VALID_AGENT_TYPES.includes(agent_type)) {
    return Response.json(
      { error: `agent_type must be one of: ${VALID_AGENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!owner_user_id || !Number.isInteger(Number(owner_user_id))) {
    return Response.json({ error: "owner_user_id is required" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ownerId = Number(owner_user_id);

  try {
    // Owner must exist and must not itself be an agent — agents can't own agents.
    const owner = await env.DB.prepare(
      `SELECT u.user_id, u.full_name
         FROM users u
         LEFT JOIN agents a ON a.user_id = u.user_id
         WHERE u.user_id = ? AND a.user_id IS NULL`
    )
      .bind(ownerId)
      .first();

    if (!owner) {
      return Response.json(
        { error: "owner_user_id must reference an existing non-agent user" },
        { status: 400 }
      );
    }

    // The accountable human owner must be on this project too.
    const ownerContained = await requireReferencedMember(
      context,
      projectId,
      ownerId,
      "owner_user_id"
    );
    if (ownerContained) return ownerContained;

    // Reject duplicate emails up front for a clean 409 instead of an FK abort.
    const existing = await env.DB.prepare(`SELECT user_id FROM users WHERE email = ?`)
      .bind(normalizedEmail)
      .first();
    if (existing) {
      return Response.json({ error: "A user with this email already exists." }, { status: 409 });
    }

    // Insert the agent's user row. password_hash is empty — agents don't log in.
    const userInsert = await env.DB.prepare(
      `INSERT INTO users (full_name, email, role, password_hash, is_active)
       VALUES (?, ?, 'AI-agent', '', 1)`
    )
      .bind(full_name.trim(), normalizedEmail)
      .run();

    const userId = userInsert.meta.last_row_id;

    await env.DB.prepare(
      `INSERT INTO agents (user_id, agent_type, owner_user_id, description, last_active_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(userId, agent_type, ownerId, description)
      .run();

    // Add the agent as a project member so it shows up in member lists,
    // dashboard queries, and task assignment dropdowns.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
    )
      .bind(projectId, userId)
      .run();

    const agent = await env.DB.prepare(
      `SELECT a.user_id, u.full_name, u.email, u.role,
              a.agent_type, a.description, a.last_active_at,
              a.owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email
         FROM agents a
         JOIN users u     ON u.user_id = a.user_id
         JOIN users owner ON owner.user_id = a.owner_user_id
         WHERE a.user_id = ?`
    )
      .bind(userId)
      .first();

    return Response.json({ agent }, { status: 201 });
  } catch (err) {
    console.error("Create agent error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
