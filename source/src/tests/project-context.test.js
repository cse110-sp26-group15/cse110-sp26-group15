import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getStoredProject, getCurrentProjectId, requireStoredProject } from "../../shared/utils.js";

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
  };
}

describe("project context helpers", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getStoredProject returns null when storage is empty", () => {
    expect(getStoredProject()).toBeNull();
  });

  it("getStoredProject returns the parsed project object", () => {
    storage.setItem(
      "sitrep_project",
      JSON.stringify({ project_id: 3, name: "Alpha", workflow: "kanban" })
    );
    expect(getStoredProject()).toEqual({
      project_id: 3,
      name: "Alpha",
      workflow: "kanban",
    });
  });

  it("getStoredProject rejects invalid project ids", () => {
    storage.setItem("sitrep_project", JSON.stringify({ project_id: 0 }));
    expect(getStoredProject()).toBeNull();
  });

  it("getCurrentProjectId reads the stored id", () => {
    storage.setItem("sitrep_project", JSON.stringify({ project_id: 5 }));
    expect(getCurrentProjectId()).toBe(5);
  });

  it("getCurrentProjectId falls back when nothing is stored", () => {
    expect(getCurrentProjectId()).toBe(1);
    expect(getCurrentProjectId(99)).toBe(99);
  });

  it("requireStoredProject returns the project when present", () => {
    const project = { project_id: 2, name: "Beta", workflow: "scrum" };
    storage.setItem("sitrep_project", JSON.stringify(project));
    expect(requireStoredProject()).toEqual(project);
  });

  it("requireStoredProject redirects when no project is stored", () => {
    const href = vi.fn();
    vi.stubGlobal("location", { href: "" });
    Object.defineProperty(globalThis.location, "href", {
      set: href,
      get: () => "",
    });

    expect(requireStoredProject("/projects/projects.html")).toBeNull();
    expect(href).toHaveBeenCalledWith("/projects/projects.html");
  });
});
