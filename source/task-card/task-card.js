// ── Task Card Component ───────────────────────────────
const PRIORITY_ICONS = {
  urgent: "⚠",
  high: "↑",
  medium: "→",
  low: "↓",
};

const STATUS_LABELS = {
  todo: "todo",
  "in-progress": "in progress",
  done: "done",
  blocked: "blocked",
};

function formatDueDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function capitalize(word) {
  if (!word) return "";
  return word[0].toUpperCase() + word.slice(1);
}

// ── Sections ──────────────────────────────────────────
function buildBanner(task, projectType) {
  const priority = task.priority ?? "low";
  const banner = document.createElement("div");
  banner.className = "task-card__banner";

  const label = document.createElement("span");
  label.className = "task-card__priority";

  const icon = document.createElement("span");
  icon.className = "task-card__priority-icon";
  icon.textContent = PRIORITY_ICONS[priority] ?? "";
  label.appendChild(icon);

  let text = capitalize(priority);
  if (projectType === "scrum" && task.sprint) {
    text += ` · ${task.sprint}`;
  }
  label.appendChild(document.createTextNode(text));
  banner.appendChild(label);

  const meta = document.createElement("div");
  meta.className = "task-card__banner-meta";

  const due = document.createElement("span");
  due.className = "task-card__due-date";
  due.textContent = formatDueDate(task.due_date);
  meta.appendChild(due);

  if (projectType === "scrum" && task.story_points != null) {
    const points = document.createElement("span");
    points.className = "task-card__points";
    points.textContent = String(task.story_points);
    meta.appendChild(points);
  }

  if (projectType === "xp" && task.estimate_hours != null) {
    const hours = document.createElement("span");
    hours.className = "task-card__hours";
    hours.textContent = `~${task.estimate_hours}h`;
    meta.appendChild(hours);
  }

  banner.appendChild(meta);
  return banner;
}

function buildBody(task, projectType) {
  const body = document.createElement("div");
  body.className = "task-card__body";

  const title = document.createElement("h3");
  title.className = "task-card__title";
  title.textContent = task.title ?? "";
  body.appendChild(title);

  if (task.is_blocked) {
    const blocker = document.createElement("div");
    blocker.className = "task-card__blocker";

    const blockerIcon = document.createElement("span");
    blockerIcon.className = "task-card__blocker-icon";
    blockerIcon.textContent = "⊘";
    blocker.appendChild(blockerIcon);

    blocker.appendChild(document.createTextNode(task.blocker_reason ?? "Blocked"));
    body.appendChild(blocker);
  }

  if (task.description) {
    const description = document.createElement("p");
    description.className = "task-card__description";
    description.textContent = task.description;
    description.title = "Click to expand";
    body.appendChild(description);

    title.classList.add("task-card__title--clickable");
    title.title = "Click to expand description";

    const toggle = () => {
      description.classList.toggle("task-card__description--expanded");
    };
    title.addEventListener("click", toggle);
    description.addEventListener("click", toggle);
  }

  const tags = [...(task.tags ?? [])];
  if (projectType === "scrum" && task.story_type) {
    tags.unshift(task.story_type);
  }
  if (tags.length > 0) {
    const tagRow = document.createElement("div");
    tagRow.className = "task-card__tags";
    tags.forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "task-card__tag";
      pill.textContent = tag;
      tagRow.appendChild(pill);
    });
    body.appendChild(tagRow);
  }

  return body;
}

function buildFooter(task, projectType) {
  const footer = document.createElement("div");
  footer.className = "task-card__footer";

  const assignees = document.createElement("div");
  assignees.className = "task-card__assignees";

  const avatars = document.createElement("div");
  avatars.className = "task-card__avatars";

  const primary = document.createElement("span");
  primary.className = "task-card__avatar";
  primary.textContent = initials(task.full_name);
  avatars.appendChild(primary);

  let label = task.full_name ?? "Unassigned";
  if (projectType === "xp" && task.pair_assignee) {
    const pair = document.createElement("span");
    pair.className = "task-card__avatar task-card__avatar--pair";
    pair.textContent = initials(task.pair_assignee);
    avatars.appendChild(pair);

    const [primaryFirst] = (task.full_name ?? "").split(/\s+/);
    const [pairFirst] = task.pair_assignee.split(/\s+/);
    label = `${primaryFirst || "Unassigned"} & ${pairFirst}`;
  }

  assignees.appendChild(avatars);

  const name = document.createElement("span");
  name.className = "task-card__assignee-name";
  name.textContent = label;
  assignees.appendChild(name);

  footer.appendChild(assignees);

  const statusKey = task.is_blocked ? "blocked" : (task.status ?? "todo");
  const status = document.createElement("span");
  status.className = `task-card__status task-card__status--${statusKey}`;
  status.textContent = STATUS_LABELS[statusKey] ?? statusKey;
  footer.appendChild(status);

  return footer;
}

// ── Public API ────────────────────────────────────────
/**
 * Build a task card DOM element for kanban / scrum / xp dashboards.
 *
 * Missing fields are tolerated — the card degrades gracefully (e.g. no
 * priority defaults to "low", no description hides the row entirely).
 *
 * @param {object} task                Task data from the API.
 * @param {number|string} task.task_id          Set on `data-task-id`.
 * @param {string}  task.title                  Card title.
 * @param {string}  [task.description]          Click title/preview to expand.
 * @param {string}  [task.full_name]            Assignee display name.
 * @param {"todo"|"in-progress"|"done"|"blocked"} [task.status="todo"]
 * @param {"urgent"|"high"|"medium"|"low"}        [task.priority="low"]
 * @param {string}  [task.due_date]             ISO date string (YYYY-MM-DD).
 * @param {string[]} [task.tags]                Rendered as pills.
 * @param {boolean} [task.is_blocked]           Shows red blocker chip + status.
 * @param {string}  [task.blocker_reason]       Shown inside the blocker chip.
 * @param {number}  [task.story_points]         Scrum only — circle in banner.
 * @param {string}  [task.sprint]               Scrum only — appended to priority.
 * @param {string}  [task.story_type]           Scrum only — prepended to tags.
 * @param {number}  [task.estimate_hours]       XP only — pill in banner.
 * @param {string}  [task.pair_assignee]        XP only — second avatar + name.
 *
 * @param {"kanban"|"scrum"|"xp"} [projectType="kanban"]
 *        Controls which conditional fields render.
 *
 * @param {object}  [options]
 * @param {boolean} [options.compact=false]     Adds `task-card--compact`
 *        (hides description preview — useful for dense kanban columns).
 *
 * @returns {HTMLElement} A detached <article> ready to be appended.
 */
export function createTaskCard(task, projectType = "kanban", { compact = false } = {}) {
  const priority = task.priority ?? "low";
  const card = document.createElement("article");
  card.className = `task-card task-card--priority-${priority} task-card--${projectType}`;
  if (compact) card.classList.add("task-card--compact");
  card.dataset.taskId = task.task_id;

  card.appendChild(buildBanner(task, projectType));
  card.appendChild(buildBody(task, projectType));
  card.appendChild(buildFooter(task, projectType));

  return card;
}

/**
 * Updates an existing card's status pill in place. Leaves the pill alone if
 * the card is currently in a blocked state (the blocker takes precedence).
 * @param {HTMLElement} card
 * @param {"todo"|"in-progress"|"done"} status
 */
export function setTaskCardStatus(card, status) {
  const pill = card.querySelector(".task-card__status");
  if (!pill) return;
  if (pill.classList.contains("task-card__status--blocked")) return;
  pill.className = `task-card__status task-card__status--${status}`;
  pill.textContent = STATUS_LABELS[status] ?? status;
}
