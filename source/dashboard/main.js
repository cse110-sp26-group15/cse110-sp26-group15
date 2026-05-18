import { mockTasks, mockMembers } from "./mock-data.js";
import { createTaskCard } from "../task-card/task-card.js";

// ── Navigation ────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    const topbarTitle = document.querySelector(".topbar-title");
    if (topbarTitle) {
      topbarTitle.textContent = item.textContent.trim();
    }

    switchView(item.textContent.trim());
  });
});

// ── View switching ────────────────────────────────────
const VIEWS = {
  Dashboard: "dashboard-view",
  "My Check-ins": "checkins-view",
  Team: "team-view",
  "Weekly Report": "weekly-view",
  Settings: "settings-view",
};

function switchView(label) {
  document.querySelectorAll(".page-view").forEach((v) => v.classList.add("hidden"));

  const viewId = VIEWS[label];
  if (!viewId) return;

  let view = document.getElementById(viewId);

  if (!view) {
    view = document.createElement("div");
    view.id = viewId;
    view.className = "page-view placeholder";
    view.innerHTML = `<p>${label}</p><span>Coming soon</span>`;
    document.getElementById("page-content")?.appendChild(view);
  }

  view.classList.remove("hidden");
}

// ── Task API ──────────────────────────────────────────
const PROJECT_ID = 1; // TODO: replace with actual logged-in project context

// ── Mock data (swap out for real API calls when deploying) ────
let mockTasksLocal = [...mockTasks];

/**
 * Fetches the list of tasks for the current project.
 * @returns {Promise<object[]>} Array of task records; empty array when none exist.
 */
async function fetchTasks() {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
  // const data = await res.json();
  // return data.tasks ?? [];
  return mockTasksLocal;
}

/**
 * Fetches the list of members for the current project.
 * @returns {Promise<object[]>} Array of member records ({ user_id, full_name, ... }).
 */
async function fetchMembers() {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
  // const data = await res.json();
  // return data.members ?? [];
  return mockMembers;
}

/**
 * Creates a new task on the current project.
 * @param {string} title - Task title.
 * @param {number|null} assignedTo - Member user_id to assign, or null/undefined for unassigned.
 * @returns {Promise<object>} The created task record returned by the API.
 */
  async function createTask(data) {
  const member = mockMembers.find((m) => m.user_id === data.assigned_to) ?? null;

  const newTask = {
    task_id: Date.now(),
    title: data.title,
    description: data.description ?? "",
    status: data.status ?? "todo",
    user_id: data.assigned_to ?? null,
    full_name: member?.full_name ?? null,
    priority: data.priority ?? "low",
    due_date: data.due_date ?? null,
    tags: data.tags ?? [],
    is_blocked: data.is_blocked ?? false,
    blocker_reason: data.blocker_reason ?? "",
  };

  mockTasksLocal.push(newTask);
  return { task: newTask };
}

/**
 * Patches mutable fields on an existing task (status, assignee, etc.).
 * @param {number|string} taskId - Task identifier.
 * @param {object} fields - Partial task fields to update (e.g. { status, assigned_to }).
 * @returns {Promise<object>} The updated task record returned by the API.
 */
async function updateTask(taskId, fields) {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks/${taskId}`, {
  //   method: "PATCH",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(fields),
  // });
  // return res.json();
  const task = mockTasksLocal.find((t) => String(t.task_id) === String(taskId));
  if (task) Object.assign(task, fields);
  return { task };
}

/**
 * Deletes a task by id.
 * @param {number|string} taskId - Task identifier.
 * @returns {Promise<object>} API response body.
 */
async function deleteTask(taskId) {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks/${taskId}`, { method: "DELETE" });
  // return res.json();
  mockTasksLocal = mockTasksLocal.filter((t) => String(t.task_id) !== String(taskId));
  return { success: true };
}

// ── Members cache ─────────────────────────────────────
let projectMembers = [];

/**
 * Builds the inner HTML for an assignee `<select>`, populated from the cached
 * project members list with the given member pre-selected.
 * @param {number|null} selectedUserId - Member user_id to mark selected, or null for "Unassigned".
 * @returns {string} The concatenated `<option>` markup.
 */
function buildAssigneeOptions(selectedUserId) {
  const unassigned = `<option value=""${!selectedUserId ? " selected" : ""}>Unassigned</option>`;
  const memberOpts = projectMembers
    .map(
      (m) =>
        `<option value="${m.user_id}"${m.user_id === selectedUserId ? " selected" : ""}>${m.full_name}</option>`
    )
    .join("");
  return unassigned + memberOpts;
}

/**
 * Populates the assignee dropdown on the inline "create task" form, if present.
 * No-op when the form is not rendered on the current page.
 * @returns {void}
 */
function populateCreateFormAssignees() {
  const sel = document.getElementById("new-task-assignee");
  if (!sel) return;
  sel.innerHTML = buildAssigneeOptions(null);
}

// ── Board rendering (kanban) ──────────────────────────
function renderBoard(tasks) {
  const groups = { todo: [], "in-progress": [], done: [] };
  for (const task of tasks) {
    const bucket = groups[task.status];
    if (bucket) bucket.push(task);
    else groups.todo.push(task);
  }

  const COLUMNS = ["todo", "in-progress", "done"];
  for (const status of COLUMNS) {
    const container = document.getElementById(`cards-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const colTasks = groups[status];

    if (countEl) countEl.textContent = String(colTasks.length);
    if (!container) continue;
    container.innerHTML = "";

    if (colTasks.length === 0) {
      container.innerHTML = `<p class="kanban-col__empty">No tasks yet</p>`;
      continue;
    }

    for (const task of colTasks) {
        const card = createTaskCard(task, "kanban");

        card.setAttribute("draggable", "true");

        card.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", String(task.task_id));
          card.classList.add("task-card--dragging");
        });

        card.addEventListener("dragend", () => {
          card.classList.remove("task-card--dragging");
        });

        container.appendChild(card);
      }
  }
}

function renderTaskCards(tasks, projectType, columnIds) {
  for (const status of Object.keys(columnIds)) {
    const container = document.getElementById(columnIds[status]);
    if (!container) continue;

    container.innerHTML = "";

    const colTasks = tasks.filter((task) => task.status === status);

    for (const task of colTasks) {
      const card = createTaskCard(task, projectType);
      card.setAttribute("draggable", "true");
      container.appendChild(card);
    }
  }
}

// ── Blocker banner ────────────────────────────────────
async function refreshBlockerBanner() {
  // TODO: swap back to real API when deploying
}

async function loadTasks() {
  const tasks = await fetchTasks();
  renderBoard(tasks);
  await refreshBlockerBanner();
}

// ── Pair sessions (XP dashboard) ──────────────────────
// Static placeholder cards live in xp.html. When the pairing API lands
// (expected: GET /api/projects/:id/pairs → { pairs: [...] }), call
// window.renderPairs(pairs) to replace the placeholders. Expected pair
// shape: { pair_id, title, is_ai_pair, status_text, driver: { full_name,
// role }, partner: { full_name, role, is_agent } }

/**
 * Returns up to two uppercase initials for a person's display name.
 * @param {string} name - Display name (e.g. "Wayne Dyer").
 * @returns {string} The initials, or "?" when the name is missing.
 */
function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Renders the XP "Pair Programming / Agent Collaboration" cards from API data.
 * No-op when the section is not on the current page or when `pairs` is empty —
 * in that case the static placeholders defined in xp.html remain visible.
 * @param {object[]} pairs - Pair session records.
 * @returns {void}
 */
function renderPairs(pairs) {
  const list = document.getElementById("pair-list");
  if (!list || !Array.isArray(pairs) || pairs.length === 0) return;

  list.innerHTML = pairs
    .map((p) => {
      const isAI = p.is_ai_pair || p.partner?.is_agent;
      const driver = p.driver ?? {};
      const partner = p.partner ?? {};
      const driverName = driver.full_name ?? "—";
      const partnerName = partner.full_name ?? "—";
      const driverRole = driver.role ?? "driving";
      const partnerRole = partner.role ?? (isAI ? "co-pilot" : "navigating");
      const baseTitle = p.title ?? "Pair Session";
      const title = isAI ? `${baseTitle} · Human + AI` : baseTitle;
      const meta = p.status_text ?? "active";

      return `
      <article class="pair-card${isAI ? " pair-card-ai" : ""}" data-pair-id="${p.pair_id ?? ""}">
        <div class="pair-card-header">
          <span class="pair-card-title">${title}</span>
        </div>
        <div class="pair-card-body">
          <div class="pair-member">
            <div class="avatar pair-avatar">${initialsFor(driverName)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${driverName}</p>
              <p class="pair-member-role">${driverRole}</p>
            </div>
          </div>
          <span class="pair-arrow" aria-hidden="true">⇄</span>
          <div class="pair-member">
            <div class="avatar pair-avatar${isAI ? " pair-avatar-ai" : ""}">${isAI ? "AI" : initialsFor(partnerName)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${partnerName}</p>
              <p class="pair-member-role">${partnerRole}</p>
            </div>
          </div>
        </div>
        <div class="pair-card-footer">
          <p class="pair-meta">${meta}</p>
        </div>
      </article>`;
    })
    .join("");
}

// ── Check-ins (XP dashboard) ──────────────────────────
/**
 * Fetches the aggregate dashboard payload (project, members, tasks, blockers,
 * checkins) for the current project. Returns null on network or HTTP error so
 * callers can degrade gracefully.
 * @returns {Promise<object|null>} The dashboard payload, or null on failure.
 */
async function fetchDashboard() {
  try {
    const res = await fetch(`/api/projects/${PROJECT_ID}/dashboard`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Maps a check-in `status_mood` value to its badge CSS class.
 * Unknown values fall back to the neutral default badge.
 * @param {string|null|undefined} statusMood - Raw status mood from the API.
 * @returns {string} The CSS class name (e.g. "checkin-badge-on-track").
 */
function badgeClassFor(statusMood) {
  if (!statusMood) return "checkin-badge-default";
  const slug = String(statusMood).toLowerCase().replace(/\s+/g, "-");
  const known = ["on-track", "blocked", "in-progress", "running", "needs-review"];
  return known.includes(slug) ? `checkin-badge-${slug}` : "checkin-badge-default";
}

/**
 * Formats an ISO date/time string as a short relative duration (e.g. "12m ago").
 * @param {string} dateStr - ISO date string parseable by `Date`.
 * @returns {string} Relative time label, or "" when input is missing/invalid.
 */
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Escapes HTML special characters so user-supplied strings can be safely
 * interpolated into template literals.
 * @param {unknown} s - Value to escape; coerced to string ("" when nullish).
 * @returns {string} HTML-safe text.
 */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders the XP "Rapid Check-ins" list into `#checkin-list`. Each row shows
 * the author (or AI badge), the work-done/planned snippet, a status badge,
 * and a relative timestamp.
 * @param {object[]} entries - Check-in entries from the dashboard payload.
 * @returns {void}
 */
function renderCheckins(entries) {
  const list = document.getElementById("checkin-list");
  if (!list) return;

  if (!Array.isArray(entries) || entries.length === 0) {
    list.innerHTML = `<p class="task-empty">No check-ins yet.</p>`;
    return;
  }

  list.innerHTML = entries
    .map((c) => {
      const isAI = c.source === "agent" || c.user?.is_agent;
      const name = c.user?.full_name ?? "—";
      const headline = c.work_done ?? c.work_planned ?? "(no update)";
      const body = c.work_done && c.work_planned ? c.work_planned : "";
      const status = c.status_mood ?? "";
      const badgeLabel = status || "update";
      const badgeClass = badgeClassFor(status);
      const time = timeAgo(c.checkin_date);

      const leadAvatar = isAI
        ? `<div class="checkin-source">AI</div>`
        : `<div class="avatar checkin-avatar">${initialsFor(name)}</div>`;

      return `
      <div class="checkin-row${isAI ? " checkin-row-ai" : ""}" data-checkin-id="${c.checkin_id ?? ""}">
        ${leadAvatar}
        <div class="checkin-content">
          <p class="checkin-headline">${escapeHtml(headline)}</p>
          ${body ? `<p class="checkin-body">${escapeHtml(body)}</p>` : ""}
        </div>
        <span class="checkin-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        <span class="checkin-time">${time}</span>
      </div>`;
    })
    .join("");
}

/**
 * Fetches the dashboard payload and renders its check-in entries into the
 * XP check-ins section. Shows an empty state when no entries are returned.
 * @returns {Promise<void>}
 */
async function loadCheckins() {
  const data = await fetchDashboard();
  const entries = data?.checkins?.entries ?? [];
  renderCheckins(entries);
}

// ── Blockers (XP dashboard) ───────────────────────────
/**
 * Builds the inner text/HTML for the blocker banner summary line.
 * Mentions the first blocker's reporter and helper (if present) and indicates
 * the total open-blocker count, matching the mockup format:
 *   "Blockers (N) · {reporter} blocked · tagged @{helper}"
 * @param {object[]} blockers - Open blocker records from the dashboard payload.
 * @returns {string} HTML-safe summary markup.
 */
function buildBlockerSummary(blockers) {
  const count = blockers.length;
  const first = blockers[0];
  const reporter = escapeHtml(first?.reported_by?.full_name ?? "Someone");
  const helper = first?.helper ? escapeHtml(first.helper) : null;
  const helperPart = helper ? ` · tagged <span class="blocker-mention">@${helper}</span>` : "";
  return `Blockers (${count}) · ${reporter} blocked${helperPart}`;
}

/**
 * Renders the blocker summary banner above the dashboard. Hides the banner
 * entirely when there are no open blockers.
 * @param {object[]} blockers - Open blocker records from the dashboard payload.
 * @returns {void}
 */
function renderBlockerSummary(blockers) {
  const banner = document.getElementById("blocker-banner");
  const summary = document.getElementById("blocker-summary");
  if (!banner || !summary) return;

  if (!Array.isArray(blockers) || blockers.length === 0) {
    banner.classList.add("hidden");
    summary.innerHTML = "";
    return;
  }

  summary.innerHTML = buildBlockerSummary(blockers);
  banner.classList.remove("hidden");
}

/**
 * Fetches the dashboard payload and renders the blocker summary banner.
 * @returns {Promise<void>}
 */
async function loadBlockers() {
  const data = await fetchDashboard();
  const blockers = data?.open_blockers ?? [];
  renderBlockerSummary(blockers);
}

// Expose to task-form module
window.getProjectMembers = () => projectMembers;
window.createTask = createTask;
window.loadTasks = loadTasks;
window.renderPairs = renderPairs;
window.loadCheckins = loadCheckins;
window.loadBlockers = loadBlockers;

// ── Drop zones (init once) ────────────────────────────
document.querySelectorAll(".kanban-col__cards").forEach((zone) => {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("kanban-col__cards--over");
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("kanban-col__cards--over");
  });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("kanban-col__cards--over");
    const taskId = e.dataTransfer.getData("text/plain");
    const newStatus = zone.closest(".kanban-col")?.dataset.status;
    if (!taskId || !newStatus) return;
    await updateTask(taskId, { status: newStatus });
    loadTasks();
  });
});

// ── Init ──────────────────────────────────────────────
/**
 * Bootstraps the dashboard: warms the member cache, populates the create-task
 * form, loads tasks, and (on XP pages only) loads the check-in feed and the
 * open-blocker summary banner.
 * @returns {Promise<void>}
 */
async function init() {
  projectMembers = await fetchMembers();
  populateCreateFormAssignees();
  await loadTasks();
  if (document.getElementById("checkin-list")) {
    await loadCheckins();
  }
  if (document.getElementById("blocker-banner")) {
    await loadBlockers();
  }
}

init();
