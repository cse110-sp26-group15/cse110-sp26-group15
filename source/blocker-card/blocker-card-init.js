import {
  createBlockerRail,
  filterActiveBlockers,
  mapApiBlocker,
  matchTaskByName,
  normalizeTaskName,
} from "./blocker-card.js";
import { attachRailNavigation } from "./blocker-card-nav.js";

const DEFAULT_API_URL = "/api/blockers?general=true";

// ── Default fetch + lookup (dashboard) ────────────────
async function defaultFetchBlockers() {
  try {
    const res = await fetch(DEFAULT_API_URL);
    if (!res.ok) {
      console.warn(`[blocker-rail] fetch ${DEFAULT_API_URL} returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.blockers ?? [];
  } catch (err) {
    console.warn("[blocker-rail] fetch failed", err);
    return [];
  }
}

function defaultFindTaskByName(taskName) {
  const target = normalizeTaskName(taskName);
  if (!target) return null;
  const cards = document.querySelectorAll("#task-list .task-card");
  for (const card of cards) {
    const titleEl = card.querySelector(".task-title");
    if (titleEl && normalizeTaskName(titleEl.textContent) === target) return card;
  }
  return null;
}

// Safe stub used when the caller hasn't supplied a real resolver.
// Logs a warning so it's obvious the PATCH route isn't wired yet,
// but throws so the card's button shows the "Failed — retry" state
// instead of pretending the resolve succeeded.
async function defaultResolveBlocker() {
  const msg =
    "[blocker-rail] resolveBlocker not configured — pass `resolveBlocker` to mountBlockerRail once PATCH /api/blockers/:id exists";
  console.warn(msg);
  throw new Error(msg);
}

// ── Public mount API ──────────────────────────────────
/**
 * Mount a blocker rail into the page and return handles to refresh / tear it down.
 *
 * Designed so teammates can drop the rail onto any page (kanban / scrum / xp /
 * future views) without copy-pasting fetch + render logic.
 *
 *   const rail = await mountBlockerRail({
 *     container: document.getElementById("dashboard-view"),
 *     anchor: document.querySelector(".section-header"),
 *     findTask: (name) => matchTaskByName(name, currentTasks)?.element ?? null,
 *   });
 *
 *   // later, after the user resolves a blocker elsewhere:
 *   await rail.refresh();
 *
 *   // tearing down (e.g. on SPA route change):
 *   rail.destroy();
 *
 * @param {object}      options
 * @param {HTMLElement} options.container               Where the rail lives.
 * @param {HTMLElement} [options.anchor=null]           If set + child of container, rail is inserted before this node; otherwise appended.
 * @param {() => Promise<object[]>} [options.fetchBlockers]   Returns raw API rows. Default hits `/api/blockers?general=true`.
 * @param {(taskName: string) => HTMLElement|null} [options.findTask]  DOM resolver for footer clicks. Default matches `#task-list .task-card` titles.
 * @param {boolean}     [options.includeResolved=false] When false, resolved blockers are dropped before render.
 * @returns {Promise<{refresh: () => Promise<void>, destroy: () => void}>}
 */
export async function mountBlockerRail({
  container,
  anchor = null,
  fetchBlockers = defaultFetchBlockers,
  findTask = defaultFindTaskByName,
  resolveBlocker = defaultResolveBlocker,
  includeResolved = false,
} = {}) {
  if (!container) throw new Error("mountBlockerRail: `container` is required");

  let currentRail = null;

  // Wrap caller's resolver so a successful PATCH automatically triggers a
  // rail refresh — caller code doesn't have to remember to dispatch the event.
  async function onResolve(blocker) {
    await resolveBlocker(blocker);
    document.dispatchEvent(new CustomEvent("blockers:changed"));
  }

  async function refresh() {
    let blockers;
    try {
      const apiRows = await fetchBlockers();
      blockers = (apiRows ?? []).map(mapApiBlocker);
    } catch (err) {
      console.warn("[blocker-rail] refresh failed", err);
      blockers = [];
    }
    if (!includeResolved) blockers = filterActiveBlockers(blockers);

    const nextRail = createBlockerRail(blockers, { onResolve });
    if (currentRail) currentRail.remove();
    currentRail = nextRail;
    if (!nextRail) return;

    attachRailNavigation(nextRail, { findTask });
    if (anchor && anchor.parentNode === container) {
      container.insertBefore(nextRail, anchor);
    } else {
      container.appendChild(nextRail);
    }
  }

  function refreshOnEvent() {
    refresh().catch((err) => console.warn("[blocker-rail] event-triggered refresh failed", err));
  }
  document.addEventListener("blockers:changed", refreshOnEvent);

  function destroy() {
    document.removeEventListener("blockers:changed", refreshOnEvent);
    if (currentRail) {
      currentRail.remove();
      currentRail = null;
    }
  }

  await refresh();
  return { refresh, destroy };
}

// ── Auto-mount on the dashboard view only ─────────────
async function autoMountIfDashboard() {
  const container = document.getElementById("dashboard-view");
  const anchor = container?.querySelector(".section-header");
  if (!container || !anchor) return;
  try {
    await mountBlockerRail({ container, anchor });
  } catch (err) {
    console.warn("[blocker-rail] auto-mount failed", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMountIfDashboard);
} else {
  autoMountIfDashboard();
}

// Re-export matchTaskByName so callers building custom findTask functions
// can share the same normalization rules as the default lookup.
export { matchTaskByName };
