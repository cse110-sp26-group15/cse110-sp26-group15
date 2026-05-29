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

function createContext(url, db) {
  return {
    request: new Request(url),
    env: {
      DB: db,
    },
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

describe("blocker API", () => {
  it("returns 500 if D1 database binding is missing", async () => {
    const response = await onRequest({
      request: new Request("http://localhost/api/blockers?task=frontend"),
      env: {},
    });

    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("D1 database binding not configured.");
  });

  it("returns 400 if task is missing and general is not true", async () => {
    const db = createMockDb();

    const response = await onRequest(createContext("http://localhost/api/blockers", db));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing task query. Use ?task=TaskName or ?general=true.");
  });

  it("returns general blockers when general=true", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: "",
            is_resolved: 0,
            helper: "Alice",
            description: "Need help with API",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?general=true", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.general).toBe(true);
    expect(data.blocked).toBe(true);
    expect(data.blockers).toEqual([
      {
        task: "",
        blocked: true,
        helper: "Alice",
        description: "Need help with API",
      },
    ]);
  });

  it("returns general blockers when task=general", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: null,
            is_resolved: 1,
            helper: null,
            description: "Old resolved blocker",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=general", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.general).toBe(true);
    expect(data.blocked).toBe(false);
    expect(data.blockers[0]).toEqual({
      task: null,
      blocked: false,
      helper: null,
      description: "Old resolved blocker",
    });
  });

  it("returns not blocked when no blocker data exists for task", async () => {
    const db = createMockDb({
      allResult: {
        results: [],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=frontend", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      task: "frontend",
      blocked: false,
      blockers: [],
    });
  });

  it("returns all blockers for a task when multiple blockers exist", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: "frontend",
            is_resolved: 0,
            helper: "Alice",
            description: "API endpoint failing",
          },
          {
            task: "frontend",
            is_resolved: 0,
            helper: "Bob",
            description: "Merge conflict",
          },
          {
            task: "frontend",
            is_resolved: 1,
            helper: "Charlie",
            description: "CSS issue fixed",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=frontend", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toBe("frontend");
    expect(data.blocked).toBe(true);
    expect(data.blockers).toHaveLength(3);

    expect(data.blockers).toEqual([
      {
        blocked: true,
        helper: "Alice",
        description: "API endpoint failing",
      },
      {
        blocked: true,
        helper: "Bob",
        description: "Merge conflict",
      },
      {
        blocked: false,
        helper: "Charlie",
        description: "CSS issue fixed",
      },
    ]);
  });

  it("returns blocked=true when a task has one unresolved blocker", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: "frontend",
            is_resolved: 0,
            helper: "Bob",
            description: "CSS layout issue",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=frontend", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      task: "frontend",
      blocked: true,
      blockers: [
        {
          blocked: true,
          helper: "Bob",
          description: "CSS layout issue",
        },
      ],
    });
  });

  it("returns blocked=false when all task blockers are resolved", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: "backend",
            is_resolved: 1,
            helper: null,
            description: "Database issue fixed",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=backend", db)
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      task: "backend",
      blocked: false,
      blockers: [
        {
          blocked: false,
          helper: null,
          description: "Database issue fixed",
        },
      ],
    });
  });

  it("trims whitespace from task query", async () => {
    const db = createMockDb({
      allResult: {
        results: [
          {
            task: "frontend",
            is_resolved: 0,
            helper: "Alice",
            description: "Merge conflict",
          },
        ],
      },
    });

    const response = await onRequest(
      createContext("http://localhost/api/blockers?task=%20frontend%20", db)
    );

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toBe("frontend");
    expect(data.blocked).toBe(true);
    expect(data.blockers).toEqual([
      {
        blocked: true,
        helper: "Alice",
        description: "Merge conflict",
      },
    ]);
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
