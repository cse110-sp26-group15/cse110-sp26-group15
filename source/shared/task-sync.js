/**
 * Local-first sync for the task-edit workflow.
 *
 * The browser twin of the Android companion's outbox (android/.../sync/):
 * a task edit is written to localStorage and the screen first, then a drain
 * loop replays it against PATCH /api/tasks/:taskId whenever the network
 * allows. The server contract this is built on (and shares with the phone):
 *
 *   - Optimistic concurrency: every PATCH carries the `version` the edit was
 *     built from. The server's compare-and-swap either applies the write and
 *     bumps the version, or returns 409 with `conflict: true` and the row as
 *     it stands now (functions/api/tasks/[taskId].js).
 *   - A 409 is not automatically a conflict. A retry of a delivery that
 *     landed (response lost on the way back) bounces off the row's new
 *     version too. The 409 body carries the current row, so the two cases
 *     are separable by comparing it with what the op meant to write - see
 *     {@link classifyConflict}, a port of the phone's ConflictResolver.
 *   - Authorization is decided when the write arrives, not when it was
 *     queued. A 403 means membership was revoked while the edit waited;
 *     the op must be dropped, never retried.
 *
 * Everything here is DOM-free and storage/network-injectable so the whole
 * engine runs under Vitest against the real API handlers (see
 * source/tests/task-sync.test.js). The scrum dashboard owns the UI half:
 * badges, the sync strip and the keep-mine/keep-theirs dialog.
 *
 * This is optimistic concurrency with explicit user resolution, not a CRDT:
 * concurrent edits to the same task converge because the server serializes
 * them and the losing writer is shown both rows and chooses.
 */

import { apiFetch } from "./utils.js";

const OUTBOX_KEY_PREFIX = "sitrep.outbox.project-";
const TASK_CACHE_KEY_PREFIX = "sitrep.taskcache.project-";

/** Op / verdict states, exported so tests and the UI share the vocabulary. */
export const OpState = Object.freeze({
  PENDING: "pending",
  CONFLICT: "conflict",
});

export const Verdict = Object.freeze({
  ALREADY_APPLIED: "already-applied",
  NEEDS_DECISION: "needs-decision",
});

export const DrainOutcome = Object.freeze({
  DRAINED: "drained",
  RETRY: "retry",
  NEEDS_USER: "needs-user",
  AUTH_LOST: "auth-lost",
});

function safeStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function newId(prefix) {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Durable queue of unsent task edits for one project, persisted as a single
 * JSON document in localStorage so a refresh (or a crashed tab) recovers it.
 *
 * Ops move through: pending → (applied and dropped | conflict | dropped with
 * a notice). Conflicted ops are parked - never re-sent - until the user picks
 * keep-mine (rebase, back to pending) or keep-theirs (dropped). A refused op
 * (403/404/other 4xx) becomes a user-visible notice rather than a queue row,
 * so the queue can never jam on a write the server will keep refusing.
 */
export class TaskOutbox {
  constructor(projectId, storage = safeStorage()) {
    this.projectId = Number(projectId);
    this.storage = storage;
    this.key = `${OUTBOX_KEY_PREFIX}${this.projectId}`;
  }

  _load() {
    if (!this.storage) return { ops: [], notices: [] };
    try {
      const raw = this.storage.getItem(this.key);
      const doc = raw ? JSON.parse(raw) : null;
      if (!doc || !Array.isArray(doc.ops) || !Array.isArray(doc.notices)) {
        return { ops: [], notices: [] };
      }
      return doc;
    } catch {
      // A corrupt document must not brick the board; better to start empty.
      return { ops: [], notices: [] };
    }
  }

  _save(doc) {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(doc));
    } catch {
      /* quota exceeded / storage disabled - the in-memory pass still runs */
    }
  }

  /**
   * Queue an edit. A task with an unsent op gets the new payload folded into
   * that op instead of a second queue row - the phone does the same, and it
   * is what keeps "no duplicate writes" true when someone edits twice while
   * offline. A task parked in conflict also coalesces: the new values become
   * the "mine" side of the pending decision.
   *
   * @param {{ taskId: number, baseVersion: number, payload: object }} edit
   *   `payload` is the PATCH body without `version` (the engine adds the
   *   base version at send time).
   * @returns {object} the stored op.
   */
  enqueueEdit({ taskId, baseVersion, payload }) {
    const doc = this._load();
    const existing = doc.ops.find((o) => Number(o.taskId) === Number(taskId));
    if (existing) {
      // Inline card controls send one field at a time. Preserve earlier queued
      // fields so changing status and then priority offline becomes one write
      // containing both choices, rather than the second edit erasing the first.
      existing.payload = { ...existing.payload, ...payload };
      this._save(doc);
      return { ...existing };
    }
    const op = {
      opId: newId("op"),
      kind: "UPDATE",
      taskId: Number(taskId),
      baseVersion: Number.isInteger(baseVersion) ? baseVersion : 1,
      payload: { ...payload },
      state: OpState.PENDING,
      remote: null,
      attempts: 0,
      queuedAt: new Date().toISOString(),
    };
    doc.ops.push(op);
    this._save(doc);
    return { ...op };
  }

  /** All ops (copies), oldest first. */
  ops() {
    return this._load().ops.map((o) => ({ ...o }));
  }

  op(opId) {
    const found = this._load().ops.find((o) => o.opId === opId);
    return found ? { ...found } : null;
  }

  nextPending() {
    const found = this._load().ops.find((o) => o.state === OpState.PENDING);
    return found ? { ...found } : null;
  }

  pendingCount() {
    return this._load().ops.filter((o) => o.state === OpState.PENDING).length;
  }

  parkedCount() {
    return this._load().ops.filter((o) => o.state === OpState.CONFLICT).length;
  }

  notices() {
    return this._load().notices.map((n) => ({ ...n }));
  }

  onAttempted(opId) {
    const doc = this._load();
    const op = doc.ops.find((o) => o.opId === opId);
    if (op) {
      op.attempts = (op.attempts ?? 0) + 1;
      this._save(doc);
    }
  }

  /** The write landed (or already had): the op is finished. */
  onApplied(opId) {
    const doc = this._load();
    doc.ops = doc.ops.filter((o) => o.opId !== opId);
    this._save(doc);
  }

  /** Park the op beside the server's row until a person decides. */
  onConflict(opId, currentRow) {
    const doc = this._load();
    const op = doc.ops.find((o) => o.opId === opId);
    if (op) {
      op.state = OpState.CONFLICT;
      op.remote = currentRow ?? null;
      this._save(doc);
    }
  }

  /**
   * The server refused the write for good (403/404/other 4xx). Drop the op
   * and leave a notice the user can read and dismiss - retrying would only
   * be refused again.
   */
  onRejected(opId, status, message) {
    const doc = this._load();
    const op = doc.ops.find((o) => o.opId === opId);
    doc.ops = doc.ops.filter((o) => o.opId !== opId);
    const title = op?.payload?.title ? `“${op.payload.title}”` : "A queued edit";
    doc.notices.push({
      id: newId("n"),
      message: `${title} was refused by the server (${status}): ${message}`,
      at: new Date().toISOString(),
    });
    this._save(doc);
  }

  /**
   * Membership on this project was revoked. Every remaining queued edit
   * would be refused the same way, so drop them all now; offline work must
   * not outlive the access that authorized it.
   */
  onProjectAccessLost() {
    const doc = this._load();
    doc.ops = [];
    this._save(doc);
  }

  /** Re-arm a parked op with the user's values rebased onto the server row. */
  keepMine(opId) {
    const doc = this._load();
    const op = doc.ops.find((o) => o.opId === opId);
    if (!op || op.state !== OpState.CONFLICT) return null;
    op.state = OpState.PENDING;
    if (Number.isInteger(op.remote?.version)) op.baseVersion = op.remote.version;
    op.remote = null;
    op.attempts = 0;
    this._save(doc);
    return { ...op };
  }

  /** Drop a parked op and hand back the server row so the caller can adopt it. */
  keepTheirs(opId) {
    const doc = this._load();
    const op = doc.ops.find((o) => o.opId === opId);
    if (!op || op.state !== OpState.CONFLICT) return null;
    const remote = op.remote;
    doc.ops = doc.ops.filter((o) => o.opId !== opId);
    this._save(doc);
    return remote ?? null;
  }

  dismissNotices() {
    const doc = this._load();
    doc.notices = [];
    this._save(doc);
  }

  /** Session over (401 or logout): queued work must not outlive it. */
  clear() {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Last server-confirmed task list for one project, so a refresh while the
 * network is down can still paint the board (with queued edits overlaid).
 */
export class TaskCache {
  constructor(projectId, storage = safeStorage()) {
    this.projectId = Number(projectId);
    this.storage = storage;
    this.key = `${TASK_CACHE_KEY_PREFIX}${this.projectId}`;
  }

  read() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      const doc = raw ? JSON.parse(raw) : null;
      return doc && Array.isArray(doc.tasks) ? doc : null;
    } catch {
      return null;
    }
  }

  write(tasks) {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify({ tasks, savedAt: new Date().toISOString() }));
    } catch {
      /* best-effort */
    }
  }

  /** Fold one server-confirmed row into the cached list. */
  upsert(taskRow) {
    if (!taskRow || taskRow.task_id == null) return;
    const doc = this.read();
    if (!doc) return;
    const i = doc.tasks.findIndex((t) => Number(t.task_id) === Number(taskRow.task_id));
    if (i === -1) doc.tasks.push(taskRow);
    else doc.tasks[i] = { ...doc.tasks[i], ...taskRow };
    this.write(doc.tasks);
  }

  clear() {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/** Remove every outbox and task cache document (logout / session expiry). */
export function clearAllSyncStorage(storage = safeStorage()) {
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && (k.startsWith(OUTBOX_KEY_PREFIX) || k.startsWith(TASK_CACHE_KEY_PREFIX))) {
        keys.push(k);
      }
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * Decide what a 409 means, by comparing what the op wanted to write with the
 * row the server handed back. Port of the phone's ConflictResolver.classify,
 * extended to the extra fields the web edit form can send.
 *
 * ALREADY_APPLIED: the row already holds every value this op intended -
 * either our own earlier delivery landed and the response was lost, or
 * somebody made the identical edit. Re-sending would be a duplicate write.
 *
 * NEEDS_DECISION: the row moved somewhere this op did not intend; only a
 * person can pick a winner.
 *
 * Notes on the field mapping: the task row returns the assignee as `user_id`
 * (there is no `assigned_to` in API responses), and a server-side null
 * assignee is tolerated the way the phone tolerates it. A null intended
 * reviewer is not compared because the server may default it (agent tasks
 * get the agent's owner), which would misread a landed write as a conflict.
 *
 * @param {object} payload - what the op meant to write (PATCH body sans version).
 * @param {object} current - the row from the 409 body.
 * @returns {"already-applied"|"needs-decision"}
 */
export function classifyConflict(payload, current) {
  // An empty description and a missing one are the same edit.
  const norm = (v) => (v === "" || v === undefined ? null : v);
  const differs =
    ("title" in payload && current.title !== payload.title) ||
    ("description" in payload && norm(current.description) !== norm(payload.description)) ||
    ("status" in payload && current.status !== payload.status) ||
    ("assigned_to" in payload &&
      payload.assigned_to != null &&
      current.user_id != null &&
      Number(current.user_id) !== Number(payload.assigned_to)) ||
    ("priority" in payload && payload.priority != null && current.priority !== payload.priority) ||
    ("reviewer_id" in payload &&
      payload.reviewer_id != null &&
      Number(current.reviewer_id) !== Number(payload.reviewer_id));
  return differs ? Verdict.NEEDS_DECISION : Verdict.ALREADY_APPLIED;
}

/**
 * Build the network port the drain loop talks to. Injectable so tests can
 * run the loop against the real API handlers (or a dead network) without a
 * browser. Production callers use the default, which rides the shared
 * apiFetch and therefore the session cookie.
 *
 * @param {typeof apiFetch} [fetchJson]
 * @returns {(taskId: number, payload: object, baseVersion: number) => Promise<object>}
 */
export function makePatchTask(fetchJson = apiFetch) {
  return async function patchTask(taskId, payload, baseVersion) {
    try {
      const body = { ...payload, version: Number.isInteger(baseVersion) ? baseVersion : 1 };
      const data = await fetchJson(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { kind: "ok", task: data.task ?? null };
    } catch (err) {
      const status = err?.status ?? 0;
      if (status === 409 && err?.body?.task) return { kind: "conflict", current: err.body.task };
      if (status === 403) return { kind: "forbidden", message: err.message };
      if (status === 404) return { kind: "not-found" };
      if (status === 401) return { kind: "unauthorized" };
      if (status === 0) return { kind: "unreachable", cause: err?.message ?? "network error" };
      return { kind: "rejected", status, message: err.message };
    }
  };
}

/**
 * Replay queued edits, oldest first, stopping at the first one that needs
 * the network back so ordering is preserved. Mirrors the phone's
 * SyncEngine.drain decision table:
 *
 *   2xx                     → op done
 *   409 + already applied   → op done (re-sending = duplicate write)
 *   409 + real conflict     → park; a person decides
 *   403                     → membership revoked: drop everything queued
 *                             for the project, leave a notice
 *   404 / other 4xx         → drop with a notice
 *   401                     → session gone: destroy queued work + cache
 *   network failure         → keep the op, ask the caller to retry later
 *
 * Calls are serialized per outbox: a call during a running drain queues one
 * more pass instead of racing it.
 *
 * @param {TaskOutbox} outbox
 * @param {object} [opts]
 * @param {Function} [opts.patchTask] - network port; defaults to the live API.
 * @param {TaskCache|null} [opts.cache] - updated with server-confirmed rows.
 * @returns {Promise<{ outcome: string, parked: number, reason?: string }>}
 */
export async function drainOutbox(outbox, { patchTask = makePatchTask(), cache = null } = {}) {
  const run = () => drainPass(outbox, patchTask, cache);
  outbox._drainChain = (outbox._drainChain ?? Promise.resolve()).then(run, run);
  return outbox._drainChain;
}

async function drainPass(outbox, patchTask, cache) {
  // Backstop against a pathological queue; one screen's worth of edits is
  // far below this.
  const MAX_OPS_PER_RUN = 200;
  let handled = 0;

  while (handled < MAX_OPS_PER_RUN) {
    const op = outbox.nextPending();
    if (!op) break;
    handled += 1;
    outbox.onAttempted(op.opId);

    const result = await patchTask(op.taskId, op.payload, op.baseVersion);

    switch (result.kind) {
      case "ok":
        outbox.onApplied(op.opId);
        if (result.task) cache?.upsert(result.task);
        break;

      case "conflict":
        if (classifyConflict(op.payload, result.current) === Verdict.ALREADY_APPLIED) {
          // Our own earlier delivery already wrote this. Adopt the server's
          // row (and its new version); re-sending is what would produce a
          // duplicate write.
          outbox.onApplied(op.opId);
          cache?.upsert(result.current);
        } else {
          outbox.onConflict(op.opId, result.current);
        }
        break;

      case "forbidden":
        // Revoked while the edit waited. The server refused the write at the
        // execution boundary, which is the authoritative answer; nothing
        // else queued for this project can fare better.
        outbox.onRejected(op.opId, 403, result.message);
        outbox.onProjectAccessLost();
        cache?.clear();
        break;

      case "not-found":
        outbox.onRejected(op.opId, 404, "This task no longer exists.");
        break;

      case "rejected":
        outbox.onRejected(op.opId, result.status, result.message);
        break;

      case "unauthorized":
        outbox.clear();
        cache?.clear();
        return { outcome: DrainOutcome.AUTH_LOST, parked: 0 };

      case "unreachable":
        return {
          outcome: DrainOutcome.RETRY,
          parked: outbox.parkedCount(),
          reason: result.cause,
        };

      default:
        return { outcome: DrainOutcome.RETRY, parked: outbox.parkedCount(), reason: "unknown" };
    }
  }

  // Asked of the store, not counted on this pass: a drain that sends nothing
  // because the queue holds only parked conflicts is still not "up to date".
  const parked = outbox.parkedCount();
  return parked > 0
    ? { outcome: DrainOutcome.NEEDS_USER, parked }
    : { outcome: DrainOutcome.DRAINED, parked: 0 };
}

/**
 * Paint queued/conflicted edits over a server task list so the board shows
 * what the user did, not what the server last confirmed. Adds `_sync`
 * ("queued" | "conflict") and `_syncOpId` to affected rows; everything else
 * passes through untouched.
 *
 * @param {object[]} tasks - rows in the GET /tasks shape.
 * @param {object[]} ops - from {@link TaskOutbox#ops}.
 * @returns {object[]}
 */
export function overlayQueuedEdits(tasks, ops) {
  const active = (ops ?? []).filter(
    (o) => o.state === OpState.PENDING || o.state === OpState.CONFLICT
  );
  if (active.length === 0) return tasks;
  const byTask = new Map(active.map((o) => [Number(o.taskId), o]));
  return tasks.map((t) => {
    const op = byTask.get(Number(t.task_id));
    if (!op) return t;
    const merged = { ...t };
    for (const [k, v] of Object.entries(op.payload)) {
      if (k === "assigned_to") {
        // Task rows carry the assignee as user_id; mirror both spellings.
        merged.user_id = v;
        merged.assigned_to = v;
      } else {
        merged[k] = v;
      }
    }
    merged._sync = op.state === OpState.CONFLICT ? "conflict" : "queued";
    merged._syncOpId = op.opId;
    return merged;
  });
}
