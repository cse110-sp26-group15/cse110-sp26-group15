// ── My Check-ins ──────────────────────────────────────────────────────
// Drives the standalone agile stand-up check-in page (check-in.html).
//
// Responsibilities:
//   • List today's + recent check-ins from `GET /api/projects/:id/checkins`.
//   • Detect whether the current user has a check-in dated today and toggle
//     between the "please check in" prompt and the "today's check-in is
//     done" confirmation accordingly.
//   • Submit the form via `POST /api/projects/:id/checkins`, then (if the
//     blocker panel is open) `POST /api/projects/:id/blockers` to attach
//     the blocker to the just-created check-in.
//   • Wire the per-card Delete button to `DELETE /api/checkins/:id`.
//
// Every fetch goes through `apiFetch` (10s timeout, throws ApiError on
// non-2xx) so a hung backend can't leave the page on a stale spinner — the
// catch block paints a visible inline error instead.
//
// The blocker pickers reflect the real project: the "Blocked on" list
// comes from `GET /api/projects/:id/tasks` and "Who can help?" from
// `GET /api/projects/:id/members`.

import { apiFetch, ApiError, getCurrentUser } from "../shared/utils.js";

// ── Constants ────────────────────────────────────────
// Hard-coded for now; will switch to the logged-in project once auth
// context is plumbed through (same TODO as scrum.js / kanban.js).
export const PROJECT_ID = 1;

// Non-task-specific blocker option shown first in the "Blocked on" picker.
export const GENERAL_BLOCKER = "General";

// Maps each workload value (the <option> values in check-in.html) to the
// human label shown on the check-in card. Workload is a UI-only field —
// it isn't part of the API check-in schema, so we stash it inside the
// `status_mood` column with a `workload:` prefix when posting.
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

// In-memory cache of the most recently-fetched check-ins, so the per-card
// delete handler can find the row it's removing without a re-fetch.
let currentCheckins = [];

// ── Pure helpers ─────────────────────────────────────

/**
 * Escape user-controlled strings before inserting into innerHTML.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * Returns up to two uppercase initials for a display name.
 * @param {string} name
 * @returns {string}
 */
export function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Formats an ISO date string as a readable completion date.
 * @param {string} dateStr
 * @returns {string}
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
 * True when the list already contains a check-in dated today (by the
 * current user when `userId` is supplied — otherwise any author).
 * @param {object[]} checkins
 * @param {number} [userId]
 * @returns {boolean}
 */
export function hasCheckinToday(checkins, userId) {
  const today = new Date();
  return checkins.some((c) => {
    if (!isSameDay(new Date(c.checkin_date), today)) return false;
    if (userId == null) return true;
    return Number(c.user_id ?? c.user?.user_id) === Number(userId);
  });
}

// ── API calls ────────────────────────────────────────

async function fetchCheckins() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/checkins`);
  return data.checkins ?? [];
}

async function fetchTasks() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/tasks`);
  return data.tasks ?? [];
}

async function fetchMembers() {
  const data = await apiFetch(`/api/projects/${PROJECT_ID}/members`);
  return data.members ?? [];
}

async function postCheckin(payload) {
  const { checkin } = await apiFetch(`/api/projects/${PROJECT_ID}/checkins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return checkin;
}

async function postBlocker(payload) {
  const { blocker } = await apiFetch(`/api/projects/${PROJECT_ID}/blockers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return blocker;
}

async function apiDeleteCheckin(checkinId) {
  return apiFetch(`/api/checkins/${checkinId}`, { method: "DELETE" });
}

// ── Blocker picker setup ─────────────────────────────

/**
 * Fills the "Blocked on" select with the General option plus the title of
 * every task in the project, and the "Who can help?" select with the
 * project's members (excluding the current user). On API failure both
 * pickers degrade to just "General" / "anyone" so the form is still
 * submittable.
 */
async function populateBlockerOptions(currentUserId) {
  let tasks = [];
  let members = [];
  try {
    [tasks, members] = await Promise.all([fetchTasks(), fetchMembers()]);
  } catch (err) {
    console.warn("[check-in] failed to populate blocker pickers", err);
  }

  const titles = [...new Set(tasks.map((t) => t.title).filter(Boolean))];
  const taskLabels = [GENERAL_BLOCKER, ...titles];
  blockerTaskSelect.innerHTML = taskLabels
    .map(
      (label, i) =>
        `<option value="${escapeHtml(label)}"${i === 0 ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");

  const others = members.filter((m) => Number(m.user_id) !== Number(currentUserId));
  const helperOptions = [
    `<option value="" selected>Not sure / anyone</option>`,
    ...others.map(
      (m) => `<option value="${escapeHtml(m.full_name)}">${escapeHtml(m.full_name)}</option>`
    ),
  ];
  blockerHelperSelect.innerHTML = helperOptions.join("");
}

function isBlockerOpen() {
  return !blockerPanel.classList.contains("hidden");
}

function setBlockerOpen(open) {
  blockerPanel.classList.toggle("hidden", !open);
  blockerToggle.setAttribute("aria-expanded", String(open));
  blockerToggle.textContent = open ? "Remove blocker" : "+ I'm blocked on a task";
}

/**
 * Reads the blocker fields into a blocker object, or null when the panel
 * is closed. Shape matches the blocker-card component so any rail render
 * downstream can consume it directly.
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

function renderDailyStatus(checkins, userId) {
  const done = hasCheckinToday(checkins, userId);
  promptBanner.classList.toggle("hidden", done);
  form.classList.toggle("hidden", done);
  doneBanner.classList.toggle("hidden", !done);
}

/**
 * Pulls a workload value out of a status_mood string. The API has no
 * `workload` column so we encode it as `workload:<value> · <mood>` when
 * posting; this reverses that for display.
 * @param {string|null} statusMood
 * @returns {string} The human workload label, or "—" when none is encoded.
 */
function workloadFromStatusMood(statusMood) {
  const match = String(statusMood ?? "").match(/workload:([a-z-]+)/i);
  if (!match) return "—";
  return WORKLOAD_LABELS[match[1]] ?? match[1];
}

/**
 * Builds the markup for a check-in's blocker block, or "" when there is none.
 * @param {{task?: string, description?: string, helper?: string}|null} blocker
 * @returns {string}
 */
export function buildBlockerBlock(blocker) {
  if (!blocker || typeof blocker !== "object") return "";

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

function buildCheckinCard(checkin) {
  const card = document.createElement("article");
  card.className = "checkin-card";
  card.dataset.checkinId = checkin.checkin_id;

  const name = checkin.user?.full_name ?? checkin.full_name ?? "Unknown";
  const workloadLabel = workloadFromStatusMood(checkin.status_mood);

  card.innerHTML = `
    <div class="checkin-card__header">
      <div class="avatar checkin-card__avatar">${escapeHtml(initialsFor(name))}</div>
      <span class="checkin-card__author">${escapeHtml(name)}</span>
      <span class="checkin-card__workload">Workload: ${escapeHtml(workloadLabel)}</span>
      <span class="checkin-card__date">${escapeHtml(formatDate(checkin.checkin_date))}</span>
    </div>

    <div class="checkin-card__section">
      <span class="checkin-card__label">Accomplished</span>
      <p class="checkin-card__text">${escapeHtml(checkin.work_done ?? "")}</p>
    </div>

    <div class="checkin-card__section">
      <span class="checkin-card__label">To-do</span>
      <p class="checkin-card__text">${escapeHtml(checkin.work_planned ?? "")}</p>
    </div>

    ${buildBlockerBlock(checkin.blocker)}

    <div class="checkin-card__footer">
      <button type="button" class="btn btn--danger checkin-card__delete">Delete</button>
    </div>
  `;

  card.querySelector(".checkin-card__delete").addEventListener("click", () => {
    handleDelete(checkin.checkin_id);
  });

  return card;
}

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

function renderLoadError(message) {
  listEl.innerHTML = `<p class="task-empty task-error">⚠ ${escapeHtml(message)}</p>`;
  // Show the form so the user can still try to submit; renderDailyStatus
  // will overwrite this on the next successful load.
  promptBanner.classList.remove("hidden");
  form.classList.remove("hidden");
  doneBanner.classList.add("hidden");
}

async function refresh(userId) {
  let checkins;
  try {
    checkins = await fetchCheckins();
  } catch (err) {
    const reason =
      err instanceof ApiError && err.status > 0
        ? `Failed to load check-ins (${err.status}): ${err.message}`
        : `Failed to load check-ins: ${err?.message ?? "network error"}`;
    renderLoadError(reason);
    console.error("[check-in] fetch failed", err);
    return;
  }
  currentCheckins = checkins;
  renderDailyStatus(checkins, userId);
  renderList(checkins);
}

// ── Mutations ────────────────────────────────────────

async function handleSubmit(event) {
  event.preventDefault();

  const workDone = document.getElementById("field-work-done").value.trim();
  const workPlanned = document.getElementById("field-work-planned").value.trim();
  const workload = document.getElementById("field-workload").value;

  if (!workDone || !workPlanned || !workload) {
    showError("Please fill in what you did, what you need to do, and your workload.");
    return;
  }
  hideError();

  const user = getCurrentUser();
  const userId = user?.user_id ?? 1; // fallback for unauthenticated demos
  const blocker = readBlocker();

  try {
    const checkin = await postCheckin({
      user_id: userId,
      // Encode workload inside status_mood since the schema has no
      // dedicated workload column.
      status_mood: `workload:${workload}`,
      work_done: workDone,
      work_planned: workPlanned,
    });

    if (blocker && checkin?.checkin_id) {
      try {
        await postBlocker({
          checkin_id: checkin.checkin_id,
          description: blocker.description || "(no description)",
          task: blocker.task === GENERAL_BLOCKER ? null : blocker.task,
          helper: blocker.helper || null,
        });
      } catch (err) {
        console.warn("[check-in] check-in saved but blocker failed", err);
        alert(`Check-in saved, but couldn't attach the blocker: ${err.message}`);
      }
    }

    resetForm();
    await refresh(userId);
  } catch (err) {
    console.error("[check-in] submit failed", err);
    showError(`Couldn't save check-in: ${err.message}`);
  }
}

async function handleDelete(checkinId) {
  try {
    await apiDeleteCheckin(checkinId);
    const user = getCurrentUser();
    await refresh(user?.user_id ?? 1);
  } catch (err) {
    console.error("[check-in] delete failed", err);
    alert(`Couldn't delete check-in: ${err.message}`);
  }
}

function resetForm() {
  form.reset();
  setBlockerOpen(false);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

// ── Init ─────────────────────────────────────────────
async function init() {
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

  const user = getCurrentUser();
  const userId = user?.user_id ?? 1;

  await populateBlockerOptions(userId);
  blockerToggle.addEventListener("click", () => setBlockerOpen(!isBlockerOpen()));
  form.addEventListener("submit", handleSubmit);

  await refresh(userId);
}

// Skip everything DOM-related under node so the test suite can import
// the pure helpers above without a document. Mirrors scrum.js / kanban.js.
if (typeof document !== "undefined") {
  init();
}

// Exported for tests
export { currentCheckins };
