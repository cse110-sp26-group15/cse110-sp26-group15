const VALID_WORKFLOWS = ["scrum", "kanban", "xp"];

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
    const insertProject = await env.DB.prepare(
      `INSERT INTO projects (name, description, workflow, created_by)
       VALUES (?, ?, ?, ?)`
    )
      .bind(name.trim(), description, workflow, created_by)
      .run();

    const projectId = insertProject.meta.last_row_id;

    // Always add the creator as a member (if known)
    const addedUserIds = new Set();
    if (created_by) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)`
      )
        .bind(projectId, created_by)
        .run();
      addedUserIds.add(created_by);
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
