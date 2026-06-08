import { describe, it, expect, vi } from "vitest";
import { onRequest, onRequestPost } from "../../../functions/api/projects/[projectId]/blockers.js";

function createMockDb({ allResult, firstQueue = [], runResult } = {}) {
  const firstQ = [...firstQueue];
  const bound = {
    all: vi.fn(async () => allResult ?? { results: [] }),
    first: vi.fn(async () => (firstQ.length ? firstQ.shift() : null)),
    run: vi.fn(async () => runResult ?? { meta: { last_row_id: 1 } }),
  };
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => bound),
      all: vi.fn(async () => allResult ?? { results: [] }),
    })),
  };
}

function createContext(url, db, projectId = "1") {
  return {
    request: new Request(url),
    env: { DB: db },
    params: { projectId },
  };
}

function createPostContext({ projectId = "1", body, db }) {
  return {
    env: { DB: db },
    params: { projectId },
    request: new Request("http://localhost/", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("GET /api/projects/:projectId/blockers", () => {
  it("returns 500 if D1 database binding is missing", async () => {
    const response = await onRequest({
      request: new Request("http://localhost/api/projects/1/blockers?task=frontend"),
      env: {},
      params: { projectId: "1" },
    });

    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("D1 database binding not configured.");
  });

  it("with no query, returns all open blockers for the project (rich shape)", async () => {
    const row = {
      blocker_id: 7,
      task: "frontend",
      description: "Merge conflict",
      helper: "Alice",
      is_resolved: 0,
      checkin_id: 3,
      checkin_date: "2026-05-29",
      user_id: 2,
      full_name: "Sam Chen",
    };
    const db = createMockDb({ allResult: { results: [row] } });

    const response = await onRequest(createContext("http://localhost/api/projects/1/blockers", db));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.blockers).toEqual([
      {
        blocker_id: 7,
        task: "frontend",
        description: "Merge conflict",
        helper: "Alice",
        is_resolved: false,
        blocked: true,
        checkin_id: 3,
        checkin_date: "2026-05-29",
        reported_by: "Sam Chen",
        user_id: 2,
        full_name: "Sam Chen",
      },
    ]);
  });

  it("with ?general=true, returns blockers where task is null/empty", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            blocker_id: 9,
            task: null,
            description: "Need help with API",
            helper: "Alice",
            is_resolved: 0,
            checkin_id: 4,
            checkin_date: "2026-05-29",
            user_id: 3,
            full_name: "Jordan Smith",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/projects/1/blockers?general=true", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.general).toBe(true);
    expect(data.blocked).toBe(true);
    expect(data.blockers[0]).toMatchObject({
      blocker_id: 9,
      blocked: true,
      helper: "Alice",
      description: "Need help with API",
      reported_by: "Jordan Smith",
    });
  });

  it("with ?task=name, returns only blockers tagged with that task", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            blocker_id: 1,
            task: "frontend",
            is_resolved: 0,
            helper: "Alice",
            description: "API endpoint failing",
            checkin_id: 2,
            checkin_date: "2026-05-29",
            user_id: 2,
            full_name: "Sam Chen",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/projects/1/blockers?task=frontend", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toBe("frontend");
    expect(data.blocked).toBe(true);
    expect(data.blockers[0]).toMatchObject({
      blocker_id: 1,
      blocked: true,
      helper: "Alice",
      description: "API endpoint failing",
    });
  });

  it("trims whitespace from task query", async () => {
    const db = createMockDb({
      allResult: { results: [] },
    });

    const response = await onRequest(
      createContext("http://localhost/api/projects/1/blockers?task=%20frontend%20", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toBe("frontend");
  });
});

describe("POST /projects/:projectId/blockers", () => {
  it("creates a blocker when checkin belongs to the project", async () => {
    const created = {
      blocker_id: 2,
      checkin_id: 2,
      description: "CI failing",
      is_resolved: 0,
      resolved_at: null,
      task: "CI/CD",
      helper: "Alex",
    };
    const db = createMockDb({
      firstQueue: [{ checkin_id: 2 }, created],
      runResult: { meta: { last_row_id: 2 } },
    });

    const response = await onRequestPost(
      createPostContext({
        db,
        body: {
          checkin_id: 2,
          description: "CI failing",
          task: "CI/CD",
          helper: "Alex",
        },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual({ blocker: created });
  });

  it("returns 400 when checkin does not belong to the project", async () => {
    const db = createMockDb({ firstQueue: [null] });

    const response = await onRequestPost(
      createPostContext({
        projectId: "999",
        db,
        body: { checkin_id: 2, description: "x" },
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("checkin_id does not belong to this project");
  });

  it("returns 400 when checkin_id is missing", async () => {
    const db = createMockDb();

    const response = await onRequestPost(createPostContext({ db, body: { description: "x" } }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("checkin_id is required");
  });

  it("returns 400 when description is missing or empty", async () => {
    const db = createMockDb();

    const response = await onRequestPost(
      createPostContext({ db, body: { checkin_id: 2, description: "   " } })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("description is required");
  });

  it("defaults task and helper to null when omitted", async () => {
    const created = {
      blocker_id: 3,
      checkin_id: 2,
      description: "x",
      is_resolved: 0,
      resolved_at: null,
      task: null,
      helper: null,
    };
    const db = createMockDb({
      firstQueue: [{ checkin_id: 2 }, created],
      runResult: { meta: { last_row_id: 3 } },
    });

    const response = await onRequestPost(
      createPostContext({ db, body: { checkin_id: 2, description: "x" } })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.blocker.task).toBeNull();
    expect(data.blocker.helper).toBeNull();
  });
});
