import { apiFetch, showLoading, hideLoading } from "../shared/utils.js";

const PROJECT_ID = 1;
const API_URL = `/api/projects/${PROJECT_ID}/weekly-report`;

const elements = {
  reportRange: document.getElementById("report-range"),
  reportNarrative: document.getElementById("report-narrative"),
  completedTasks: document.getElementById("completed-tasks"),
  openBlockers: document.getElementById("open-blockers"),
  resolvedBlockers: document.getElementById("resolved-blockers"),
  workloadTotal: document.getElementById("workload-total"),
  takeawayText: document.getElementById("takeaway-text"),
  teamNotes: document.getElementById("team-notes"),
  workloadQuickView: document.getElementById("workload-quick-view"),
  chatLog: document.getElementById("chat-log"),
  queryInput: document.getElementById("query-input"),
  querySubmit: document.getElementById("query-submit"),
  errorBanner: document.getElementById("report-error"),
  refreshButton: document.getElementById("refresh-btn"),
};

let reportState = null;

function formatCount(value) {
  return value != null ? String(value) : "—";
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function createNarrative(data) {
  const completed = data.tasks?.completed || [];
  const openBlockers = data.counts?.openBlockersCount || 0;
  const resolvedBlockers = data.counts?.resolvedBlockersCount || 0;
  const checkins = data.checkins || [];
  const workload = data.workload || [];
  const headline = [];

  headline.push(`Between ${formatDateLabel(data.range.start)} and ${formatDateLabel(data.range.end)}, the team completed ${completed.length} ${pluralize(completed.length, "task")}.`);

  if (openBlockers > 0) {
    headline.push(`There are ${openBlockers} open blocker${openBlockers === 1 ? "" : "s"}, and ${resolvedBlockers} blocker${resolvedBlockers === 1 ? "" : "s"} were resolved this week.`);
  } else {
    headline.push(`There are no open blockers listed for this week, and ${resolvedBlockers} blocker${resolvedBlockers === 1 ? "" : "s"} were resolved during the period.`);
  }

  if (checkins.length > 0) {
    headline.push(`The team shared ${checkins.length} check-in${checkins.length === 1 ? "" : "s"}, which helps capture progress and risk across the sprint.`);
  } else {
    headline.push(`No check-ins were logged during this period. Follow up with the team to confirm status next week.`);
  }

  if (workload.length > 0) {
    headline.push(`Workload is spread across ${workload.length} collaborator${workload.length === 1 ? "" : "s"}, with the top contributor carrying the largest slice of active tasks.`);
  }

  headline.push(`Ask a question below about this week’s progress, blockers, check-ins, or workload distribution.`);
  return headline.join(" ");
}

function buildQuickWorkloadSummary(workload) {
  if (!workload || workload.length === 0) {
    return "No workload details are available for this week.";
  }
  const sorted = [...workload].sort((a, b) => Number(b.task_count || 0) - Number(a.task_count || 0));
  const items = sorted.slice(0, 3).map((item) => `${item.full_name}: ${item.task_count || 0} ${pluralize(Number(item.task_count || 0), "task")}`);
  return items.join(", ") + (sorted.length > 3 ? `, and ${sorted.length - 3} more member${sorted.length - 3 === 1 ? "" : "s"}.` : "");
}

function findMatches(query, data) {
  const lower = query.toLowerCase();
  const found = [];
  const completed = data.tasks?.completed || [];
  const checkins = data.checkins || [];
  const blockers = data.blockers || [];

  completed.forEach((task) => {
    const haystack = `${task.title} ${task.description || ""} ${task.assignee || ""}`.toLowerCase();
    if (haystack.includes(lower)) {
      found.push({ type: "Task", summary: `${task.title} (${task.assignee || "unassigned"})` });
    }
  });

  checkins.forEach((entry) => {
    const haystack = `${entry.full_name} ${entry.work_done || ""} ${entry.work_planned || ""} ${entry.status_mood || ""}`.toLowerCase();
    if (haystack.includes(lower)) {
      found.push({ type: "Check-in", summary: `${entry.full_name}: ${entry.work_done || "update"}` });
    }
  });

  blockers.forEach((blocker) => {
    const haystack = `${blocker.title || ""} ${blocker.description || ""} ${blocker.status || ""}`.toLowerCase();
    if (haystack.includes(lower)) {
      found.push({ type: "Blocker", summary: blocker.title || "Blocker item" });
    }
  });

  return found;
}

function answerQuery(query, data) {
  const lower = query.toLowerCase();
  const completed = data.tasks?.completed || [];
  const checkins = data.checkins || [];
  const workload = data.workload || [];
  const counts = data.counts || {};

  if (/(completed|done|finished|delivered)/.test(lower)) {
    if (completed.length === 0) return "No completed tasks were recorded this week.";
    return `The team completed ${completed.length} ${pluralize(completed.length, "task")}. Example items: ${completed.slice(0, 3).map((task) => `${task.title} (${task.assignee || "unassigned"})`).join(", ")}.`;
  }

  if (/(blocker|issue|blocked|stuck)/.test(lower)) {
    if ((counts.openBlockersCount || 0) === 0) {
      return `There are no open blockers listed for this week. ${counts.resolvedBlockersCount || 0} blocker${counts.resolvedBlockersCount === 1 ? "" : "s"} were resolved.`;
    }
    return `There are ${counts.openBlockersCount || 0} open blocker${(counts.openBlockersCount || 0) === 1 ? "" : "s"} and ${counts.resolvedBlockersCount || 0} resolved blocker${(counts.resolvedBlockersCount || 0) === 1 ? "" : "s"} this week.`;
  }

  if (/(check-in|checkin|update|status|reported)/.test(lower)) {
    if (checkins.length === 0) return "No check-ins were recorded this period.";
    return `The report includes ${checkins.length} check-in${checkins.length === 1 ? "" : "s"}. Team updates cover work done, current plans, and wellbeing signals.`;
  }

  if (/(workload|distribution|load|balance|task count)/.test(lower)) {
    if (workload.length === 0) return "Workload information is not available for this week.";
    return `The workload is shared across ${workload.length} team member${workload.length === 1 ? "" : "s"}. ${buildQuickWorkloadSummary(workload)}`;
  }

  const matches = findMatches(query, data);
  if (matches.length > 0) {
    const example = matches.slice(0, 3).map((match) => `${match.type}: ${match.summary}`).join("; ");
    return `I found ${matches.length} matching item${matches.length === 1 ? "" : "s"}. Example: ${example}.`;
  }

  return "I couldn't find a direct answer in the weekly data. Try asking about completed tasks, blockers, check-ins, or workload distribution.";
}

function setError(message) {
  if (!elements.errorBanner) return;
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

function clearError() {
  if (!elements.errorBanner) return;
  elements.errorBanner.textContent = "";
  elements.errorBanner.classList.add("hidden");
}

function addChatMessage(message, sender = "bot") {
  if (!elements.chatLog) return;
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${sender}`;
  bubble.textContent = message;
  elements.chatLog.appendChild(bubble);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function handleQuery() {
  const input = elements.queryInput;
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  addChatMessage(query, "user");
  const response = answerQuery(query, reportState || { tasks: {}, checkins: [], blockers: [], workload: [], counts: {} });
  addChatMessage(response, "bot");
  input.value = "";
}

function renderReport(data) {
  reportState = data;
  const completedTasks = data.tasks?.completed || [];
  const workload = data.workload || [];
  const totalWorkload = workload.reduce((sum, item) => sum + Number(item.task_count || 0), 0);

  elements.reportRange.textContent = `${formatDateLabel(data.range.start)} – ${formatDateLabel(data.range.end)}`;
  elements.completedTasks.textContent = formatCount(completedTasks.length);
  elements.openBlockers.textContent = formatCount(data.counts?.openBlockersCount);
  elements.resolvedBlockers.textContent = formatCount(data.counts?.resolvedBlockersCount);
  elements.workloadTotal.textContent = `${totalWorkload} ${pluralize(totalWorkload, "task")}`;
  elements.reportNarrative.textContent = createNarrative(data);
  elements.takeawayText.textContent = completedTasks.length
    ? `The team completed ${completedTasks.length} ${pluralize(completedTasks.length, "task")}, and resolved ${data.counts?.resolvedBlockersCount || 0} blocker${(data.counts?.resolvedBlockersCount || 0) === 1 ? "" : "s"}.`
    : "No completed tasks were captured this week. Use this report to align on priorities for next week.";
  elements.teamNotes.textContent = data.checkins?.length
    ? `There were ${data.checkins.length} team check-in${data.checkins.length === 1 ? "" : "s"} that summarize work and upcoming plans.`
    : "No check-ins were captured. Connect with the team for a full update.";
  elements.workloadQuickView.textContent = buildQuickWorkloadSummary(workload);
}

async function loadWeeklyReport() {
  clearError();
  showLoading(document.getElementById("page-content"), "Loading weekly report…");
  try {
    const payload = await apiFetch(API_URL);
    renderReport(payload);
  } catch (error) {
    setError(error.message || "Unable to load weekly report.");
  } finally {
    hideLoading(document.getElementById("page-content"));
  }
}

if (typeof document !== "undefined") {
  elements.refreshButton?.addEventListener("click", loadWeeklyReport);
  elements.querySubmit?.addEventListener("click", handleQuery);
  elements.queryInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleQuery();
    }
  });
  loadWeeklyReport();
}
