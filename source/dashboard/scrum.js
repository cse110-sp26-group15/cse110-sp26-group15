// ── Scrum Dashboard ──────────────────────────────────
// Wires together:
//   • a sprint picker (sprint number + date range) persisted to
//     localStorage so the user can re-open the page without re-entering;
//   • the shared task-card component (createTaskCard) for the display;
//   • the openTaskModal modal from ../task-form/task-form.js as the
//     "+ Add Task" creation flow;
//   • a list ⇄ kanban toggle for the Sprint Tasks panel, with per-column
//     + buttons that pre-fill (and lock) the new-task status.
//
// All task mutations (create/update/delete) fall back to a localStorage
// store when the API isn't reachable, so the dashboard stays usable on a
// plain static server too. Pure helper functions (computeDayOfSprint,
// computeSprintProgress, etc.) are exported so tests can exercise them
// without a DOM.

import { createTaskCard } from "../task-card/task-card.js";

// task-form.js runs `document.addEventListener(...)` at module top, so we
// can't import it statically — it would crash the node-side tests where
// there's no document. We dynamic-import it inside openCreateTaskModal
// instead. The module's own DOMContentLoaded auto-init becomes a no-op
// when the module is loaded after DCL has already fired in the browser,
// which is exactly what we want — scrum.js owns the wiring.
//
// `taskFormModulePromise` caches the import so repeated clicks reuse the
// same module instance instead of re-fetching it.
let taskFormModulePromise = null;
function loadTaskFormModule() {
  if (!taskFormModulePromise) {
    taskFormModulePromise = import("../task-form/task-form.js");
  }
  return taskFormModulePromise;
}

// ── Constants ────────────────────────────────────────
// PROJECT_ID is hard-coded for now (no auth/projects flow on the
// dashboard yet); will switch to the logged-in user's project once that
// context is plumbed through.
export const PROJECT_ID = 1;

// localStorage key for the sprint picker selection. Namespaced by
// project so multiple projects can each remember their own sprint.
const SPRINT_STORAGE_KEY = `sitrep.scrum.sprint.project-${PROJECT_ID}`;

// localStorage key for the task fallback store. Used whenever the API
// isn't reachable (e.g. running the static `dist/` on a plain HTTP
// server with no D1 binding). Local tasks are merged with API tasks on
// every fetch so users never see "I created something but it vanished".
const LOCAL_TASKS_KEY = `sitrep.scrum.tasks.project-${PROJECT_ID}`;

// Column definitions for the kanban view. Order is left → right.
// Each column tracks every task whose `status` matches `key`.
export const STATUS_COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in-progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

// ── Pure helpers (exported for tests) ────────────────

/**
 * Escape any user-controlled string before interpolating into HTML.
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

/**
 * Build a 1–2 letter avatar from a person's name (e.g. "Alex K." → "AK").
 */
export function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Render a date as "May 18". Returns "" when the input is unparseable so
 * callers can drop it cleanly into a label.
 */
export function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Map a free-form status_mood string ("blocked", "needs help", "ok"…) to
 * the matching status-badge class + label.
 */
export function classifyMood(mood) {
  const m = (mood || "").toLowerCase();
  if (m.includes("block")) return { cls: "status-blocked", label: "blocked" };
  if (m.includes("help") || m.includes("overwhelm") || m.includes("stuck")) {
    return { cls: "status-needs-help", label: "needs help" };
  }
  return { cls: "status-on-track", label: "on track" };
}

/**
 * Parse a YYYY-MM-DD string into a Date at local midnight. Returns null
 * if the input is empty/invalid — callers should treat this as "unknown".
 */
export function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Calculate the current day of a sprint, given its start and end dates.
 *
 * @param {string|Date} startDate  Sprint start (inclusive).
 * @param {string|Date} endDate    Sprint end (inclusive).
 * @param {Date} [today]           Defaults to "now"; injectable for tests.
 * @returns {{day: number, total: number}|null}
 *
 * - If the dates are invalid or end < start → null.
 * - `day` is clamped to [1, total]; before the sprint starts it is 1,
 *   after it ends it equals `total`. This matches the mockup style of
 *   "Day 3 of 7" — we never show "Day 0" or "Day 8 of 7".
 */
export function computeDayOfSprint(startDate, endDate, today = new Date()) {
  const start = startDate instanceof Date ? startDate : parseISODate(startDate);
  const end = endDate instanceof Date ? endDate : parseISODate(endDate);
  if (!start || !end) return null;
  if (end < start) return null;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const total = Math.round((end - start) / MS_PER_DAY) + 1;
  const raw = Math.floor((today - start) / MS_PER_DAY) + 1;
  const day = Math.max(1, Math.min(total, raw));
  return { day, total };
}

/**
 * Compute the sprint progress bar percentages from the task list.
 *
 * Returns the same `done`/`total`/`pct` numbers regardless of whether
 * tasks are stored as a flat list or grouped by column.
 */
export function computeSprintProgress(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

/**
 * Bucket tasks into columns keyed by status. Always returns an entry for
 * every column in STATUS_COLUMNS (with an empty array if no tasks match)
 * so the kanban view can render every column without null checks.
 *
 * Tasks with an unknown/missing status fall into "todo".
 */
export function groupTasksByStatus(tasks) {
  const groups = {};
  for (const col of STATUS_COLUMNS) groups[col.key] = [];

  for (const t of tasks ?? []) {
    const key = STATUS_COLUMNS.some((c) => c.key === t.status) ? t.status : "todo";
    groups[key].push(t);
  }
  return groups;
}

/**
 * Format a sprint date range as "May 5–11" (same month) or "Apr 30–May 6"
 * (cross-month). Returns "" if either date is missing/invalid.
 */
export function formatSprintRange(startDate, endDate) {
  const a = parseISODate(startDate);
  const b = parseISODate(endDate);
  if (!a || !b) return "";

  const monthDayA = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${monthDayA}–${b.getDate()}`;
  }
  const monthDayB = b.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${monthDayA}–${monthDayB}`;
}

/**
 * Read the persisted sprint state. Returns null when nothing is stored
 * or storage is unavailable (e.g. running under SSR / private mode).
 */
export function readSprintFromStorage(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SPRINT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      number: Number(parsed.number) || null,
      start_date: parsed.start_date ?? null,
      end_date: parsed.end_date ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Persist the sprint state. Swallows quota / disabled-storage errors so a
 * failure to save never breaks the dashboard UI.
 */
export function writeSprintToStorage(sprint, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(SPRINT_STORAGE_KEY, JSON.stringify(sprint));
  } catch {
    /* best-effort */
  }
}

// ── Module-level state ───────────────────────────────
// `sprintState` holds the currently-shown sprint metadata (number + date
// range). It is loaded from localStorage on init and overwritten when the
// user saves the picker.
let sprintState = { number: null, start_date: null, end_date: null };

// "list" or "kanban" — controls which view of Sprint Tasks is visible.
let viewMode = "list";

// Cache of the most recently-fetched task list, so the kanban view can
// re-render after a status change without an extra round trip.
let currentTasks = [];

// Cache of project members — populated by fetchMembers() during loadAll
// and exposed to the task-form modal via `window.getProjectMembers` so
// the assignee dropdown can be populated.
let projectMembers = [];

// ── Local-task fallback store ────────────────────────
// When the API is unreachable, tasks are persisted here so the create /
// update / delete actions still feel responsive. Local tasks carry a
// "local-…" id so we can tell them apart from API rows.

function readLocalTasks() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_TASKS_KEY);
    return raw ? (JSON.parse(raw) ?? []) : [];
  } catch {
    return [];
  }
}

function writeLocalTasks(tasks) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  } catch {
    /* quota / disabled storage — swallow */
  }
}

// Generated id for local-only tasks. The "local-" prefix is meaningful:
// updateTask/deleteTask check for it to route the mutation to storage
// instead of the API.
function nextLocalTaskId() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// Identifies a task id minted by the local-fallback store (so callers
// know to route updates/deletes to localStorage instead of the API).
export function isLocalTaskId(taskId) {
  return String(taskId).startsWith("local-");
}

// ── API (with local-fallback semantics) ──────────────
// Each call tries the real endpoint first, then degrades to the
// in-browser store. The shape returned to callers (task / tasks array)
// is identical so the renderers don't need to know which source won.

async function fetchTasks() {
  let apiTasks = [];
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
    if (res.ok) {
      const data = await res.json();
      apiTasks = data.tasks ?? [];
    }
  } catch {
    /* fall through to local-only */
  }
  // Always merge in local-only rows so user-created tasks show up even
  // when only one side of the pipe is live.
  return [...apiTasks, ...readLocalTasks()];
}

/**
 * Create a task. `data` is whatever openTaskModal hands back:
 *   { title, description, assigned_to, status }
 *
 * `forceStatus` overrides whatever status the modal returned — used by
 * kanban-column + buttons so the task always lands in the right column.
 */
async function createTask(data, { forceStatus } = {}) {
  const status = forceStatus ?? data.status ?? "todo";
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status,
  };

  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      // The POST handler currently always inserts as `status='todo'`
      // (see functions/api/projects/[projectId]/tasks.js). If the user
      // wanted something else, immediately PATCH to fix it up so the
      // task lands in the correct column.
      const created = json.task ?? null;
      if (created && status !== "todo") {
        await updateTask(created.task_id, { status });
        created.status = status;
      }
      return { task: created };
    }
  } catch {
    /* fall through */
  }

  // API was unavailable — persist locally so the UI still shows the
  // new task. The shape mirrors the API row enough for the renderers.
  const localTask = {
    task_id: nextLocalTaskId(),
    title: data.title,
    description: data.description ?? "",
    user_id: data.assigned_to ?? null,
    full_name: assigneeName(data.assigned_to),
    status,
    is_local: true,
  };
  writeLocalTasks([...readLocalTasks(), localTask]);
  return { task: localTask };
}

async function updateTask(taskId, fields) {
  if (isLocalTaskId(taskId)) {
    // Local task — just rewrite the entry in storage.
    const tasks = readLocalTasks().map((t) =>
      String(t.task_id) === String(taskId) ? { ...t, ...fields } : t
    );
    writeLocalTasks(tasks);
    return {};
  }
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) return await res.json();
  } catch {
    /* fall through */
  }
  return {};
}

async function deleteTask(taskId) {
  if (isLocalTaskId(taskId)) {
    const tasks = readLocalTasks().filter((t) => String(t.task_id) !== String(taskId));
    writeLocalTasks(tasks);
    return {};
  }
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) return await res.json();
  } catch {
    /* fall through */
  }
  return {};
}

// Look up an assignee's name from the cached project members. Used when
// creating a local-only task so the avatar/name row still renders.
function assigneeName(userId) {
  if (!userId) return null;
  const member = projectMembers.find((m) => Number(m.user_id) === Number(userId));
  return member?.full_name ?? null;
}

async function fetchCheckins() {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/checkins`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.checkins ?? [];
  } catch {
    return [];
  }
}

async function fetchBlockers() {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/blockers`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.blockers ?? [];
  } catch {
    return [];
  }
}

async function fetchSprint() {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/sprints/current`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.sprint ?? null;
  } catch {
    return null;
  }
}

async function fetchMembers() {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.members ?? [];
  } catch {
    return [];
  }
}

// ── Sprint header + progress ─────────────────────────
function renderSprintHeader(checkins) {
  const metaEl = document.getElementById("sprint-meta");
  const titleEl = document.getElementById("sprint-progress-title");
  if (!metaEl || !titleEl) return;

  const range = formatSprintRange(sprintState.start_date, sprintState.end_date);
  const parts = [];
  if (sprintState.number) parts.push(`Sprint ${sprintState.number}`);
  if (range) parts.push(range);
  parts.push(`${checkins.length} checked in today`);
  metaEl.textContent = parts.join(" · ");

  titleEl.textContent = sprintState.number
    ? `Sprint ${sprintState.number} Progress`
    : "Sprint Progress";
}

function renderSprintProgress(tasks) {
  const fill = document.getElementById("sprint-progress-fill");
  const text = document.getElementById("sprint-progress-text");
  const badge = document.getElementById("sprint-day-badge");
  const statusEl = document.getElementById("sprint-progress-status");
  if (!fill || !text || !badge || !statusEl) return;

  const { done, total, pct } = computeSprintProgress(tasks);
  fill.style.width = `${pct}%`;
  text.textContent = `${done} / ${total} tasks · ${pct}% complete`;

  // Show "Day X of Y" only when the date range is valid; otherwise hide
  // the badge so it doesn't display a stale value.
  const dayInfo = computeDayOfSprint(sprintState.start_date, sprintState.end_date);
  if (dayInfo) {
    badge.hidden = false;
    badge.textContent = `Day ${dayInfo.day} of ${dayInfo.total}`;
  } else {
    badge.hidden = true;
    badge.textContent = "";
  }

  statusEl.textContent = pct >= 100 ? "complete" : "on track";
}

// ── Blockers ─────────────────────────────────────────
function renderBlockers(blockers) {
  const panel = document.getElementById("blockers-panel");
  const list = document.getElementById("blockers-list");
  const title = document.getElementById("blockers-title");
  if (!panel || !list || !title) return;

  const open = blockers.filter((b) => !b.is_resolved);
  title.textContent = `⚠ Blockers (${open.length})`;

  if (open.length === 0) {
    panel.classList.add("is-empty");
    list.innerHTML = "";
    return;
  }

  panel.classList.remove("is-empty");
  list.innerHTML = open
    .map(
      (b) => `
      <div class="blocker-item" data-blocker-id="${escapeHtml(b.blocker_id)}">
        <span class="blocker-dot"></span>
        <span class="blocker-desc">${escapeHtml(b.description)}</span>
        ${b.tag ? `<span class="blocker-tag">tag: ${escapeHtml(b.tag)}</span>` : ""}
        <span class="blocker-author">${escapeHtml(b.full_name ?? "")}</span>
      </div>`
    )
    .join("");
}

// ── Check-in cards ───────────────────────────────────
function renderCheckins(checkins, members) {
  const grid = document.getElementById("checkin-grid");
  if (!grid) return;
  const checkedInUserIds = new Set(checkins.map((c) => c.user_id));

  const checkinCards = checkins
    .map((c) => {
      const mood = classifyMood(c.status_mood);
      const time = c.checkin_date ? formatDate(c.checkin_date) : "today";
      const work = c.work_done || c.work_planned || "—";
      return `
        <div class="checkin-card" data-checkin-id="${escapeHtml(c.checkin_id)}">
          <div class="checkin-top">
            <div class="checkin-user">
              <div class="avatar">${escapeHtml(initials(c.full_name))}</div>
              <span class="checkin-name">${escapeHtml(c.full_name ?? "Unknown")}</span>
            </div>
            <span class="status-badge ${mood.cls}">${mood.label}</span>
          </div>
          <div class="checkin-body">${escapeHtml(work)}</div>
          <div class="checkin-footer">
            <span class="checkin-meta">${escapeHtml(time)}${c.status_mood ? " · " + escapeHtml(c.status_mood) : ""}</span>
            ${
              mood.cls === "status-blocked"
                ? `<button class="btn-mini danger">view blocker</button>`
                : `<button class="btn-mini">view update</button>`
            }
          </div>
        </div>`;
    })
    .join("");

  const missing = members
    .filter((m) => !checkedInUserIds.has(m.user_id))
    .map(
      (m) => `
        <div class="checkin-card is-empty">
          <div class="checkin-user">
            <div class="avatar">${escapeHtml(initials(m.full_name))}</div>
            <span class="checkin-name">${escapeHtml(m.full_name)}</span>
          </div>
          <span>not checked in</span>
        </div>`
    )
    .join("");

  if (!checkins.length && !members.length) {
    grid.innerHTML = `<p class="muted-small">No check-ins for today yet.</p>`;
    return;
  }
  grid.innerHTML = checkinCards + missing;
}

// ── Task rendering helpers (shared by list + kanban) ──
// Decorates a card with the page-specific status + delete controls in a
// row below the task-card component. The shared component intentionally
// doesn't provide a delete button, so we add it here.
function appendTaskControls(card, task) {
  const row = document.createElement("div");
  row.className = "task-card-row-delete";

  const statusSelect = document.createElement("select");
  statusSelect.className = `status-select status-${task.status ?? "todo"}`;
  statusSelect.dataset.taskId = task.task_id;
  for (const col of STATUS_COLUMNS) {
    const opt = document.createElement("option");
    opt.value = col.key;
    opt.textContent = col.label;
    if (task.status === col.key) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.addEventListener("change", async (e) => {
    const newStatus = e.target.value;
    e.target.className = `status-select status-${newStatus}`;
    await updateTask(task.task_id, { status: newStatus });
    await loadAll();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-delete";
  deleteBtn.dataset.taskId = task.task_id;
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    await deleteTask(task.task_id);
    await loadAll();
  });

  row.appendChild(statusSelect);
  row.appendChild(deleteBtn);
  card.appendChild(row);
}

// Build a task-card element for the list view (uses scrum-style card).
function buildTaskCard(task, { compact = false } = {}) {
  // Mix in the active sprint number so the card banner reads
  // "Urgent · Sprint 3" the way the task-card scrum variant expects.
  const enriched = {
    ...task,
    sprint: sprintState.number ? `Sprint ${sprintState.number}` : task.sprint,
  };
  const card = createTaskCard(enriched, "scrum", { compact });
  appendTaskControls(card, task);
  return card;
}

// ── List view ────────────────────────────────────────
function renderTaskList(tasks) {
  const list = document.getElementById("task-list");
  if (!list) return;
  list.innerHTML = "";

  if (tasks.length === 0) {
    list.innerHTML = `<p class="task-empty">No tasks yet. Add one above.</p>`;
    return;
  }
  for (const t of tasks) {
    list.appendChild(buildTaskCard(t));
  }
}

// ── Kanban view ──────────────────────────────────────
function renderKanban(tasks) {
  const board = document.getElementById("kanban-board");
  if (!board) return;
  board.innerHTML = "";

  const grouped = groupTasksByStatus(tasks);

  for (const col of STATUS_COLUMNS) {
    const column = document.createElement("div");
    column.className = `kanban-column kanban-column--${col.key}`;
    column.dataset.status = col.key;

    // Column header: title + count + add button.
    const header = document.createElement("div");
    header.className = "kanban-column-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "kanban-column-title";
    titleSpan.textContent = col.label;

    const count = document.createElement("span");
    count.className = "kanban-column-count";
    count.textContent = String(grouped[col.key].length);
    titleSpan.appendChild(count);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "kanban-column-add";
    addBtn.dataset.status = col.key;
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", `Add task to ${col.label}`);
    // Open the create modal with this column's status locked in, so the
    // new task always lands in this column regardless of the modal UI.
    addBtn.addEventListener("click", () => openCreateTaskModal({ lockedStatus: col.key }));

    header.appendChild(titleSpan);
    header.appendChild(addBtn);
    column.appendChild(header);

    // Task list inside the column (compact cards to fit narrow widths).
    const listEl = document.createElement("div");
    listEl.className = "kanban-column-list";
    if (grouped[col.key].length === 0) {
      const empty = document.createElement("div");
      empty.className = "kanban-column-empty";
      empty.textContent = "No tasks";
      listEl.appendChild(empty);
    } else {
      for (const t of grouped[col.key]) {
        listEl.appendChild(buildTaskCard(t, { compact: true }));
      }
    }
    column.appendChild(listEl);
    board.appendChild(column);
  }
}

// Render whichever view is active. Called whenever tasks change so both
// view containers stay in sync (the inactive one is hidden via CSS).
function renderTasks(tasks) {
  currentTasks = tasks;
  renderTaskList(tasks);
  renderKanban(tasks);
}

// ── View toggle ──────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode === "kanban" ? "kanban" : "list";

  const listEl = document.getElementById("task-list");
  const boardEl = document.getElementById("kanban-board");
  if (listEl) listEl.classList.toggle("hidden", viewMode !== "list");
  if (boardEl) boardEl.classList.toggle("hidden", viewMode !== "kanban");

  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewMode);
  });
}

// ── Add-task flow (uses task-form modal) ─────────────
// Opens the shared modal from ../task-form/task-form.js. The modal's
// onSubmit fires once the user clicks "Create task" with a valid title.
//
// `lockedStatus`, when provided, forces the new task into that status
// regardless of what the user picked in the modal — used by the kanban
// column + buttons so a click on the "Blocked" column's + reliably
// produces a blocked task. We also hide the status field in the modal
// when it's locked so the UI doesn't lie about what the dropdown does.
async function openCreateTaskModal({ lockedStatus, defaultStatus = "todo" } = {}) {
  const { openTaskModal } = await loadTaskFormModule();

  openTaskModal(async (data) => {
    const result = await createTask(data, { forceStatus: lockedStatus });
    if (!result?.task) {
      // Storage was wedged AND the API failed — give the user feedback
      // instead of silently dropping the task.
      console.error("Failed to create task — neither API nor localStorage accepted it.");
    }
    await loadAll();
  });

  // Tweak the just-opened modal: preselect the column's status, and hide
  // the status field entirely when it's locked (kanban + buttons).
  // openTaskModal builds the DOM synchronously, so the elements are
  // already on the page by the time this code runs.
  const statusSelect = document.getElementById("tf-input-status");
  if (statusSelect) {
    const wanted = lockedStatus ?? defaultStatus;
    const supported = [...statusSelect.options].some((o) => o.value === wanted);
    if (supported) statusSelect.value = wanted;
    if (lockedStatus) {
      const wrapper = statusSelect.closest(".tf-field");
      if (wrapper) wrapper.style.display = "none";
    }
  }
}

// ── Sprint picker ────────────────────────────────────
function openSprintPicker() {
  const picker = document.getElementById("sprint-picker");
  const numberInput = document.getElementById("sprint-number-input");
  const startInput = document.getElementById("sprint-start-input");
  const endInput = document.getElementById("sprint-end-input");
  if (!picker || !numberInput || !startInput || !endInput) return;

  // Prefill with the current state so editing is non-destructive.
  numberInput.value = sprintState.number ?? "";
  startInput.value = sprintState.start_date ?? "";
  endInput.value = sprintState.end_date ?? "";

  picker.classList.remove("hidden");
  numberInput.focus();
}

function closeSprintPicker() {
  const picker = document.getElementById("sprint-picker");
  const err = document.getElementById("sprint-picker-error");
  if (picker) picker.classList.add("hidden");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function saveSprintPicker() {
  const numberInput = document.getElementById("sprint-number-input");
  const startInput = document.getElementById("sprint-start-input");
  const endInput = document.getElementById("sprint-end-input");
  const err = document.getElementById("sprint-picker-error");
  if (!numberInput || !startInput || !endInput || !err) return;

  const number = numberInput.value ? Number(numberInput.value) : null;
  const start = startInput.value || null;
  const end = endInput.value || null;

  // Validate: when both dates are set, end ≥ start.
  if (start && end && parseISODate(start) > parseISODate(end)) {
    err.hidden = false;
    err.textContent = "End date must be on or after start date.";
    return;
  }

  sprintState = { number, start_date: start, end_date: end };
  writeSprintToStorage(sprintState);
  closeSprintPicker();

  // Re-render the header + progress (which both depend on sprintState).
  renderSprintHeader(/* checkins */ []);
  renderSprintProgress(currentTasks);
  // Also re-render tasks so the "Sprint N" banner label on each card
  // reflects the new sprint number.
  renderTasks(currentTasks);
}

// ── Load + render orchestration ──────────────────────
async function loadAll() {
  const [tasks, checkins, blockers, apiSprint, apiMembers] = await Promise.all([
    fetchTasks(),
    fetchCheckins(),
    fetchBlockers(),
    fetchSprint(),
    fetchMembers(),
  ]);

  // If /members returned something, trust it; otherwise reverse-engineer
  // members from rows that include user info (legacy / partial APIs).
  // Either way, cache the result so the create modal's assignee dropdown
  // can populate (it reads via window.getProjectMembers).
  projectMembers = apiMembers.length ? apiMembers : deriveMembers(tasks, checkins);

  // If the user hasn't set a sprint yet, prefer whatever the API knows;
  // user-saved values always win once they exist.
  if (apiSprint && sprintState.number === null) {
    sprintState = {
      number: apiSprint.number ?? null,
      start_date: apiSprint.start_date ?? null,
      end_date: apiSprint.end_date ?? null,
    };
  }

  renderSprintHeader(checkins);
  renderSprintProgress(tasks);
  renderBlockers(blockers);
  renderCheckins(checkins, projectMembers);
  renderTasks(tasks);
}

// Derive team members from any rows that include user info — keeps the
// dashboard usable even without a dedicated /members endpoint.
function deriveMembers(tasks, checkins) {
  const map = new Map();
  for (const t of tasks) {
    if (t.user_id && t.full_name) map.set(t.user_id, t.full_name);
  }
  for (const c of checkins) {
    if (c.user_id && c.full_name) map.set(c.user_id, c.full_name);
  }
  return [...map.entries()].map(([user_id, full_name]) => ({ user_id, full_name }));
}

// ── Init (DOM-only) ──────────────────────────────────
// Skip everything below when there's no document — lets the test suite
// import this module purely for the helpers above.
function init() {
  // Restore sprint state from localStorage (if anything is saved).
  const stored = readSprintFromStorage();
  if (stored) sprintState = stored;

  // ── Sidebar nav ────────────────────────────────────
  // Real `href`s do the navigation; we only toggle the active state for
  // hash links so they don't reload the page.
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const href = item.getAttribute("href");
      if (!href || href === "#") {
        e.preventDefault();
      }
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      item.classList.add("active");

      const topbarTitle = document.querySelector(".topbar-title");
      if (topbarTitle) topbarTitle.textContent = item.textContent.trim();
    });
  });

  // ── Sprint picker controls ─────────────────────────
  document.getElementById("edit-sprint-btn")?.addEventListener("click", openSprintPicker);
  document.getElementById("save-sprint-btn")?.addEventListener("click", saveSprintPicker);
  document.getElementById("cancel-sprint-btn")?.addEventListener("click", closeSprintPicker);

  // ── View toggle (list ⇄ kanban) ────────────────────
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => setViewMode(btn.dataset.view));
  });

  // ── Add-task button (opens task-form modal) ────────
  // task-form.js is dynamic-imported on first click (so the node-side
  // tests don't crash on its top-level `document.addEventListener`).
  // Because that import happens after DOMContentLoaded, the module's
  // own auto-init won't fire — which means we own #add-task-btn outright
  // and don't have to fight over it.
  document.getElementById("add-task-btn")?.addEventListener("click", () => {
    openCreateTaskModal({ defaultStatus: "todo" });
  });

  // task-form's modal builder reads the project's member list off
  // `window.getProjectMembers` to populate the assignee dropdown — we
  // expose ours here so the dropdown isn't empty.
  if (typeof window !== "undefined") {
    window.getProjectMembers = () => projectMembers;
  }

  // ── Check-in button (placeholder until check-in flow exists) ──
  document.getElementById("checkin-today-btn")?.addEventListener("click", () => {
    // The dedicated check-in page isn't built yet — this stub keeps the
    // affordance discoverable so the next person to touch the flow has
    // a place to wire it up.
    alert("Check-in flow not yet implemented — wire up to the My Check-ins page.");
  });

  // Apply the saved view mode (defaults to "list") and kick off the
  // first load.
  setViewMode(viewMode);
  loadAll();
}

if (typeof document !== "undefined") {
  // Modules are deferred by default, so the DOM is parsed by the time
  // we get here; no DOMContentLoaded listener required.
  init();
}
