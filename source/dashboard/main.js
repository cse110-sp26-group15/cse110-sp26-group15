import { createTaskCard, setTaskCardStatus } from "../task-card/task-card.js";
import { renderAgents } from "../agent-card/agent-card.js";
import { openAgentModal, createAgent } from "../agent-card/agent-form.js";
import {
  apiFetch,
  ApiError,
  showLoading,
  hideLoading,
  getCurrentProjectId,
} from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";
import { initLocalPairs, loadPairs } from "./xp-pairs.js";
import { readResolvedBlockerIds } from "../blocker-card/blocker-card.js";

initUserMenu();

// The project the user is currently viewing, chosen at project setup and read
// from localStorage. Falls back to 1 when nothing is stored.
const PROJECT_ID = getCurrentProjectId();

// ── Navigation ────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    const href = item.getAttribute("href");
    // Real links (e.g. ../check-in/check-in.html) navigate normally.
    // Only intercept in-page tabs (href="#").
    if (href && href !== "#") return;

    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

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

function assigneeName(userId) {
  if (!userId) return null;
  const member = projectMembers.find((m) => Number(m.user_id) === Number(userId));
  return member?.full_name ?? null;
}

/**
 * Fetches the list of tasks for the current project.
 * Throws ApiError on failure so the caller can surface a visible error.
 * @returns {Promise<object[]>}
 */
async function fetchTasks() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`);
  return data.tasks ?? [];
}

/**
 * Fetches the list of members for the current project.
 * Throws ApiError on failure.
 * @returns {Promise<object[]>}
 */
async function fetchMembers() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/members`);
  return data.members ?? [];
}

/**
 * Fetches AI agents (and their human owners) for the current project.
 * Best-effort: callers should treat failure as "no agents to show".
 * @returns {Promise<object[]>}
 */
async function fetchAgents() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/agents`);
  return data.agents ?? [];
}

/**
 * Load and render the AI Agents rail on pages that have an #agents-list
 * container (xp.html today). No-op when the container is absent so this
 * function is safe to call on every page main.js drives.
 */
async function loadAgents() {
  const container = document.getElementById("agents-list");
  if (!container) return;
  try {
    projectAgents = await fetchAgents();
  } catch (err) {
    console.warn("[main] fetchAgents failed; rendering empty rail", err);
    projectAgents = [];
  }
  renderAgents(container, projectAgents);
}

/**
 * Creates a new task on the current project.
 * @param {object} data - { title, assigned_to, status, description }
 * @returns {Promise<{ task: object|null }>}
 */
async function createTask(data) {
  const status = data.status ?? "todo";
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status,
    ...(data.reviewer_id != null ? { reviewer_id: data.reviewer_id } : {}),
    ...(data.review_status != null ? { review_status: data.review_status } : {}),
  };

  const { task } = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!task) return { task: null };

  task.user_id = task.assigned_to ?? data.assigned_to ?? null;
  task.full_name = task.full_name ?? assigneeName(task.user_id);
  return { task };
}

/**
 * Patches mutable fields on an existing task (status, assignee, etc.).
 * @param {number|string} taskId
 * @param {object} fields
 * @returns {Promise<object>}
 */
async function updateTask(taskId, fields) {
  return apiFetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

/**
 * Deletes a task by id.
 * @param {number|string} taskId - Task identifier.
 * @returns {Promise<object>} API response body.
 */
// async function deleteTask(taskId) {
//   try {
//     const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
//     if (res.ok) return await res.json();
//   } catch {
//     /* fall through */
//   }
//   return {};
// }

// ── Members cache ─────────────────────────────────────
let projectMembers = [];

// AI agents on this project. Mirrors the projectMembers cache so the
// task-form modal can identify which assignees are agents.
let projectAgents = [];

// Maps a task title → the description of an open blocker filed against it (via
// the daily check-in). Rebuilt each loadTasks; used to show a blocker chip on
// the matching task card. Cards display blockers read-only — they're raised
// and resolved through the check-in flow, not here.
let blockerByTask = new Map();

// Build the title→reason lookup from the open-blocker list. First open blocker
// per task wins (the API returns them most-recent-first).
//
// Blockers the user resolved from the blocker rail are persisted to
// localStorage (by blocker-card.js) but aren't yet reflected by the API, so we
// also skip any blocker whose id is in that resolved set. This keeps the
// "Blocked" chip off a task card after its blocker was resolved on a different
// dashboard type and the user switched here.
function buildBlockerIndex(openBlockers) {
  const map = new Map();
  const resolvedIds = readResolvedBlockerIds();
  for (const b of openBlockers ?? []) {
    if (!b.task) continue; // skip project-wide (general) blockers
    if (resolvedIds.has(b.blocker_id)) continue; // resolved via the blocker rail
    if (!map.has(b.task)) map.set(b.task, b.description || "Blocked");
  }
  return map;
}

// Returns a copy of `task` flagged as blocked when an open blocker targets it;
// otherwise the task unchanged.
function enrichTaskWithBlocker(task) {
  const reason = blockerByTask.get(task.title);
  if (!reason) return task;
  return { ...task, is_blocked: true, blocker_reason: reason };
}

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
let draggingCard = null;

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
      const card = createTaskCard(enrichTaskWithBlocker(task), "kanban", {
        members: projectMembers,
        onChange: async (taskId, fields) => {
          await updateTask(taskId, fields);
          if (fields.status !== undefined) {
            await loadTasks();
          }
        },
      });

      card.setAttribute("draggable", "true");
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(task.task_id));
        card.classList.add("task-card--dragging");
        draggingCard = card;
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("task-card--dragging");
        draggingCard = null;
      });

      container.appendChild(card);
    }
  }
}

// ── Task list (XP dashboard) ──────────────────────────
/**
 * Renders the XP "Assigned Tasks" list into `#task-list` using the shared
 * task-card component with `projectType = "xp"`. Shows XP-specific fields
 * (hour estimate in the banner, pair avatar when `pair_assignee` is set).
 * Replaces the list contents on every call; no-op when the container is absent.
 * @param {object[]} tasks - Task records from {@link fetchTasks}.
 * @returns {void}
 */
function renderTaskList(tasks) {
  const list = document.getElementById("task-list");
  if (!list) return;

  // Each page declares its card variant via `data-card-variant` on #task-list
  // (xp.html → "xp"; main.html → "kanban"). Defaults to the base kanban card.
  const variant = list.dataset.cardVariant || "kanban";

  list.innerHTML = "";

  if (tasks.length === 0) {
    list.innerHTML = `<p class="task-empty">No tasks yet.</p>`;
    return;
  }

  for (const task of tasks) {
    const card = createTaskCard(enrichTaskWithBlocker(task), variant, {
      members: projectMembers,
      editPair: false,
      onChange: async (taskId, fields) => {
        await updateTask(taskId, fields);
        if (fields.status !== undefined) {
          await loadTasks();
        }
      },
    });
    list.appendChild(card);
  }
}

// ── Blocker banner ────────────────────────────────────
async function refreshBlockerBanner() {
  if (document.getElementById("blocker-banner")) {
    await loadBlockers();
  }
}

// Paint a visible error so the task panels never stay on "Loading…".
function renderTasksLoadError(message) {
  const safe = String(message ?? "").replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]
  );
  const html = `<p class="task-empty task-error">⚠ ${safe}</p>`;
  const list = document.getElementById("task-list");
  if (list) list.innerHTML = html;
  for (const status of ["todo", "in-progress", "done"]) {
    const container = document.getElementById(`cards-${status}`);
    if (container) container.innerHTML = html;
  }
}

async function loadTasks() {
  let tasks;
  try {
    tasks = await fetchTasks();
  } catch (err) {
    const reason =
      err instanceof ApiError && err.status > 0
        ? `Failed to load tasks (${err.status}): ${err.message}`
        : `Failed to load tasks: ${err?.message ?? "network error"}`;
    renderTasksLoadError(reason);
    console.error("[main] loadTasks failed", err);
    return;
  }

  // Pull open blockers so cards can show a chip when a check-in flagged the
  // task as blocked. Best-effort: a blocker-fetch failure must not blank the
  // board, so we log it and render tasks without chips.
  try {
    const data = await fetchDashboard();
    blockerByTask = buildBlockerIndex(data?.open_blockers ?? []);
  } catch (err) {
    console.error("[main] loadTasks: blocker fetch failed", err);
    blockerByTask = new Map();
  }

  renderBoard(tasks);
  renderTaskList(tasks);
  await refreshBlockerBanner();
}

// ── Pair sessions (XP dashboard) ──────────────────────
// When the pairing API lands (expected: GET /api/projects/:id/pairs →
// { pairs: [...] }), call window.renderPairs(pairs). Expected pair shape:
// { pair_id, title, is_ai_pair, status_text, driver: { full_name, role },
// partner: { full_name, role, is_agent } }

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
 * Shows an empty state when `pairs` is empty or missing.
 * @param {object[]} pairs - Pair session records.
 * @returns {void}
 */
function renderPairs(pairs) {
  const list = document.getElementById("pair-list");
  if (!list) return;

  if (!Array.isArray(pairs) || pairs.length === 0) {
    list.innerHTML = `<p class="task-empty">No pair sessions yet.</p>`;
    return;
  }

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
 * checkins) for the current project. Throws ApiError on failure so callers
 * can surface a visible error state.
 * @returns {Promise<object>}
 */
async function fetchDashboard() {
  return apiFetch(`/api/projects/${PROJECT_ID}/dashboard`);
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
  const list = document.getElementById("checkin-list");
  try {
    const data = await fetchDashboard();
    const entries = data?.checkins?.entries ?? [];
    renderCheckins(entries);
  } catch (err) {
    console.error("[main] loadCheckins failed", err);
    if (list) {
      const msg = err instanceof ApiError ? err.message : "network error";
      list.innerHTML = `<p class="task-empty task-error">⚠ Failed to load check-ins: ${escapeHtml(msg)}</p>`;
    }
  }
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
  try {
    const data = await fetchDashboard();
    const blockers = data?.open_blockers ?? [];
    renderBlockerSummary(blockers);
  } catch (err) {
    console.error("[main] loadBlockers failed", err);
    // Don't show a banner error — the banner is hidden by default, and
    // surfacing a blocker-load failure in a banner that says "Blockers"
    // would be confusing. Silent log is the right call here.
    renderBlockerSummary([]);
  }
}

// Expose to task-form module
window.getProjectMembers = () => projectMembers;
window.getProjectAgents = () => projectAgents;
window.createTask = createTask;
window.loadTasks = loadTasks;
window.renderPairs = renderPairs;
window.loadCheckins = loadCheckins;
window.loadBlockers = loadBlockers;
window.loadAgents = loadAgents;

function moveCardTo(card, destZone, srcZone, srcStatus, destStatus) {
  destZone.querySelector(".kanban-col__empty")?.remove();
  destZone.appendChild(card);
  setTaskCardStatus(card, destStatus); // ← new line
  if (srcZone.children.length === 0) {
    srcZone.innerHTML = `<p class="kanban-col__empty">No tasks yet</p>`;
  }
  const srcCount = document.getElementById(`count-${srcStatus}`);
  const destCount = document.getElementById(`count-${destStatus}`);
  if (srcCount) srcCount.textContent = String(Number(srcCount.textContent || "0") - 1);
  if (destCount) destCount.textContent = String(Number(destCount.textContent || "0") + 1);
}

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
    if (!taskId || !newStatus || !draggingCard) return;

    const card = draggingCard;
    const oldZone = card.parentElement;
    const oldStatus = oldZone?.closest(".kanban-col")?.dataset.status;
    if (!oldZone || !oldStatus || oldStatus === newStatus) return;

    moveCardTo(card, zone, oldZone, oldStatus, newStatus);

    try {
      const result = await updateTask(taskId, { status: newStatus });
      if (!result?.task) throw new Error("update failed");
    } catch {
      moveCardTo(card, oldZone, zone, newStatus, oldStatus);
    }
  });
});

// ── Init ──────────────────────────────────────────────
/**
 * Bootstraps the dashboard: warms the member cache, populates the create-task
 * form, loads tasks, and (on XP pages only) loads the check-in feed and the
 * open-blocker summary banner.
 * @returns {Promise<void>}
 */
async function initImpl() {
  try {
    projectMembers = await fetchMembers();
  } catch (err) {
    console.error("[main] fetchMembers failed during init", err);
    projectMembers = [];
  }
  populateCreateFormAssignees();
  await loadTasks();
  if (document.getElementById("checkin-list")) {
    await loadCheckins();
  }
  if (document.getElementById("blocker-banner")) {
    await loadBlockers();
  }
  if (document.getElementById("pair-list")) {
    initLocalPairs();
    await loadPairs();
  }
  // No-op on pages without an #agents-list container.
  await loadAgents();

  // "+ Add Agent" button in the AI Agents rail header (xp dashboard).
  // On other pages without the button this is a no-op. Bound here in
  // init() so projectMembers is already cached. The onSubmit refreshes
  // members + agents but does NOT re-call init() — that would re-bind
  // this same listener and stack duplicates.
  document.getElementById("add-agent-btn")?.addEventListener("click", () => {
    openAgentModal({
      members: projectMembers,
      onSubmit: async (data) => {
        await createAgent(PROJECT_ID, data);
        try {
          projectMembers = await fetchMembers();
        } catch (err) {
          console.warn("[main] re-fetch members after agent create failed", err);
        }
        populateCreateFormAssignees();
        await loadAgents();
      },
    });
  });
}

// Public entry point — shows a loading overlay over the content area
// while the initial data (members, tasks, board) loads, then removes it.
async function init() {
  showLoading();
  try {
    await initImpl();
  } finally {
    hideLoading();
  }
}

init();
