// Tests for the pure helpers in source/check-in/check-in.js.
//
// The DOM-only side of check-in.js (form wiring, rendering, the blocker
// pickers) is gated behind `typeof document !== "undefined"`, so importing
// the module here under node doesn't run any browser code. These tests
// cover the framework-free helpers + constants the page is built on —
// mirroring the scrum.js / kanban.js test approach.

import { describe, it, expect } from "vitest";
import {
  PROJECT_ID,
  GENERAL_BLOCKER,
  WORKLOAD_LABELS,
  escapeHtml,
  initialsFor,
  formatDate,
  isSameDay,
  hasCheckinToday,
  buildBlockerBlock,
} from "../../check-in/check-in.js";

// ── Module constants ─────────────────────────────────
describe("check-in module constants", () => {
  it("exposes a numeric project id", () => {
    expect(typeof PROJECT_ID).toBe("number");
    expect(PROJECT_ID).toBeGreaterThan(0);
  });

  it("maps every workload value to a human label", () => {
    expect(GENERAL_BLOCKER).toBe("General");
    expect(WORKLOAD_LABELS.heavy).toBe("Heavy");
    expect(WORKLOAD_LABELS["very-light"]).toBe("Very Light");
    expect(Object.keys(WORKLOAD_LABELS)).toHaveLength(5);
  });
});

// ── escapeHtml ───────────────────────────────────────
describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("coerces nullish input to an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

// ── initialsFor ──────────────────────────────────────
describe("initialsFor", () => {
  it("returns up to two uppercase initials", () => {
    expect(initialsFor("Wayne Dyer")).toBe("WD");
    expect(initialsFor("alex")).toBe("A");
  });

  it("falls back to '?' when the name is missing", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor(undefined)).toBe("?");
  });
});

// ── formatDate ───────────────────────────────────────
describe("formatDate", () => {
  it("formats a valid ISO date and includes the year", () => {
    expect(formatDate("2026-05-29T14:00:00Z")).toContain("2026");
  });

  it("returns '' for missing or unparseable input", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

// ── isSameDay / hasCheckinToday ──────────────────────
describe("isSameDay", () => {
  it("is true for two times on the same calendar day", () => {
    expect(isSameDay(new Date(2026, 4, 29, 1), new Date(2026, 4, 29, 23))).toBe(true);
  });

  it("is false across day boundaries", () => {
    expect(isSameDay(new Date(2026, 4, 29), new Date(2026, 4, 30))).toBe(false);
  });
});

describe("hasCheckinToday", () => {
  it("detects a check-in dated today", () => {
    expect(hasCheckinToday([{ checkin_date: new Date().toISOString() }])).toBe(true);
  });

  it("ignores older check-ins and empty lists", () => {
    expect(hasCheckinToday([{ checkin_date: "2000-01-01T00:00:00Z" }])).toBe(false);
    expect(hasCheckinToday([])).toBe(false);
  });
});

// ── buildBlockerBlock ────────────────────────────────
describe("buildBlockerBlock", () => {
  it("renders nothing when there is no structured blocker", () => {
    expect(buildBlockerBlock(null)).toBe("");
    expect(buildBlockerBlock("legacy free text")).toBe("");
  });

  it("renders a single compact line with task, reason, and helper", () => {
    const html = buildBlockerBlock({
      task: "Build login",
      description: "API contract unclear",
      helper: "Alex K.",
    });
    expect(html).toContain('class="checkin-card__blocker"');
    expect(html).toContain("Blocked on:");
    expect(html).toContain("Build login");
    expect(html).toContain("API contract unclear");
    expect(html).toContain("Can help:");
    expect(html).toContain("Alex K.");
  });

  it("omits the helper segment when no helper is given", () => {
    const html = buildBlockerBlock({ task: "General", description: "", helper: "" });
    expect(html).toContain("General");
    expect(html).not.toContain("Can help:");
  });

  it("escapes user-supplied blocker text", () => {
    const html = buildBlockerBlock({ task: "<b>x</b>", description: "", helper: "" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});
