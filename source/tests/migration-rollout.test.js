import { describe, expect, it } from "vitest";

import { onRequestPatch as patchTaskCurrent } from "../../functions/api/tasks/[taskId].js";
import { onRequestPost as createTaskCurrent } from "../../functions/api/projects/[projectId]/tasks.js";
import { patchTaskV14 } from "./fixtures/task-service-v14.js";
import { applyMigrations, freshDb, seedProject, seedTask, seedUser } from "./helpers/d1-harness.js";

function context(env, userId, taskId, body) {
  return {
    env,
    data: { userId },
    params: { taskId: String(taskId) },
    request: new Request(`http://sitrep.test/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
}

describe("0015 expand rollout", () => {
  it("keeps the previous service writing while the current service starts using versions", async () => {
    const env = freshDb({ through: 14 });
    const owner = seedUser(env, { email: "owner@example.test" });
    const projectId = seedProject(env, {
      name: "Migration",
      ownerId: owner.userId,
    });
    const taskId = seedTask(env, { projectId, title: "before" });

    const before = await patchTaskV14(context(env, owner.userId, taskId, { title: "old before" }));
    expect(before.status).toBe(200);

    applyMigrations(env.raw, { after: 14, through: 15 });

    const oldAfterExpand = await patchTaskV14(
      context(env, owner.userId, taskId, { title: "old during rollout" })
    );
    expect(oldAfterExpand.status).toBe(200);
    expect(
      env.raw.prepare("SELECT title, version FROM tasks WHERE task_id = ?").get(taskId)
    ).toEqual({
      title: "old during rollout",
      version: 1,
    });

    const current = await patchTaskCurrent(
      context(env, owner.userId, taskId, {
        title: "new during rollout",
        version: 1,
      })
    );
    expect(current.status).toBe(200);
    expect((await current.json()).task.version).toBe(2);
    expect(
      env.raw.prepare("SELECT title, version FROM tasks WHERE task_id = ?").get(taskId)
    ).toEqual({
      title: "new during rollout",
      version: 2,
    });
  });
});

describe("0016 failed migration repair", () => {
  it("rolls back partial DDL, preserves old rows, and accepts a current-service write after repair", async () => {
    const env = freshDb({ through: 15 });
    const owner = seedUser(env, { email: "repair@example.test" });
    const projectId = seedProject(env, {
      name: "Repair",
      ownerId: owner.userId,
    });
    const oldTaskId = seedTask(env, { projectId, title: "must survive" });

    env.raw.exec("BEGIN");
    try {
      env.raw.exec("ALTER TABLE tasks ADD COLUMN client_token TEXT");
      env.raw.exec("ALTER TABLE table_that_does_not_exist ADD COLUMN broken TEXT");
      env.raw.exec("COMMIT");
      throw new Error("the deliberately broken migration unexpectedly succeeded");
    } catch (error) {
      env.raw.exec("ROLLBACK");
      expect(String(error)).toContain("table_that_does_not_exist");
    }

    const columnsAfterFailure = env.raw
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .map((row) => row.name);
    expect(columnsAfterFailure).not.toContain("client_token");
    expect(env.raw.prepare("SELECT title FROM tasks WHERE task_id = ?").get(oldTaskId).title).toBe(
      "must survive"
    );

    applyMigrations(env.raw, { after: 15, through: 16 });
    const create = await createTaskCurrent({
      env,
      data: { userId: owner.userId },
      params: { projectId: String(projectId) },
      request: new Request(`http://sitrep.test/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "written after repair",
          assigned_to: owner.userId,
          client_token: "migration-repair-create",
        }),
      }),
    });
    expect(create.status).toBe(201);
    expect(env.raw.prepare("SELECT count(*) AS n FROM tasks").get().n).toBe(2);
    expect(env.raw.prepare("SELECT title FROM tasks WHERE task_id = ?").get(oldTaskId).title).toBe(
      "must survive"
    );
  });
});
