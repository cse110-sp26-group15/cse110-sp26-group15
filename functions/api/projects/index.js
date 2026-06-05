import { requireUser } from "../_auth.js";

const VALID_WORKFLOWS = ["scrum", "kanban", "xp"];

/**
 * Cloudflare Pages function: GET /api/projects
 *
 * Lists the projects the authenticated caller is a member of. The caller is
 * taken from the session (context.data.userId), never from a query param, so a
 * client cannot enumerate another user's — or every — project. Each row
 * includes `member_count` so callers can render a picker without a second
 * round-trip, plus an `is_owner` flag marking the projects this caller created
 * (the only ones they're allowed to delete).
 *
 * @param {{ env: { DB?: object }, data?: { userId?: number|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const denied = requireUser(context);
  if (denied) return denied;
  const userId = context.data.userId;

  try {
    const { results } = await env.DB.prepare(
      `SELECT p.project_id, p.name, p.description, p.workflow, p.created_by, p.created_at,
              (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) AS member_count
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.project_id
       WHERE pm.user_id = ?
       ORDER BY p.created_at DESC`
    )
      .bind(userId)
      .all();

    // Tag each project with whether this caller created it. Only the creator may
    // delete a project (enforced by the DELETE handler), so the Projects page
    // uses this server-derived flag to decide whether to show the delete
    // control — rather than comparing against client-side state, which the
    // session cookie can outlive.
    const projects = (results ?? []).map((p) => ({
      ...p,
      is_owner: p.created_by === userId,
    }));

    return Response.json({ projects });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Returns true when `email` matches the basic local@domain.tld shape.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Cloudflare Pages function: POST /api/projects
 *
 * Creates a new project, registers the creator (when supplied) as a member,
 * and resolves any invited member emails to existing users in `project_members`.
 * Emails with no matching user are returned in `not_found` rather than failing
 * the request.
 *
 * Request body:
 *   - name {string}       Required. Project display name.
 *   - workflow {string}   Optional. One of 'scrum' | 'kanban' | 'xp'. Defaults to 'scrum'.
 *   - description {string|null} Optional.
 *   - members {string[]}  Optional. Invited member emails.
 *
 * The creator is the authenticated caller (session), added as a member. Any
 * `created_by` in the body is ignored so a client cannot create a project owned
 * by someone else.
 *
 * Response 201:
 *   { project, invited: [{ user_id, email }], not_found: string[] }
 *
 * @param {{ env: { DB?: object }, request: Request, data?: { userId?: number|null } }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const denied = requireUser(context);
  if (denied) return denied;
  const creatorId = context.data.userId;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, workflow = "scrum", description = null, members = [] } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return Response.json({ error: "Project name is required." }, { status: 400 });
  }

  if (!VALID_WORKFLOWS.includes(workflow)) {
    return Response.json(
      { error: `workflow must be one of ${VALID_WORKFLOWS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!Array.isArray(members)) {
    return Response.json({ error: "members must be an array of emails" }, { status: 400 });
  }

  const normalizedEmails = [];
  for (const raw of members) {
    if (typeof raw !== "string" || !validateEmail(raw)) {
      return Response.json({ error: `Invalid member email: ${raw}` }, { status: 400 });
    }
    const email = raw.trim().toLowerCase();
    if (!normalizedEmails.includes(email)) normalizedEmails.push(email);
  }

  try {
    // creatorId comes from the verified session (requireUser above), so it
    // always references a real user — no need to re-check it against the FK.
    const insertProject = await env.DB.prepare(
      `INSERT INTO projects (name, description, workflow, created_by)
       VALUES (?, ?, ?, ?)`
    )
      .bind(name.trim(), description, workflow, creatorId)
      .run();

    const projectId = insertProject.meta.last_row_id;

    // Always add the creator as a member (if known + verified)
    const addedUserIds = new Set();
    if (creatorId) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
      )
        .bind(projectId, creatorId)
        .run();
      addedUserIds.add(creatorId);
    }

    // Resolve invited member emails -> existing users; skip unknown emails
    const invited = [];
    const notFound = [];
    for (const email of normalizedEmails) {
      const user = await env.DB.prepare("SELECT user_id, email FROM users WHERE email = ?")
        .bind(email)
        .first();

      if (!user) {
        notFound.push(email);
        continue;
      }

      if (addedUserIds.has(user.user_id)) continue;

      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
      )
        .bind(projectId, user.user_id)
        .run();
      addedUserIds.add(user.user_id);
      invited.push({ user_id: user.user_id, email: user.email });
    }

    const project = await env.DB.prepare(
      `SELECT project_id, name, description, workflow, created_by, created_at
       FROM projects WHERE project_id = ?`
    )
      .bind(projectId)
      .first();

    return Response.json({ project, invited, not_found: notFound }, { status: 201 });
  } catch (err) {
    console.error("Create project error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
