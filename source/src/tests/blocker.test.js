import { describe, it, expect, vi } from "vitest";
import { onRequest } from "../../functions/api/blockers.js";

function createMockDb({ allResult } = {}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => allResult ?? { results: [] }),
      })),
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

    const response = await onRequest(createContext("http://localhost/api/blockers?general=true", db));
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

    const response = await onRequest(createContext("http://localhost/api/blockers?task=general", db));
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

    const response = await onRequest(createContext("http://localhost/api/blockers?task=frontend", db));
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

    const response = await onRequest(createContext("http://localhost/api/blockers?task=frontend", db));
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

    const response = await onRequest(createContext("http://localhost/api/blockers?task=frontend", db));
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

    const response = await onRequest(createContext("http://localhost/api/blockers?task=backend", db));
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