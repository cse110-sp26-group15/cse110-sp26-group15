// ── Blocker Card Navigation Behavior ──────────────────
// Attaches click + keyboard activation to a blocker rail's footers.
// The caller provides `findTask` so the lookup strategy stays decoupled
// from the rail (e.g. dashboard matches `#task-list` by title; demo
// passes a stub that returns null to showcase the missing-state flash).

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

function makeHandler(rail, findTask) {
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
  const handler = makeHandler(rail, findTask);
  rail.addEventListener("click", handler);
  rail.addEventListener("keydown", handler);
}
