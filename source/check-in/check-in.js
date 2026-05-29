// ── My Check-ins ──────────────────────────────────────────────────────
// Drives the standalone agile stand-up check-in page (check-in.html).
//
// Responsibilities:
//   • Keep a per-project list of daily check-ins (what I did / what I need
//     to do / workload / an optional blocker).
//   • Detect whether a check-in already exists for *today* and toggle
//     between a "please check in" prompt and a "today's check-in is done"
//     message accordingly.
//   • Handle form submission, then render each check-in as a card showing
//     every field, the completion date, and a delete button.
//
// Persistence mirrors the offline-fallback pattern in dashboard/kanban.js:
// check-ins are stored in localStorage under a project-namespaced key so
// the page is fully functional without a running backend. The matching
// real API is POST/GET `/api/projects/:projectId/checkins` (see
// functions/api/projects/[projectId]/checkins.js) — swap readCheckins /
// writeCheckins for fetch() calls there when auth + project context land.
//
// The blocker pickers reflect the real project: the "Blocked on" list comes
// from tasks actually created in the dashboard (the same /api/projects/:id/
// tasks endpoint the dashboards use, plus their offline localStorage stores),
// and "Who can help?" lists the project's assigned members.

// ── Constants ────────────────────────────────────────
// Hard-coded for now; will switch to the logged-in project + user once
// auth context is plumbed through (same TODO as scrum.js / kanban.js).
export const PROJECT_ID = 1;
const CURRENT_USER = { user_id: 1, full_name: "You" };

// localStorage key for the check-in store, namespaced by project so
// multi-project support is straightforward later.
export const STORAGE_KEY = `sitrep.checkins.project-${PROJECT_ID}`;

// Where the dashboards persist tasks created while the API is unreachable
// (see scrum.js / kanban.js). Reading these lets offline-created tasks
// still appear in the blocker picker.
export const LOCAL_TASK_KEYS = [
  `sitrep.scrum.tasks.project-${PROJECT_ID}`,
  `sitrep.kanban.tasks.project-${PROJECT_ID}`,
];

// Non-task-specific blocker option shown first in the "Blocked on" picker.
export const GENERAL_BLOCKER = "General";

// Maps each workload value (the <option> values in check-in.html) to the
// human label shown on the check-in card.
export const WORKLOAD_LABELS = {
  "very-light": "Very Light",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  overloaded: "Overloaded",
};

// ── DOM references ───────────────────────────────────
// Assigned in init() (browser only) so this module can be imported under
// node for unit tests without a DOM. Mirrors the scrum.js / kanban.js
// pattern of gating every DOM touch behind `typeof document`.
let form;
let promptBanner;
let doneBanner;
let listEl;
let errorEl;
let blockerToggle;
let blockerPanel;
let blockerTaskSelect;
let blockerWhyInput;
let blockerHelperSelect;

// ── Pure helpers ─────────────────────────────────────

/**
 * Escape user-controlled strings before inserting into innerHTML.
 * (Mirrors the helper used in dashboard/main.js + kanban.js.)
 * @param {unknown} s - Value to escape; coerced to string ("" when nullish).
 * @returns {string} HTML-safe text.
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Returns up to two uppercase initials for a display name.
 * @param {string} name - Display name (e.g. "Wayne Dyer").
 * @returns {string} The initials, or "?" when the name is missing.
 */
export function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Formats an ISO date string as a readable completion date, e.g.
 * "May 28, 2026 · 2:14 PM".
 * @param {string} dateStr - ISO date string parseable by `Date`.
 * @returns {string} Formatted date, or "" when input is missing/invalid.
 */
export function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/**
 * True when two dates fall on the same calendar day (local time).
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
export function isSameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

/**
 * True when the list already contains a check-in dated today.
 * @param {object[]} checkins
 * @returns {boolean}
 */
export function hasCheckinToday(checkins) {
  const today = new Date();
  return checkins.some((c) => isSameDay(new Date(c.checkin_date), today));
}

// ── Persistence (localStorage store) ─────────────────

/**
 * Reads the stored check-ins, newest first. Tolerates missing/corrupt
 * storage by returning an empty array.
 * @returns {object[]}
 */
function readCheckins() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the check-in list. Swallows quota/disabled-storage errors so
 * the UI stays responsive.
 * @param {object[]} checkins
 */
function writeCheckins(checkins) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkins));
  } catch {
    /* quota / disabled storage — swallow silently */
  }
}

// ── Blocker picker data ──────────────────────────────

/**
 * Reads a JSON array out of localStorage, tolerating missing/corrupt data.
 * @param {string} key
 * @returns {object[]}
 */
export function readLocalArray(key) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Collects the tasks created in the dashboard. Tries the real tasks API
 * first (same endpoint scrum.js / kanban.js use), then merges in any tasks
 * the dashboards persisted locally while offline. Returns [] when none
 * exist or the data can't be reached.
 * @returns {Promise<object[]>}
 */
async function fetchDashboardTasks() {
  let tasks = [];
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
    if (res.ok) {
      const data = await res.json();
      tasks = Array.isArray(data.tasks) ? data.tasks : [];
    }
  } catch {
    /* API unreachable — fall back to the dashboards' local stores */
  }
  for (const key of LOCAL_TASK_KEYS) {
    tasks = tasks.concat(readLocalArray(key));
  }
  return tasks;
}

/**
 * Collects the people assigned to the project. Tries the members API first,
 * then falls back to deriving members from task assignees (mirrors the
 * deriveMembers pattern in scrum.js). Returns [] when no one is assigned.
 * @param {object[]} tasks - Tasks already fetched, used for the fallback.
 * @returns {Promise<{user_id: number, full_name: string}[]>}
 */
async function fetchProjectMembers(tasks) {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.members) && data.members.length) return data.members;
    }
  } catch {
    /* API unreachable — derive from task assignees below */
  }
  const byId = new Map();
  for (const t of tasks) {
    if (t.user_id && t.full_name) byId.set(t.user_id, t.full_name);
  }
  return [...byId.entries()].map(([user_id, full_name]) => ({ user_id, full_name }));
}

// ── Blocker picker setup ─────────────────────────────

/**
 * Fills the "Blocked on" select with the General option plus the title of
 * every task created in the dashboard, and the "Who can help?" select with
 * the project's assigned members (excluding the current user). When there
 * are no tasks the picker shows only "General"; when no one else is
 * assigned the helper picker shows only "Not sure / anyone".
 * @returns {Promise<void>}
 */
async function populateBlockerOptions() {
  const tasks = await fetchDashboardTasks();
  const members = await fetchProjectMembers(tasks);

  // "Blocked on" — General first (default), then each unique task title.
  const titles = [...new Set(tasks.map((t) => t.title).filter(Boolean))];
  const taskLabels = [GENERAL_BLOCKER, ...titles];
  blockerTaskSelect.innerHTML = taskLabels
    .map(
      (label, i) =>
        `<option value="${escapeHtml(label)}"${i === 0 ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");

  // "Who can help?" — an unsure default, then everyone else on the project.
  const others = members.filter((m) => Number(m.user_id) !== CURRENT_USER.user_id);
  const helperOptions = [
    `<option value="" selected>Not sure / anyone</option>`,
    ...others.map(
      (m) => `<option value="${escapeHtml(m.full_name)}">${escapeHtml(m.full_name)}</option>`
    ),
  ];
  blockerHelperSelect.innerHTML = helperOptions.join("");
}

/**
 * Whether the blocker panel is currently revealed.
 * @returns {boolean}
 */
function isBlockerOpen() {
  return !blockerPanel.classList.contains("hidden");
}

/**
 * Shows/hides the blocker panel and keeps the toggle button's label +
 * aria-expanded state in sync.
 * @param {boolean} open
 */
function setBlockerOpen(open) {
  blockerPanel.classList.toggle("hidden", !open);
  blockerToggle.setAttribute("aria-expanded", String(open));
  blockerToggle.textContent = open ? "Remove blocker" : "+ I'm blocked on a task";
}

/**
 * Reads the blocker fields into a blocker object, or null when the panel is
 * closed. Shape matches the blocker-card component
 * ({ task, description, helper }) so a future API sync can reuse it.
 * @returns {{task: string, description: string, helper: string}|null}
 */
function readBlocker() {
  if (!isBlockerOpen()) return null;
  return {
    task: blockerTaskSelect.value || GENERAL_BLOCKER,
    description: blockerWhyInput.value.trim(),
    helper: blockerHelperSelect.value.trim(),
  };
}

// ── Rendering ────────────────────────────────────────

/**
 * Toggles the prompt vs. completed banner and the form's visibility based
 * on whether today's check-in already exists.
 * @param {object[]} checkins
 */
function renderDailyStatus(checkins) {
  const done = hasCheckinToday(checkins);
  // When today's check-in is done: hide the prompt + form, show the
  // confirmation. Otherwise show the prompt + form, hide the confirmation.
  promptBanner.classList.toggle("hidden", done);
  form.classList.toggle("hidden", done);
  doneBanner.classList.toggle("hidden", !done);
}

/**
 * Builds the markup for a check-in's blocker, or "" when there is none.
 * Kept to a single compact line: the blocked-on task, then the reason and
 * who-can-help appended inline (each shown only when it has a value).
 * @param {{task?: string, description?: string, helper?: string}|null} blocker
 * @returns {string}
 */
export function buildBlockerBlock(blocker) {
  // Defensive: only render structured blocker objects (ignores any legacy
  // free-text blocker left in storage by an earlier version of the page).
  if (!blocker || typeof blocker !== "object") return "";

  // Build the inline segments, dropping any that are empty, then join them
  // with a middot so the whole blocker reads as one tight line.
  const segments = [
    `<span class="checkin-card__blocker-key">Blocked on:</span> ${escapeHtml(blocker.task || GENERAL_BLOCKER)}`,
  ];
  if (blocker.description) segments.push(escapeHtml(blocker.description));
  if (blocker.helper) {
    segments.push(
      `<span class="checkin-card__blocker-key">Can help:</span> ${escapeHtml(blocker.helper)}`
    );
  }

  return `<p class="checkin-card__blocker">${segments.join(" · ")}</p>`;
}

/**
 * Builds the DOM for a single check-in card: header (author, workload, date),
 * the "Accomplished" and "To-do" fields, an optional blocker block, and a
 * delete button.
 * @param {object} checkin
 * @returns {HTMLElement} A detached <article> ready to append.
 */
function buildCheckinCard(checkin) {
  const card = document.createElement("article");
  card.className = "checkin-card";
  card.dataset.checkinId = checkin.checkin_id;

  const name = checkin.user?.full_name ?? "Unknown";
  const workloadLabel = WORKLOAD_LABELS[checkin.workload] ?? checkin.workload ?? "—";

  card.innerHTML = `
    <div class="checkin-card__header">
      <div class="avatar checkin-card__avatar">${escapeHtml(initialsFor(name))}</div>
      <span class="checkin-card__author">${escapeHtml(name)}</span>
      <span class="checkin-card__workload">Workload: ${escapeHtml(workloadLabel)}</span>
      <span class="checkin-card__date">${escapeHtml(formatDate(checkin.checkin_date))}</span>
    </div>

    <div class="checkin-card__section">
      <span class="checkin-card__label">Accomplished</span>
      <p class="checkin-card__text">${escapeHtml(checkin.work_done)}</p>
    </div>

    <div class="checkin-card__section">
      <span class="checkin-card__label">To-do</span>
      <p class="checkin-card__text">${escapeHtml(checkin.work_planned)}</p>
    </div>

    ${buildBlockerBlock(checkin.blocker)}

    <div class="checkin-card__footer">
      <button type="button" class="btn btn--danger checkin-card__delete">Delete</button>
    </div>
  `;

  // Wire the delete button to remove this check-in and re-render.
  card.querySelector(".checkin-card__delete").addEventListener("click", () => {
    deleteCheckin(checkin.checkin_id);
  });

  return card;
}

/**
 * Renders the full list of check-in cards (newest first), or an empty
 * state when there are none.
 * @param {object[]} checkins
 */
function renderList(checkins) {
  listEl.innerHTML = "";

  if (checkins.length === 0) {
    listEl.innerHTML = `<p class="task-empty">No check-ins yet.</p>`;
    return;
  }

  for (const checkin of checkins) {
    listEl.appendChild(buildCheckinCard(checkin));
  }
}

/**
 * Reads from storage and repaints both the daily-status banner and the
 * list. Single entry point so every mutation ends with one render call.
 */
function render() {
  const checkins = readCheckins();
  renderDailyStatus(checkins);
  renderList(checkins);
}

// ── Mutations ────────────────────────────────────────

/**
 * Validates and stores a new check-in from the form, then re-renders.
 * @param {SubmitEvent} event
 */
function handleSubmit(event) {
  event.preventDefault();

  const workDone = document.getElementById("field-work-done").value.trim();
  const workPlanned = document.getElementById("field-work-planned").value.trim();
  const workload = document.getElementById("field-workload").value;

  // Required fields: the two stand-up updates and the workload pick.
  if (!workDone || !workPlanned || !workload) {
    showError("Please fill in what you did, what you need to do, and your workload.");
    return;
  }
  hideError();

  const checkin = {
    // Local id prefixed like kanban.js's offline tasks so a future API
    // sync layer can tell client-minted records apart.
    checkin_id: `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    user: { ...CURRENT_USER },
    work_done: workDone,
    work_planned: workPlanned,
    workload,
    blocker: readBlocker(), // null when the blocker panel is closed
    checkin_date: new Date().toISOString(),
  };

  // Prepend so the newest check-in renders at the top of the history.
  writeCheckins([checkin, ...readCheckins()]);

  resetForm();
  render();
}

/**
 * Removes a check-in by id and re-renders. Deleting today's check-in
 * reverts the page to the prompt state so the user can log a new one.
 * @param {string} checkinId
 */
function deleteCheckin(checkinId) {
  const remaining = readCheckins().filter((c) => String(c.checkin_id) !== String(checkinId));
  writeCheckins(remaining);
  render();
}

/**
 * Clears the form back to its empty state, including collapsing the blocker
 * panel (which form.reset() alone does not handle).
 */
function resetForm() {
  form.reset();
  setBlockerOpen(false);
}

// ── Inline form error helpers ────────────────────────
function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

// ── Init ─────────────────────────────────────────────
/**
 * Caches the DOM references, fills the blocker pickers, wires the toggle +
 * submit handlers, and paints the initial state. Runs only in the browser
 * (see the guard below) so node-side tests can import the pure helpers
 * above without a DOM — same approach as scrum.js / kanban.js.
 */
function init() {
  form = document.getElementById("checkin-form");
  promptBanner = document.getElementById("checkin-prompt");
  doneBanner = document.getElementById("checkin-done");
  listEl = document.getElementById("checkin-list");
  errorEl = document.getElementById("checkin-form-error");
  blockerToggle = document.getElementById("blocker-toggle-btn");
  blockerPanel = document.getElementById("blocker-panel");
  blockerTaskSelect = document.getElementById("field-blocker-task");
  blockerWhyInput = document.getElementById("field-blocker-why");
  blockerHelperSelect = document.getElementById("field-blocker-helper");

  populateBlockerOptions();
  blockerToggle.addEventListener("click", () => setBlockerOpen(!isBlockerOpen()));
  form.addEventListener("submit", handleSubmit);
  render();
}

// ES modules are deferred, so the DOM is already parsed when this runs in
// the browser. Skipped under node (no document) so importing the module for
// unit tests never touches the DOM.
if (typeof document !== "undefined") {
  init();
}
