import { describe, it, expect, vi } from "vitest";
import { onRequestDelete as deleteProject } from "../../functions/api/projects/[projectId]/index.js";

/**
 * Minimal D1 mock. The DELETE handler does one read (the project's `created_by`)
 * followed by a `batch()` of deletes, so we stub `prepare().bind().first()` to
 * return `projectRow` and record the batch call.
 */
function mockDb(projectRow) {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => projectRow),
      })),
    })),
    batch,
  };
  return { db, batch };
}

function ctx({ userId, db, projectId = "5" } = {}) {
  return {
    env: { DB: db },
    params: { projectId },
    data: { userId },
  };
}

describe("DELETE /api/projects/:projectId", () => {
  it("deletes the project (and its dependents) when the caller is the creator", async () => {
    const { db, batch } = mockDb({ created_by: 7 });
    const res = await deleteProject(ctx({ userId: 7, db }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    // One batch issuing the cascade of deletes.
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(6);
  });

  it("rejects a member who is not the creator with 403 and deletes nothing", async () => {
    const { db, batch } = mockDb({ created_by: 7 });
    const res = await deleteProject(ctx({ userId: 99, db }));

    expect(res.status).toBe(403);
    expect(batch).not.toHaveBeenCalled();
  });

  it("returns 404 when the project does not exist", async () => {
    const { db } = mockDb(null);
    const res = await deleteProject(ctx({ userId: 7, db }));

    expect(res.status).toBe(404);
  });

  it("returns 500 when the DB binding is missing", async () => {
    const res = await deleteProject(ctx({ userId: 7, db: undefined }));

    expect(res.status).toBe(500);
  });
});
