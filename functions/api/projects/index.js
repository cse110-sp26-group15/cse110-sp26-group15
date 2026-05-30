const VALID_WORKFLOWS = ["scrum", "kanban", "xp"];

/**
 * Cloudflare Pages function: GET /api/projects
 *
 * Lists projects. When `?user_id=N` is supplied, returns only projects
 * where N is a member (via project_members); otherwise returns every
 * project. Each row includes `member_count` so callers can render a
 * picker without a second round-trip.
 *
 * @param {{ env: { DB?: object }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  const url = new URL(request.url);
  const userIdParam = url.searchParams.get("user_id");
  const userId = userIdParam ? Number(userIdParam) : null;

  try {
    const query = userId
      ? `SELECT p.project_id, p.name, p.description, p.workflow, p.created_by, p.created_at,
                (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) AS member_count
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.project_id
         WHERE pm.user_id = ?
         ORDER BY p.created_at DESC`
      : `SELECT p.project_id, p.name, p.description, p.workflow, p.created_by, p.created_at,
                (SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.project_id) AS member_count
         FROM projects p
         ORDER BY p.created_at DESC`;

    const stmt = userId ? env.DB.prepare(query).bind(userId) : env.DB.prepare(query);
    const { results } = await stmt.all();

    return Response.json({ projects: results });
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
 *   - created_by {number|null} Optional. user_id of the creator; added as a member.
 *
 * Response 201:
 *   { project, invited: [{ user_id, email }], not_found: string[] }
 *
 * @param {{ env: { DB?: object }, request: Request }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.DB) {
    return Response.json({ error: "D1 database binding not configured." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, workflow = "scrum", description = null, members = [], created_by = null } = body;

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
    // Verify `created_by` actually references a real user before binding
    // it to the FK. Stale sessionStorage can carry a user_id from a
    // previous DB seed/reset, which would otherwise trip the projects
    // → users FK and abort the entire request.
    let creatorId = null;
    if (created_by != null) {
      const creator = await env.DB.prepare("SELECT user_id FROM users WHERE user_id = ?")
        .bind(created_by)
        .first();
      if (creator) {
        creatorId = creator.user_id;
      } else {
        console.warn(`[projects POST] created_by=${created_by} not found; storing NULL`);
      }
    }

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
