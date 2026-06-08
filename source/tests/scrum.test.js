// Tests for the pure helpers in scrum.js.
//
// The DOM-only side of scrum.js is gated behind `typeof document !==
// "undefined"`, so importing the module here (under node) doesn't try to
// run any browser code. Anything DOM-shaped (renderers, event handlers)
// is exercised manually in the browser; everything testable in node
// lives in the pure helpers asserted below.

import { describe, it, expect } from "vitest";
import {
  PROJECT_ID,
  STATUS_COLUMNS,
  escapeHtml,
  initials,
  formatDate,
  classifyMood,
  parseISODate,
  computeDayOfSprint,
  computeSprintProgress,
  groupTasksByStatus,
  formatSprintRange,
  readSprintFromStorage,
  writeSprintToStorage,
} from "../../dashboard/scrum.js";

// ── Module constants ────────────────────────────────
describe("scrum module constants", () => {
  it("exposes a numeric PROJECT_ID", () => {
    expect(typeof PROJECT_ID).toBe("number");
    expect(PROJECT_ID).toBeGreaterThan(0);
  });

  it("declares the four kanban status columns in order", () => {
    expect(STATUS_COLUMNS.map((c) => c.key)).toEqual(["todo", "in-progress", "blocked", "done"]);
    for (const col of STATUS_COLUMNS) {
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
    }
  });
});

// ── escapeHtml ──────────────────────────────────────
describe("escapeHtml", () => {
  it("encodes the five HTML metacharacters", () => {
    expect(escapeHtml(`<script>"&'</script>`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;"
    );
  });

  it("coerces nullish to empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeHtml("Hello world")).toBe("Hello world");
  });
});

// ── initials ────────────────────────────────────────
describe("initials", () => {
  it("returns ? for falsy names", () => {
    expect(initials("")).toBe("?");
    expect(initials(undefined)).toBe("?");
  });

  it("returns up to two uppercase initials", () => {
    expect(initials("Alex Rivera")).toBe("AR");
    expect(initials("alex rivera knight")).toBe("AR");
  });

  it("handles single-name input", () => {
    expect(initials("Beyoncé")).toBe("B");
  });
});

// ── formatDate ──────────────────────────────────────
describe("formatDate", () => {
  it("returns an empty string for invalid dates", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("returns a non-empty short date for a valid input", () => {
    const out = formatDate("2026-05-18");
    expect(out).toBeTruthy();
    expect(out).toMatch(/\d/);
  });
});

// ── classifyMood ────────────────────────────────────
describe("classifyMood", () => {
  it("classifies blocker phrasing as status-blocked", () => {
    expect(classifyMood("blocked")).toEqual({ cls: "status-blocked", label: "blocked" });
    expect(classifyMood("I'm blocked on review")).toEqual({
      cls: "status-blocked",
      label: "blocked",
    });
  });

  it("classifies help / stuck / overwhelmed as needs-help", () => {
    expect(classifyMood("need help")).toEqual({ cls: "status-needs-help", label: "needs help" });
    expect(classifyMood("stuck on deploy")).toEqual({
      cls: "status-needs-help",
      label: "needs help",
    });
    expect(classifyMood("overwhelmed")).toEqual({
      cls: "status-needs-help",
      label: "needs help",
    });
  });

  it("defaults everything else to on-track", () => {
    expect(classifyMood("")).toEqual({ cls: "status-on-track", label: "on track" });
    expect(classifyMood(undefined)).toEqual({ cls: "status-on-track", label: "on track" });
    expect(classifyMood("feeling great")).toEqual({ cls: "status-on-track", label: "on track" });
  });
});

// ── parseISODate ────────────────────────────────────
describe("parseISODate", () => {
  it("parses YYYY-MM-DD into a Date at local midnight", () => {
    const d = parseISODate("2026-05-18");
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(0);
  });

  it("returns null for missing / malformed input", () => {
    expect(parseISODate("")).toBeNull();
    expect(parseISODate(null)).toBeNull();
    expect(parseISODate("not-a-date")).toBeNull();
  });
});

// ── computeDayOfSprint ──────────────────────────────
describe("computeDayOfSprint", () => {
  it("returns Day 1 of N at the start of the sprint", () => {
    const today = new Date(2026, 4, 5); // May 5, 2026
    expect(computeDayOfSprint("2026-05-05", "2026-05-11", today)).toEqual({ day: 1, total: 7 });
  });

  it("returns the running day mid-sprint", () => {
    const today = new Date(2026, 4, 7); // 3rd day
    expect(computeDayOfSprint("2026-05-05", "2026-05-11", today)).toEqual({ day: 3, total: 7 });
  });

  it("clamps to Day 1 before the sprint starts", () => {
    const today = new Date(2026, 4, 1);
    expect(computeDayOfSprint("2026-05-05", "2026-05-11", today)).toEqual({ day: 1, total: 7 });
  });

  it("clamps to the final day after the sprint ends", () => {
    const today = new Date(2026, 5, 1);
    expect(computeDayOfSprint("2026-05-05", "2026-05-11", today)).toEqual({ day: 7, total: 7 });
  });

  it("returns null when dates are missing or reversed", () => {
    expect(computeDayOfSprint(null, "2026-05-11")).toBeNull();
    expect(computeDayOfSprint("2026-05-11", "2026-05-05")).toBeNull();
    expect(computeDayOfSprint("nonsense", "2026-05-11")).toBeNull();
  });
});

// ── computeSprintProgress ───────────────────────────
describe("computeSprintProgress", () => {
  it("returns zeros for an empty list", () => {
    expect(computeSprintProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it("counts only `done` tasks toward completion", () => {
    const tasks = [
      { status: "todo" },
      { status: "in-progress" },
      { status: "done" },
      { status: "done" },
    ];
    expect(computeSprintProgress(tasks)).toEqual({ done: 2, total: 4, pct: 50 });
  });

  it("rounds pct to the nearest whole percent", () => {
    const tasks = [{ status: "done" }, { status: "todo" }, { status: "todo" }];
    expect(computeSprintProgress(tasks).pct).toBe(33);
  });
});

// ── groupTasksByStatus ──────────────────────────────
describe("groupTasksByStatus", () => {
  it("buckets tasks into every column even when empty", () => {
    const groups = groupTasksByStatus([]);
    expect(Object.keys(groups).sort()).toEqual(["blocked", "done", "in-progress", "todo"]);
    for (const key of Object.keys(groups)) {
      expect(groups[key]).toEqual([]);
    }
  });

  it("groups tasks under the matching status key", () => {
    const tasks = [
      { task_id: 1, status: "todo" },
      { task_id: 2, status: "in-progress" },
      { task_id: 3, status: "blocked" },
      { task_id: 4, status: "done" },
      { task_id: 5, status: "done" },
    ];
    const groups = groupTasksByStatus(tasks);
    expect(groups.todo).toHaveLength(1);
    expect(groups["in-progress"]).toHaveLength(1);
    expect(groups.blocked).toHaveLength(1);
    expect(groups.done).toHaveLength(2);
  });

  it("falls back to `todo` for unknown statuses", () => {
    const tasks = [{ task_id: 7, status: "weird" }, { task_id: 8 }];
    const groups = groupTasksByStatus(tasks);
    expect(groups.todo).toHaveLength(2);
  });

  it("tolerates null/undefined input", () => {
    expect(groupTasksByStatus(undefined).todo).toEqual([]);
    expect(groupTasksByStatus(null).todo).toEqual([]);
  });
});

// ── formatSprintRange ───────────────────────────────
describe("formatSprintRange", () => {
  it("returns empty string for missing dates", () => {
    expect(formatSprintRange(null, "2026-05-11")).toBe("");
    expect(formatSprintRange("2026-05-05", null)).toBe("");
  });

  it("collapses same-month ranges to a single month label", () => {
    const out = formatSprintRange("2026-05-05", "2026-05-11");
    expect(out).toMatch(/–11$/);
    expect(out).toMatch(/5/);
  });

  it("includes both months for cross-month ranges", () => {
    const out = formatSprintRange("2026-04-30", "2026-05-06");
    expect(out).toMatch(/–/);
    expect(out.split("–")[1].trim().length).toBeGreaterThan(2);
  });
});

// ── Sprint persistence ──────────────────────────────
describe("sprint persistence", () => {
  // A throwaway in-memory localStorage stand-in — keeps the suite
  // hermetic and lets us exercise the JSON round-trip.
  function makeStorage(initial = {}) {
    let store = { ...initial };
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
      _snapshot: () => ({ ...store }),
    };
  }

  it("returns null when storage is empty", () => {
    expect(readSprintFromStorage(makeStorage())).toBeNull();
  });

  it("returns null when storage is undefined", () => {
    expect(readSprintFromStorage(undefined)).toBeNull();
  });

  it("round-trips a sprint through write + read", () => {
    const storage = makeStorage();
    const sprint = { number: 3, start_date: "2026-05-05", end_date: "2026-05-11" };
    writeSprintToStorage(sprint, storage);
    expect(readSprintFromStorage(storage)).toEqual(sprint);
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem(`sitrep.scrum.sprint.project-${PROJECT_ID}`, "{not json");
    expect(readSprintFromStorage(storage)).toBeNull();
  });

  it("coerces a non-numeric `number` field to null", () => {
    const storage = makeStorage();
    storage.setItem(
      `sitrep.scrum.sprint.project-${PROJECT_ID}`,
      JSON.stringify({ number: "abc", start_date: "2026-05-05", end_date: "2026-05-11" })
    );
    const read = readSprintFromStorage(storage);
    expect(read.number).toBeNull();
    expect(read.start_date).toBe("2026-05-05");
    expect(read.end_date).toBe("2026-05-11");
  });
});
