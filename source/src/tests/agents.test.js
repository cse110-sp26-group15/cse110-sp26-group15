import { describe, it, expect, vi } from "vitest";
import {
  onRequestGet as getProjectAgents,
  onRequestPost as postProjectAgent,
} from "../../../functions/api/projects/[projectId]/agents.js";
import {
  onRequestGet as getAgent,
  onRequestPatch as patchAgent,
} from "../../../functions/api/agents/[userId].js";

/**
 * Build a mock D1 whose `first()` calls return values in the order
 * `firstResults` is given. `runResults` and `allResults` work the same
 * for `run()` and `all()`. We need ordering because the handlers issue
 * multiple SELECT statements per request (owner check, dup-email check,
 * fetch-after-insert) and a single fixed value can't satisfy all of them.
 */
function createMockDb({ firstResults = [], allResults = [], runResults = [] } = {}) {
  let firstIdx = 0;
  let allIdx = 0;
  let runIdx = 0;
  const bound = {
    first: vi.fn(async () => {
      const v = firstResults[firstIdx];
      firstIdx += 1;
      return v ?? null;
    }),
    all: vi.fn(async () => {
      const v = allResults[allIdx];
      allIdx += 1;
      return v ?? { results: [] };
    }),
    run: vi.fn(async () => {
      const v = runResults[runIdx];
      runIdx += 1;
      return v ?? { meta: { last_row_id: 99 } };
    }),
  };
  return {
    prepare: vi.fn(() => ({ bind: vi.fn(() => bound) })),
  };
}

function createContext({ projectId = "1", userId = "6", body, db } = {}) {
  const ctx = { env: { DB: db }, params: { projectId, userId } };
  if (body !== undefined) {
    ctx.request = new Request("http://localhost/", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
  return ctx;
}

describe("GET /projects/:projectId/agents", () => {
  it("returns the project's agents joined with owner info", async () => {
    const rows = [
      {
        user_id: 6,
        full_name: "SitRep-Bot-v1",
        email: "agent@sesitrep.ai",
        role: "AI-agent",
        agent_type: "standup-summarizer",
        description: "Summarises overnight commits.",
        last_active_at: "2026-05-30T12:00:00Z",
        owner_user_id: 1,
        owner_name: "Alex Rivera",
        owner_email: "arivera@ucsd.edu",
      },
    ];
    const db = createMockDb({ allResults: [{ results: rows }] });
    const res = await getProjectAgents(createContext({ db }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].owner_name).toBe("Alex Rivera");
  });

  it("returns 500 when DB is missing", async () => {
    const res = await getProjectAgents({ env: {}, params: { projectId: "1" } });
    expect(res.status).toBe(500);
  });
});

describe("POST /projects/:projectId/agents", () => {
  it("rejects when owner_user_id is missing", async () => {
    const db = createMockDb();
    const res = await postProjectAgent(
      createContext({
        db,
        body: { full_name: "Bot", email: "b@x.com", agent_type: "general" },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/owner_user_id/);
  });

  it("rejects when agent_type is not in the whitelist", async () => {
    const db = createMockDb();
    const res = await postProjectAgent(
      createContext({
        db,
        body: { full_name: "Bot", email: "b@x.com", agent_type: "evil-bot", owner_user_id: 1 },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/agent_type/);
  });

  it("rejects when owner_user_id is itself an agent", async () => {
    // First .first() — owner lookup that joins agents — returns null
    // because the WHERE filters out users that are agents.
    const db = createMockDb({ firstResults: [null] });
    const res = await postProjectAgent(
      createContext({
        db,
        body: { full_name: "Bot", email: "b@x.com", agent_type: "general", owner_user_id: 6 },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/non-agent/);
  });

  it("rejects duplicate email with 409", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 1, full_name: "Alex" }, // owner exists + non-agent
        { user_id: 5 }, // existing email
      ],
    });
    const res = await postProjectAgent(
      createContext({
        db,
        body: { full_name: "Bot", email: "dup@x.com", agent_type: "general", owner_user_id: 1 },
      })
    );
    expect(res.status).toBe(409);
  });

  it("creates the agent and returns it joined with owner", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 1, full_name: "Alex Rivera" }, // owner check
        null, // dup-email check (no dup)
        {
          // final SELECT
          user_id: 8,
          full_name: "QA-Bot",
          email: "qa@b.ai",
          role: "AI-agent",
          agent_type: "qa-bot",
          description: null,
          last_active_at: "2026-05-30T12:00:00Z",
          owner_user_id: 1,
          owner_name: "Alex Rivera",
          owner_email: "arivera@ucsd.edu",
        },
      ],
      runResults: [{ meta: { last_row_id: 8 } }, { meta: {} }, { meta: {} }],
    });
    const res = await postProjectAgent(
      createContext({
        db,
        body: { full_name: "QA-Bot", email: "qa@b.ai", agent_type: "qa-bot", owner_user_id: 1 },
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.agent.full_name).toBe("QA-Bot");
    expect(data.agent.owner_user_id).toBe(1);
  });
});

describe("PATCH /agents/:userId", () => {
  it("rejects when owner_user_id is null", async () => {
    const db = createMockDb();
    const res = await patchAgent(createContext({ db, body: { owner_user_id: null } }));
    expect(res.status).toBe(400);
  });

  it("rejects when no fields are supplied", async () => {
    const db = createMockDb();
    const res = await patchAgent(createContext({ db, body: {} }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/No valid fields/);
  });

  it("updates owner when new owner is a human", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 2 }, // owner check — non-agent user exists
        { user_id: 6 }, // agent exists
        {
          user_id: 6,
          full_name: "SitRep-Bot-v1",
          agent_type: "standup-summarizer",
          description: null,
          last_active_at: "2026-05-30T12:00:00Z",
          owner_user_id: 2,
          owner_name: "Sam Chen",
        },
      ],
    });
    const res = await patchAgent(createContext({ db, body: { owner_user_id: 2 } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent.owner_user_id).toBe(2);
  });

  it("returns 404 when agent does not exist", async () => {
    const db = createMockDb({
      firstResults: [
        { user_id: 2 }, // owner check passes
        null, // existing agent lookup → not found
      ],
    });
    const res = await patchAgent(createContext({ db, body: { owner_user_id: 2 } }));
    expect(res.status).toBe(404);
  });
});

describe("GET /agents/:userId", () => {
  it("returns 404 when not found", async () => {
    const db = createMockDb({ firstResults: [null] });
    const res = await getAgent(createContext({ db }));
    expect(res.status).toBe(404);
  });
});
