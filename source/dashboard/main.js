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
  });
});

// ── Task API ──────────────────────────────────────────
const PROJECT_ID = 1; // TODO: replace with actual logged-in project context

/**
 * Fetches the list of tasks for the current project.
 * @returns {Promise<object[]>} Array of task records; empty array when none exist.
 */
async function fetchTasks() {
  const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
  const data = await res.json();
  return data.tasks ?? [];
}

/**
 * Fetches the list of members for the current project.
 * @returns {Promise<object[]>} Array of member records ({ user_id, full_name, ... }).
 */
async function fetchMembers() {
  const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
  const data = await res.json();
  return data.members ?? [];
}

/**
 * Creates a new task on the current project.
 * @param {string} title - Task title.
 * @param {number|null} assignedTo - Member user_id to assign, or null/undefined for unassigned.
 * @returns {Promise<object>} The created task record returned by the API.
 */
async function createTask(title, assignedTo) {
  const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, assigned_to: assignedTo || null }),
  });
  return res.json();
}

/**
 * Patches mutable fields on an existing task (status, assignee, etc.).
 * @param {number|string} taskId - Task identifier.
 * @param {object} fields - Partial task fields to update (e.g. { status, assigned_to }).
 * @returns {Promise<object>} The updated task record returned by the API.
 */
async function updateTask(taskId, fields) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return res.json();
}

/**
 * Deletes a task by id.
 * @param {number|string} taskId - Task identifier.
 * @returns {Promise<object>} API response body.
 */
async function deleteTask(taskId) {
  const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  return res.json();
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

// ── Task UI ───────────────────────────────────────────
/**
 * Renders the task list into `#task-list` and wires up its interactive controls
 * (status change, assignee change, delete).
 * @param {object[]} tasks - Task records to render.
 * @returns {void}
 */
function renderTasks(tasks) {
  const list = document.getElementById("task-list");
  if (!list) return;

  if (tasks.length === 0) {
    list.innerHTML = `<p class="task-empty">No tasks yet. Add one above.</p>`;
    return;
  }

  list.innerHTML = tasks
    .map(
      (t) => `
    <div class="task-card" data-task-id="${t.task_id}">
      <span class="task-title">${t.title}</span>
      <div class="task-meta">
        <select class="assignee-select" data-task-id="${t.task_id}">
          ${buildAssigneeOptions(t.user_id)}
        </select>
        <select class="status-select status-${t.status}" data-task-id="${t.task_id}">
          <option value="todo" ${t.status === "todo" ? "selected" : ""}>Todo</option>
          <option value="in-progress" ${t.status === "in-progress" ? "selected" : ""}>In Progress</option>
          <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
        </select>
        <button class="btn-delete" data-task-id="${t.task_id}">Delete</button>
      </div>
    </div>`
    )
    .join("");

  // Status change handler
  list.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const newStatus = e.target.value;
      e.target.className = `status-select status-${newStatus}`;
      await updateTask(taskId, { status: newStatus });
    });
  });

  // Assignee change handler
  list.querySelectorAll(".assignee-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const userId = e.target.value ? Number(e.target.value) : null;
      await updateTask(taskId, { assigned_to: userId });
    });
  });

  // Delete handler
  list.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const taskId = e.target.dataset.taskId;
      await deleteTask(taskId);
      loadTasks();
    });
  });
}

/**
 * Fetches the latest task list from the API and re-renders the UI.
 * @returns {Promise<void>}
 */
async function loadTasks() {
  const tasks = await fetchTasks();
  renderTasks(tasks);
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

// Expose to task-form module
window.getProjectMembers = () => projectMembers;
window.createTask = createTask;
window.loadTasks = loadTasks;
window.renderPairs = renderPairs;
window.loadCheckins = loadCheckins;

// ── Init ──────────────────────────────────────────────
/**
 * Bootstraps the dashboard: warms the member cache, populates the create-task
 * form, loads tasks, and (on XP pages only) loads the check-in feed.
 * @returns {Promise<void>}
 */
async function init() {
  projectMembers = await fetchMembers();
  populateCreateFormAssignees();
  await loadTasks();
  if (document.getElementById("checkin-list")) {
    await loadCheckins();
  }
}

init();
