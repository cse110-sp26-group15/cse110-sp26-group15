// ── Blocker Card Component ────────────────────────────
const COLLAPSE_STORAGE_KEY = "blocker-rail:collapsed";

/**
 * Wire click + Enter/Space toggling on `trigger` that flips a `data-collapsed`
 * flag on `stateEl` (defaults to the trigger), keeps `aria-expanded` on the
 * trigger in sync, and persists the collapsed state to localStorage under a
 * shared key so the rail and its placeholder stay consistent across renders.
 *
 * @param {object} options
 * @param {HTMLElement} options.trigger  Element that receives click/keydown.
 * @param {HTMLElement} [options.stateEl=trigger]  Element that carries `data-collapsed` (used by CSS).
 * @param {boolean} [options.defaultCollapsed=false]  Initial state when the user
 *        hasn't toggled before (no stored preference). The rail (real blockers)
 *        starts expanded; the empty-state placeholder starts collapsed.
 */
export function wireCollapseToggle({ trigger, stateEl = trigger, defaultCollapsed = false }) {
  // Apply collapsed state to the DOM only. Kept separate from persistence so
  // initialization can set the visual state without writing localStorage —
  // otherwise the placeholder's default-collapsed would leak onto the shared
  // key before the rail mounts, collapsing a rail that has real blockers.
  function applyCollapsed(collapsed) {
    stateEl.dataset.collapsed = String(collapsed);
    trigger.setAttribute("aria-expanded", String(!collapsed));
  }

  // Persist + apply. Only used for explicit user toggles, so a real preference
  // is what gets stored and shared across the placeholder and rail.
  function setCollapsed(collapsed) {
    applyCollapsed(collapsed);
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
    } catch {
      /* localStorage unavailable — silently skip persistence */
    }
  }

  trigger.addEventListener("click", () => {
    setCollapsed(stateEl.dataset.collapsed !== "true");
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setCollapsed(stateEl.dataset.collapsed !== "true");
    }
  });

  try {
    // A stored preference (the user explicitly toggled) wins; otherwise fall
    // back to the caller's default so the empty placeholder starts collapsed
    // while a rail with real blockers starts expanded. Initialization never
    // persists — it only reflects the existing preference (or the default).
    const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === "true") applyCollapsed(true);
    else if (stored === "false") applyCollapsed(false);
    else applyCollapsed(defaultCollapsed);
  } catch {
    /* localStorage unavailable */
    applyCollapsed(defaultCollapsed);
  }
}

function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ── Sections ──────────────────────────────────────────
function buildBanner(blocker, { onResolve } = {}) {
  const banner = document.createElement("div");
  banner.className = "blocker-card__banner";

  const left = document.createElement("div");
  left.className = "blocker-card__banner-left";

  const label = document.createElement("span");
  label.className = "blocker-card__status-label";

  const dot = document.createElement("span");
  dot.className = "blocker-card__status-dot";
  label.appendChild(dot);

  label.appendChild(document.createTextNode(blocker.blocked ? "BLOCKED" : "RESOLVED"));
  left.appendChild(label);

  if (blocker.reportedBy) {
    const needsHelp = document.createElement("span");
    needsHelp.className = "blocker-card__needs-help";
    needsHelp.textContent = blocker.reportedBy;
    needsHelp.title = `${blocker.reportedBy} needs help`;
    left.appendChild(needsHelp);
  }

  banner.appendChild(left);

  if (onResolve && blocker.blocked) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "blocker-card__resolve";
    button.setAttribute(
      "aria-label",
      `Mark blocker as resolved: ${blocker.task ?? blocker.description ?? ""}`.trim()
    );
    button.textContent = "✓ Resolve";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.dataset.busy === "1") return;
      button.dataset.busy = "1";
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "Resolving…";
      try {
        // Hand the card element to onResolve so it can remove this card (and
        // any linked task's blocker chip) once the resolve succeeds.
        await onResolve(blocker, button.closest(".blocker-card"));
        // If onResolve didn't remove the card, fully restore the button so it
        // stays usable.
        button.textContent = originalText;
        button.disabled = false;
        delete button.dataset.busy;
      } catch (err) {
        console.warn("[blocker-rail] resolve failed", err);
        button.textContent = "Failed — retry";
        button.disabled = false;
        delete button.dataset.busy;
      }
    });
    banner.appendChild(button);
  }

  return banner;
}

function buildBody(blocker) {
  const body = document.createElement("div");
  body.className = "blocker-card__body";

  if (blocker.description) {
    const description = document.createElement("p");
    description.className = "blocker-card__description";
    description.textContent = blocker.description;
    body.appendChild(description);
  }

  return body;
}

function buildPeople(blocker) {
  if (!blocker.helper) return null;

  const people = document.createElement("div");
  people.className = "blocker-card__people";

  const row = document.createElement("div");
  row.className = "blocker-card__person";

  const roleLabel = document.createElement("span");
  roleLabel.className = "blocker-card__person-label";
  roleLabel.textContent = "Can help";
  row.appendChild(roleLabel);

  const avatar = document.createElement("span");
  avatar.className = "blocker-card__avatar blocker-card__avatar--helper";
  avatar.textContent = initials(blocker.helper);
  row.appendChild(avatar);

  const name = document.createElement("span");
  name.className = "blocker-card__person-name";
  name.textContent = blocker.helper;
  row.appendChild(name);

  people.appendChild(row);
  return people;
}

function buildFooter(blocker) {
  if (!blocker.task) return null;

  const footer = document.createElement("div");
  footer.className = "blocker-card__footer";
  footer.dataset.taskName = blocker.task;
  footer.setAttribute("role", "button");
  footer.setAttribute("aria-label", `Open task: ${blocker.task}`);
  footer.tabIndex = 0;

  const label = document.createElement("span");
  label.className = "blocker-card__footer-label";
  label.textContent = blocker.task;
  footer.appendChild(label);

  const arrow = document.createElement("span");
  arrow.className = "blocker-card__footer-arrow";
  arrow.textContent = "›";
  arrow.setAttribute("aria-hidden", "true");
  footer.appendChild(arrow);

  return footer;
}

// ── Public API ────────────────────────────────────────
/**
 * Build a blocker card DOM element for the dashboard blocker rail.
 *
 * Matches the shape returned by `GET /api/blockers?general=true`:
 *
 *   { task, blocked, helper, description }
 *
 * Missing fields are tolerated — the people row and task footer are
 * omitted when the corresponding fields are null.
 *
 * @param {object}  blocker
 * @param {string|null} [blocker.task]         Task name; renders the footer when present.
 * @param {boolean} [blocker.blocked]          true → "BLOCKED" label, false → "RESOLVED".
 * @param {string|null} [blocker.helper]       Helper name; renders the "Can help" row.
 * @param {string|null} [blocker.reportedBy]   Person who needs help; renders a small inline note in the banner when present.
 * @param {string}  [blocker.description]      Main card body text.
 *
 * @param {object}  [options]
 * @param {(blocker: object) => Promise<void> | void} [options.onResolve]
 *        When provided (and blocker.blocked is true), renders a "Resolve" button
 *        in the banner. Called as `onResolve(blocker, cardElement)` on click;
 *        mountBlockerRail's wrapper removes the card (and the linked task's
 *        blocker chip) once it resolves.
 *
 * @returns {HTMLElement} A detached <article> ready to be appended.
 */
export function createBlockerCard(blocker, { onResolve } = {}) {
  const card = document.createElement("article");
  card.className = "blocker-card";
  if (!blocker.blocked) card.classList.add("blocker-card--resolved");

  card.appendChild(buildBanner(blocker, { onResolve }));
  card.appendChild(buildBody(blocker));

  const people = buildPeople(blocker);
  if (people) card.appendChild(people);

  const footer = buildFooter(blocker);
  if (footer) card.appendChild(footer);

  return card;
}

/**
 * Build a horizontally scrolling rail of blocker cards with a section header.
 *
 * Returns null when the array is empty so callers can hide the rail entirely
 * (no empty state).
 *
 * @param {object[]} blockers  Array of blocker objects (see createBlockerCard).
 * @param {object}   [options]
 * @param {(blocker: object) => Promise<void> | void} [options.onResolve]
 *        Forwarded to every card. See createBlockerCard for behavior.
 * @returns {HTMLElement|null} A detached <section> or null if blockers is empty.
 */
export function createBlockerRail(blockers, { onResolve } = {}) {
  if (!Array.isArray(blockers) || blockers.length === 0) return null;

  const rail = document.createElement("section");
  rail.className = "blocker-rail";

  const header = document.createElement("div");
  header.className = "blocker-rail__header";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", "true");
  header.setAttribute("aria-label", "Toggle blockers list");

  const title = document.createElement("h2");
  title.className = "blocker-rail__title";

  const icon = document.createElement("span");
  icon.className = "blocker-rail__title-icon";
  icon.textContent = "⚠";
  title.appendChild(icon);

  title.appendChild(document.createTextNode(" Blockers"));

  const count = document.createElement("span");
  count.className = "blocker-rail__count";
  count.textContent = String(blockers.length);
  title.appendChild(count);

  header.appendChild(title);

  const toggle = document.createElement("span");
  toggle.className = "blocker-rail__toggle";

  const toggleLabel = document.createElement("span");
  toggleLabel.className = "blocker-rail__toggle-label";
  toggleLabel.setAttribute("aria-hidden", "true");
  toggle.appendChild(toggleLabel);

  const chevron = document.createElement("span");
  chevron.className = "blocker-rail__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  toggle.appendChild(chevron);

  header.appendChild(toggle);

  rail.appendChild(header);

  const track = document.createElement("div");
  track.className = "blocker-rail__track";
  blockers.forEach((blocker) => {
    track.appendChild(createBlockerCard(blocker, { onResolve }));
  });
  rail.appendChild(track);

  // Persist across the recreate-on-refresh that mountBlockerRail does, so
  // resolving a blocker doesn't re-expand a section the user collapsed.
  wireCollapseToggle({ trigger: header, stateEl: rail });

  return rail;
}

/**
 * Build the empty-state / reserved-space placeholder that dashboards show
 * when no active blockers are loaded. The placeholder is collapsible — the
 * toggle wiring is attached in blocker-card-init.js once it's in the DOM.
 *
 * Centralizing this means new dashboards don't need to copy a ~10-line HTML
 * block, and structural changes happen in one place.
 *
 * @returns {HTMLElement} A detached <div data-blocker-placeholder>.
 */
export function createBlockerPlaceholder() {
  const root = document.createElement("div");
  root.className = "blocker-rail-placeholder";
  root.setAttribute("data-blocker-placeholder", "");

  const labelWrap = document.createElement("span");
  labelWrap.className = "blocker-rail-placeholder__label";

  const icon = document.createElement("span");
  icon.className = "blocker-rail-placeholder__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✓";
  labelWrap.appendChild(icon);

  const text = document.createElement("span");
  text.textContent = "No current blockers";
  labelWrap.appendChild(text);

  root.appendChild(labelWrap);

  const toggle = document.createElement("span");
  toggle.className = "blocker-rail-placeholder__toggle";

  const toggleLabel = document.createElement("span");
  toggleLabel.className = "blocker-rail-placeholder__toggle-label";
  toggleLabel.setAttribute("aria-hidden", "true");
  toggle.appendChild(toggleLabel);

  const chevron = document.createElement("span");
  chevron.className = "blocker-rail-placeholder__chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  toggle.appendChild(chevron);

  root.appendChild(toggle);

  return root;
}

/**
 * Adapt one row from the `/api/blockers` response into the createBlockerCard
 * input shape. Pass-through today (shapes match) — kept as a seam so the API
 * can evolve without touching callers.
 *
 * @param {object} apiRow  One entry from `response.blockers`.
 * @returns {object} A blocker object ready for createBlockerCard.
 */
export function mapApiBlocker(apiRow) {
  if (!apiRow || typeof apiRow !== "object") return null;
  const rawReporter = apiRow.reported_by;
  const reportedBy =
    rawReporter && typeof rawReporter === "object"
      ? (rawReporter.full_name ?? null)
      : (rawReporter ?? null);
  return {
    task: apiRow.task ?? null,
    blocked: Boolean(apiRow.blocked),
    helper: apiRow.helper ?? null,
    reportedBy,
    description: apiRow.description ?? "",
  };
}

/**
 * Filter blockers to active (unresolved) ones only.
 *
 * @param {object[]} blockers
 * @returns {object[]}
 */
export function filterActiveBlockers(blockers) {
  if (!Array.isArray(blockers)) return [];
  return blockers.filter((b) => b && b.blocked);
}

// ── Resolved-blocker persistence (shared across dashboards) ──
// Resolving a blocker is visual-only today (no PATCH route is wired into the
// dashboards yet), so a resolved blocker would reappear the moment any page
// re-fetches from the API. Each dashboard type (scrum / kanban / xp / main) is a
// separate page, so switching dashboard type re-mounts everything from scratch.
//
// To keep a resolved blocker resolved across those page loads — both as a
// standalone blocker card AND as the "Blocked" chip on its linked task card — we
// remember its stable `blocker_id` in localStorage under one shared key and
// filter those ids out everywhere blockers are rendered (the blocker rail in
// blocker-card-init.js, and the per-task blocker chips built by the scrum/main
// dashboards). Centralizing the key + readers here keeps every surface in sync.
export const RESOLVED_STORAGE_KEY = "blocker-rail:resolved";

/**
 * Read the set of blocker ids the user has already resolved. Returns an empty
 * set when storage is unavailable or the stored value is missing/corrupt.
 *
 * @returns {Set<*>} Set of resolved `blocker_id`s.
 */
export function readResolvedBlockerIds() {
  try {
    const raw = localStorage.getItem(RESOLVED_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    /* localStorage unavailable or corrupt — treat as nothing resolved */
    return new Set();
  }
}

/**
 * Persist `id` as resolved so it stays hidden on future renders / page loads.
 * No-op when the id is missing (e.g. demo blockers) or storage is unavailable.
 *
 * @param {*} id  The blocker's stable `blocker_id`.
 */
export function rememberResolvedBlockerId(id) {
  if (id == null) return;
  try {
    const ids = readResolvedBlockerIds();
    ids.add(id);
    localStorage.setItem(RESOLVED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* localStorage unavailable — resolve stays visual-only for this session */
  }
}

/**
 * Normalize a task title for fuzzy matching: trim, collapse whitespace,
 * lowercase. Exported so test code and lookup callers stay aligned.
 *
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function normalizeTaskName(str) {
  return (str ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find a task in a list whose `title` matches `taskName` after normalization.
 * Pure — used by both the dashboard lookup and tests.
 *
 * @param {string} taskName
 * @param {{title?: string}[]} tasks
 * @returns {object|null}
 */
export function matchTaskByName(taskName, tasks) {
  const target = normalizeTaskName(taskName);
  if (!target || !Array.isArray(tasks)) return null;
  return tasks.find((t) => normalizeTaskName(t?.title) === target) ?? null;
}
