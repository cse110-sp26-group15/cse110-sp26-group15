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
  getCurrentProjectId,
} from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";
import { readResolvedBlockerIds } from "../blocker-card/blocker-card.js";
import { renderTeamPanel } from "../shared/team-panel.js";

initUserMenu();

// task-form.js adds a top-level document listener, so it's dynamic-imported
// (not static) to keep the node-side tests from crashing. Cached so repeated
// opens reuse the same module instance.
let taskFormModulePromise = null;
function loadTaskFormModule() {
  if (!taskFormModulePromise) {
    taskFormModulePromise = import("../task-form/task-form.js");
  }
  return taskFormModulePromise;
}

// ── Constants ────────────────────────────────────────
// The project the user is currently viewing, chosen at project setup and read
// from localStorage. Falls back to 1 when nothing is stored (e.g. direct
// navigation, or the unit suite running under Node with no localStorage).
export const PROJECT_ID = getCurrentProjectId();

// localStorage key for the picked sprint, namespaced per project so the
// last-picked sprint survives reloads.
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

/** Format a Date as a local YYYY-MM-DD string. */
function formatISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today as a local YYYY-MM-DD string. Gates the sprint picker's date inputs. */
export function todayISODate() {
  return formatISODate(new Date());
}

/**
 * Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD (or null if invalid).
 * Used to suggest a default 1-week range for a new sprint.
 */
export function addDaysISO(iso, days) {
  const date = parseISODate(iso);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

/**
 * True when a sprint is currently running. Used to lock the "New sprint" action
 * so a fresh sprint can't be started mid-sprint (one sprint at a time).
 *
 * A sprint counts as "in progress" when it's configured (has a start date or a
 * number) and hasn't ended yet — i.e. it has no end date (open-ended sprint) or
 * its end date is today or later. Returns false when there's no sprint at all
 * or the sprint's end date has already passed, so a new sprint can be started.
 */
export function isSprintInProgress(sprint) {
  if (!sprint) return false;
  // Nothing configured yet → not in progress.
  if (!sprint.start_date && !sprint.number) return false;
  const end = parseISODate(sprint.end_date);
  // Configured but no (valid) end date → treat as still running.
  if (!end) return true;
  // Otherwise it runs until the end date passes.
  return end >= parseISODate(todayISODate());
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
// Currently-shown sprint (number + date range); loaded from localStorage on
// init, overwritten when the user saves the picker.
let sprintState = { number: null, start_date: null, end_date: null };

// Real sprint_id from /sprints/current (localStorage picks carry only a
// number). Used to wire the create-modal's sprint dropdown.
let currentSprintId = null;

// task title → open-blocker description, for the "Blocked" chip on task cards.
// Read-only here; blockers are raised/resolved through the check-in flow.
let blockerByTask = new Map();

// Build the title→reason lookup; first open blocker per task wins (API sorts
// DESC). Skips blockers resolved from the rail (persisted to localStorage by
// blocker-card.js but not yet reflected by the API) so the chip stays off.
function buildBlockerIndex(blockers) {
  const map = new Map();
  const resolvedIds = readResolvedBlockerIds();
  for (const b of blockers ?? []) {
    if (b.is_resolved || resolvedIds.has(b.blocker_id) || !b.task) continue;
    if (!map.has(b.task)) map.set(b.task, b.description || "Blocked");
  }
  return map;
}

// "list" or "kanban" — which Sprint Tasks view is visible.
let viewMode = "list";

// Last-fetched tasks, so the kanban view can re-render without a round trip.
let currentTasks = [];

// Last-fetched check-ins + whether the standup grid is showing history; both
// back the "View history" toggle.
let checkinsCache = [];
let showingCheckinHistory = false;

// Last-fetched open blockers, so the check-in modal can show a check-in's
// blocker(s) (matched by checkin_id).
let blockersCache = [];

// Project members, exposed to the task-form modal via window.getProjectMembers
// for the assignee dropdown.
let projectMembers = [];

// AI agents on this project, exposed via window.getProjectAgents so the
// task-form modal can require a reviewer when an agent is assigned.
let projectAgents = [];

// ── API calls ────────────────────────────────────────
// All requests go through apiFetch (10s timeout, throws ApiError on non-2xx);
// loadAll() catches once at the top and shows an inline error.

async function fetchTasks() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`);
  return data.tasks ?? [];
}

/**
 * Create a task from the openTaskModal payload. `forceStatus` overrides the
 * modal's status (used by the kanban column + buttons).
 */
async function createTask(data, { forceStatus } = {}) {
  const status = forceStatus ?? data.status ?? "todo";
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status,
    priority: data.priority ?? "medium",
    // reviewer_id + review_status only flow through when the task-form
    // modal sets them (agent-assigned tasks). Server enforces the rule
    // either way; we just avoid sending null spam for human tasks.
    ...(data.reviewer_id != null ? { reviewer_id: data.reviewer_id } : {}),
    ...(data.review_status != null ? { review_status: data.review_status } : {}),
    // TODO(sprint-persistence): tasks have no sprint_id column yet, so the API
    // currently drops this.
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
    task: b.task ?? null, // null = project-wide; drives the task-card chip
    tag: b.helper || null,
    checkin_id: b.checkin_id ?? null, // links the blocker to its check-in
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
  // Keep the progressbar's accessible value in sync with the visual fill.
  fill.parentElement?.setAttribute("aria-valuenow", String(pct));
  // At 100% the bar turns green to signal the sprint is fully complete.
  fill.classList.toggle("progress-bar-fill--complete", pct >= 100);
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

// Open blockers raised from a given check-in (matched by checkin_id). Single
// source of truth so the card's "view blocker" button and the modal's blocker
// section always agree — driving them off different signals (mood vs. blocker
// data) is what let a "view update" card still show a blocker in the modal.
function blockersForCheckin(checkinId) {
  return blockersCache.filter(
    (b) => !b.is_resolved && b.checkin_id != null && String(b.checkin_id) === String(checkinId)
  );
}

// Build the HTML for a single check-in card.
function buildCheckinCardHtml(c) {
  const mood = classifyMood(c.status_mood);
  const time = c.checkin_date ? formatDate(c.checkin_date) : "today";
  const work = c.work_done || c.work_planned || "—";
  // Label the footer button by whether this check-in actually has an open
  // blocker, not by mood — so it matches what the modal will show.
  const hasBlocker = blockersForCheckin(c.checkin_id).length > 0;
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
              hasBlocker
                ? `<button class="btn-mini danger" data-action="view-checkin">view blocker</button>`
                : `<button class="btn-mini" data-action="view-checkin">view update</button>`
            }
          </div>
        </div>`;
}

// Open a read-only modal showing the full details of a single check-in.
// Reuses the shared task-form modal styles (tf-*, loaded via task-form.css on
// this page) so it matches the app's other dialogs.
function openCheckinModal(checkin) {
  if (!checkin) return;

  const backdrop = document.createElement("div");
  backdrop.className = "tf-backdrop";

  const modal = document.createElement("div");
  modal.className = "tf-modal checkin-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Check-in details");

  const mood = classifyMood(checkin.status_mood);
  const when = checkin.checkin_date ? formatDate(checkin.checkin_date) : "today";
  const moodSuffix = checkin.status_mood ? " · " + escapeHtml(checkin.status_mood) : "";

  // Open blockers raised from this check-in. Same source as the card's
  // "view blocker" button so the two never disagree.
  const relatedBlockers = blockersForCheckin(checkin.checkin_id);
  const blockerSection = relatedBlockers.length
    ? `
      <div class="checkin-modal-section">
        <span class="checkin-modal-label">Blocker${relatedBlockers.length > 1 ? "s" : ""}</span>
        ${relatedBlockers
          .map(
            (b) => `
          <div class="checkin-modal-blocker">
            <p class="checkin-modal-text">${escapeHtml(b.description || "—")}</p>
            ${b.task ? `<span class="checkin-modal-meta">Task: ${escapeHtml(b.task)}</span>` : ""}
            ${b.tag ? `<span class="checkin-modal-meta">Helper: ${escapeHtml(b.tag)}</span>` : ""}
          </div>`
          )
          .join("")}
      </div>`
    : "";

  modal.innerHTML = `
    <div class="tf-header">
      <h2 class="tf-title">${escapeHtml(checkin.full_name ?? "Unknown")} · Check-in</h2>
      <button type="button" class="tf-close" aria-label="Close">✕</button>
    </div>
    <div class="tf-body">
      <div class="checkin-modal-summary">
        <div class="checkin-modal-row">
          <span class="checkin-modal-label">Status</span>
          <span class="status-badge ${mood.cls}">${escapeHtml(mood.label)}</span>
        </div>
        <div class="checkin-modal-row">
          <span class="checkin-modal-label">When</span>
          <span class="checkin-modal-value">${escapeHtml(when)}${moodSuffix}</span>
        </div>
      </div>
      ${blockerSection}
      <div class="checkin-modal-section">
        <span class="checkin-modal-label">Work done</span>
        <p class="checkin-modal-text">${escapeHtml(checkin.work_done || "—")}</p>
      </div>
      <div class="checkin-modal-section">
        <span class="checkin-modal-label">Work planned</span>
        <p class="checkin-modal-text">${escapeHtml(checkin.work_planned || "—")}</p>
      </div>
    </div>`;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  function close() {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }
  modal.querySelector(".tf-close")?.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);
  modal.querySelector(".tf-close")?.focus();
}

// Delegated handler for the Daily Standup grid: "view update" / "view blocker"
// both open the check-in details modal for that card's person. Looks the
// check-in up in checkinsCache by id, so it works for today's grid and history.
function onCheckinGridClick(e) {
  const btn = e.target.closest('[data-action="view-checkin"]');
  if (!btn) return;
  const id = btn.closest(".checkin-card")?.dataset.checkinId;
  if (id == null) return;
  const checkin = checkinsCache.find((c) => String(c.checkin_id) === String(id));
  if (checkin) openCheckinModal(checkin);
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
// but only assigned_to, status + priority have backend persistence right now —
// the rest update locally and are intentionally not PATCHed. Blocker persistence is
// owned by another branch, so we leave is_blocked/blocker_reason untouched too.
async function persistTaskChange(taskId, fields) {
  const payload = {};
  if ("assigned_to" in fields) payload.assigned_to = fields.assigned_to;
  if ("status" in fields) payload.status = fields.status;
  if ("priority" in fields) payload.priority = fields.priority;
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

/**
 * Map the task-form modal's output to a PATCH body for an edit. Mirrors the
 * create payload but clears the reviewer + review pill when no reviewer is
 * set (human/unassigned), and omits review_status otherwise so the API
 * preserves/promotes whatever the agent task already had.
 * @param {object} data - Modal submission object.
 * @returns {object} PATCH body.
 */
function buildEditPayload(data) {
  const payload = {
    title: data.title,
    description: data.description ?? null,
    assigned_to: data.assigned_to ?? null,
    status: data.status,
  };
  if (data.priority) payload.priority = data.priority;
  if (data.reviewer_id != null) {
    payload.reviewer_id = data.reviewer_id;
  } else {
    payload.reviewer_id = null;
    payload.review_status = "not-required";
  }
  return payload;
}

// Opens the shared task-form modal pre-filled with an existing task, PATCHing
// the changes and refreshing the dashboard on save.
async function openEditTaskModal(task) {
  const { openTaskModal } = await loadTaskFormModule();
  openTaskModal(
    async (data) => {
      try {
        await updateTask(task.task_id, buildEditPayload(data));
        await loadAll();
      } catch (err) {
        console.error("[scrum] editTask failed", err);
        alert(`Couldn't update task: ${err.message}`);
      }
    },
    { task }
  );
}

// Adds the page-specific edit + delete buttons in a row below the task-card.
// Assignee and status editing come from the shared component's interactive
// mode; the component intentionally doesn't provide these, so we add them.
function appendTaskControls(card, task) {
  const row = document.createElement("div");
  row.className = "task-card-row-delete";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn task-card-edit";
  editBtn.dataset.taskId = task.task_id;
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openEditTaskModal(task));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn task-card-delete";
  deleteBtn.dataset.taskId = task.task_id;
  deleteBtn.textContent = "delete";
  deleteBtn.addEventListener("click", async () => {
    try {
      await deleteTask(task.task_id);
      await loadAll();
    } catch (err) {
      console.error("[scrum] deleteTask failed", err);
      alert(`Couldn't delete task: ${err.message}`);
    }
  });

  row.appendChild(editBtn);
  row.appendChild(deleteBtn);
  card.appendChild(row);
}

// Build a task-card element, enriched with the active sprint label and any
// open check-in blocker for this task.
function buildTaskCard(task, { compact = false } = {}) {
  const blockerReason = blockerByTask.get(task.title);
  const enriched = {
    ...task,
    // Mirror user_id → assigned_to so the card's assignee dropdown pre-selects.
    assigned_to: task.assigned_to ?? task.user_id ?? null,
    sprint: sprintState.number ? `Sprint ${sprintState.number}` : task.sprint,
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
// `lockedStatus` forces the new task into that status and hides the modal's
// status field (used by the kanban column + buttons).
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

  // openTaskModal builds the DOM synchronously, so the status field is already
  // present: preselect the wanted status, and hide it when locked.
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
// The sprint number is auto-assigned ("New sprint" increments, "Edit sprint"
// keeps); the open picker stashes the value it will save here.
let pickerSprintNumber = null;

// One sprint at a time: hide "New sprint" while a sprint is in progress.
function updateSprintButtons() {
  const newBtn = document.getElementById("new-sprint-btn");
  if (!newBtn) return;
  newBtn.hidden = isSprintInProgress(sprintState);
}

/**
 * Open the sprint picker.
 *
 * @param {"new"|"edit"} mode  "new" auto-increments the sprint number and
 *        suggests the next 1-week range; "edit" keeps the current number and
 *        prefills the current dates. The number is read-only either way.
 */
function openSprintPicker(mode = "edit") {
  const picker = document.getElementById("sprint-picker");
  const numberDisplay = document.getElementById("sprint-number-display");
  const startInput = document.getElementById("sprint-start-input");
  const endInput = document.getElementById("sprint-end-input");
  if (!picker || !numberDisplay || !startInput || !endInput) return;

  // Guard: can't start a new sprint while one is in progress.
  if (mode === "new" && isSprintInProgress(sprintState)) return;

  if (mode === "new") {
    // Auto-increment from the current sprint (1 for the very first sprint), and
    // suggest a 1-week range starting today, which the user can adjust.
    pickerSprintNumber = (sprintState.number ?? 0) + 1;
    const start = todayISODate();
    startInput.value = start;
    endInput.value = addDaysISO(start, 6) ?? "";
  } else {
    // Editing: keep the current number and prefill the current dates so the
    // edit is non-destructive. Fall back to sprint 1 if none is set yet.
    pickerSprintNumber = sprintState.number ?? 1;
    startInput.value = sprintState.start_date ?? "";
    endInput.value = sprintState.end_date ?? "";
  }
  numberDisplay.textContent = String(pickerSprintNumber);

  // A sprint can't start before today: grey out past days in the date pickers.
  // saveSprintPicker re-checks this since `min` only guides the calendar UI.
  const today = todayISODate();
  startInput.min = today;
  endInput.min = today;

  picker.classList.remove("hidden");
  startInput.focus();
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
  const startInput = document.getElementById("sprint-start-input");
  const endInput = document.getElementById("sprint-end-input");
  const err = document.getElementById("sprint-picker-error");
  if (!startInput || !endInput || !err) return;

  // Number is auto-assigned by openSprintPicker (new = +1, edit = unchanged),
  // never typed.
  const number = pickerSprintNumber;
  const start = startInput.value || null;
  const end = endInput.value || null;

  // Validate: a sprint can't start before today. Checked here (not just via the
  // input's `min`) because a user can still type a past date into the field.
  if (start && parseISODate(start) < parseISODate(todayISODate())) {
    err.hidden = false;
    err.textContent = "Sprint can't start before today.";
    return;
  }

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
  // Lock/unlock "New sprint" now that the sprint's dates may have changed.
  updateSprintButtons();
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
      // Best-effort: a failing agents endpoint shouldn't break the dashboard.
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

  // Trust /members if non-empty; otherwise derive members from task/checkin rows.
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
  // Cache the raw blockers so the check-in modal can surface details per person.
  blockersCache = blockers;

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
  // Lock "New sprint" if the loaded sprint is still in progress.
  updateSprintButtons();
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
  // Set the initial "New sprint" visibility (loadAll refreshes it later).
  updateSprintButtons();

  // ── Sidebar nav ────────────────────────────────────
  // Real hrefs navigate; in-page tabs (href="#") swap to a placeholder view.
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
  // Arrow wrappers so the click event isn't passed as the mode argument.
  document
    .getElementById("new-sprint-btn")
    ?.addEventListener("click", () => openSprintPicker("new"));
  document
    .getElementById("edit-sprint-btn")
    ?.addEventListener("click", () => openSprintPicker("edit"));
  document.getElementById("save-sprint-btn")?.addEventListener("click", saveSprintPicker);
  document.getElementById("cancel-sprint-btn")?.addEventListener("click", closeSprintPicker);

  // ── View toggle (list ⇄ kanban) ────────────────────
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => setViewMode(btn.dataset.view));
  });

  // ── Daily Standup: "view update" → check-in details modal ──
  // Delegated so it covers cards re-rendered for today and the history view.
  document.getElementById("checkin-grid")?.addEventListener("click", onCheckinGridClick);

  // ── Add-agent button (opens agent-form modal) ──────
  // openAgentModal filters members to non-agents; reload after a create.
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
  // task-form.js is dynamic-imported on first click (see loadTaskFormModule).
  document.getElementById("add-task-btn")?.addEventListener("click", () => {
    openCreateTaskModal({ defaultStatus: "todo" });
  });

  // Expose the caches the task-form modal reads to populate its assignee
  // dropdown and enforce the reviewer-required rule for agents.
  if (typeof window !== "undefined") {
    window.getProjectMembers = () => projectMembers;
    window.getProjectAgents = () => projectAgents;
  }

  // ── Daily Standup "View history" toggle ────────────
  document.getElementById("checkin-history-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleCheckinHistory();
  });

  // ── Check-in button → dedicated check-in page ──────
  document.getElementById("checkin-today-btn")?.addEventListener("click", () => {
    window.location.href = "../check-in/check-in.html";
  });

  // Apply the saved view mode and kick off the first load (with a spinner).
  setViewMode(viewMode);
  loadAll(true);
}

if (typeof document !== "undefined") {
  init(); // deferred module: the DOM is already parsed
}
