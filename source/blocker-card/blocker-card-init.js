import {
  createBlockerRail,
  filterActiveBlockers,
  mapApiBlocker,
  matchTaskByName,
  normalizeTaskName,
} from "./blocker-card.js";

const DEFAULT_API_URL = "/api/blockers?general=true";

// ── Rail navigation (click + keyboard) ────────────────
// Caller supplies `findTask` so the lookup strategy stays decoupled from
// the rail (dashboard matches `#task-list` by title; demo passes a stub
// that returns null to showcase the missing-state flash).
const FLASH_TASK_MS = 1600;
const FLASH_MISSING_MS = 1600;
const MISSING_LABEL = "Not in current view";

function flashTaskCard(card) {
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("task-card--blocker-highlight");
  window.setTimeout(() => {
    card.classList.remove("task-card--blocker-highlight");
  }, FLASH_TASK_MS);
}

function ensureLiveRegion(rail) {
  let region = rail.querySelector(".blocker-rail__live");
  if (region) return region;
  region = document.createElement("div");
  region.className = "blocker-rail__live";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  rail.appendChild(region);
  return region;
}

function announce(rail, message) {
  const region = ensureLiveRegion(rail);
  // Clear then set so repeated identical messages re-announce.
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

function flashFooterMissing(footer, rail) {
  if (footer.dataset.flashing === "1") return;
  footer.dataset.flashing = "1";

  const arrow = footer.querySelector(".blocker-card__footer-arrow");
  const originalArrow = arrow ? arrow.textContent : null;
  if (arrow) arrow.textContent = MISSING_LABEL;
  footer.classList.add("blocker-card__footer--missing");
  announce(rail, `${footer.dataset.taskName || "Task"} is not in the current view`);

  window.setTimeout(() => {
    footer.classList.remove("blocker-card__footer--missing");
    if (arrow && originalArrow !== null) arrow.textContent = originalArrow;
    delete footer.dataset.flashing;
  }, FLASH_MISSING_MS);
}

function makeNavHandler(rail, findTask) {
  return (event) => {
    const footer = event.target.closest(".blocker-card__footer");
    if (!footer) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();

    const card = findTask(footer.dataset.taskName);
    if (card) {
      flashTaskCard(card);
    } else {
      flashFooterMissing(footer, rail);
    }
  };
}

/**
 * Attach click + Enter/Space activation to a blocker rail.
 *
 * @param {HTMLElement} rail         A rail element returned by createBlockerRail.
 * @param {object}      options
 * @param {(taskName: string) => HTMLElement | null} options.findTask
 *        Resolve a task name to a DOM node to scroll-and-highlight, or
 *        return null to trigger the missing-state flash on the footer.
 */
export function attachRailNavigation(rail, { findTask }) {
  const handler = makeNavHandler(rail, findTask);
  rail.addEventListener("click", handler);
  rail.addEventListener("keydown", handler);
}

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

  // If this container already has a rail mounted, tear it down first so we
  // don't stack duplicate `blockers:changed` listeners or leave a stale node.
  if (container.__blockerRailDestroy) {
    container.__blockerRailDestroy();
  }

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
    if (container.__blockerRailDestroy === destroy) {
      delete container.__blockerRailDestroy;
    }
  }
  container.__blockerRailDestroy = destroy;

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
