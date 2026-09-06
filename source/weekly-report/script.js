import {
  apiFetch,
  showLoading,
  hideLoading,
  getCurrentProject,
  dashboardPathFor,
} from "../shared/utils.js";

const params = new URLSearchParams(window.location.search);
const PROJECT_ID =
  params.get("project") ||
  params.get("projectId") ||
  localStorage.getItem("sitrep_project_id") ||
  "1";
const API_URL = `/api/projects/${PROJECT_ID}/weekly-report`;

const elements = {
  reportRange: document.getElementById("report-range"),
  documentDateRange: document.getElementById("document-date-range"),
  reportNarrative: document.getElementById("report-narrative"),
  completedTasksList: document.getElementById("completed-tasks-list"),
  activeTasksList: document.getElementById("active-tasks-list"),
  openBlockersList: document.getElementById("open-blockers-list"),
  resolvedBlockersList: document.getElementById("resolved-blockers-list"),
  checkinSummary: document.getElementById("checkin-summary"),
  checkinList: document.getElementById("weekly-report-checkin-list"),
  workloadSummary: document.getElementById("workload-summary"),
  workloadList: document.getElementById("workload-list"),
  workflowNotes: document.getElementById("workflow-notes"),
  chatLog: document.getElementById("chat-log"),
  queryInput: document.getElementById("query-input"),
  querySubmit: document.getElementById("query-submit"),
  errorBanner: document.getElementById("report-error"),
  refreshButton: document.getElementById("refresh-btn"),
};

let reportState = null;

function formatDateLabel(value) {
  if (!value) return "Unknown date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function getTaskAssignee(task) {
  return task.assignee || task.assignee_name || task.full_name || task.owner || "Unassigned";
}

function getTaskStatus(task) {
  return task.status || task.column || task.state || "Active";
}

function getTaskDescription(task) {
  return task.description || task.summary || "";
}

function getTaskTitle(task) {
  return task.title || task.name || "Untitled task";
}

function getBlockerTitle(blocker) {
  return blocker.title || blocker.name || "Untitled blocker";
}

function getBlockerDescription(blocker) {
  return blocker.description || blocker.summary || blocker.reason || "";
}

function getBlockerOwner(blocker) {
  return blocker.owner || blocker.assignee || blocker.full_name || "Unassigned";
}

function clearElement(element) {
  if (!element) return;
  element.innerHTML = "";
}

function renderTaskList(container, tasks, emptyMessage) {
  if (!container) return;
  clearElement(container);

  if (!tasks || tasks.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = emptyMessage;
    container.appendChild(message);
    return;
  }

  const list = document.createElement("ul");
  list.className = "report-bullet-list compact-list";

  tasks.forEach((task) => {
    const item = document.createElement("li");

    const title = document.createElement("strong");
    title.textContent = getTaskTitle(task);
    item.appendChild(title);

    const meta = document.createElement("span");
    meta.textContent = `${getTaskAssignee(task)} • ${getTaskStatus(task)}`;
    item.appendChild(meta);

    const description = getTaskDescription(task);
    if (description) {
      const detail = document.createElement("p");
      detail.textContent = description;
      item.appendChild(detail);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
}

function renderBlockerList(container, blockers, emptyMessage) {
  if (!container) return;
  clearElement(container);

  if (!blockers || blockers.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = emptyMessage;
    container.appendChild(message);
    return;
  }

  const list = document.createElement("ul");
  list.className = "report-bullet-list compact-list";

  blockers.forEach((blocker) => {
    const item = document.createElement("li");

    const title = document.createElement("strong");
    title.textContent = getBlockerTitle(blocker);
    item.appendChild(title);

    const owner = document.createElement("span");
    owner.textContent = `${getBlockerOwner(blocker)} • ${blocker.status || "Unknown status"}`;
    item.appendChild(owner);

    const description = getBlockerDescription(blocker);
    if (description) {
      const detail = document.createElement("p");
      detail.textContent = description;
      item.appendChild(detail);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
}

function renderCheckins(container, checkins) {
  if (!container) return;
  clearElement(container);

  if (!checkins || checkins.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "No individual check-in updates are available.";
    container.appendChild(message);
    return;
  }

  const list = document.createElement("ul");
  list.className = "report-bullet-list compact-list";

  checkins.forEach((entry) => {
    const item = document.createElement("li");

    const title = document.createElement("strong");
    title.textContent = entry.full_name || entry.name || "Team member";
    item.appendChild(title);

    const details = document.createElement("span");
    details.textContent = `${entry.work_done || "No update"}${entry.status_mood ? ` • ${entry.status_mood}` : ""}`;
    item.appendChild(details);

    if (entry.work_planned) {
      const nextStep = document.createElement("p");
      nextStep.textContent = `Next: ${entry.work_planned}`;
      item.appendChild(nextStep);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
}

function renderWorkload(container, workload) {
  if (!container) return;
  clearElement(container);

  if (!workload || workload.length === 0) {
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = "No workload distribution data is available for this week.";
    container.appendChild(message);
    return;
  }

  const sorted = [...workload].sort(
    (a, b) => Number(b.task_count || 0) - Number(a.task_count || 0)
  );

  sorted.forEach((item) => {
    const row = document.createElement("div");
    row.className = "workload-row";

    const meta = document.createElement("div");
    meta.className = "workload-meta";
    const name = document.createElement("span");
    name.textContent = item.full_name || item.name || "Team member";
    const count = document.createElement("span");
    count.textContent = `${item.task_count || 0} ${pluralize(Number(item.task_count || 0), "task")}`;
    meta.appendChild(name);
    meta.appendChild(count);

    const barWrap = document.createElement("div");
    barWrap.className = "workload-bar";
    // The bar is a drawing of the number already printed beside it, so it is
    // decorative: hiding it keeps an empty, unlabelled stop out of the
    // accessibility tree without removing any information.
    barWrap.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, Number(item.task_count || 0) * 10)}%`;
    barWrap.appendChild(fill);

    row.appendChild(meta);
    row.appendChild(barWrap);
    container.appendChild(row);
  });
}

function getCompletedTasks(data) {
  return data.tasks?.completed || data.completedTasks || [];
}

function getActiveTasks(data) {
  return data.tasks?.active || data.tasks?.inProgress || data.activeTasks || data.tasks?.todo || [];
}

function getOpenBlockers(data) {
  if (data.blockers?.open) return data.blockers.open;
  return (data.blockers || []).filter((blocker) => {
    const status = String(blocker.status || "").toLowerCase();
    return status.includes("open") || status.includes("active");
  });
}

function getResolvedBlockers(data) {
  if (data.blockers?.resolved) return data.blockers.resolved;
  return (data.blockers || []).filter((blocker) => {
    const status = String(blocker.status || "").toLowerCase();
    return status.includes("resolved") || status.includes("closed");
  });
}

function createNarrative(data) {
  const completed = getCompletedTasks(data);
  const active = getActiveTasks(data);
  const openBlockers = getOpenBlockers(data);
  const resolvedBlockers = getResolvedBlockers(data);
  const checkins = data.checkins || [];
  const workload = data.workload || [];

  const start = formatDateLabel(data.range?.start);
  const end = formatDateLabel(data.range?.end);

  const paragraphs = [];

  paragraphs.push(
    `During the reporting period from ${start} to ${end}, the team completed ${
      completed.length
    } ${pluralize(completed.length, "task")} and currently has ${
      active.length
    } active ${pluralize(active.length, "task")} in progress.`
  );

  if (openBlockers.length > 0) {
    paragraphs.push(
      `The team is currently tracking ${openBlockers.length} open ${pluralize(
        openBlockers.length,
        "blocker"
      )}. These blockers should be reviewed during the next team sync to avoid slowing project progress.`
    );
  } else {
    paragraphs.push(
      `No open blockers are listed for this report, which suggests the team is not currently blocked by any tracked issues.`
    );
  }

  paragraphs.push(
    `${resolvedBlockers.length} ${pluralize(
      resolvedBlockers.length,
      "blocker"
    )} were resolved this week. ${checkins.length} ${pluralize(
      checkins.length,
      "check-in"
    )} were submitted, giving visibility into progress, upcoming work, and team health.`
  );

  if (workload.length > 0) {
    paragraphs.push(
      `Workload distribution is included below to show how active tasks are spread across team members.`
    );
  }

  return paragraphs.join(" ");
}

function createWorkflowNotes(data) {
  const workflow = String(
    data.workflow || data.project?.workflow || data.workflow_type || ""
  ).toLowerCase();

  const completed = getCompletedTasks(data).length;
  const active = getActiveTasks(data).length;
  const openBlockers = getOpenBlockers(data).length;

  if (workflow.includes("scrum")) {
    return `Scrum workflow note: This report should be reviewed as part of sprint tracking. The team completed ${completed} ${pluralize(
      completed,
      "task"
    )}, has ${active} active ${pluralize(
      active,
      "task"
    )}, and should address ${openBlockers} open ${pluralize(
      openBlockers,
      "blocker"
    )} during sprint planning or standup.`;
  }

  if (workflow.includes("kanban")) {
    return `Kanban workflow note: This report should be used to monitor task flow across the board. The team completed ${completed} ${pluralize(
      completed,
      "task"
    )} and has ${active} active ${pluralize(
      active,
      "task"
    )}. Open blockers should be handled quickly to keep work moving across columns.`;
  }

  if (workflow.includes("xp")) {
    return `XP workflow note: This report should be used to review iteration progress, team communication, and delivery health. The team completed ${completed} ${pluralize(
      completed,
      "task"
    )}, has ${active} active ${pluralize(
      active,
      "task"
    )}, and should use check-ins to identify pairing, testing, or integration risks.`;
  }

  return `Workflow note: This report supports Scrum, Kanban, and XP-style review by summarizing completed work, active work, blockers, check-ins, and workload distribution from project data.`;
}

function renderReport(data) {
  reportState = data;

  const completed = getCompletedTasks(data);
  const active = getActiveTasks(data);
  const openBlockers = getOpenBlockers(data);
  const resolvedBlockers = getResolvedBlockers(data);
  const checkins = data.checkins || [];
  const workload = data.workload || [];

  const start = formatDateLabel(data.range?.start);
  const end = formatDateLabel(data.range?.end);

  if (elements.reportRange) {
    elements.reportRange.textContent = `${start} — ${end}`;
  }

  if (elements.documentDateRange) {
    elements.documentDateRange.textContent = `Report dates: ${start} to ${end}`;
  }

  if (elements.reportNarrative) {
    elements.reportNarrative.textContent = createNarrative(data);
  }

  renderTaskList(
    elements.completedTasksList,
    completed,
    "No completed tasks were recorded during this reporting period."
  );
  renderTaskList(
    elements.activeTasksList,
    active,
    "No active tasks are listed for this reporting period."
  );

  renderBlockerList(
    elements.openBlockersList,
    openBlockers,
    "No open blockers are listed for this reporting period."
  );
  renderBlockerList(
    elements.resolvedBlockersList,
    resolvedBlockers,
    "No resolved blockers were recorded during this reporting period."
  );

  if (elements.checkinSummary) {
    elements.checkinSummary.textContent = checkins.length
      ? `${checkins.length} ${pluralize(checkins.length, "check-in")} submitted during this reporting period.`
      : "No check-ins were submitted during this reporting period.";
  }
  renderCheckins(elements.checkinList, checkins);

  if (elements.workloadSummary) {
    elements.workloadSummary.textContent = workload.length
      ? `Workload distribution is shown below for ${workload.length} ${pluralize(workload.length, "team member")}.`
      : "No workload distribution data is available for this week.";
  }
  renderWorkload(elements.workloadList, workload);

  if (elements.workflowNotes) {
    elements.workflowNotes.textContent = createWorkflowNotes(data);
  }
}

function findMatches(query, data) {
  const lower = query.toLowerCase();
  const found = [];

  const allTasks = [...getCompletedTasks(data), ...getActiveTasks(data)];
  const allBlockers = [...getOpenBlockers(data), ...getResolvedBlockers(data)];
  const checkins = data.checkins || [];
  const workload = data.workload || [];

  allTasks.forEach((task) => {
    const haystack = `${getTaskTitle(task)} ${getTaskDescription(
      task
    )} ${getTaskAssignee(task)} ${getTaskStatus(task)}`.toLowerCase();

    if (haystack.includes(lower)) {
      found.push({
        type: "Task",
        summary: `${getTaskTitle(task)} (${getTaskAssignee(task)})`,
      });
    }
  });

  allBlockers.forEach((blocker) => {
    const haystack = `${getBlockerTitle(blocker)} ${getBlockerDescription(
      blocker
    )} ${getBlockerOwner(blocker)} ${blocker.status || ""}`.toLowerCase();

    if (haystack.includes(lower)) {
      found.push({
        type: "Blocker",
        summary: `${getBlockerTitle(blocker)} (${getBlockerOwner(blocker)})`,
      });
    }
  });

  checkins.forEach((entry) => {
    const haystack = `${entry.full_name || ""} ${entry.name || ""} ${
      entry.work_done || ""
    } ${entry.work_planned || ""} ${entry.status_mood || ""}`.toLowerCase();

    if (haystack.includes(lower)) {
      found.push({
        type: "Check-in",
        summary: `${entry.full_name || entry.name || "Team member"}: ${
          entry.work_done || "submitted an update"
        }`,
      });
    }
  });

  workload.forEach((item) => {
    const haystack = `${item.full_name || ""} ${item.name || ""} ${
      item.task_count || 0
    }`.toLowerCase();

    if (haystack.includes(lower)) {
      found.push({
        type: "Workload",
        summary: `${item.full_name || item.name || "Team member"} has ${
          item.task_count || 0
        } ${pluralize(Number(item.task_count || 0), "task")}`,
      });
    }
  });

  return found;
}

function answerQuery(query, data) {
  if (!data) {
    return "The weekly report is still loading. Please try again once the report appears.";
  }

  const lower = query.toLowerCase();

  const completed = getCompletedTasks(data);
  const active = getActiveTasks(data);
  const openBlockers = getOpenBlockers(data);
  const resolvedBlockers = getResolvedBlockers(data);
  const checkins = data.checkins || [];
  const workload = data.workload || [];

  if (/(summary|overview|recap|report)/.test(lower)) {
    return createNarrative(data);
  }

  if (/(completed|done|finished|delivered)/.test(lower)) {
    if (completed.length === 0) {
      return "No completed tasks were recorded in this weekly report.";
    }

    return `The team completed ${completed.length} ${pluralize(
      completed.length,
      "task"
    )}: ${completed.map((task) => getTaskTitle(task)).join(", ")}.`;
  }

  if (/(active|current|progress|in progress|working on|todo|to do)/.test(lower)) {
    if (active.length === 0) {
      return "No active tasks are listed in this weekly report.";
    }

    return `There are ${active.length} active ${pluralize(active.length, "task")}: ${active
      .map((task) => `${getTaskTitle(task)} (${getTaskAssignee(task)})`)
      .join(", ")}.`;
  }

  if (/(blocker|blocked|stuck|issue|risk)/.test(lower)) {
    if (openBlockers.length === 0) {
      return `There are no open blockers listed in this weekly report. ${resolvedBlockers.length} ${pluralize(
        resolvedBlockers.length,
        "blocker"
      )} were resolved.`;
    }

    return `There are ${openBlockers.length} open ${pluralize(
      openBlockers.length,
      "blocker"
    )}: ${openBlockers
      .map((blocker) => getBlockerTitle(blocker))
      .join(", ")}. ${resolvedBlockers.length} ${pluralize(
      resolvedBlockers.length,
      "blocker"
    )} were resolved.`;
  }

  if (/(resolved|fixed|closed)/.test(lower)) {
    if (resolvedBlockers.length === 0) {
      return "No resolved blockers were recorded in this weekly report.";
    }

    return `${resolvedBlockers.length} ${pluralize(
      resolvedBlockers.length,
      "blocker"
    )} were resolved: ${resolvedBlockers.map((blocker) => getBlockerTitle(blocker)).join(", ")}.`;
  }

  if (/(check-in|checkin|participation|update|status|reported)/.test(lower)) {
    if (checkins.length === 0) {
      return "No check-ins were submitted during this reporting period.";
    }

    return `${checkins.length} ${pluralize(
      checkins.length,
      "check-in"
    )} were submitted. The report includes updates on completed work, planned work, and team status.`;
  }

  if (/(workload|distribution|balance|assigned|task count|load)/.test(lower)) {
    if (workload.length === 0) {
      return "No workload distribution data is available in this weekly report.";
    }

    const sorted = [...workload].sort(
      (a, b) => Number(b.task_count || 0) - Number(a.task_count || 0)
    );

    return `Workload is spread across ${sorted.length} ${pluralize(
      sorted.length,
      "team member"
    )}: ${sorted
      .map(
        (item) =>
          `${item.full_name || item.name || "Team member"} has ${
            item.task_count || 0
          } ${pluralize(Number(item.task_count || 0), "task")}`
      )
      .join(", ")}.`;
  }

  if (/(scrum|kanban|xp|workflow)/.test(lower)) {
    return createWorkflowNotes(data);
  }

  const matches = findMatches(query, data);

  if (matches.length > 0) {
    return `I found ${matches.length} matching item${matches.length === 1 ? "" : "s"} in the report: ${matches
      .slice(0, 5)
      .map((match) => `${match.type}: ${match.summary}`)
      .join("; ")}.`;
  }

  return "I could not find a direct answer in this weekly report. Try asking about completed tasks, active tasks, blockers, check-ins, workload, or workflow notes.";
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

  const response = answerQuery(query, reportState);
  addChatMessage(response, "bot");

  input.value = "";
}

async function loadWeeklyReport() {
  clearError();

  const pageContent = document.getElementById("page-content");
  showLoading(pageContent, "Loading weekly report…");

  try {
    const payload = await apiFetch(API_URL);
    renderReport(payload);

    clearElement(elements.chatLog);
    addChatMessage(
      "Weekly report loaded. Ask me about completed tasks, active work, blockers, check-ins, workload, or workflow notes.",
      "bot"
    );
  } catch (error) {
    setError(error.message || "Unable to load weekly report.");
  } finally {
    hideLoading(pageContent);
  }
}

if (typeof document !== "undefined") {
  const project = getCurrentProject();
  const dashboardUrl = dashboardPathFor(project?.workflow);
  const dashboardLink = document.getElementById("nav-dashboard");
  const teamLink = document.getElementById("nav-team");
  if (dashboardLink) dashboardLink.href = dashboardUrl;
  if (teamLink) teamLink.href = `${dashboardUrl}#team`;

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
