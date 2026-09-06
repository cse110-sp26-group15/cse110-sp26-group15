/**
 * Concurrent edits to the same task.
 *
 * The board's edit dialog does not PATCH the one field the user touched - it
 * PATCHes the whole form (source/dashboard/main.js buildEditPayload sends
 * title, description, assigned_to, status, priority and reviewer together), so
 * two teammates who open the same card and each change a different field will
 * write over one another. These tests reproduce that from two sessions against
 * a real database, then pin the compare-and-swap behaviour that fixes it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { callApi, freshDb, seedProject, seedTask, seedUser } from "./helpers/d1-harness.js";

let env;
let alice;
let bob;
let projectId;
let taskId;

/** What the edit dialog sends: every field on the form, not just the changed one. */
function editPayload(snapshot, changes) {
  return {
    title: snapshot.title,
    description: snapshot.description ?? null,
    status: snapshot.status,
    ...changes,
  };
}

/** Read one task back the way the board does (through the project task list). */
async function readTask(token) {
  const res = await callApi(env, { path: `/api/projects/${projectId}/tasks`, token });
  expect(res.status).toBe(200);
  const { tasks } = await res.json();
  return tasks.find((t) => t.task_id === taskId);
}

beforeEach(() => {
  env = freshDb();
  alice = seedUser(env, { email: "alice@example.com", name: "Alice" });
  bob = seedUser(env, { email: "bob@example.com", name: "Bob" });
  projectId = seedProject(env, {
    name: "Shared",
    ownerId: alice.userId,
    memberIds: [alice.userId, bob.userId],
  });
  taskId = seedTask(env, { projectId, title: "Original title", assignedTo: alice.userId });
  env.raw
    .prepare("UPDATE tasks SET description = ? WHERE task_id = ?")
    .run("Original description", taskId);
});

describe("two sessions editing the same task", () => {
  it("a version-checked second write is refused instead of overwriting", async () => {
    // Both teammates open the card. Same snapshot, same version.
    const aliceView = await readTask(alice.token);
    const bobView = await readTask(bob.token);
    expect(aliceView.version).toBe(bobView.version);

    // Alice retitles and saves first.
    const first = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: editPayload(aliceView, { title: "Alice's new title", version: aliceView.version }),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).task.version).toBe(aliceView.version + 1);

    // Bob saves his description change from the snapshot he loaded before
    // Alice's save. Under last-write-wins this silently restored the old title.
    const second = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: editPayload(bobView, { description: "Bob's notes", version: bobView.version }),
    });
    expect(second.status).toBe(409);

    // Alice's edit survived, and Bob's stale copy of the title was not written.
    const row = env.raw
      .prepare("SELECT title, description FROM tasks WHERE task_id = ?")
      .get(taskId);
    expect(row.title).toBe("Alice's new title");
    expect(row.description).toBe("Original description");
  });

  it("the conflict response carries the current row so the client can recover", async () => {
    const stale = await readTask(bob.token);
    await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { title: "Alice won", version: stale.version },
    });

    const conflict = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: editPayload(stale, { description: "Bob's notes", version: stale.version }),
    });
    expect(conflict.status).toBe(409);

    const body = await conflict.json();
    expect(body.conflict).toBe(true);
    expect(body.task.title).toBe("Alice won");
    expect(body.task.version).toBe(stale.version + 1);
    // Enough for the UI to re-render the card and let the user re-apply their edit.
    expect(body.error).toMatch(/changed/i);
  });

  it("Bob succeeds once he retries against the version he was handed", async () => {
    const stale = await readTask(bob.token);
    await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { title: "Alice won", version: stale.version },
    });

    const conflict = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: editPayload(stale, { description: "Bob's notes", version: stale.version }),
    });
    const { task: current } = await conflict.json();

    const retry = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: editPayload(current, { description: "Bob's notes", version: current.version }),
    });
    expect(retry.status).toBe(200);

    const row = env.raw
      .prepare("SELECT title, description FROM tasks WHERE task_id = ?")
      .get(taskId);
    expect(row.title).toBe("Alice won");
    expect(row.description).toBe("Bob's notes");
  });

  it("every accepted write advances the version", async () => {
    const start = (await readTask(alice.token)).version;
    for (let i = 1; i <= 3; i++) {
      const res = await callApi(env, {
        method: "PATCH",
        path: `/api/tasks/${taskId}`,
        token: alice.token,
        body: { title: `edit ${i}`, version: start + i - 1 },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).task.version).toBe(start + i);
    }
  });

  it("a version for a task that no longer exists is a 404, not a conflict", async () => {
    const view = await readTask(alice.token);
    env.raw.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
    const res = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { title: "gone", version: view.version },
    });
    expect(res.status).toBe(404);
  });

  it("authorization still runs ahead of the version check", async () => {
    // A non-member must not be able to probe versions or learn a task exists.
    const mallory = seedUser(env, { email: "mallory@example.com", name: "Mallory" });
    const res = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: mallory.token,
      body: { title: "pwned", version: 1 },
    });
    expect(res.status).toBe(403);
  });
});

describe("callers that do not send a version", () => {
  it("still work, so the single-field controls are unchanged", async () => {
    // The kanban status dropdown PATCHes one field and sends no version.
    const res = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { status: "in-progress" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).task.status).toBe("in-progress");
  });

  it("but their write still advances the version, so a held snapshot goes stale", async () => {
    const held = await readTask(bob.token);

    // Someone else moves the card with a versionless single-field PATCH.
    await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: alice.token,
      body: { status: "done" },
    });

    // Bob's full-form save from before that move is now correctly refused,
    // rather than quietly resetting the status back to todo.
    const res = await callApi(env, {
      method: "PATCH",
      path: `/api/tasks/${taskId}`,
      token: bob.token,
      body: editPayload(held, { description: "Bob's notes", version: held.version }),
    });
    expect(res.status).toBe(409);
    expect(env.raw.prepare("SELECT status FROM tasks WHERE task_id = ?").get(taskId).status).toBe(
      "done"
    );
  });
});
