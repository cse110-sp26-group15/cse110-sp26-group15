// ── Kanban Dashboard ──────────────────────────────────────────────────
// Drives the standalone Kanban Board page (kanban.html).
//
// Responsibilities:
//   • Fetch project tasks via apiFetch (10s timeout, throws on non-2xx).
//   • Render tasks into four shared kanban columns using createTaskCard()
//     from the shared task-card component (Issue #8).
//   • Open the shared task-form modal on "+ Add Task" and on per-column
//     "+" buttons, locking the status for column-specific adds.
//   • Handle status changes and task deletion without a full page reload.
//   • Paint a visible error state when the API call fails so the board
//     never gets stuck on "Loading tasks…".
//
// Pure helpers and the STATUS_COLUMNS constant are exported so the test
// suite can exercise them without a DOM (mirrors scrum.js's pattern).

import { createTaskCard } from "../task-card/task-card.js";
import { apiFetch, ApiError } from "../shared/utils.js";

// ── Constants ────────────────────────────────────────
// Hard-coded for now; will switch to the logged-in project once auth
// context is plumbed through (same TODO as scrum.js).
export const PROJECT_ID = 1;

// Column definitions — order is left → right on the board.
export const STATUS_COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "in-progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

// ── Pure helpers (exported for tests) ────────────────

/**
 * Escape user-controlled strings before inserting into innerHTML.
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Group a flat task array into an object keyed by STATUS_COLUMNS.
 * Tasks with an unrecognised / missing status fall into "todo".
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

// ── Module state ──────────────────────────────────────
// Cached member list so the task-form assignee dropdown can populate.
let projectMembers = [];

// task-form.js is dynamically imported on first click so its top-level
// `document.addEventListener` does not run in Node test environments.
let taskFormModulePromise = null;

function loadTaskFormModule() {
  if (!taskFormModulePromise) {
    taskFormModulePromise = import("../task-form/task-form.js");
  }
  return taskFormModulePromise;
}

// ── API calls ────────────────────────────────────────
// All requests go through apiFetch (10s timeout, throws on non-2xx).
// Callers in this file catch + surface failures via alert() / inline
// error so a failing request never leaves the board on a stale state.

async function fetchTasks() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`);
  return data.tasks ?? [];
}

async function fetchMembers() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/members`);
  return data.members ?? [];
}

/**
 * Create a task. `data` is the object returned by the task-form modal:
 *   { title, description, assigned_to, status }
 *
 * `forceStatus` overrides the modal's status — used by kanban column "+"
 * buttons so the new task always lands in the correct column.
 */
async function createTask(data, { forceStatus } = {}) {
  const status = forceStatus ?? data.status ?? "todo";
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status,
  };

  const { task } = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { task: task ?? null };
}

async function updateTask(taskId, fields) {
  return apiFetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

async function deleteTask(taskId) {
  return apiFetch(`/api/tasks/${taskId}`, { method: "DELETE" });
}

// ── Task-card controls ────────────────────────────────
// Appends a footer row below each shared task-card article containing
// a status dropdown (left) and a delete button (right).
// Styled by .task-card-row-delete in kanban.css.
function appendTaskControls(card, task) {
  const row = document.createElement("div");
  row.className = "task-card-row-delete";

  // Status dropdown — reflects the current status; changes trigger a PATCH.
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
    try {
      await updateTask(task.task_id, { status: newStatus });
      await loadAll();
    } catch (err) {
      console.error("[kanban] updateTask failed", err);
      alert(`Couldn't update task: ${err.message}`);
      await loadAll();
    }
  });

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-delete";
  deleteBtn.dataset.taskId = task.task_id;
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    try {
      await deleteTask(task.task_id);
      await loadAll();
    } catch (err) {
      console.error("[kanban] deleteTask failed", err);
      alert(`Couldn't delete task: ${err.message}`);
    }
  });

  row.appendChild(statusSelect);
  row.appendChild(deleteBtn);
  card.appendChild(row);
}

/**
 * Build a complete task card: shared task-card component + controls row.
 * Compact mode hides the description preview to keep narrow columns tidy.
 */
function buildTaskCard(task) {
  const card = createTaskCard(task, "kanban", { compact: true });
  appendTaskControls(card, task);
  return card;
}

// ── Kanban board renderer ─────────────────────────────
function renderKanban(tasks) {
  const board = document.getElementById("kanban-board");
  if (!board) return;
  board.innerHTML = "";

  const grouped = groupTasksByStatus(tasks);

  for (const col of STATUS_COLUMNS) {
    // ── Column shell ──────────────────────────────────
    const column = document.createElement("div");
    column.className = `kanban-column kanban-column--${col.key}`;
    column.dataset.status = col.key;

    // ── Column header (title + count + add button) ──
    const header = document.createElement("div");
    header.className = "kanban-column-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "kanban-column-title";
    titleSpan.textContent = col.label;

    const count = document.createElement("span");
    count.className = "kanban-column-count";
    count.textContent = String(grouped[col.key].length);
    // Count pill sits inside the title flex container.
    titleSpan.appendChild(count);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "kanban-column-add btn btn--primary";
    addBtn.dataset.status = col.key;
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", `Add task to ${col.label}`);
    // Lock the new task's status to this column's status so it always
    // appears in the correct column regardless of the modal's UI.
    addBtn.addEventListener("click", () => openCreateTaskModal({ lockedStatus: col.key }));

    header.appendChild(titleSpan);
    header.appendChild(addBtn);
    column.appendChild(header);

    // ── Card list ───────────────────────────────────
    const listEl = document.createElement("div");
    listEl.className = "kanban-column-list";

    if (grouped[col.key].length === 0) {
      const empty = document.createElement("div");
      empty.className = "kanban-column-empty";
      empty.textContent = "No tasks";
      listEl.appendChild(empty);
    } else {
      for (const t of grouped[col.key]) {
        listEl.appendChild(buildTaskCard(t));
      }
    }

    column.appendChild(listEl);
    board.appendChild(column);
  }
}

// ── Task-form modal ───────────────────────────────────
// Opens the shared task-form modal from ../task-form/task-form.js.
// Dynamic import is used so the module's DOMContentLoaded handler
// doesn't run during Node-side tests.
//
// `lockedStatus` forces the new task into a specific status and hides
// the status field in the modal — used by per-column "+" buttons.
async function openCreateTaskModal({ lockedStatus, defaultStatus = "todo" } = {}) {
  const { openTaskModal } = await loadTaskFormModule();

  openTaskModal(async (data) => {
    try {
      await createTask(data, { forceStatus: lockedStatus });
      await loadAll();
    } catch (err) {
      console.error("[kanban] createTask failed", err);
      alert(`Couldn't create task: ${err.message}`);
    }
  });

  // Pre-select the column's status in the modal and hide the dropdown
  // when it's locked so the UI doesn't suggest the user can override it.
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

// Paint a visible error so the board never stays on "Loading tasks…".
function renderLoadError(message) {
  const board = document.getElementById("kanban-board");
  if (board) {
    board.innerHTML = `<p class="task-empty task-error">⚠ ${escapeHtml(message)}</p>`;
  }
}

// ── Data loading ──────────────────────────────────────
async function loadAll() {
  let tasks, members;
  try {
    [tasks, members] = await Promise.all([fetchTasks(), fetchMembers()]);
  } catch (err) {
    const reason =
      err instanceof ApiError && err.status > 0
        ? `Failed to load board (${err.status}): ${err.message}`
        : `Failed to load board: ${err?.message ?? "network error"}`;
    renderLoadError(reason);
    console.error("[kanban] loadAll failed", err);
    return;
  }

  // Cache members so the task-form modal's assignee dropdown can populate.
  projectMembers = members;

  renderKanban(tasks);
}

// ── Init ──────────────────────────────────────────────
function init() {
  // Sidebar nav — toggle active state for hash links without reloading.
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const href = item.getAttribute("href");
      if (!href || href === "#") e.preventDefault();
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
      const topbarTitle = document.querySelector(".topbar-title");
      if (topbarTitle) topbarTitle.textContent = item.textContent.trim();
    });
  });

  // "+ Add Task" button at the top of the board.
  document.getElementById("add-task-btn")?.addEventListener("click", () => {
    openCreateTaskModal({ defaultStatus: "todo" });
  });

  // Expose the member cache to the task-form modal's assignee dropdown.
  if (typeof window !== "undefined") {
    window.getProjectMembers = () => projectMembers;
  }

  // First load — fetches tasks and renders the board.
  loadAll();
}

// Skip DOM wiring when the module is imported in a non-browser context
// (e.g. Node-side unit tests that only exercise the exported helpers).
if (typeof document !== "undefined") {
  // ES modules are deferred by default, so the DOM is fully parsed here.
  init();
}
