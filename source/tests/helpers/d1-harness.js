/**
 * Integration harness: a real SQLite database behind the D1 API, plus a
 * router that reproduces the Cloudflare Pages middleware chain.
 *
 * The existing unit tests drive handlers with an ordered mock D1 (`firstResults`
 * consumed positionally). That is fine for validating request shapes, but it
 * cannot answer an authorization question: the mock returns whatever the test
 * queued regardless of who is asking, so a cross-tenant read looks identical to
 * a legitimate one. These helpers run the handlers against the real migrations
 * with real rows, so "user B could read user A's project" is a fact about the
 * SQL and the guards rather than about the mock's script.
 *
 * `callApi` walks the same chain Pages does: functions/_middleware.js first,
 * then functions/api/projects/[projectId]/_middleware.js for routes under that
 * prefix, then the leaf handler. The route table below mirrors the real file
 * layout one-for-one; adding a route to functions/ means adding it here too.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "db", "migrations");

/**
 * Wrap a node:sqlite database in the subset of the D1 API the handlers use:
 * `prepare(sql).bind(...).first()/.all()/.run()` and `batch([...])`.
 *
 * D1 and node:sqlite disagree on a few return shapes, so the shim normalizes:
 *   - `.first()` yields `null` (not `undefined`) when there is no row,
 *   - `.all()` yields `{ results }`,
 *   - `.run()` yields `{ meta: { last_row_id, changes } }`,
 *   - booleans bind as 0/1 and `undefined` binds as NULL, matching D1.
 *
 * @param {DatabaseSync} db
 * @returns {{ prepare: Function, batch: Function, _raw: DatabaseSync }}
 */
export function d1(db) {
  const coerce = (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  };

  const makeStatement = (sql) => {
    let args = [];
    const stmt = {
      bind(...values) {
        args = values.map(coerce);
        return stmt;
      },
      async first() {
        const row = db.prepare(sql).get(...args);
        return row === undefined ? null : { ...row };
      },
      async all() {
        const rows = db.prepare(sql).all(...args);
        return { results: rows.map((r) => ({ ...r })), success: true };
      },
      async run() {
        const info = db.prepare(sql).run(...args);
        return {
          success: true,
          meta: {
            last_row_id: Number(info.lastInsertRowid),
            changes: Number(info.changes),
            rows_written: Number(info.changes),
          },
        };
      },
      // batch() needs the deferred call, not the promise
      _exec() {
        return db.prepare(sql).run(...args);
      },
    };
    return stmt;
  };

  return {
    _raw: db,
    prepare: (sql) => makeStatement(sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => {
          const info = s._exec();
          return {
            success: true,
            meta: {
              last_row_id: Number(info.lastInsertRowid),
              changes: Number(info.changes),
            },
          };
        });
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/**
 * Fresh in-memory database with every migration in db/migrations applied in
 * filename order - the same order `wrangler d1 migrations apply` uses.
 *
 * @returns {{ DB: object, raw: DatabaseSync }} An env-shaped object.
 */
export function freshDb() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return { DB: d1(db), raw: db };
}

/**
 * Insert a user and an unexpired session for them.
 *
 * @param {{ raw: DatabaseSync }} env
 * @param {{ email: string, name?: string }} opts
 * @returns {{ userId: number, token: string, email: string }}
 */
export function seedUser(env, { email, name = email }) {
  const info = env.raw
    .prepare("INSERT INTO users (full_name, email, password_hash, is_active) VALUES (?, ?, ?, 1)")
    .run(name, email, "x");
  const userId = Number(info.lastInsertRowid);
  const token = `tok-${userId}-${email}`;
  env.raw
    .prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))"
    )
    .run(token, userId);
  return { userId, token, email };
}

/**
 * Create a project owned by `ownerId` and add every id in `memberIds` (the
 * owner included) to project_members.
 *
 * @param {{ raw: DatabaseSync }} env
 * @param {{ name: string, ownerId: number, memberIds?: number[], workflow?: string }} opts
 * @returns {number} project_id
 */
export function seedProject(env, { name, ownerId, memberIds = [ownerId], workflow = "scrum" }) {
  const info = env.raw
    .prepare("INSERT INTO projects (name, workflow, created_by) VALUES (?, ?, ?)")
    .run(name, workflow, ownerId);
  const projectId = Number(info.lastInsertRowid);
  for (const uid of memberIds) {
    env.raw
      .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)")
      .run(projectId, uid);
  }
  return projectId;
}

/**
 * Insert a task into `projectId`.
 *
 * @param {{ raw: DatabaseSync }} env
 * @param {{ projectId: number, title?: string, status?: string, assignedTo?: number|null }} opts
 * @returns {number} task_id
 */
export function seedTask(env, { projectId, title = "Task", status = "todo", assignedTo = null }) {
  const info = env.raw
    .prepare("INSERT INTO tasks (project_id, title, status, assigned_to) VALUES (?, ?, ?, ?)")
    .run(projectId, title, status, assignedTo);
  return Number(info.lastInsertRowid);
}

/* ------------------------------------------------------------------ *
 * Route table - mirrors the functions/ directory.
 * ------------------------------------------------------------------ */

const ROUTES = [
  // [ regex over pathname, param names, lazy module import ]
  [/^\/api\/auth\/login$/, [], () => import("../../../functions/api/auth/login.js")],
  [/^\/api\/auth\/signup$/, [], () => import("../../../functions/api/auth/signup.js")],
  [/^\/api\/auth\/logout$/, [], () => import("../../../functions/api/auth/logout.js")],
  [
    /^\/api\/auth\/forgot-password$/,
    [],
    () => import("../../../functions/api/auth/forgot-password.js"),
  ],
  [
    /^\/api\/auth\/reset-password$/,
    [],
    () => import("../../../functions/api/auth/reset-password.js"),
  ],
  [/^\/api\/invites$/, [], () => import("../../../functions/api/invites/index.js")],
  [/^\/api\/blockers$/, [], () => import("../../../functions/api/blockers/index.js")],
  [
    /^\/api\/blockers\/([^/]+)$/,
    ["blockerId"],
    () => import("../../../functions/api/blockers/[blockerId].js"),
  ],
  [
    /^\/api\/checkins\/([^/]+)$/,
    ["checkinId"],
    () => import("../../../functions/api/checkins/[checkinId].js"),
  ],
  [/^\/api\/tasks\/([^/]+)$/, ["taskId"], () => import("../../../functions/api/tasks/[taskId].js")],
  [
    /^\/api\/agents\/([^/]+)$/,
    ["userId"],
    () => import("../../../functions/api/agents/[userId].js"),
  ],
  [/^\/api\/projects$/, [], () => import("../../../functions/api/projects/index.js")],
  [
    /^\/api\/projects\/([^/]+)\/members$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/members.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/tasks$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/tasks.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/checkins$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/checkins.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/blockers$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/blockers.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/agents$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/agents.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/dashboard$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/dashboard.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/weekly-report$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/weekly-report.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/summary$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/summary.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/sprints$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/sprints/index.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/sprints\/current$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/sprints/current.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/sprints\/([^/]+)$/,
    ["projectId", "sprintId"],
    () => import("../../../functions/api/projects/[projectId]/sprints/[sprintId].js"),
  ],
  [
    /^\/api\/projects\/([^/]+)\/pairs$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/pairs.js"),
  ],
  [
    /^\/api\/projects\/([^/]+)$/,
    ["projectId"],
    () => import("../../../functions/api/projects/[projectId]/index.js"),
  ],
];

/**
 * Pick the handler export Pages would call for `method`, falling back to the
 * catch-all `onRequest` the way Pages does.
 *
 * @param {object} mod
 * @param {string} method
 * @returns {Function|undefined}
 */
function pickHandler(mod, method) {
  const named = `onRequest${method[0].toUpperCase()}${method.slice(1).toLowerCase()}`;
  return mod[named] ?? mod.onRequest;
}

/**
 * Drive one API request through the real middleware chain.
 *
 * @param {{ DB: object }} env
 * @param {{ method?: string, path: string, token?: string|null, body?: any, headers?: object, envVars?: object }} opts
 * @returns {Promise<Response>}
 */
export async function callApi(
  env,
  { method = "GET", path, token = null, body, headers = {}, envVars = {} }
) {
  const url = new URL(path, "https://sitrep.test");
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["Content-Type"] = "application/json";
  }
  if (token) init.headers["Cookie"] = `sitrep_token=${token}`;
  const request = new Request(url.toString(), init);

  const match = ROUTES.find(([re]) => re.test(url.pathname));
  if (!match) throw new Error(`No route in harness for ${url.pathname}`);
  const [re, names, load] = match;
  const groups = url.pathname.match(re).slice(1);
  const params = Object.fromEntries(names.map((n, i) => [n, groups[i]]));

  const mod = await load();
  const handler = pickHandler(mod, method);
  if (!handler) {
    return Response.json({ error: "Method not allowed (no handler exported)" }, { status: 405 });
  }

  const context = { request, env: { DB: env.DB, ...envVars }, params, data: {} };

  // Layer 2: the project-scoped middleware. Pages applies a directory's
  // _middleware.js to that directory's own index route as well as everything
  // beneath it, so /api/projects/:id is scoped just like /api/projects/:id/*.
  // (Verified against `wrangler pages dev`: an anonymous GET /api/projects/1
  // returns 401 from this middleware, not 200 from the handler.)
  const scoped = /^\/api\/projects\/[^/]+(\/|$)/.test(url.pathname);
  const inner = async () => {
    if (!scoped) return handler(context);
    const mw = await import("../../../functions/api/projects/[projectId]/_middleware.js");
    return mw.onRequest({ ...context, next: () => handler(context) });
  };

  // Layer 1: the global middleware that resolves the session cookie.
  const globalMw = await import("../../../functions/_middleware.js");
  return globalMw.onRequest({ ...context, next: inner });
}

/**
 * Pull the `sitrep_token` value out of a response's Set-Cookie header.
 *
 * @param {Response} res
 * @returns {string|null}
 */
export function tokenFromResponse(res) {
  const cookie = res.headers.get("Set-Cookie") ?? "";
  const m = cookie.match(/sitrep_token=([^;]*)/);
  return m && m[1] ? m[1] : null;
}

/**
 * Parse a Set-Cookie header into its attribute set (lowercased keys), so tests
 * can assert on HttpOnly / Secure / SameSite without string-matching.
 *
 * @param {Response} res
 * @returns {{ value: string|null, attrs: Record<string, string|true> }}
 */
export function parseSetCookie(res) {
  const raw = res.headers.get("Set-Cookie") ?? "";
  const [first, ...rest] = raw.split(";").map((p) => p.trim());
  const eq = first.indexOf("=");
  const attrs = {};
  for (const part of rest) {
    const i = part.indexOf("=");
    if (i === -1) attrs[part.toLowerCase()] = true;
    else attrs[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
  }
  return { value: eq === -1 ? null : first.slice(eq + 1), attrs };
}
