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
// All data loads go through {@link apiFetch} (10s timeout, throws on
// non-2xx) — when a call fails the matching renderer paints a visible
// error state instead of an empty panel. Pure helper functions
// (computeDayOfSprint, computeSprintProgress, etc.) are exported so
// tests can exercise them without a DOM.

import { createTaskCard } from "../task-card/task-card.js";
import { renderAgents } from "../agent-card/agent-card.js";
import { openAgentModal, createAgent } from "../agent-card/agent-form.js";
import {
  apiFetch,
  ApiError,
  showLoading,
  hideLoading,
  getCurrentProject,
} from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";
import { readResolvedBlockerIds } from "../blocker-card/blocker-card.js";
import { renderTeamPanel } from "../shared/team-panel.js";

initUserMenu();

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
export const PROJECT_ID = getCurrentProject()?.project_id ?? 1;

// localStorage key for the sprint picker selection. Namespaced by
// project so multiple projects can each remember their own sprint.
// (This is a UI preference, not data — we keep it in localStorage on
// purpose so the user's last-picked sprint survives reloads.)
const SPRINT_STORAGE_KEY = `sitrep.scrum.sprint.project-${PROJECT_ID}`;

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
 * Classify how a sprint is tracking by comparing weighted work completed
 * against time spent, using the Weighted Sprint Health Score:
 *
 *   D = % of tasks Done
 *   P = % of tasks In Progress
 *   T = % of sprint time elapsed = (day / total) × 100
 *   Weighted Completion = D + (0.5 × P)
 *   Sprint Health Score = Weighted Completion / T
 *
 * In-progress tasks count as half-done, so a sprint with work underway
 * scores higher than one that hasn't started. A score above 1 means more
 * of the (weighted) work is done than time has passed (ahead); below 1
 * means the sprint is lagging the clock (behind).
 *
 *   • score > 1.20          → "ahead"
 *   • 0.80 ≤ score ≤ 1.20   → "on track"
 *   • score < 0.80          → "behind"
 *
 * @param {number} pctDone  D: percentage of tasks done (0–100).
 * @param {number} pctInProgress  P: percentage of tasks in progress (0–100).
 * @param {{day: number, total: number}|null} dayInfo  Output of computeDayOfSprint.
 * @returns {{label: string, cls: string, score: number}|null}
 *   null when health can't be computed (no valid date range, or no time
 *   has elapsed yet so the ratio would divide by zero).
 */
export function computeSprintHealth(pctDone, pctInProgress, dayInfo) {
  if (!dayInfo || dayInfo.total <= 0) return null;
  // T: percentage of the sprint's time that has elapsed.
  const pctTimeElapsed = (dayInfo.day / dayInfo.total) * 100;
  if (pctTimeElapsed <= 0) return null;

  // Weighted Completion = D + (0.5 × P): done tasks count fully, in-progress
  // tasks count half.
  const weightedCompletion = pctDone + 0.5 * pctInProgress;
  const score = weightedCompletion / pctTimeElapsed;
  if (score > 1.2) return { label: "ahead", cls: "progress-status--ahead", score };
  if (score < 0.8) return { label: "behind", cls: "progress-status--behind", score };
  return { label: "on track", cls: "progress-status--on-track", score };
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

// Real sprint_id of the current sprint, when the API knows one. Used to wire
// the create-modal's sprint dropdown. Null until /sprints/current returns a
// row (localStorage picks carry only a number, never a sprint_id).
let currentSprintId = null;

// Maps a task title → the description of an open blocker filed against it (via
// the daily check-in). Rebuilt each loadAll; used to show a blocker chip on
// the matching task card. Blockers are read-only here — they're raised and
// resolved through the check-in flow, not the cards.
let blockerByTask = new Map();

// Build the title→reason lookup from the open-blocker list. First (most
// recent, since the API sorts DESC) open blocker per task wins.
//
// Blockers the user resolved from the blocker rail are persisted to
// localStorage (by blocker-card.js) but aren't yet reflected by the API, so we
// also skip any blocker whose id is in that resolved set. This keeps the
// "Blocked" chip off a task card after its blocker was resolved on a different
// dashboard type and the user switched back here.
function buildBlockerIndex(blockers) {
  const map = new Map();
  const resolvedIds = readResolvedBlockerIds();
  for (const b of blockers ?? []) {
    if (b.is_resolved || resolvedIds.has(b.blocker_id) || !b.task) continue;
    if (!map.has(b.task)) map.set(b.task, b.description || "Blocked");
  }
  return map;
}

// "list" or "kanban" — controls which view of Sprint Tasks is visible.
let viewMode = "list";

// Cache of the most recently-fetched task list, so the kanban view can
// re-render after a status change without an extra round trip.
let currentTasks = [];

// Cache of the most recently-fetched check-ins plus whether the Daily Standup
// grid is currently showing history (past days) rather than today. Both back
// the "View history" toggle (toggleCheckinHistory).
let checkinsCache = [];
let showingCheckinHistory = false;

// Cache of project members — populated by fetchMembers() during loadAll
// and exposed to the task-form modal via `window.getProjectMembers` so
// the assignee dropdown can be populated.
let projectMembers = [];

// Cache of AI agents on this project. Exposed via window.getProjectAgents
// so the task-form modal can identify which assignees are agents and
// auto-enforce the reviewer-required rule on the client side.
let projectAgents = [];

// ── API calls ────────────────────────────────────────
// All requests go through apiFetch (10s timeout, throws ApiError on
// non-2xx). loadAll() catches once at the top so a single failure
// surfaces as an inline error in the relevant panel rather than a
// half-rendered dashboard.

async function fetchTasks() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`);
  return data.tasks ?? [];
}

/**
 * Create a task. `data` is whatever openTaskModal hands back:
 *   { title, description, assigned_to, status }
 *
 * `forceStatus` overrides whatever status the modal returned — used by
 * kanban-column + buttons so the task always lands in the right column.
 *
 * New tasks automatically join the currently-active sprint — there's no
 * manual sprint picker, since a task created "now" belongs to "now"'s sprint.
 */
async function createTask(data, { forceStatus } = {}) {
  const status = forceStatus ?? data.status ?? "todo";
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status,
    // reviewer_id + review_status only flow through when the task-form
    // modal sets them (agent-assigned tasks). Server enforces the rule
    // either way; we just avoid sending null spam for human tasks.
    ...(data.reviewer_id != null ? { reviewer_id: data.reviewer_id } : {}),
    ...(data.review_status != null ? { review_status: data.review_status } : {}),
    // Auto-assign to the active sprint. TODO(sprint-persistence): the tasks
    // table has no sprint_id column yet, so the API silently drops this. Once
    // the migration + API land, this will actually link the task to a sprint.
    sprint_id: currentSprintId,
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

async function fetchCheckins() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/checkins`);
  return data.checkins ?? [];
}

async function fetchBlockers() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/blockers`);
  return (data.blockers ?? []).map((b) => ({
    blocker_id: b.blocker_id,
    description: b.description,
    // The task title this blocker is filed against (null = project-wide).
    // Used to show a blocker chip on the matching task card.
    task: b.task ?? null,
    tag: b.helper || null,
    full_name: b.reported_by || b.full_name || "",
    is_resolved: Boolean(b.is_resolved),
  }));
}

async function fetchSprint() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/sprints/current`);
  return data.sprint ?? null;
}

async function fetchMembers() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/members`);
  return data.members ?? [];
}

async function fetchAgents() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/agents`);
  return data.agents ?? [];
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

  const dayInfo = computeDayOfSprint(sprintState.start_date, sprintState.end_date);

  // Once the sprint's end date is before the current day, the running
  // "Day X of Y" count no longer makes sense — show "Sprint N has ended"
  // instead. Otherwise show "Day X of Y" while a valid range is configured,
  // and hide the badge when no range is set so it doesn't show a stale value.
  const endDate = parseISODate(sprintState.end_date);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (endDate && endDate < startOfToday) {
    badge.hidden = false;
    badge.textContent = sprintState.number
      ? `Sprint ${sprintState.number} has ended`
      : "Sprint has ended";
  } else if (dayInfo) {
    badge.hidden = false;
    badge.textContent = `Day ${dayInfo.day} of ${dayInfo.total}`;
  } else {
    badge.hidden = true;
    badge.textContent = "";
  }

  // Label + color the status from the Weighted Sprint Health Score (ahead /
  // on track / behind). Clear any previous health class first so re-renders
  // don't stack them, then apply the one matching the current score.
  statusEl.classList.remove(
    "progress-status--ahead",
    "progress-status--on-track",
    "progress-status--behind"
  );
  // P: percentage of tasks currently in progress, used for the weighted score.
  const inProgress = tasks.filter((t) => t.status === "in-progress").length;
  const pctInProgress = total === 0 ? 0 : (inProgress / total) * 100;
  const health = computeSprintHealth(pct, pctInProgress, dayInfo);
  if (pct >= 100) {
    // Sprint is complete — show no status at all.
    statusEl.textContent = "";
  } else if (health) {
    statusEl.textContent = health.label;
    statusEl.classList.add(health.cls);
  } else {
    statusEl.textContent = "on track";
  }
}

// ── Check-in cards ───────────────────────────────────
// Decide whether a check-in belongs to "today" in the viewer's local
// timezone. Date-only strings ("YYYY-MM-DD") are read at local midnight;
// full ISO timestamps are read as-is. A check-in with no date is treated
// as today (the API defaults the column to the current date on insert).
function isCheckinToday(checkin, now = new Date()) {
  const raw = checkin.checkin_date;
  if (!raw) return true;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseISODate(raw) : new Date(raw);
  if (!d || Number.isNaN(d.getTime())) return true;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// Build the HTML for a single check-in card.
function buildCheckinCardHtml(c) {
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
}

// Render the Daily Standup grid. Only today's check-ins are shown here;
// members who haven't checked in today get an "is-empty" placeholder card.
// Past days are reachable through the "View history" link (toggleCheckinHistory).
function renderCheckins(checkins, members) {
  const grid = document.getElementById("checkin-grid");
  if (!grid) return;

  const todays = checkins.filter((c) => isCheckinToday(c));
  const checkedInUserIds = new Set(todays.map((c) => c.user_id));

  const checkinCards = todays.map(buildCheckinCardHtml).join("");

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

  if (!todays.length && !members.length) {
    grid.innerHTML = `<p class="muted-small">No check-ins for today yet.</p>`;
    return;
  }
  grid.innerHTML = checkinCards + missing;
}

// Keep the "View history" link's empty-state in sync with the cache. When the
// grid is showing today and there are no past check-ins, mark the link inert so
// it surfaces a hover tooltip ("No previous check-ins to display.", styled in
// scrum.css) instead of toggling. Any other state clears the marker so the link
// behaves as a normal toggle.
function updateHistoryLinkState() {
  const link = document.getElementById("checkin-history-link");
  if (!link) return;
  const hasPast = checkinsCache.some((c) => !isCheckinToday(c));
  const inert = !showingCheckinHistory && !hasPast;
  link.classList.toggle("panel-link--no-history", inert);
  link.setAttribute("aria-disabled", inert ? "true" : "false");
}

// Toggle the Daily Standup grid between today's check-ins and the history of
// past days. When there are no past days to show, clicking is a no-op — the
// "View history" link instead reveals a hover tooltip (see updateHistoryLinkState).
function toggleCheckinHistory() {
  const grid = document.getElementById("checkin-grid");
  const link = document.getElementById("checkin-history-link");
  if (!grid) return;

  if (!showingCheckinHistory) {
    const past = checkinsCache.filter((c) => !isCheckinToday(c));
    // Nothing to show — do nothing; the hover tooltip explains why.
    if (past.length === 0) return;
    showingCheckinHistory = true;
    if (link) link.textContent = "View today";
    grid.innerHTML = past.map(buildCheckinCardHtml).join("");
  } else {
    showingCheckinHistory = false;
    if (link) link.textContent = "View history";
    renderCheckins(checkinsCache, projectMembers);
  }
  updateHistoryLinkState();
}

// ── Task rendering helpers (shared by list + kanban) ──
// onChange handler for the shared task-card's interactive controls. The card
// can edit priority, story points, tags, blocker, assignee and status inline,
// but only assigned_to + status have backend persistence right now — the rest
// update locally and are intentionally not PATCHed. Blocker persistence is
// owned by another branch, so we leave is_blocked/blocker_reason untouched too.
async function persistTaskChange(taskId, fields) {
  const payload = {};
  if ("assigned_to" in fields) payload.assigned_to = fields.assigned_to;
  if ("status" in fields) payload.status = fields.status;
  if (Object.keys(payload).length === 0) return;

  try {
    await updateTask(taskId, payload);
    await loadAll();
  } catch (err) {
    console.error("[scrum] task-card change failed", err);
    alert(`Couldn't update task: ${err.message}`);
    await loadAll();
  }
}

// Adds the page-specific delete button in a row below the task-card. Assignee
// and status editing now come from the shared component's interactive mode;
// the component intentionally doesn't provide a delete button, so we add it.
function appendTaskControls(card, task) {
  const row = document.createElement("div");
  row.className = "task-card-row-delete";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn task-card-delete";
  deleteBtn.dataset.taskId = task.task_id;
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    try {
      await deleteTask(task.task_id);
      await loadAll();
    } catch (err) {
      console.error("[scrum] deleteTask failed", err);
      alert(`Couldn't delete task: ${err.message}`);
    }
  });

  row.appendChild(deleteBtn);
  card.appendChild(row);
}

// Build a task-card element for the list view (uses scrum-style card).
function buildTaskCard(task, { compact = false } = {}) {
  // Mix in the active sprint number so the card banner reads
  // "Urgent · Sprint 3" the way the task-card scrum variant expects.
  const blockerReason = blockerByTask.get(task.title);
  const enriched = {
    ...task,
    // The card's assignee dropdown keys off assigned_to; scrum rows carry the
    // assignee as user_id, so mirror it across for correct pre-selection.
    assigned_to: task.assigned_to ?? task.user_id ?? null,
    sprint: sprintState.number ? `Sprint ${sprintState.number}` : task.sprint,
    // Surface an open check-in blocker (if any) as the card's blocker chip.
    ...(blockerReason ? { is_blocked: true, blocker_reason: blockerReason } : null),
  };
  const card = createTaskCard(enriched, "scrum", {
    compact,
    members: projectMembers,
    onChange: persistTaskChange,
  });
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
    addBtn.className = "kanban-column-add btn btn--primary";
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
    try {
      await createTask(data, { forceStatus: lockedStatus });
      await loadAll();
    } catch (err) {
      console.error("[scrum] createTask failed", err);
      alert(`Couldn't create task: ${err.message}`);
    }
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

// Paint a visible error state across every panel so failures are loud,
// not silent. Caller passes the message to surface.
function renderLoadError(message) {
  for (const id of ["task-list", "kanban-board", "checkin-grid", "blockers-list", "agents-list"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<p class="task-empty task-error">⚠ ${escapeHtml(message)}</p>`;
  }
  const meta = document.getElementById("sprint-meta");
  if (meta) meta.textContent = "Sprint data unavailable";
}

// ── Load + render orchestration ──────────────────────
// Public entry point. The first load (from init) passes showSpinner so a
// loading overlay covers the content area until data arrives; refreshes
// after create/update call loadAll() with no arg and update silently.
async function loadAll(showSpinner = false) {
  if (showSpinner) showLoading();
  try {
    await loadAllImpl();
  } finally {
    if (showSpinner) hideLoading();
  }
}

async function loadAllImpl() {
  let tasks, checkins, blockers, apiSprint, apiMembers, apiAgents;
  try {
    [tasks, checkins, blockers, apiSprint, apiMembers, apiAgents] = await Promise.all([
      fetchTasks(),
      fetchCheckins(),
      fetchBlockers(),
      fetchSprint(),
      fetchMembers(),
      // The agents endpoint is best-effort — a missing/empty response
      // shouldn't blow up the dashboard. Catch + log so the rest of
      // loadAll() proceeds even when agents 500s.
      fetchAgents().catch((err) => {
        console.warn("[scrum] fetchAgents failed; rendering empty agents rail", err);
        return [];
      }),
    ]);
  } catch (err) {
    const reason =
      err instanceof ApiError && err.status > 0
        ? `Failed to load dashboard (${err.status}): ${err.message}`
        : `Failed to load dashboard: ${err?.message ?? "network error"}`;
    renderLoadError(reason);
    console.error("[scrum] loadAll failed", err);
    return;
  }

  // If /members returned something, trust it; otherwise reverse-engineer
  // members from rows that include user info (legacy / partial APIs).
  // Either way, cache the result so the create modal's assignee dropdown
  // can populate (it reads via window.getProjectMembers).
  projectMembers = apiMembers.length ? apiMembers : deriveMembers(tasks, checkins);
  projectAgents = apiAgents;

  // If the user hasn't set a sprint yet, prefer whatever the API knows;
  // user-saved values always win once they exist.
  if (apiSprint && sprintState.number === null) {
    sprintState = {
      number: apiSprint.number ?? null,
      start_date: apiSprint.start_date ?? null,
      end_date: apiSprint.end_date ?? null,
    };
  }

  // Remember the real sprint_id so the create-modal dropdown can send it.
  currentSprintId = apiSprint?.sprint_id ?? currentSprintId;

  // Index open blockers by task title so cards can show a blocker chip.
  blockerByTask = buildBlockerIndex(blockers);

  // Cache check-ins and reset the Daily Standup grid to today's view; the
  // "View history" toggle reads this cache to show past days on demand.
  checkinsCache = checkins;
  showingCheckinHistory = false;
  const historyLink = document.getElementById("checkin-history-link");
  if (historyLink) historyLink.textContent = "View history";
  // Refresh the "View history" empty-state (hover tooltip vs. active toggle).
  updateHistoryLinkState();

  renderSprintHeader(checkins);
  renderSprintProgress(tasks);
  renderCheckins(checkins, projectMembers);
  renderTasks(tasks);
  renderAgents(document.getElementById("agents-list"), projectAgents);
  renderAgentContributionsMeta(projectAgents, tasks);
}

/**
 * Paint a one-liner above the agents grid: "N agents · X tasks completed".
 * Lets the team see at-a-glance whether agents are pulling their weight
 * without a full weekly report. Numbers are derived client-side from the
 * payload we already have so no extra request is needed.
 *
 * @param {object[]} agents
 * @param {object[]} tasks
 */
function renderAgentContributionsMeta(agents, tasks) {
  const meta = document.getElementById("agent-contributions-meta");
  if (!meta) return;
  if (!agents.length) {
    meta.textContent = "";
    return;
  }
  const agentIds = new Set(agents.map((a) => a.user_id));
  const completed = tasks.filter((t) => agentIds.has(t.user_id) && t.status === "done").length;
  const pendingReview = tasks.filter(
    (t) => agentIds.has(t.user_id) && t.review_status === "pending"
  ).length;
  const parts = [`${agents.length} agent${agents.length === 1 ? "" : "s"}`];
  parts.push(`${completed} task${completed === 1 ? "" : "s"} done`);
  if (pendingReview > 0) parts.push(`${pendingReview} pending review`);
  meta.textContent = parts.join(" · ");
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

// ── In-page tab switching ────────────────────────────
// Sidebar tabs whose target page isn't built yet (Team, Weekly Report)
// land here. We hide the real dashboard view and reveal a lazy-rendered
// placeholder so the click clearly does something. Maps a nav item's
// `data-nav` slug → { id, subtitle }; missing entries fall back to the
// dashboard view (so "Dashboard" click still works if it ever loses its
// real href).
const TAB_VIEWS = {
  dashboard: { id: "dashboard-view", subtitle: null },
  team: { id: "team-view", subtitle: "Team roster and roles" },
  "weekly-report": { id: "weekly-report-view", subtitle: "Sprint summary report" },
};

function switchView(navSlug, label) {
  const target = TAB_VIEWS[navSlug] ?? TAB_VIEWS.dashboard;
  const root = document.getElementById("page-content");
  if (!root) return;

  root.querySelectorAll(".page-view").forEach((v) => v.classList.add("hidden"));

  let view = document.getElementById(target.id);
  if (!view) {
    view = document.createElement("div");
    view.id = target.id;
    view.className = "page-view placeholder";
    view.innerHTML = `<p>${escapeHtml(label)}</p><span>${escapeHtml(target.subtitle ?? "Coming soon")}</span>`;
    root.appendChild(view);
  }

  if (navSlug === "team") {
    renderTeamPanel(view, { projectId: PROJECT_ID });
  }

  view.classList.remove("hidden");
}

// ── Init (DOM-only) ──────────────────────────────────
// Skip everything below when there's no document — lets the test suite
// import this module purely for the helpers above.
function init() {
  // Restore sprint state from localStorage (if anything is saved).
  const stored = readSprintFromStorage();
  if (stored) sprintState = stored;

  // ── Sidebar nav ────────────────────────────────────
  // Real `href`s do the navigation (e.g. My Check-ins → check-in.html).
  // In-page tabs (href="#") swap the visible .page-view to a placeholder
  // so the user sees the click took effect — full pages for Team /
  // Weekly Report aren't built yet.
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      const href = item.getAttribute("href");
      const isInPage = !href || href === "#";

      if (isInPage) {
        e.preventDefault();
        switchView(item.dataset.nav, item.textContent.trim());
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

  // ── Add-agent button (opens agent-form modal) ──────
  // Members are filtered to non-agents inside openAgentModal — we pass
  // the full cached list. createAgent posts to the API; on success we
  // reload everything so the new agent shows in the rail + the
  // assignee/owner pickers.
  document.getElementById("add-agent-btn")?.addEventListener("click", () => {
    openAgentModal({
      members: projectMembers,
      onSubmit: async (data) => {
        await createAgent(PROJECT_ID, data);
        await loadAll();
      },
    });
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
    // The task-form modal also needs to know which members are AI agents
    // so it can auto-default + require a reviewer when one is selected.
    window.getProjectAgents = () => projectAgents;
  }

  // ── Daily Standup "View history" toggle ────────────
  // Swaps the standup grid between today's check-ins and past days.
  document.getElementById("checkin-history-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleCheckinHistory();
  });

  // ── Check-in button ────────────────────────────────
  // Sends the user to the dedicated check-in page (source/check-in), which
  // hosts the daily stand-up form. Same destination as the "My Check-ins"
  // sidebar link, so both entry points land on the same flow.
  document.getElementById("checkin-today-btn")?.addEventListener("click", () => {
    window.location.href = "../check-in/check-in.html";
  });

  // Apply the saved view mode (defaults to "list") and kick off the
  // first load (with a loading overlay).
  setViewMode(viewMode);
  loadAll(true);
}

if (typeof document !== "undefined") {
  // Modules are deferred by default, so the DOM is parsed by the time
  // we get here; no DOMContentLoaded listener required.
  init();
}
