/**
 * The web outbox (source/shared/task-sync.js) against the real API.
 *
 * Every test here drives the actual drain loop over the actual PATCH handler
 * (real migrations, real middleware, real compare-and-swap) - the only fakes
 * are the network (a switch that throws status-0 the way a dead connection
 * does) and localStorage (a Map). "The phone" in the two-client scenarios is
 * a second instance of the same engine: its semantics are a port of the
 * Android SyncEngine, whose own behaviour is pinned by the JVM suite under
 * android/app/src/test.
 *
 * The negative controls at the bottom reproduce what the board did before
 * this package existed (versionless saves, blind retries) and assert that
 * that behaviour loses data - so the guard is proven necessary, not just
 * present.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { callApi, freshDb, seedProject, seedTask, seedUser } from "./helpers/d1-harness.js";
import { ApiError } from "../shared/utils.js";
import {
  TaskOutbox,
  TaskCache,
  classifyConflict,
  clearAllSyncStorage,
  drainOutbox,
  makePatchTask,
  overlayQueuedEdits,
  DrainOutcome,
  OpState,
  Verdict,
} from "../shared/task-sync.js";

/** Minimal localStorage stand-in. */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
}

let env;
let alice; // edits from the web board
let wayne; // edits from a second offline client (the phone's engine, ported)
let projectId;
let taskId;

/**
 * One client's view of the network: an apiFetch-compatible function backed by
 * the real handlers, plus the two failure switches the engine must survive.
 * `delivered` counts requests that actually reached the server, so tests can
 * assert "nothing was sent" and "sent exactly once".
 */
function makeClient(user) {
  const net = { online: true, loseNextResponse: false, delivered: 0 };
  const fetchJson = async (url, init = {}) => {
    if (!net.online) {
      throw new ApiError(`Network error calling ${url}: offline`, { status: 0 });
    }
    net.delivered += 1;
    const method = init.method ?? "GET";
    const body = init.body !== undefined ? JSON.parse(init.body) : undefined;
    const res = await callApi(env, { method, path: url, token: user.token, body });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      /* no body */
    }
    if (net.loseNextResponse) {
      // The server committed; the response died on the way back. This is the
      // shape that makes blind retries dangerous.
      net.loseNextResponse = false;
      throw new ApiError(`Network error calling ${url}: connection reset`, { status: 0 });
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
    net,
    storage,
    outbox: new TaskOutbox(1, storage), // project id fixed after seeding, see beforeEach
    cache: new TaskCache(1, storage),
    patchTask: makePatchTask(fetchJson),
  };
}

let web;
let phone;

/** What the edit dialog queues: the whole form, version handled by the engine. */
function editPayload(snapshot, changes) {
  return {
    title: snapshot.title,
    description: snapshot.description ?? null,
    status: snapshot.status,
    ...changes,
  };
}

async function readTaskAs(user) {
  const res = await callApi(env, { path: `/api/projects/${projectId}/tasks`, token: user.token });
  expect(res.status).toBe(200);
  const { tasks } = await res.json();
  return tasks.find((t) => t.task_id === taskId);
}

function dbRow() {
  return env.raw
    .prepare("SELECT title, description, status, version FROM tasks WHERE task_id = ?")
    .get(taskId);
}

function drain(client) {
  return drainOutbox(client.outbox, { patchTask: client.patchTask, cache: client.cache });
}

beforeEach(() => {
  env = freshDb();
  alice = seedUser(env, { email: "alice@example.com", name: "Alice" });
  wayne = seedUser(env, { email: "wayne@example.com", name: "Wayne" });
  projectId = seedProject(env, {
    name: "Shared",
    ownerId: alice.userId,
    memberIds: [alice.userId, wayne.userId],
  });
  taskId = seedTask(env, { projectId, title: "Original title", assignedTo: alice.userId });
  env.raw
    .prepare("UPDATE tasks SET description = ? WHERE task_id = ?")
    .run("Original description", taskId);

  web = makeClient(alice);
  phone = makeClient(wayne);
  for (const c of [web, phone]) {
    c.outbox = new TaskOutbox(projectId, c.storage);
    c.cache = new TaskCache(projectId, c.storage);
  }
});

describe("offline edit, refresh, reconnect", () => {
  it("queues while offline, survives a page refresh, and lands exactly once", async () => {
    const snapshot = await readTaskAs(alice);
    web.net.delivered = 0;
    web.net.online = false;

    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "Edited offline on the web" }),
    });
    expect((await drain(web)).outcome).toBe(DrainOutcome.RETRY);
    expect(web.net.delivered).toBe(0);
    expect(dbRow().title).toBe("Original title");

    // "Refresh": a brand-new outbox over the same storage, the way a reloaded
    // page reconstructs its state. The op is still there.
    const reloaded = new TaskOutbox(projectId, web.storage);
    expect(reloaded.pendingCount()).toBe(1);

    web.net.online = true;
    const result = await drainOutbox(reloaded, { patchTask: web.patchTask, cache: web.cache });
    expect(result.outcome).toBe(DrainOutcome.DRAINED);
    expect(web.net.delivered).toBe(1);
    expect(reloaded.pendingCount()).toBe(0);

    const row = dbRow();
    expect(row.title).toBe("Edited offline on the web");
    expect(row.version).toBe(snapshot.version + 1);
  });

  it("a delivery whose response was lost is finished on retry, not applied twice", async () => {
    const snapshot = await readTaskAs(alice);
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "Landed but unacknowledged" }),
    });

    web.net.loseNextResponse = true;
    expect((await drain(web)).outcome).toBe(DrainOutcome.RETRY);
    // The write committed even though the client never heard back.
    expect(dbRow().title).toBe("Landed but unacknowledged");
    expect(dbRow().version).toBe(snapshot.version + 1);
    expect(web.outbox.pendingCount()).toBe(1);

    // The retry bounces off the compare-and-swap, recognizes its own write in
    // the 409 body, and finishes the op without writing again.
    const retry = await drain(web);
    expect(retry.outcome).toBe(DrainOutcome.DRAINED);
    expect(web.outbox.ops()).toHaveLength(0);
    expect(dbRow().version).toBe(snapshot.version + 1); // still one bump, not two
  });

  it("two offline edits to the same task coalesce into a single delivery", async () => {
    const snapshot = await readTaskAs(alice);
    web.net.online = false;
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "First thought" }),
    });
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "Second thought" }),
    });
    expect(web.outbox.ops()).toHaveLength(1);

    web.net.online = true;
    web.net.delivered = 0;
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);
    expect(web.net.delivered).toBe(1);
    expect(dbRow().title).toBe("Second thought");
    expect(dbRow().version).toBe(snapshot.version + 1);
  });

  it("partial inline edits merge into one delivery instead of erasing each other", async () => {
    const snapshot = await readTaskAs(alice);
    web.net.online = false;
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: { status: "in-progress" },
    });
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: { priority: "high" },
    });

    expect(web.outbox.ops()).toHaveLength(1);
    expect(web.outbox.ops()[0].payload).toEqual({ status: "in-progress", priority: "high" });

    web.net.online = true;
    web.net.delivered = 0;
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);
    expect(web.net.delivered).toBe(1);
    expect(dbRow().status).toBe("in-progress");
    expect(dbRow().version).toBe(snapshot.version + 1);
  });
});

describe("concurrent offline edits from the web and the phone", () => {
  /**
   * Both clients read the task at version 1, both edit while offline, then
   * reconnect in the order under test. The first to reconnect lands; the
   * second is parked with the server row and resolves. `resolution` picks the
   * loser's decision so both orders can assert deterministic convergence.
   */
  async function bothEditOffline() {
    const webView = await readTaskAs(alice);
    const phoneView = await readTaskAs(wayne);
    expect(webView.version).toBe(phoneView.version);

    web.net.online = false;
    phone.net.online = false;
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: webView.version,
      payload: editPayload(webView, { title: "Retitled on the web" }),
    });
    phone.outbox.enqueueEdit({
      taskId,
      baseVersion: phoneView.version,
      payload: editPayload(phoneView, { title: "Retitled on the phone", status: "in-progress" }),
    });
    return { webView, phoneView };
  }

  /** Every replica and the database agree on (title, status, version). */
  async function expectConverged() {
    const row = dbRow();
    const asAlice = await readTaskAs(alice);
    const asWayne = await readTaskAs(wayne);
    for (const view of [asAlice, asWayne]) {
      expect(view.title).toBe(row.title);
      expect(view.status).toBe(row.status);
      expect(view.version).toBe(row.version);
    }
    expect(web.outbox.ops()).toHaveLength(0);
    expect(phone.outbox.ops()).toHaveLength(0);
    return row;
  }

  it("web reconnects first: the phone is parked, keep-theirs converges on the web's edit", async () => {
    const { webView } = await bothEditOffline();

    web.net.online = true;
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);
    expect(dbRow().title).toBe("Retitled on the web");

    phone.net.online = true;
    const result = await drain(phone);
    expect(result.outcome).toBe(DrainOutcome.NEEDS_USER);
    expect(result.parked).toBe(1);
    const parked = phone.outbox.ops()[0];
    expect(parked.state).toBe(OpState.CONFLICT);
    expect(parked.remote.title).toBe("Retitled on the web");
    expect(parked.remote.version).toBe(webView.version + 1);

    // The user takes the server's side; nothing further is written.
    phone.net.delivered = 0;
    expect(phone.outbox.keepTheirs(parked.opId)).not.toBeNull();
    expect(phone.net.delivered).toBe(0);

    const row = await expectConverged();
    expect(row.title).toBe("Retitled on the web");
    expect(row.version).toBe(webView.version + 1); // exactly one write landed
  });

  it("phone reconnects first: the web is parked, keep-mine rebases and converges on the web's edit", async () => {
    const { webView } = await bothEditOffline();

    phone.net.online = true;
    expect((await drain(phone)).outcome).toBe(DrainOutcome.DRAINED);
    expect(dbRow().title).toBe("Retitled on the phone");

    web.net.online = true;
    const result = await drain(web);
    expect(result.outcome).toBe(DrainOutcome.NEEDS_USER);
    const parked = web.outbox.ops()[0];
    expect(parked.state).toBe(OpState.CONFLICT);
    expect(parked.remote.title).toBe("Retitled on the phone");

    // The user insists on their edit: rebase onto the server's version and
    // resubmit. The phone's write is superseded by an informed decision, not
    // silently destroyed.
    expect(web.outbox.keepMine(parked.opId)).not.toBeNull();
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);

    const row = await expectConverged();
    expect(row.title).toBe("Retitled on the web");
    expect(row.version).toBe(webView.version + 2); // two writes: phone's, then the rebase
  });

  it("identical edits on both sides converge without asking anyone", async () => {
    const webView = await readTaskAs(alice);
    const phoneView = await readTaskAs(wayne);
    const samePayload = editPayload(webView, { title: "Same idea, both sides" });

    web.net.online = false;
    phone.net.online = false;
    web.outbox.enqueueEdit({ taskId, baseVersion: webView.version, payload: samePayload });
    phone.outbox.enqueueEdit({ taskId, baseVersion: phoneView.version, payload: samePayload });

    phone.net.online = true;
    expect((await drain(phone)).outcome).toBe(DrainOutcome.DRAINED);

    // The web's 409 is classified as already-applied: the row holds every
    // value the op wanted, so re-sending would be a duplicate write.
    web.net.online = true;
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);

    const row = await expectConverged();
    expect(row.title).toBe("Same idea, both sides");
    expect(row.version).toBe(webView.version + 1); // one write, not two
  });

  it("a parked conflict survives a refresh and is never re-sent on its own", async () => {
    await bothEditOffline();
    phone.net.online = true;
    await drain(phone);
    web.net.online = true;
    await drain(web);
    expect(web.outbox.parkedCount()).toBe(1);

    // Refresh the page: the parked decision is still waiting, snapshot intact.
    const reloaded = new TaskOutbox(projectId, web.storage);
    expect(reloaded.parkedCount()).toBe(1);
    expect(reloaded.ops()[0].remote.title).toBe("Retitled on the phone");

    // Draining again must not retry the parked op behind the user's back.
    web.net.delivered = 0;
    const again = await drainOutbox(reloaded, { patchTask: web.patchTask, cache: web.cache });
    expect(again.outcome).toBe(DrainOutcome.NEEDS_USER);
    expect(web.net.delivered).toBe(0);
  });
});

describe("authorization decides at delivery time", () => {
  it("membership removed while the edit waited: the queued write is refused, dropped, and reported", async () => {
    const snapshot = await readTaskAs(alice);
    web.net.online = false;
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "Should never land" }),
    });
    web.cache.write([snapshot]);

    // Removed from the project while offline (there is no removal endpoint;
    // this is the direct delete the server-side tests use too).
    env.raw
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(projectId, alice.userId);

    web.net.online = true;
    const result = await drain(web);
    expect(result.outcome).toBe(DrainOutcome.DRAINED);

    // Nothing was written, the op is gone, and the user can see why.
    expect(dbRow().title).toBe("Original title");
    expect(dbRow().version).toBe(snapshot.version);
    expect(web.outbox.ops()).toHaveLength(0);
    expect(web.outbox.notices()).toHaveLength(1);
    expect(web.outbox.notices()[0].message).toMatch(/403/);
    // Cached project data does not outlive the access that earned it.
    expect(web.cache.read()).toBeNull();

    // And a later drain has nothing to send: the refusal is permanent.
    web.net.delivered = 0;
    expect((await drain(web)).outcome).toBe(DrainOutcome.DRAINED);
    expect(web.net.delivered).toBe(0);
  });

  it("a dead session destroys the queue instead of replaying under it", async () => {
    const snapshot = await readTaskAs(alice);
    web.outbox.enqueueEdit({
      taskId,
      baseVersion: snapshot.version,
      payload: editPayload(snapshot, { title: "Should never land" }),
    });
    web.cache.write([snapshot]);

    env.raw.prepare("DELETE FROM sessions WHERE token = ?").run(alice.token);

    const result = await drain(web);
    expect(result.outcome).toBe(DrainOutcome.AUTH_LOST);
    expect(web.outbox.ops()).toHaveLength(0);
    expect(web.cache.read()).toBeNull();
    expect(dbRow().title).toBe("Original title");
  });
});

describe("negative controls: the naive behaviour this package replaces", () => {
  it("a versionless save (the old board behaviour) silently destroys a teammate's edit; a versioned one cannot", async () => {
    const staleSnapshot = await readTaskAs(alice);

    // Wayne saves first.
    const first = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: wayne.token,
      body: editPayload(staleSnapshot, { title: "Wayne's careful retitle" }),
    });
    expect(first.status).toBe(200);

    // NAIVE: Alice's stale full-form save without a version is accepted and
    // quietly restores the old title - Wayne's edit is gone and nobody was
    // told. This is what every pre-package save did.
    const naive = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: editPayload(staleSnapshot, { description: "Alice's notes" }),
    });
    expect(naive.status).toBe(200);
    expect(dbRow().title).toBe("Original title"); // Wayne's retitle destroyed

    // Reset and replay the same race through the engine: the stale save is
    // refused and parked instead of landing.
    env.raw
      .prepare("UPDATE tasks SET title = ?, description = ?, version = ? WHERE task_id = ?")
      .run("Original title", "Original description", 1, taskId);
    const wayneAgain = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: wayne.token,
      body: editPayload(staleSnapshot, { title: "Wayne's careful retitle", version: 1 }),
    });
    expect(wayneAgain.status).toBe(200);

    web.outbox.enqueueEdit({
      taskId,
      baseVersion: 1,
      payload: editPayload(staleSnapshot, { description: "Alice's notes" }),
    });
    const result = await drain(web);
    expect(result.outcome).toBe(DrainOutcome.NEEDS_USER);
    expect(dbRow().title).toBe("Wayne's careful retitle"); // intact this time
  });

  it("a blind retry after a lost response (naive queue) re-applies a stale payload over a newer edit; the engine parks it", async () => {
    const snapshot = await readTaskAs(alice);
    const payload = editPayload(snapshot, { title: "Alice's offline edit" });

    // Delivery 1 lands but the response is lost; Wayne edits in between.
    const d1 = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: payload, // versionless, like the old board
    });
    expect(d1.status).toBe(200);
    const wayneEdit = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: wayne.token,
      body: { status: "done" },
    });
    expect(wayneEdit.status).toBe(200);
    expect(dbRow().status).toBe("done");

    // NAIVE: the client never heard back, so it re-sends the same payload.
    // The second application overwrites Wayne's newer status change.
    const d2 = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: payload,
    });
    expect(d2.status).toBe(200);
    expect(dbRow().status).toBe("todo"); // Wayne's "done" destroyed by the replay

    // Same shape through the engine: the retry carries the original base
    // version, bounces off the compare-and-swap, sees the row holds more than
    // it wrote (Wayne's status), and parks for a decision instead.
    env.raw
      .prepare("UPDATE tasks SET title = ?, status = ?, version = ? WHERE task_id = ?")
      .run("Original title", "todo", 1, taskId);
    web.outbox.enqueueEdit({ taskId, baseVersion: 1, payload });
    web.net.loseNextResponse = true;
    expect((await drain(web)).outcome).toBe(DrainOutcome.RETRY);
    const between = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: wayne.token,
      body: { status: "done" },
    });
    expect(between.status).toBe(200);

    const retry = await drain(web);
    expect(retry.outcome).toBe(DrainOutcome.NEEDS_USER);
    expect(dbRow().status).toBe("done"); // Wayne's edit intact, decision surfaced
  });
});

describe("pure pieces", () => {
  it("classifyConflict tolerates the row's null assignee and description spelling", () => {
    const payload = { title: "T", description: null, status: "todo", assigned_to: 4 };
    expect(
      classifyConflict(payload, {
        title: "T",
        description: "",
        status: "todo",
        user_id: null,
        version: 2,
      })
    ).toBe(Verdict.ALREADY_APPLIED);
    expect(
      classifyConflict(payload, { title: "T", description: null, status: "todo", user_id: 9 })
    ).toBe(Verdict.NEEDS_DECISION);
    expect(
      classifyConflict(payload, { title: "Other", description: null, status: "todo", user_id: 4 })
    ).toBe(Verdict.NEEDS_DECISION);
    expect(
      classifyConflict(
        { ...payload, priority: "high" },
        {
          title: "T",
          description: null,
          status: "todo",
          user_id: 4,
          priority: "low",
        }
      )
    ).toBe(Verdict.NEEDS_DECISION);
  });

  it("overlayQueuedEdits paints the op's values and flags over the server rows", () => {
    const tasks = [
      { task_id: 1, title: "A", status: "todo", user_id: 2, version: 1 },
      { task_id: 2, title: "B", status: "todo", user_id: 2, version: 1 },
    ];
    const ops = [
      {
        opId: "op-1",
        taskId: 1,
        state: OpState.PENDING,
        payload: { title: "A edited", status: "in-progress", assigned_to: 5 },
      },
    ];
    const shown = overlayQueuedEdits(tasks, ops);
    expect(shown[0]).toMatchObject({
      title: "A edited",
      status: "in-progress",
      user_id: 5,
      _sync: "queued",
      _syncOpId: "op-1",
    });
    expect(shown[1]).toEqual(tasks[1]);
    expect(tasks[0].title).toBe("A"); // input untouched
  });

  it("a corrupt outbox document is treated as empty rather than crashing the board", () => {
    const storage = new MemoryStorage();
    storage.setItem(`sitrep.outbox.project-1`, "{not json");
    const outbox = new TaskOutbox(1, storage);
    expect(outbox.ops()).toEqual([]);
    outbox.enqueueEdit({ taskId: 1, baseVersion: 1, payload: { title: "x" } });
    expect(outbox.pendingCount()).toBe(1);
  });

  it("clearAllSyncStorage removes outbox and cache documents and nothing else", () => {
    const storage = new MemoryStorage();
    new TaskOutbox(1, storage).enqueueEdit({ taskId: 1, baseVersion: 1, payload: { title: "x" } });
    new TaskCache(1, storage).write([{ task_id: 1 }]);
    storage.setItem("sitrep_theme", "dark");
    clearAllSyncStorage(storage);
    expect(storage.getItem("sitrep.outbox.project-1")).toBeNull();
    expect(storage.getItem("sitrep.taskcache.project-1")).toBeNull();
    expect(storage.getItem("sitrep_theme")).toBe("dark");
  });
});
