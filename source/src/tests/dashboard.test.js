import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPlatformProxy } from "wrangler";
import {
  onRequestGet,
  buildDashboardPayload,
  getCheckinDateRange,
  mapOpenBlocker,
  mapCheckinEntry,
} from "../../../functions/api/projects/[projectId]/dashboard.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DB_NAME = "cse110-sp26-group15";

/**
 * Runs a SQL file against the local D1 database via wrangler.
 * @param {string} filename - File name inside db/ (e.g. reset.sql).
 */
function runD1File(filename) {
  const filePath = join(ROOT, "db", filename);
  execSync(`npx wrangler d1 execute ${DB_NAME} --local --file="${filePath}"`, {
    cwd: ROOT,
    stdio: "pipe",
  });
}

/**
 * Applies migrations, clears data, and loads the dashboard test fixture.
 */
function seedDashboardTestDb() {
  execSync(`npx wrangler d1 migrations apply ${DB_NAME} --local`, {
    cwd: ROOT,
    stdio: "pipe",
  });
  runD1File("reset.sql");
  runD1File("dashboard-test-seed.sql");
}

/**
 * @param {string} projectId
 * @param {object} db
 * @returns {{ env: { DB: object }, params: { projectId: string } }}
 */
function createContext(projectId, db) {
  return {
    env: { DB: db },
    params: { projectId },
  };
}

describe("dashboard helpers", () => {
  it("getCheckinDateRange returns a two-day inclusive window ending today", () => {
    const { from, to } = getCheckinDateRange();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    expect(to).toBe(today.toISOString().slice(0, 10));
    expect(from).toBe(yesterday.toISOString().slice(0, 10));
  });

  it("mapOpenBlocker normalizes nullable task and helper fields", () => {
    expect(
      mapOpenBlocker({
        blocker_id: 1,
        description: "Blocked",
        task: undefined,
        helper: undefined,
        checkin_id: 2,
        user_id: 3,
        full_name: "Sam Chen",
        checkin_date: "2026-05-16",
      })
    ).toEqual({
      blocker_id: 1,
      description: "Blocked",
      task: null,
      helper: null,
      checkin_id: 2,
      reported_by: { user_id: 3, full_name: "Sam Chen" },
      checkin_date: "2026-05-16",
    });
  });

  it("mapCheckinEntry shapes user nested object", () => {
    expect(
      mapCheckinEntry({
        checkin_id: 1,
        checkin_date: "2026-05-16",
        status_mood: "Good",
        work_done: "Done work",
        work_planned: "Next work",
        user_id: 2,
        full_name: "Alex Rivera",
      })
    ).toEqual({
      checkin_id: 1,
      checkin_date: "2026-05-16",
      status_mood: "Good",
      work_done: "Done work",
      work_planned: "Next work",
      user: { user_id: 2, full_name: "Alex Rivera" },
    });
  });

  it("buildDashboardPayload assembles all sections", () => {
    const payload = buildDashboardPayload({
      project: { project_id: 1, name: "Test" },
      members: [{ user_id: 1, full_name: "Alex" }],
      tasks: [{ task_id: 1, title: "Task" }],
      blockers: [
        {
          blocker_id: 1,
          description: "Stuck",
          task: null,
          helper: "Jordan",
          checkin_id: 1,
          user_id: 2,
          full_name: "Sam",
          checkin_date: "2026-05-16",
        },
      ],
      checkins: [
        {
          checkin_id: 1,
          checkin_date: "2026-05-16",
          status_mood: "OK",
          work_done: "a",
          work_planned: "b",
          user_id: 1,
          full_name: "Alex",
        },
      ],
    });

    expect(payload.project.name).toBe("Test");
    expect(payload.members).toHaveLength(1);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.open_blockers).toHaveLength(1);
    expect(payload.checkins.entries).toHaveLength(1);
    expect(payload.meta.checkin_days).toBe(2);
    expect(payload.meta.generated_at).toBeTruthy();
  });
});

describe.sequential("dashboard API", () => {
  /** @type {object | undefined} */
  let db;
  /** @type {(() => Promise<void>) | undefined} */
  let dispose;
  /** @type {string | undefined} */
  let fullProjectId;
  /** @type {string | undefined} */
  let emptyProjectId;

  beforeAll(async () => {
    seedDashboardTestDb();

    const proxy = await getPlatformProxy({
      configPath: join(ROOT, "wrangler.toml"),
    });

    db = proxy.env.DB;
    dispose = proxy.dispose;

    const fullProject = await db
      .prepare("SELECT project_id FROM projects WHERE name = ?")
      .bind("SE SitRep Prototype")
      .first();

    const emptyProject = await db
      .prepare("SELECT project_id FROM projects WHERE name = ?")
      .bind("Empty Project")
      .first();

    fullProjectId = String(fullProject.project_id);
    emptyProjectId = String(emptyProject.project_id);
  }, 30000);

  afterAll(async () => {
    runD1File("reset.sql");
    await dispose?.();
  });

  it("returns 500 if D1 database binding is missing", async () => {
    const response = await onRequestGet({ env: {}, params: { projectId: "1" } });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("D1 database binding not configured.");
  });

  it("returns 404 when project does not exist", async () => {
    const response = await onRequestGet(createContext("99", db));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Project not found");
  });

  it("returns full dashboard payload for an existing project", async () => {
    const response = await onRequestGet(createContext(fullProjectId, db));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.project.name).toBe("SE SitRep Prototype");
    expect(data.project.description).toBe("A tool for tracking status.");
    expect(data.members).toHaveLength(1);
    expect(data.members[0].full_name).toBe("Alex Rivera");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe("Create User Personas");
    expect(data.open_blockers).toHaveLength(1);
    expect(data.open_blockers[0].description).toBe("Waiting for approval");
    expect(data.open_blockers[0].reported_by.full_name).toBe("Sam Chen");
    expect(data.checkins.entries).toHaveLength(3);
    expect(data.checkins.entries.every((e) => e.checkin_date !== undefined)).toBe(true);
    expect(data.meta.checkin_days).toBe(2);
  });

  it("excludes check-ins older than the two-day window", async () => {
    const response = await onRequestGet(createContext(fullProjectId, db));
    const data = await response.json();

    const workDoneValues = data.checkins.entries.map((e) => e.work_done);
    expect(workDoneValues).not.toContain("Should not appear.");
  });

  it("returns empty arrays when project has no tasks, blockers, or check-ins", async () => {
    const response = await onRequestGet(createContext(emptyProjectId, db));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.project.name).toBe("Empty Project");
    expect(data.members).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.open_blockers).toEqual([]);
    expect(data.checkins.entries).toEqual([]);
  });
});
