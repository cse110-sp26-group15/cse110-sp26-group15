import {
  createBlockerPlaceholder,
  createBlockerRail,
  filterActiveBlockers,
  mapApiBlocker,
  matchTaskByName,
  normalizeTaskName,
  readResolvedBlockerIds,
  rememberResolvedBlockerId,
  wireCollapseToggle,
} from "./blocker-card.js";
import { getCurrentProjectId } from "../shared/utils.js";

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
  // Scope the rail to the project the user is currently viewing (read from
  // localStorage via getCurrentProjectId). Using the cross-project /api/blockers
  // endpoint here leaked blockers from the user's *other* projects into whatever
  // board they were on. The project-scoped endpoint's default query returns
  // every open blocker for this project, and its row shape matches mapApiBlocker.
  const url = `/api/projects/${getCurrentProjectId()}/blockers`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[blocker-rail] fetch ${url} returned ${res.status}`);
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
  // Search every task card on the page so the lookup works across all
  // dashboard layouts (scrum list + kanban, the standalone kanban board, and
  // the main/xp lists). The shared task-card component titles with
  // `.task-card__title`; `.task-title` is kept as a fallback for legacy markup.
  const cards = document.querySelectorAll(".task-card");
  let hiddenMatch = null;
  for (const card of cards) {
    const titleEl = card.querySelector(".task-card__title, .task-title");
    if (!titleEl || normalizeTaskName(titleEl.textContent) !== target) continue;
    // Scrum renders both the list and kanban views at once with the inactive
    // one hidden, so prefer a card that's actually visible; only fall back to
    // a hidden match if no visible one exists.
    if (card.offsetParent !== null) return card;
    if (!hiddenMatch) hiddenMatch = card;
  }
  return hiddenMatch;
}

// Remove the blocker chip shown on a task's card(s). Used when a blocker is
// resolved so the linked task no longer displays a "Blocked" field. Clears the
// chip everywhere the task appears (e.g. scrum's simultaneous list + kanban
// views) and across every dashboard layout.
function removeTaskBlockerChip(taskName) {
  const target = normalizeTaskName(taskName);
  if (!target) return;
  for (const card of document.querySelectorAll(".task-card")) {
    const titleEl = card.querySelector(".task-card__title, .task-title");
    if (titleEl && normalizeTaskName(titleEl.textContent) === target) {
      card.querySelector(".task-card__blocker")?.remove();
    }
  }
}

// Default resolve handler. There's no PATCH /api/blockers/:id route wired into
// the dashboards yet, so "resolving" is visual-only: the card removal is done
// by onResolve in mountBlockerRail; here we just clear the blocker chip from
// the linked task's card when the blocker is filed against one.
function defaultResolveBlocker(blocker) {
  if (blocker?.task) removeTaskBlockerChip(blocker.task);
}

// ── Resolved-blocker persistence ──────────────────────
// The read/remember helpers now live in blocker-card.js so the dashboards'
// per-task blocker chips can share the exact same resolved-id store (see
// readResolvedBlockerIds / rememberResolvedBlockerId). This keeps a resolved
// blocker hidden everywhere — both as a blocker card and on its linked task
// card — when the user switches dashboard type and a fresh page mounts.

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
 * @param {() => Promise<object[]>} [options.fetchBlockers]   Returns raw API rows. Default hits `/api/projects/:id/blockers` for the active project.
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

  // Wrap caller's resolver so resolving a blocker also tidies up the UI.
  // `card` is the blocker card the Resolve button lives in (passed through by
  // createBlockerCard). After the resolver runs we remove that card directly
  // rather than refetching: the resolve is visual-only (no PATCH route yet), so
  // a refetch would just re-add the still-open blocker. When the last card goes
  // the rail is torn down and the dashed placeholder is restored.
  async function onResolve(blocker, card) {
    await resolveBlocker(blocker);
    // Remember the resolve so the blocker stays gone after a refetch — e.g.
    // when the user switches dashboard type and a fresh rail mounts.
    rememberResolvedBlockerId(blocker?.id);
    if (card) card.remove();
    if (currentRail && !currentRail.querySelector(".blocker-card")) {
      currentRail.remove();
      currentRail = null;
      const placeholder = container.querySelector("[data-blocker-placeholder]");
      if (placeholder) placeholder.hidden = false;
    }
  }

  async function refresh() {
    let blockers;
    try {
      const apiRows = await fetchBlockers();
      blockers = (apiRows ?? [])
        .map((row) => {
          const blocker = mapApiBlocker(row);
          // Carry the stable blocker_id alongside the card's render shape so
          // resolved-state persistence has something to key on. Kept off
          // mapApiBlocker itself so its output shape (and tests) stay intact;
          // createBlockerCard ignores the extra field.
          if (blocker) blocker.id = row?.blocker_id ?? null;
          return blocker;
        })
        .filter(Boolean);
    } catch (err) {
      console.warn("[blocker-rail] refresh failed", err);
      blockers = [];
    }
    // Drop blockers the user already resolved (persisted across page loads) so
    // they don't reappear when switching dashboard type re-mounts the rail.
    const resolvedIds = readResolvedBlockerIds();
    blockers = blockers.filter((b) => !resolvedIds.has(b.id));
    if (!includeResolved) blockers = filterActiveBlockers(blockers);

    const nextRail = createBlockerRail(blockers, { onResolve });
    if (currentRail) currentRail.remove();
    currentRail = nextRail;

    // Toggle the dashed placeholder dashboards use to reserve space.
    const placeholder = container.querySelector("[data-blocker-placeholder]");
    if (placeholder) placeholder.hidden = Boolean(nextRail);

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
    const placeholder = container.querySelector("[data-blocker-placeholder]");
    if (placeholder) placeholder.hidden = false;
    if (container.__blockerRailDestroy === destroy) {
      delete container.__blockerRailDestroy;
    }
  }
  container.__blockerRailDestroy = destroy;

  await refresh();
  return { refresh, destroy };
}

// ── Placeholder collapse toggle ───────────────────────
// Uses wireCollapseToggle to share the collapsed-state localStorage key with
// createBlockerRail so toggling either side stays consistent when the rail
// appears/disappears.
function setupPlaceholderToggle(placeholder) {
  placeholder.setAttribute("role", "button");
  placeholder.setAttribute("tabindex", "0");
  placeholder.setAttribute("aria-label", "Toggle blockers section");
  // No blockers → start collapsed; wireCollapseToggle keeps aria-expanded in sync.
  wireCollapseToggle({ trigger: placeholder, defaultCollapsed: true });
}

// ── Auto-mount on the dashboard view only ─────────────
async function autoMountIfDashboard() {
  const container = document.getElementById("dashboard-view");
  if (!container) return;

  // Create the placeholder if a dashboard didn't author one inline. Default
  // location: right after the section header. Dashboards can opt out of
  // auto-creation by inserting their own `[data-blocker-placeholder]`.
  let placeholder = container.querySelector("[data-blocker-placeholder]");
  if (!placeholder) {
    placeholder = createBlockerPlaceholder();
    const sectionHeader = container.querySelector(".section-header");
    if (sectionHeader) {
      sectionHeader.insertAdjacentElement("afterend", placeholder);
    } else {
      container.prepend(placeholder);
    }
  }
  setupPlaceholderToggle(placeholder);

  // Anchor the rail to the placeholder so it lands in the same reserved spot.
  try {
    await mountBlockerRail({ container, anchor: placeholder });
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
