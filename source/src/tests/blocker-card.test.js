import { describe, it, expect } from "vitest";
import {
  filterActiveBlockers,
  mapApiBlocker,
  matchTaskByName,
  normalizeTaskName,
} from "../../blocker-card/blocker-card.js";

describe("mapApiBlocker", () => {
  it("passes through a fully-populated API row", () => {
    expect(
      mapApiBlocker({
        task: "Fix login",
        blocked: true,
        helper: "Alex",
        reported_by: "Sam",
        description: "Token broken",
      })
    ).toEqual({
      task: "Fix login",
      blocked: true,
      helper: "Alex",
      reportedBy: "Sam",
      description: "Token broken",
    });
  });

  it("defaults missing optional fields", () => {
    expect(mapApiBlocker({})).toEqual({
      task: null,
      blocked: false,
      helper: null,
      reportedBy: null,
      description: "",
    });
  });

  it("coerces truthy blocked values to boolean", () => {
    expect(mapApiBlocker({ blocked: 1 }).blocked).toBe(true);
    expect(mapApiBlocker({ blocked: 0 }).blocked).toBe(false);
    expect(mapApiBlocker({ blocked: null }).blocked).toBe(false);
  });

  it("preserves null helper (no fallback name)", () => {
    expect(mapApiBlocker({ helper: null }).helper).toBeNull();
  });

  it("renames reported_by → reportedBy and defaults to null", () => {
    expect(mapApiBlocker({ reported_by: "Sam" }).reportedBy).toBe("Sam");
    expect(mapApiBlocker({}).reportedBy).toBeNull();
  });

  it("extracts full_name when reported_by is a {user_id, full_name} object", () => {
    expect(mapApiBlocker({ reported_by: { user_id: 3, full_name: "Sam Chen" } }).reportedBy).toBe(
      "Sam Chen"
    );
    expect(mapApiBlocker({ reported_by: { user_id: 3 } }).reportedBy).toBeNull();
  });
});

describe("filterActiveBlockers", () => {
  it("keeps only blockers where blocked is true", () => {
    const input = [
      { task: "a", blocked: true },
      { task: "b", blocked: false },
      { task: "c", blocked: true },
    ];
    expect(filterActiveBlockers(input)).toEqual([
      { task: "a", blocked: true },
      { task: "c", blocked: true },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(filterActiveBlockers(null)).toEqual([]);
    expect(filterActiveBlockers(undefined)).toEqual([]);
    expect(filterActiveBlockers("nope")).toEqual([]);
  });

  it("skips null/undefined entries without throwing", () => {
    expect(filterActiveBlockers([null, undefined, { blocked: true }])).toEqual([{ blocked: true }]);
  });
});

describe("normalizeTaskName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeTaskName("  Fix   Login  Timeout  ")).toBe("fix login timeout");
  });

  it("treats null / undefined as empty string", () => {
    expect(normalizeTaskName(null)).toBe("");
    expect(normalizeTaskName(undefined)).toBe("");
  });
});

describe("matchTaskByName", () => {
  const tasks = [
    { task_id: 1, title: "Fix login timeout on mobile" },
    { task_id: 2, title: "Add filter by priority to dashboard" },
    { task_id: 3, title: "Update readme with setup instructions" },
  ];

  it("finds an exact title match", () => {
    expect(matchTaskByName("Fix login timeout on mobile", tasks)).toBe(tasks[0]);
  });

  it("matches case-insensitively and ignores extra whitespace", () => {
    expect(matchTaskByName("  ADD   filter  BY priority TO dashboard", tasks)).toBe(tasks[1]);
  });

  it("returns null when no task matches", () => {
    expect(matchTaskByName("Nonexistent task", tasks)).toBeNull();
  });

  it("returns null on empty / null name", () => {
    expect(matchTaskByName("", tasks)).toBeNull();
    expect(matchTaskByName(null, tasks)).toBeNull();
  });

  it("returns null when tasks is not an array", () => {
    expect(matchTaskByName("Fix login timeout on mobile", null)).toBeNull();
  });

  it("safely skips tasks without a title field", () => {
    const messy = [{}, { title: null }, { title: "Real task" }];
    expect(matchTaskByName("Real task", messy)).toBe(messy[2]);
  });
});
