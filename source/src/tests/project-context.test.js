import { describe, it, expect } from "vitest";
import {
  dashboardPathFor,
  setCurrentProject,
  getCurrentProject,
  defaultAssigneeId,
} from "../../shared/utils.js";

/**
 * Minimal in-memory Storage stand-in for Node (no real localStorage).
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe("dashboardPathFor", () => {
  it("maps each workflow to its dashboard page", () => {
    expect(dashboardPathFor("scrum")).toMatch(/scrum\.html$/);
    expect(dashboardPathFor("kanban")).toMatch(/kanban\.html$/);
    expect(dashboardPathFor("xp")).toMatch(/xp\.html$/);
  });
  it("falls back to scrum for an unknown workflow", () => {
    expect(dashboardPathFor("nope")).toMatch(/scrum\.html$/);
  });
});

describe("current project storage", () => {
  it("round-trips a project through the injected store", () => {
    const store = memStore();
    setCurrentProject({ project_id: 7, name: "P", workflow: "xp" }, store);
    expect(getCurrentProject(store)).toEqual({ project_id: 7, name: "P", workflow: "xp" });
  });
  it("returns null when nothing is stored", () => {
    expect(getCurrentProject(memStore())).toBeNull();
  });
  it("clears when given null", () => {
    const store = memStore();
    setCurrentProject({ project_id: 1, name: "A", workflow: "scrum" }, store);
    setCurrentProject(null, store);
    expect(getCurrentProject(store)).toBeNull();
  });
});

describe("defaultAssigneeId", () => {
  const members = [{ user_id: 1 }, { user_id: 2 }];
  it("prefers the current user when a member", () => {
    expect(defaultAssigneeId(members, { user_id: 2 })).toBe(2);
  });
  it("falls back to the first member otherwise", () => {
    expect(defaultAssigneeId(members, { user_id: 99 })).toBe(1);
  });
  it("returns null when there are no members", () => {
    expect(defaultAssigneeId([], { user_id: 1 })).toBeNull();
  });
});
