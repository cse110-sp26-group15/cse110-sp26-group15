/**
 * The write contract an offline client has to build against.
 *
 * The Android companion (android/) queues writes while the device has no
 * network and replays them later from a WorkManager job. A replay is not a
 * hypothetical: the queue survives process death, so an op can be re-sent after
 * the phone lost the response to a request the server had already committed.
 * These tests pin the two server behaviours that make that safe.
 *
 *   1. CREATE is idempotent when the caller supplies `client_token`. Replaying
 *      the same token returns the task the first attempt created instead of
 *      inserting a second one. Callers that send no token keep the previous
 *      behaviour exactly.
 *   2. UPDATE is compare-and-swap on `version` (db/migrations/0015). A replayed
 *      update carries the version it was built from, so once the first delivery
 *      lands the second is refused with 409 rather than applied twice.
 *
 * Plus the authorization half: a member removed from the project while their
 * phone was offline cannot land the queued write when it finally reaches the
 * server. That is checked at the execution boundary, not at request entry, so a
 * queued write is judged against membership as it stands when it arrives.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { callApi, freshDb, seedProject, seedTask, seedUser } from "./helpers/d1-harness.js";

let env;
let alice;
let projectId;

/** The body the Android client sends for a queued create. */
function createBody(clientToken, overrides = {}) {
  return {
    title: "Filed from the phone",
    description: "Written while offline",
    assigned_to: alice.userId,
    status: "todo",
    client_token: clientToken,
    ...overrides,
  };
}

function countTasks() {
  return env.raw.prepare("SELECT COUNT(*) AS n FROM tasks").get().n;
}

beforeEach(() => {
  env = freshDb();
  alice = seedUser(env, { email: "alice@example.com", name: "Alice" });
  projectId = seedProject(env, { name: "Shared", ownerId: alice.userId });
});

describe("create idempotency", () => {
  it("a create replayed with the same client token does not insert a second task", async () => {
    const token = "b7f0c0de-0000-4000-8000-000000000001";

    const first = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody(token),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()).task;
    expect(countTasks()).toBe(1);

    // The phone never saw that response, so WorkManager retries the same op.
    const replay = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody(token),
    });

    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.idempotent_replay).toBe(true);
    expect(replayBody.task.task_id).toBe(created.task_id);
    expect(countTasks()).toBe(1);
  });

  it("the replay returns the row as it stands, not the resent payload", async () => {
    const token = "b7f0c0de-0000-4000-8000-000000000002";
    const first = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody(token),
    });
    const created = (await first.json()).task;

    // Somebody edited the task on the web between the two deliveries.
    await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${created.task_id}`,
      token: alice.token,
      body: { title: "Renamed on the web", version: created.version },
    });

    const replay = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody(token),
    });
    const task = (await replay.json()).task;

    // The replay must not resurrect the original title: it is a read of the
    // row the first delivery created, not a second write.
    expect(task.title).toBe("Renamed on the web");
    expect(task.version).toBe(created.version + 1);
    expect(countTasks()).toBe(1);
  });

  it("two different client tokens create two tasks", async () => {
    for (const t of ["tok-a", "tok-b"]) {
      const res = await callApi(env, {
        method: "POST",
        path: `/api/projects/${projectId}/tasks`,
        token: alice.token,
        body: createBody(t),
      });
      expect(res.status).toBe(201);
    }
    expect(countTasks()).toBe(2);
  });

  it("a token is scoped to its project, so the same token in another project still creates", async () => {
    const other = seedProject(env, { name: "Other", ownerId: alice.userId });
    const token = "shared-token";

    const a = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody(token),
    });
    const b = await callApi(env, {
      method: "POST",
      path: `/api/projects/${other}/tasks`,
      token: alice.token,
      body: createBody(token),
    });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(countTasks()).toBe(2);
  });

  it("callers that send no client token keep last-write-wins create behaviour", async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await callApi(env, {
        method: "POST",
        path: `/api/projects/${projectId}/tasks`,
        token: alice.token,
        body: { title: "No token", assigned_to: alice.userId },
      });
      expect(res.status).toBe(201);
    }
    // Unchanged behaviour for the web client, which sends no token.
    expect(countTasks()).toBe(2);
  });

  it("rejects a client token that is not a short string", async () => {
    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: alice.token,
      body: createBody("x".repeat(200)),
    });
    expect(res.status).toBe(400);
    expect(countTasks()).toBe(0);
  });
});

describe("update replay", () => {
  it("a queued update delivered twice is applied once", async () => {
    const taskId = seedTask(env, { projectId, title: "Original", assignedTo: alice.userId });
    const base = 1;

    const first = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { title: "Edited on the phone", status: "in-progress", version: base },
    });
    expect(first.status).toBe(200);
    expect((await first.json()).task.version).toBe(base + 1);

    // Same op, replayed. It still carries the version it was built from.
    const replay = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { title: "Edited on the phone", status: "in-progress", version: base },
    });
    expect(replay.status).toBe(409);

    const conflict = await replay.json();
    // The 409 body is what lets the client tell "my write already landed" from
    // "somebody else changed this": every field the op wanted is already set.
    expect(conflict.task.title).toBe("Edited on the phone");
    expect(conflict.task.status).toBe("in-progress");
    expect(conflict.task.version).toBe(base + 1);

    const row = env.raw.prepare("SELECT title, version FROM tasks WHERE task_id = ?").get(taskId);
    expect(row.version).toBe(base + 1);
  });
});

describe("membership removed while the phone was offline", () => {
  let bob;
  let taskId;

  beforeEach(() => {
    bob = seedUser(env, { email: "bob@example.com", name: "Bob" });
    env.raw
      .prepare("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)")
      .run(projectId, bob.userId);
    taskId = seedTask(env, { projectId, title: "Original", assignedTo: alice.userId });
  });

  it("bob's queued create is refused once he is no longer a member", async () => {
    // He was a member when the op was queued.
    expect(
      (
        await callApi(env, {
          method: "GET",
          path: `/api/projects/${projectId}/tasks`,
          token: bob.token,
        })
      ).status
    ).toBe(200);

    env.raw
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(projectId, bob.userId);

    const res = await callApi(env, {
      method: "POST",
      path: `/api/projects/${projectId}/tasks`,
      token: bob.token,
      body: createBody("queued-while-offline", { assigned_to: bob.userId }),
    });

    expect(res.status).toBe(403);
    expect(countTasks()).toBe(1); // only the seeded row
  });

  it("bob's queued update is refused and the row is untouched", async () => {
    const before = env.raw.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);

    env.raw
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(projectId, bob.userId);

    const res = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: { title: "Edited after removal", version: before.version },
    });

    expect(res.status).toBe(403);
    const after = env.raw.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    expect(after).toEqual(before);
  });

  it("his session is still valid, so the refusal is authorization and not a logout", async () => {
    env.raw
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(projectId, bob.userId);

    const res = await callApi(env, { method: "GET", path: "/api/projects", token: bob.token });
    expect(res.status).toBe(200);
  });
});
