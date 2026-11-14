/**
 * SitRep local-first conflict demo - `npm run demo:offline` (or
 * `node demo/offline-conflict-demo.mjs`). Credential-free: no network, no
 * Cloudflare account, no secrets. It boots the real API handlers and the real
 * middleware chain over an in-memory SQLite database (the same harness the
 * integration tests use), applies the real migrations, loads the checked-in
 * seed data, and signs in as two seeded teammates with the documented seed
 * password.
 *
 * Two clients edit the same seeded task while "offline":
 *   - the web board's actual outbox engine (source/shared/task-sync.js) over a
 *     localStorage stand-in, and
 *   - a second instance of the same engine standing in for the phone; the
 *     Android app's own engine has the same wire behaviour, pinned by its JVM
 *     suite (android/app/src/test).
 *
 * The demo replays the full acceptance story: concurrent offline edits,
 *  reconnect in both orders, deterministic convergence, no duplicate writes,
 * "process death" as a fresh engine over the same storage, membership revoked
 * while offline, and two negative controls showing the naive behaviour this
 * package replaces actually loses data.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { callApi, freshDb } from "../source/tests/helpers/d1-harness.js";
import { ApiError } from "../source/shared/utils.js";
import {
  TaskOutbox,
  drainOutbox,
  makePatchTask,
  DrainOutcome,
  OpState,
} from "../source/shared/task-sync.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Tiny reporting harness ──────────────────────────────────────────────

let failures = 0;
const say = (msg) => console.log(msg);
const check = (cond, label) => {
  if (cond) {
    console.log(`   ✔ ${label}`);
  } else {
    failures += 1;
    console.log(`   ✘ FAILED: ${label}`);
  }
};

// ── One client = a session + a fake network + the real outbox engine ────

class MemoryStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(k) ? this.#map.get(k) : null;
  }
  setItem(k, v) {
    this.#map.set(k, String(v));
  }
  removeItem(k) {
    this.#map.delete(k);
  }
  get length() {
    return this.#map.size;
  }
  key(i) {
    return [...this.#map.keys()][i] ?? null;
  }
}

function makeClient(env, name, token, projectId) {
  const net = { online: true, delivered: 0 };
  const fetchJson = async (url, init = {}) => {
    if (!net.online) throw new ApiError(`Network error calling ${url}: offline`, { status: 0 });
    net.delivered += 1;
    const method = init.method ?? "GET";
    const body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    const res = await callApi(env, { method, path: url, token, body });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) {
      throw new ApiError(parsed?.error || `Request to ${url} failed (${res.status})`, {
        status: res.status,
        body: parsed,
      });
    }
    return parsed ?? {};
  };
  const storage = new MemoryStorage();
  return {
    name,
    token,
    net,
    storage,
    outbox: new TaskOutbox(projectId, storage),
    patchTask: makePatchTask(fetchJson),
    drain() {
      return drainOutbox(this.outbox, { patchTask: this.patchTask });
    },
    async readTask(taskId) {
      const res = await callApi(env, { path: `/api/projects/${projectId}/tasks`, token });
      const { tasks } = await res.json();
      return tasks.find((t) => t.task_id === taskId);
    },
  };
}

// ── Boot: real handlers, real migrations, real seed data ────────────────

say("── Booting SitRep in-process: real API handlers + middleware over in-memory SQLite");
const env = freshDb();
env.raw.exec(readFileSync(join(ROOT, "db", "seed.sql"), "utf8"));
say("   Applied db/migrations/*.sql and loaded db/seed.sql (3 projects, 7 users, 18 tasks)\n");

const PROJECT_ID = 1; // "SE SitRep Prototype" - every seeded user is a member
const TASK_ID = 1;

async function login(email) {
  const res = await callApi(env, {
    method: "POST",
    path: "/api/auth/login",
    body: { email, password: "TestPassword123" }, // the documented seed password
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const { token, user } = await res.json();
  return { token, name: user.full_name };
}

const alex = await login("arivera@ucsd.edu");
const wayne = await login("wdyer@ucsd.edu");
say(`── Signed in as ${alex.name} (web) and ${wayne.name} (phone) via POST /api/auth/login\n`);

const taskRow = () =>
  env.raw.prepare("SELECT title, status, version FROM tasks WHERE task_id = ?").get(TASK_ID);

const resetTask = (title, status = "todo") => {
  env.raw
    .prepare("UPDATE tasks SET title = ?, status = ?, version = 1 WHERE task_id = ?")
    .run(title, status, TASK_ID);
};

async function expectConverged(web, phone, expected) {
  const row = taskRow();
  const webView = await web.readTask(TASK_ID);
  const phoneView = await phone.readTask(TASK_ID);
  check(row.title === expected, `the database holds "${expected}"`);
  check(
    webView.title === row.title && phoneView.title === row.title,
    "both clients read back the identical row (converged)"
  );
  check(
    web.outbox.ops().length === 0 && phone.outbox.ops().length === 0,
    "no queued or parked work remains on either client"
  );
  return row;
}

// ── Scenario A: web reconnects first; the phone resolves with keep-theirs ──

say("── Scenario A: concurrent offline edits; the WEB reconnects first");
resetTask("Draft sprint retro agenda");
{
  const web = makeClient(env, "web", alex.token, PROJECT_ID);
  const phone = makeClient(env, "phone", wayne.token, PROJECT_ID);
  const snapshot = await web.readTask(TASK_ID);

  web.net.online = false;
  phone.net.online = false;
  web.outbox.enqueueEdit({
    taskId: TASK_ID,
    baseVersion: snapshot.version,
    payload: { title: "Agenda (web edit)", status: "in-progress" },
  });
  phone.outbox.enqueueEdit({
    taskId: TASK_ID,
    baseVersion: snapshot.version,
    payload: { title: "Agenda (phone edit)", status: "done" },
  });
  check((await web.drain()).outcome === DrainOutcome.RETRY, "offline web edit stays queued");
  check(taskRow().version === 1, "nothing reached the server while offline");

  say("   … the phone process dies; a fresh engine re-reads the same durable queue");
  const phoneAfterDeath = makeClient(env, "phone", wayne.token, PROJECT_ID);
  phoneAfterDeath.storage = phone.storage;
  phoneAfterDeath.outbox = new TaskOutbox(PROJECT_ID, phone.storage);
  check(
    phoneAfterDeath.outbox.pendingCount() === 1,
    "the phone's queued edit survived process death"
  );

  web.net.online = true;
  check((await web.drain()).outcome === DrainOutcome.DRAINED, "web reconnects; its edit lands");
  check(taskRow().version === 2, "one write, one version bump");

  phoneAfterDeath.net.online = true;
  const result = await phoneAfterDeath.drain();
  check(
    result.outcome === DrainOutcome.NEEDS_USER && result.parked === 1,
    "the phone's edit is refused and parked as a conflict (never silently applied)"
  );
  const parked = phoneAfterDeath.outbox.ops()[0];
  check(
    parked.state === OpState.CONFLICT && parked.remote.title === "Agenda (web edit)",
    "the conflict carries the server's row for the user to compare"
  );

  say('   … the user picks "Keep theirs" on the phone');
  phoneAfterDeath.outbox.keepTheirs(parked.opId);
  const row = await expectConverged(web, phoneAfterDeath, "Agenda (web edit)");
  check(row.version === 2, "keep-theirs wrote nothing (still exactly one write)");
}

// ── Scenario B: phone reconnects first; the web resolves with keep-mine ──

say("\n── Scenario B: same edits, reconnect order REVERSED (phone first)");
resetTask("Draft sprint retro agenda");
{
  const web = makeClient(env, "web", alex.token, PROJECT_ID);
  const phone = makeClient(env, "phone", wayne.token, PROJECT_ID);
  const snapshot = await web.readTask(TASK_ID);

  web.net.online = false;
  phone.net.online = false;
  web.outbox.enqueueEdit({
    taskId: TASK_ID,
    baseVersion: snapshot.version,
    payload: { title: "Agenda (web edit)", status: "in-progress" },
  });
  phone.outbox.enqueueEdit({
    taskId: TASK_ID,
    baseVersion: snapshot.version,
    payload: { title: "Agenda (phone edit)", status: "done" },
  });

  phone.net.online = true;
  check((await phone.drain()).outcome === DrainOutcome.DRAINED, "phone reconnects; its edit lands");

  web.net.online = true;
  const result = await web.drain();
  check(result.outcome === DrainOutcome.NEEDS_USER, "the web's edit parks instead of clobbering");

  say('   … the user picks "Keep mine" on the web (rebase onto the server version)');
  const parked = web.outbox.ops()[0];
  web.outbox.keepMine(parked.opId);
  check((await web.drain()).outcome === DrainOutcome.DRAINED, "the rebased edit lands");

  const row = await expectConverged(web, phone, "Agenda (web edit)");
  check(row.version === 3, "two writes total: the phone's, then the informed rebase");
  say(
    "   Deterministic in both orders: the first reconnect wins the row, the second is\n" +
      "   parked and resolves explicitly; every replica ends equal to the server."
  );
}

// ── Scenario C: membership revoked while the edit waits ─────────────────

say("\n── Scenario C: membership revoked while an edit is queued offline");
resetTask("Draft sprint retro agenda");
{
  const phone = makeClient(env, "phone", wayne.token, PROJECT_ID);
  phone.net.online = false;
  phone.outbox.enqueueEdit({
    taskId: TASK_ID,
    baseVersion: 1,
    payload: { title: "Should never land" },
  });

  // There is no member-removal endpoint; removal is a direct delete, same as
  // the server-side tests do it.
  env.raw
    .prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = (SELECT user_id FROM users WHERE email = ?)"
    )
    .run(PROJECT_ID, "wdyer@ucsd.edu");

  phone.net.online = true;
  const result = await phone.drain();
  check(result.outcome === DrainOutcome.DRAINED, "the drain finishes instead of retrying forever");
  check(taskRow().title === "Draft sprint retro agenda", "the unauthorized write did NOT apply");
  check(phone.outbox.ops().length === 0, "the refused op was dropped, not kept for retry");
  check(
    phone.outbox.notices().some((n) => n.message.includes("403")),
    "the user is told the server refused it (403 notice)"
  );

  // Restore membership for anyone re-running scenarios below.
  env.raw
    .prepare(
      "INSERT INTO project_members (project_id, user_id) SELECT ?, user_id FROM users WHERE email = ?"
    )
    .run(PROJECT_ID, "wdyer@ucsd.edu");
}

// ── Negative control 1: the naive versionless save (the old board) ──────

say("\n── Negative control 1: the pre-package behaviour (versionless full-form save)");
resetTask("Original title");
{
  const stale = { title: "Original title", description: null, status: "todo" };
  await callApi(env, {
    method: "PATCH",
    path: `/api/tasks/${TASK_ID}`,
    token: wayne.token,
    body: { ...stale, title: "Wayne's careful retitle", version: 1 },
  });
  const naive = await callApi(env, {
    method: "PATCH",
    path: `/api/tasks/${TASK_ID}`,
    token: alex.token,
    body: { ...stale, description: "Alex's stale notes" }, // no version = last write wins
  });
  check(naive.status === 200, "the naive stale save is accepted (200)");
  check(
    taskRow().title === "Original title",
    "…and it silently DESTROYED Wayne's retitle (this is the failure mode)"
  );

  resetTask("Original title");
  await callApi(env, {
    method: "PATCH",
    path: `/api/tasks/${TASK_ID}`,
    token: wayne.token,
    body: { ...stale, title: "Wayne's careful retitle", version: 1 },
  });
  const guarded = await callApi(env, {
    method: "PATCH",
    path: `/api/tasks/${TASK_ID}`,
    token: alex.token,
    body: { ...stale, description: "Alex's stale notes", version: 1 },
  });
  check(guarded.status === 409, "the same stale save WITH a version is refused (409)");
  check(taskRow().title === "Wayne's careful retitle", "…and Wayne's edit survives");
}

// ── Negative control 2: replayed create without an idempotency token ────

say("\n── Negative control 2: a client that replays task creation");
{
  const countTasks = () =>
    env.raw.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?").get(PROJECT_ID).n;
  const body = { title: "Filed twice?", assigned_to: 1, status: "todo" };

  const before = countTasks();
  await callApi(env, {
    method: "POST",
    path: `/api/projects/${PROJECT_ID}/tasks`,
    token: alex.token,
    body,
  });
  await callApi(env, {
    method: "POST",
    path: `/api/projects/${PROJECT_ID}/tasks`,
    token: alex.token,
    body,
  });
  check(countTasks() === before + 2, "without client_token the replay creates a DUPLICATE task");

  const tokenBody = { ...body, title: "Filed once", client_token: "demo-token-1" };
  const first = await callApi(env, {
    method: "POST",
    path: `/api/projects/${PROJECT_ID}/tasks`,
    token: alex.token,
    body: tokenBody,
  });
  const replay = await callApi(env, {
    method: "POST",
    path: `/api/projects/${PROJECT_ID}/tasks`,
    token: alex.token,
    body: tokenBody,
  });
  const replayBody = await replay.json();
  check(
    first.status === 201 && replay.status === 200 && replayBody.idempotent_replay === true,
    "with client_token the replay returns the existing row (idempotent_replay: true)"
  );
  check(countTasks() === before + 3, "…and no duplicate row exists");
}

// ── Verdict ─────────────────────────────────────────────────────────────

say("");
if (failures > 0) {
  say(`✘ ${failures} check(s) failed`);
  process.exit(1);
}
say("✔ All checks passed: concurrent offline edits converge in both reconnect orders,");
say("  replays never double-write, revoked members cannot apply queued writes, and the");
say("  naive pre-package behaviour demonstrably loses data.");
