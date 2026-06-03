// ─────────────────────────────────────────────────────────────────────────
// Task Card Component
//
// Renders a single task as a self-contained <article> for the kanban, scrum,
// and xp dashboards. The same element serves two modes:
//
//   • read-only  — plain labels (omit `onChange`).
//   • interactive — inline <select>/<input> controls that call `onChange`
//                   with only the field that changed (pass `onChange`).
//
// Missing task fields are tolerated: the card degrades gracefully rather than
// throwing (e.g. no priority → "low", no description → the row is dropped).
//
// Public API lives at the bottom: createTaskCard() and setTaskCardStatus().
// ─────────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────
const PRIORITY_ICONS = {
  urgent: "⚠",
  high: "↑",
  medium: "→",
  low: "↓",
};

// Priority values in display order (also the <select> option order).
const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];

const STATUS_LABELS = {
  todo: "todo",
  "in-progress": "in progress",
  done: "done",
  blocked: "blocked",
};

const REVIEW_STATUS_LABELS = {
  "not-required": "no review",
  pending: "pending review",
  approved: "approved",
  "needs-revision": "needs revision",
};

// ── DOM + formatting helpers ──────────────────────────
/**
 * Terse element factory. `opts` covers the attributes used across this file;
 * remaining args are children (DOM nodes or strings → text nodes).
 */
function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.title != null) node.title = opts.title;
  if (opts.ariaLabel != null) node.setAttribute("aria-label", opts.ariaLabel);
  if (opts.type != null) node.type = opts.type;
  if (opts.placeholder != null) node.placeholder = opts.placeholder;
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

// Replaces whichever `${prefix}*` modifier class is present with `prefix+value`,
// leaving every other class on the node untouched.
function swapPrefixedClass(node, prefix, value) {
  [...node.classList].forEach((c) => {
    if (c.startsWith(prefix)) node.classList.remove(c);
  });
  node.classList.add(`${prefix}${value}`);
}

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

// Builds an avatar bubble showing a person's initials (or "?" when nobody).
// `markEmpty` adds the --empty modifier for unassigned interactive slots.
// `isAgent` adds the --agent modifier so the avatar renders with the AI
// agent badge styling (used when the assignee is an AI agent).
function buildAvatar(source, { markEmpty = false, extraClass = null, isAgent = false } = {}) {
  const avatar = el("span", {
    className: "task-card__avatar",
    text: source ? initials(source) : "?",
  });
  if (markEmpty && !source) avatar.classList.add("task-card__avatar--empty");
  if (isAgent) avatar.classList.add("task-card__avatar--agent");
  if (extraClass) avatar.classList.add(extraClass);
  return avatar;
}

// Appends `{ value, label, selected }` options to a <select>.
function addOptions(select, options) {
  for (const { value, label, selected } of options) {
    const opt = el("option", { text: label });
    opt.value = value;
    if (selected) opt.selected = true;
    select.appendChild(opt);
  }
}

// ── Change notification ───────────────────────────────
// Invokes the consumer's onChange with the single changed field, swallowing
// both sync throws and rejected promises so a card never breaks the page.
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

// ── Inline-edit helpers ───────────────────────────────
// Wires Enter=submit / Escape=cancel / blur=submit onto a text input, with a
// one-shot guard so blur-after-Enter doesn't fire the callback twice.
function attachInlineText(input, { onSubmit, onCancel }) {
  let done = false;
  const finish = (fn) => {
    if (done) return;
    done = true;
    fn();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(onSubmit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(onCancel);
    }
  });
  input.addEventListener("blur", () => finish(onSubmit));
}

// Wires a numeric input that commits on Enter/blur and reverts on Escape or
// invalid input (empty, non-finite, negative). `onCommit` fires only when the
// normalized value actually changed.
function attachNumberCommit(input, { onCommit }) {
  let lastValue = input.value;

  const commit = () => {
    const raw = input.value.trim();
    const num = Number(raw);
    if (raw === "" || !Number.isFinite(num) || num < 0) {
      input.value = lastValue;
      return;
    }
    const normalized = String(num);
    input.value = normalized;
    if (normalized !== lastValue) {
      lastValue = normalized;
      onCommit(num);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = lastValue;
      input.blur();
    }
  });
  input.addEventListener("blur", commit);
}

// ── Interactive control builders ──────────────────────
function buildPrioritySelect(task, currentPriority, iconEl, textEl, ctx) {
  const select = el("select", {
    className: "task-card__select task-card__select--priority",
    ariaLabel: "Priority",
  });
  addOptions(
    select,
    PRIORITY_ORDER.map((p) => ({
      value: p,
      label: capitalize(p),
      selected: p === currentPriority,
    }))
  );

  select.addEventListener("change", (e) => {
    const newPriority = e.target.value;
    swapPrefixedClass(ctx.card, "task-card--priority-", newPriority);
    iconEl.textContent = PRIORITY_ICONS[newPriority] ?? "";
    if (textEl) textEl.textContent = capitalize(newPriority);
    notifyChange(ctx, task, { priority: newPriority });
  });

  return select;
}

function buildStatusSelect(task, ctx) {
  const currentStatus = task.status ?? "todo";
  const select = el("select", {
    className: `task-card__select task-card__select--status task-card__status task-card__status--${currentStatus}`,
  });
  addOptions(
    select,
    Object.entries(STATUS_LABELS)
      .filter(([value]) => value !== "blocked")
      .map(([value, label]) => ({ value, label, selected: value === currentStatus }))
  );

  select.addEventListener("change", (e) => {
    const newStatus = e.target.value;
    swapPrefixedClass(select, "task-card__status--", newStatus);
    notifyChange(ctx, task, { status: newStatus });
  });

  return select;
}

// Shared by the points (step 1) and hours (step 0.5) editors.
function buildNumberInput({ className, ariaLabel, step, value, field, task, ctx }) {
  const input = el("input", { type: "number", className, ariaLabel });
  input.min = "0";
  input.step = step;
  input.value = String(value ?? "");
  attachNumberCommit(input, {
    onCommit: (num) => notifyChange(ctx, task, { [field]: num }),
  });
  return input;
}

function buildPointsInput(task, ctx) {
  return buildNumberInput({
    className: "task-card__points-input",
    ariaLabel: "Story points",
    step: "1",
    value: task.story_points,
    field: "story_points",
    task,
    ctx,
  });
}

function buildHoursInput(task, ctx) {
  const input = buildNumberInput({
    className: "task-card__hours-input",
    ariaLabel: "Estimated hours",
    step: "0.5",
    value: task.estimate_hours,
    field: "estimate_hours",
    task,
    ctx,
  });
  return el("span", { className: "task-card__hours-edit" }, "~", input, "h");
}

function buildTagsControl(task, projectType, ctx) {
  const tagRow = el("div", { className: "task-card__tags" });

  // Scrum story-type pill is fixed (not user-editable) and sits before the
  // editable tags, so it lives outside the re-rendered region below.
  if (projectType === "scrum" && task.story_type) {
    tagRow.appendChild(el("span", { className: "task-card__tag", text: task.story_type }));
  }

  const tags = [...(task.tags ?? [])];

  // Re-renders just the editable pills + add affordance (the fixed pill stays).
  const render = () => {
    tagRow
      .querySelectorAll(".task-card__tag--editable, .task-card__tag-add, .task-card__tag-input")
      .forEach((node) => node.remove());

    tags.forEach((tag, idx) => {
      const remove = el("button", {
        type: "button",
        className: "task-card__tag-remove",
        text: "×",
        title: `Remove "${tag}"`,
      });
      remove.addEventListener("click", () => {
        tags.splice(idx, 1);
        render();
        notifyChange(ctx, task, { tags: [...tags] });
      });
      tagRow.appendChild(
        el("span", { className: "task-card__tag task-card__tag--editable" }, tag, remove)
      );
    });

    const addBtn = el("button", {
      type: "button",
      className: "task-card__tag-add",
      text: "+ Add tag",
    });
    addBtn.addEventListener("click", () => {
      addBtn.remove();
      const input = el("input", {
        type: "text",
        className: "task-card__tag-input",
        placeholder: "Tag",
      });
      input.maxLength = 24;
      tagRow.appendChild(input);
      input.focus();

      attachInlineText(input, {
        onSubmit: () => {
          const v = input.value.trim();
          if (v && !tags.includes(v)) {
            tags.push(v);
            render();
            notifyChange(ctx, task, { tags: [...tags] });
          } else {
            render();
          }
        },
        onCancel: render,
      });
    });
    tagRow.appendChild(addBtn);
  };

  render();
  return tagRow;
}

function buildBlockerControl(task, ctx) {
  const wrapper = el("div", { className: "task-card__blocker-control" });
  const state = { blocked: !!task.is_blocked, reason: task.blocker_reason ?? "" };

  // Forward-declared so the two render branches below can re-invoke it.
  let render;

  const renderBlocked = () => {
    wrapper.innerHTML = "";
    const remove = el("button", {
      type: "button",
      className: "task-card__blocker-remove",
      text: "✕",
      title: "Remove blocker",
    });
    remove.addEventListener("click", () => {
      state.blocked = false;
      state.reason = "";
      render();
      notifyChange(ctx, task, { is_blocked: false, blocker_reason: null });
    });

    const icon = el("span", { className: "task-card__blocker-icon", text: "⊘" });
    wrapper.appendChild(
      el("div", { className: "task-card__blocker" }, icon, state.reason || "Blocked", remove)
    );
  };

  const renderAdd = () => {
    wrapper.innerHTML = "";
    const button = el("button", {
      type: "button",
      className: "task-card__blocker-add",
      text: "+ Add blocker",
    });
    button.addEventListener("click", () => {
      wrapper.innerHTML = "";
      const input = el("input", {
        type: "text",
        className: "task-card__blocker-input",
        placeholder: "Why is this blocked?",
      });
      wrapper.appendChild(input);
      input.focus();

      attachInlineText(input, {
        onSubmit: () => {
          const v = input.value.trim();
          if (v) {
            state.blocked = true;
            state.reason = v;
            render();
            notifyChange(ctx, task, { is_blocked: true, blocker_reason: v });
          } else {
            render();
          }
        },
        onCancel: render,
      });
    });
    wrapper.appendChild(button);
  };

  render = () => (state.blocked ? renderBlocked() : renderAdd());
  render();
  return wrapper;
}

// Assignee dropdown keyed by user_id. Updates `avatarEl` live on change.
function buildAssigneeSelect(task, members, avatarEl, ctx) {
  const select = el("select", {
    className: "task-card__select task-card__select--assignee",
    ariaLabel: "Assignee",
  });
  addOptions(select, [
    { value: "", label: "Unassigned" },
    ...members.map((m) => ({ value: String(m.user_id), label: m.full_name ?? "" })),
  ]);

  // Prefer the explicit id; fall back to matching the display name.
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
    avatarEl.textContent = newMember ? initials(newMember.full_name) : "?";
    avatarEl.classList.toggle("task-card__avatar--empty", !newMember);
    notifyChange(ctx, task, { assigned_to: newId });
  });

  return select;
}

// XP pair-partner dropdown keyed by full name (no backend id for pairs).
function buildPairSelect(task, members, avatarEl, ctx) {
  const select = el("select", {
    className: "task-card__select task-card__select--assignee",
    ariaLabel: "Pair partner",
  });
  addOptions(select, [
    { value: "", label: "No pair" },
    ...members.map((m) => ({ value: m.full_name ?? "", label: m.full_name ?? "" })),
  ]);
  select.value = task.pair_assignee ?? "";

  select.addEventListener("change", (e) => {
    const v = e.target.value;
    avatarEl.textContent = v ? initials(v) : "?";
    avatarEl.classList.toggle("task-card__avatar--empty", !v);
    notifyChange(ctx, task, { pair_assignee: v || null });
  });

  return select;
}

// ── Sections ──────────────────────────────────────────
function buildBanner(task, projectType, ctx) {
  const priority = task.priority ?? "low";
  const banner = el("div", { className: "task-card__banner" });

  const label = el("span", { className: "task-card__priority" });
  const icon = el("span", {
    className: "task-card__priority-icon",
    text: PRIORITY_ICONS[priority] ?? "",
  });
  const sprintSuffix = projectType === "scrum" && task.sprint ? ` · ${task.sprint}` : "";

  if (ctx?.interactive) {
    const textEl = el("span", {
      className: "task-card__priority-text",
      text: capitalize(priority),
    });
    const target = el(
      "span",
      { className: "task-card__priority-target" },
      icon,
      textEl,
      buildPrioritySelect(task, priority, icon, textEl, ctx)
    );
    label.appendChild(target);
    if (sprintSuffix) label.append(sprintSuffix);
  } else {
    label.append(icon, capitalize(priority) + sprintSuffix);
  }
  banner.appendChild(label);

  const meta = el("div", { className: "task-card__banner-meta" });
  meta.appendChild(
    el("span", { className: "task-card__due-date", text: formatDueDate(task.due_date) })
  );

  if (projectType === "scrum" && task.story_points != null) {
    meta.appendChild(
      ctx?.interactive
        ? buildPointsInput(task, ctx)
        : el("span", { className: "task-card__points", text: String(task.story_points) })
    );
  }

  if (projectType === "xp" && task.estimate_hours != null) {
    meta.appendChild(
      ctx?.interactive
        ? buildHoursInput(task, ctx)
        : el("span", { className: "task-card__hours", text: `~${task.estimate_hours}h` })
    );
  }

  banner.appendChild(meta);
  return banner;
}

// Read-only blocker chip (interactive cards use buildBlockerControl instead).
function buildBlockerChip(task) {
  const icon = el("span", { className: "task-card__blocker-icon", text: "⊘" });
  return el("div", { className: "task-card__blocker" }, icon, task.blocker_reason ?? "Blocked");
}

// Read-only tag row, with the scrum story-type prepended.
function buildTagRow(task, projectType) {
  const tags = [...(task.tags ?? [])];
  if (projectType === "scrum" && task.story_type) tags.unshift(task.story_type);
  if (tags.length === 0) return null;

  const tagRow = el("div", { className: "task-card__tags" });
  for (const tag of tags) {
    tagRow.appendChild(el("span", { className: "task-card__tag", text: tag }));
  }
  return tagRow;
}

function buildBody(task, projectType, ctx) {
  const body = el("div", { className: "task-card__body" });

  const title = el("h3", { className: "task-card__title", text: task.title ?? "" });
  body.appendChild(title);

  if (ctx?.interactive) {
    body.appendChild(buildBlockerControl(task, ctx));
  } else if (task.is_blocked) {
    body.appendChild(buildBlockerChip(task));
  }

  if (task.description) {
    const description = el("p", {
      className: "task-card__description",
      text: task.description,
      title: "Click to expand",
    });
    body.appendChild(description);

    title.classList.add("task-card__title--clickable");
    title.title = "Click to expand description";

    const toggle = () => description.classList.toggle("task-card__description--expanded");
    title.addEventListener("click", toggle);
    description.addEventListener("click", toggle);
  }

  if (ctx?.interactive) {
    body.appendChild(buildTagsControl(task, projectType, ctx));
  } else {
    const tagRow = buildTagRow(task, projectType);
    if (tagRow) body.appendChild(tagRow);
  }

  return body;
}

// Interactive XP footer: stacked assignee + pair groups whose dropdowns
// mutually exclude each other's current pick (you can't pair with yourself).
function buildXpAssigneeGroups(task, ctx) {
  const buildGroup = (avatarSource, ariaName, selectBuilder) => {
    const avatar = buildAvatar(avatarSource, { markEmpty: true });
    const select = selectBuilder(avatar);
    const group = el("div", { className: "task-card__assignee-group" }, avatar, select);
    group.title = ariaName;
    return { group, select };
  };

  const primary = buildGroup(task.full_name, "Assignee", (avatar) =>
    buildAssigneeSelect(task, ctx.members, avatar, ctx)
  );
  const pair = buildGroup(task.pair_assignee, "Pair partner", (avatar) =>
    buildPairSelect(task, ctx.members, avatar, ctx)
  );

  const syncDisabled = () => {
    const primaryMember = ctx.members.find((m) => String(m.user_id) === primary.select.value);
    const pairMember = ctx.members.find((m) => m.full_name === pair.select.value);
    const blockedNameForPair = primaryMember ? primaryMember.full_name : "";
    const blockedIdForPrimary = pairMember ? String(pairMember.user_id) : "";

    [...pair.select.options].forEach((opt) => {
      opt.disabled = opt.value !== "" && opt.value === blockedNameForPair;
    });
    [...primary.select.options].forEach((opt) => {
      opt.disabled = opt.value !== "" && opt.value === blockedIdForPrimary;
    });
  };

  primary.select.addEventListener("change", syncDisabled);
  pair.select.addEventListener("change", syncDisabled);
  syncDisabled();

  return [primary.group, pair.group];
}

// Read-only assignee display: avatar(s) plus either an editable dropdown
// (when members are known) or a plain name label.
function buildReadonlyAssignees(task, projectType, ctx, canEditAssignee) {
  const avatars = el("div", { className: "task-card__avatars" });
  // Pass through is_agent so the avatar gets the agent-badge modifier.
  const primary = buildAvatar(task.full_name, { isAgent: task.is_agent });
  avatars.appendChild(primary);

  let pairFirstName = null;
  if (projectType === "xp" && task.pair_assignee) {
    avatars.appendChild(buildAvatar(task.pair_assignee, { extraClass: "task-card__avatar--pair" }));
    [pairFirstName] = task.pair_assignee.split(/\s+/);
  }

  const nodes = [avatars];
  if (canEditAssignee) {
    nodes.push(buildAssigneeSelect(task, ctx.members, primary, ctx));
  } else {
    let labelText = task.full_name ?? "Unassigned";
    if (pairFirstName) {
      const [primaryFirst] = (task.full_name ?? "").split(/\s+/);
      labelText = `${primaryFirst || "Unassigned"} & ${pairFirstName}`;
    }
    nodes.push(el("span", { className: "task-card__assignee-name", text: labelText }));
  }
  return nodes;
}

function buildFooter(task, projectType, ctx) {
  const footer = el("div", { className: "task-card__footer" });
  const assignees = el("div", { className: "task-card__assignees" });

  const canEditAssignee = ctx?.interactive && Array.isArray(ctx.members);
  const isXpInteractive = projectType === "xp" && canEditAssignee && ctx.editPair;

  if (isXpInteractive) {
    assignees.classList.add("task-card__assignees--stacked");
    buildXpAssigneeGroups(task, ctx).forEach((group) => assignees.appendChild(group));
  } else {
    buildReadonlyAssignees(task, projectType, ctx, canEditAssignee).forEach((node) =>
      assignees.appendChild(node)
    );
  }

  // AI badge — surfaces that this work is being done by an agent so the
  // reviewer pill below makes sense without extra explanation.
  if (task.is_agent) {
    const aiBadge = document.createElement("span");
    aiBadge.className = "task-card__ai-badge";
    aiBadge.textContent = "AI";
    assignees.appendChild(aiBadge);
  }

  footer.appendChild(assignees);

  if (ctx?.interactive) {
    footer.appendChild(buildStatusSelect(task, ctx));
  } else {
    const statusKey = task.is_blocked ? "blocked" : (task.status ?? "todo");
    footer.appendChild(
      el("span", {
        className: `task-card__status task-card__status--${statusKey}`,
        text: STATUS_LABELS[statusKey] ?? statusKey,
      })
    );
  }

  return footer;
}

/**
 * Build the optional "Reviewer · review_status" row. Returns null when
 * the task has no reviewer and no meaningful review status — non-agent
 * tasks without oversight stay visually clean.
 */
function buildReviewRow(task) {
  const status = task.review_status ?? "not-required";
  const hasReviewer = task.reviewer_id != null || task.reviewer_name;
  if (!hasReviewer && status === "not-required") return null;

  const row = document.createElement("div");
  row.className = "task-card__review-row";

  const reviewerLabel = document.createElement("span");
  reviewerLabel.className = "task-card__reviewer";
  reviewerLabel.textContent = task.reviewer_name
    ? `Reviewer: ${task.reviewer_name}`
    : "Reviewer: unassigned";
  row.appendChild(reviewerLabel);

  const pill = document.createElement("span");
  pill.className = `task-card__review-pill task-card__review-pill--${status}`;
  pill.textContent = REVIEW_STATUS_LABELS[status] ?? status;
  row.appendChild(pill);

  return row;
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
 * @param {boolean} [options.editPair=true]
 *        XP only. When true (default), an interactive XP card renders both an
 *        assignee and a pair-partner `<select>`. Set false to render just the
 *        primary assignee dropdown (e.g. while `pair_assignee` has no backend
 *        persistence) — the pair partner then shows as a read-only avatar.
 *
 * @returns {HTMLElement} A detached <article> ready to be appended.
 */
export function createTaskCard(task, projectType = "kanban", options = {}) {
  const { compact = false, members = null, onChange = null, editPair = true } = options;
  const priority = task.priority ?? "low";

  const card = el("article", {
    className: `task-card task-card--priority-${priority} task-card--${projectType}`,
  });
  if (compact) card.classList.add("task-card--compact");
  card.dataset.taskId = task.task_id;

  const ctx = {
    card,
    members,
    onChange,
    interactive: typeof onChange === "function",
    editPair,
  };

  card.appendChild(buildBanner(task, projectType, ctx));
  card.appendChild(buildBody(task, projectType, ctx));
  // Review row (AI-agent reviewer + status) only appears when the task has
  // reviewer metadata — buildReviewRow returns null for human tasks.
  const reviewRow = buildReviewRow(task);
  if (reviewRow) card.appendChild(reviewRow);
  card.appendChild(buildFooter(task, projectType, ctx));

  return card;
}

/**
 * Updates an existing card's status control in place. Leaves it alone if the
 * card is currently in a blocked state (the blocker takes precedence).
 *
 * Works for both card modes: the read-only `<span>` pill and the interactive
 * `<select>` (which also carries the `task-card__select` classes). For the
 * select we update `.value` — setting `textContent` would delete its
 * `<option>`s — and only swap the `task-card__status--*` modifier class so the
 * select styling survives.
 * @param {HTMLElement} card
 * @param {"todo"|"in-progress"|"done"} status
 */
export function setTaskCardStatus(card, status) {
  const pill = card.querySelector(".task-card__status");
  if (!pill) return;
  if (pill.classList.contains("task-card__status--blocked")) return;

  swapPrefixedClass(pill, "task-card__status--", status);

  if (pill.tagName === "SELECT") {
    pill.value = status;
  } else {
    pill.textContent = STATUS_LABELS[status] ?? status;
  }
}
