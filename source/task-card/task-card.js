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

function notifyChange(ctx, task, fields) {
  if (!ctx?.onChange) return;
  try {
    const result = ctx.onChange(task.task_id, fields);
    if (result && typeof result.catch === "function") {
      result.catch((err) => console.error("Task card onChange failed:", err));
    }
  } catch (err) {
    console.error("Task card onChange threw:", err);
  }
}

function buildPrioritySelect(task, currentPriority, iconEl, textEl, ctx) {
  const select = document.createElement("select");
  select.className = "task-card__select task-card__select--priority";
  select.setAttribute("aria-label", "Priority");
  ["urgent", "high", "medium", "low"].forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = capitalize(p);
    if (p === currentPriority) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    const newPriority = e.target.value;
    [...ctx.card.classList].forEach((c) => {
      if (c.startsWith("task-card--priority-")) ctx.card.classList.remove(c);
    });
    ctx.card.classList.add(`task-card--priority-${newPriority}`);
    iconEl.textContent = PRIORITY_ICONS[newPriority] ?? "";
    if (textEl) textEl.textContent = capitalize(newPriority);
    notifyChange(ctx, task, { priority: newPriority });
  });

  return select;
}

function buildStatusSelect(task, ctx) {
  const select = document.createElement("select");
  const currentStatus = task.status ?? "todo";
  select.className = `task-card__select task-card__select--status task-card__status task-card__status--${currentStatus}`;

  Object.entries(STATUS_LABELS).forEach(([value, labelText]) => {
    if (value === "blocked") return;
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = labelText;
    if (value === currentStatus) opt.selected = true;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    const newStatus = e.target.value;
    [...select.classList].forEach((c) => {
      if (c.startsWith("task-card__status--")) select.classList.remove(c);
    });
    select.classList.add(`task-card__status--${newStatus}`);
    notifyChange(ctx, task, { status: newStatus });
  });

  return select;
}

function buildBlockerControl(task, ctx) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-card__blocker-control";

  const state = {
    blocked: !!task.is_blocked,
    reason: task.blocker_reason ?? "",
  };

  let render;

  const renderBlocked = () => {
    wrapper.innerHTML = "";
    const chip = document.createElement("div");
    chip.className = "task-card__blocker";

    const icon = document.createElement("span");
    icon.className = "task-card__blocker-icon";
    icon.textContent = "⊘";
    chip.appendChild(icon);

    chip.appendChild(document.createTextNode(state.reason || "Blocked"));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-card__blocker-remove";
    remove.textContent = "✕";
    remove.title = "Remove blocker";
    remove.addEventListener("click", () => {
      state.blocked = false;
      state.reason = "";
      render();
      notifyChange(ctx, task, { is_blocked: false, blocker_reason: null });
    });
    chip.appendChild(remove);

    wrapper.appendChild(chip);
  };

  const renderAdd = () => {
    wrapper.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-card__blocker-add";
    button.textContent = "+ Add blocker";
    button.addEventListener("click", () => {
      wrapper.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "task-card__blocker-input";
      input.placeholder = "Why is this blocked?";
      wrapper.appendChild(input);
      input.focus();

      let committed = false;
      const submit = () => {
        if (committed) return;
        committed = true;
        const v = input.value.trim();
        if (v) {
          state.blocked = true;
          state.reason = v;
          render();
          notifyChange(ctx, task, { is_blocked: true, blocker_reason: v });
        } else {
          render();
        }
      };
      const cancel = () => {
        if (committed) return;
        committed = true;
        render();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", submit);
    });
    wrapper.appendChild(button);
  };

  render = () => {
    if (state.blocked) renderBlocked();
    else renderAdd();
  };
  render();
  return wrapper;
}

function buildAssigneeSelect(task, members, avatarEl, pairFirstName, ctx) {
  const select = document.createElement("select");
  select.className = "task-card__select task-card__select--assignee";

  const formatLabel = (firstName) =>
    pairFirstName ? `${firstName || "Unassigned"} & ${pairFirstName}` : firstName || "Unassigned";

  const unassigned = document.createElement("option");
  unassigned.value = "";
  unassigned.textContent = formatLabel("Unassigned");
  select.appendChild(unassigned);

  members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.user_id);
    const first = (m.full_name ?? "").split(/\s+/)[0] || m.full_name || "";
    opt.textContent = pairFirstName ? formatLabel(first) : m.full_name ?? "";
    select.appendChild(opt);
  });

  let currentId = task.assigned_to != null ? String(task.assigned_to) : "";
  if (currentId === "" && task.full_name) {
    const match = members.find((m) => m.full_name === task.full_name);
    if (match) currentId = String(match.user_id);
  }
  select.value = currentId;

  select.addEventListener("change", (e) => {
    const rawValue = e.target.value;
    const newId = rawValue === "" ? null : Number(rawValue);
    const newMember = newId == null ? null : members.find((m) => String(m.user_id) === rawValue);
    avatarEl.textContent = initials(newMember?.full_name);
    notifyChange(ctx, task, { assigned_to: newId });
  });

  return select;
}

// ── Sections ──────────────────────────────────────────
function buildBanner(task, projectType, ctx) {
  const priority = task.priority ?? "low";
  const banner = document.createElement("div");
  banner.className = "task-card__banner";

  const label = document.createElement("span");
  label.className = "task-card__priority";

  const icon = document.createElement("span");
  icon.className = "task-card__priority-icon";
  icon.textContent = PRIORITY_ICONS[priority] ?? "";

  if (ctx?.interactive) {
    const target = document.createElement("span");
    target.className = "task-card__priority-target";
    target.appendChild(icon);

    const textEl = document.createElement("span");
    textEl.className = "task-card__priority-text";
    textEl.textContent = capitalize(priority);
    target.appendChild(textEl);

    target.appendChild(buildPrioritySelect(task, priority, icon, textEl, ctx));
    label.appendChild(target);

    if (projectType === "scrum" && task.sprint) {
      label.appendChild(document.createTextNode(` · ${task.sprint}`));
    }
  } else {
    label.appendChild(icon);
    let text = capitalize(priority);
    if (projectType === "scrum" && task.sprint) {
      text += ` · ${task.sprint}`;
    }
    label.appendChild(document.createTextNode(text));
  }
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

function buildBody(task, projectType, ctx) {
  const body = document.createElement("div");
  body.className = "task-card__body";

  const title = document.createElement("h3");
  title.className = "task-card__title";
  title.textContent = task.title ?? "";
  body.appendChild(title);

  if (ctx?.interactive) {
    body.appendChild(buildBlockerControl(task, ctx));
  } else if (task.is_blocked) {
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

function buildFooter(task, projectType, ctx) {
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

  let pairFirstName = null;
  if (projectType === "xp" && task.pair_assignee) {
    const pair = document.createElement("span");
    pair.className = "task-card__avatar task-card__avatar--pair";
    pair.textContent = initials(task.pair_assignee);
    avatars.appendChild(pair);

    const [pairFirst] = task.pair_assignee.split(/\s+/);
    pairFirstName = pairFirst;
  }

  assignees.appendChild(avatars);

  const canEditAssignee = ctx?.interactive && Array.isArray(ctx.members);
  if (canEditAssignee) {
    assignees.appendChild(buildAssigneeSelect(task, ctx.members, primary, pairFirstName, ctx));
  } else {
    let labelText = task.full_name ?? "Unassigned";
    if (pairFirstName) {
      const [primaryFirst] = (task.full_name ?? "").split(/\s+/);
      labelText = `${primaryFirst || "Unassigned"} & ${pairFirstName}`;
    }
    const name = document.createElement("span");
    name.className = "task-card__assignee-name";
    name.textContent = labelText;
    assignees.appendChild(name);
  }

  footer.appendChild(assignees);

  if (ctx?.interactive) {
    footer.appendChild(buildStatusSelect(task, ctx));
  } else {
    const statusKey = task.is_blocked ? "blocked" : (task.status ?? "todo");
    const status = document.createElement("span");
    status.className = `task-card__status task-card__status--${statusKey}`;
    status.textContent = STATUS_LABELS[statusKey] ?? statusKey;
    footer.appendChild(status);
  }

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
 * @param {Array<{user_id: number|string, full_name: string}>} [options.members]
 *        When provided alongside `onChange`, the assignee becomes an editable
 *        `<select>` populated from this list.
 * @param {(taskId: number|string, fields: object) => void|Promise<void>} [options.onChange]
 *        Called when the user changes status, priority, or assignee.
 *        `fields` contains only the changed key, e.g. `{ status: "done" }`,
 *        `{ priority: "high" }`, or `{ assigned_to: 4 }` (null = unassigned).
 *        Pass this to make the card interactive; omit to render read-only.
 *
 * @returns {HTMLElement} A detached <article> ready to be appended.
 */
export function createTaskCard(task, projectType = "kanban", options = {}) {
  const { compact = false, members = null, onChange = null } = options;
  const priority = task.priority ?? "low";
  const card = document.createElement("article");
  card.className = `task-card task-card--priority-${priority} task-card--${projectType}`;
  if (compact) card.classList.add("task-card--compact");
  card.dataset.taskId = task.task_id;

  const ctx = {
    card,
    members,
    onChange,
    interactive: typeof onChange === "function",
  };

  card.appendChild(buildBanner(task, projectType, ctx));
  card.appendChild(buildBody(task, projectType, ctx));
  card.appendChild(buildFooter(task, projectType, ctx));

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
