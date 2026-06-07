// ── Task Creation Modal ───────────────────────────────
//
// Modal also enforces the "agent-assigned tasks need a human reviewer"
// rule on the client side: when the assignee picker lands on an AI
// agent, the reviewer select becomes required and is auto-defaulted to
// that agent's owning human. The API also enforces this — the client
// rule is a UX nicety, not a security boundary.

import { getCurrentUser, defaultAssigneeId } from "../shared/utils.js";

/**
 * Pull project members from the host page (the various dashboards expose
 * `window.getProjectMembers`). Returns `[]` when the host hasn't set it.
 * @returns {Array<{ user_id: number, full_name: string }>}
 */
function getMembers() {
  return typeof window.getProjectMembers === "function" ? window.getProjectMembers() : [];
}

/**
 * Pull AI agents (with owner info) from the host page.
 * Returns `[]` when the host hasn't set window.getProjectAgents.
 * @returns {Array<{ user_id: number, full_name: string, owner: { user_id: number, full_name: string } }>}
 */
function getAgents() {
  return typeof window.getProjectAgents === "function" ? window.getProjectAgents() : [];
}

/**
 * Pull existing Pair Programming sessions from the host page. Only the XP
 * dashboard sets these (alongside `window.taskFormShowPairs`); every other
 * dashboard leaves them undefined so the pair UI never appears there.
 * @returns {Array<{ pair_id: number|string, member1: object, member2: object }>}
 */
function getPairs() {
  return typeof window.getProjectPairs === "function" ? window.getProjectPairs() : [];
}

/**
 * Whether the pair-assignee UI should render. Set true only by the XP
 * dashboard — this keeps pairing strictly out of the scrum/kanban forms.
 * @returns {boolean}
 */
function pairUiEnabled() {
  return typeof window !== "undefined" && window.taskFormShowPairs === true;
}

export function openTaskModal(onSubmit, options = {}) {
  const { task = null } = options;
  const isEdit = task != null;

  const backdrop = document.createElement("div");
  backdrop.className = "tf-backdrop";

  const modal = document.createElement("div");
  modal.className = "tf-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  // ── Header ─────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "tf-header";

  const heading = document.createElement("h2");
  heading.className = "tf-title";
  heading.textContent = isEdit ? "Edit task" : "New task";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tf-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";

  header.appendChild(heading);
  header.appendChild(closeBtn);

  // ── Body ───────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "tf-body";

  // Title
  const titleField = document.createElement("div");
  titleField.className = "tf-field";

  const titleLabel = document.createElement("label");
  titleLabel.className = "tf-label";
  titleLabel.setAttribute("for", "tf-input-title");
  titleLabel.innerHTML = 'Title <span class="tf-required">*</span>';

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.id = "tf-input-title";
  titleInput.className = "tf-input";
  titleInput.placeholder = "What needs to be done?";
  titleInput.required = true;

  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInput);

  // Description
  const descField = document.createElement("div");
  descField.className = "tf-field";

  const descLabel = document.createElement("label");
  descLabel.className = "tf-label";
  descLabel.setAttribute("for", "tf-input-description");
  descLabel.textContent = "Description";

  const descInput = document.createElement("textarea");
  descInput.id = "tf-input-description";
  descInput.className = "tf-textarea";
  descInput.placeholder = "Details, requirements, or context...";
  descInput.rows = 4;

  descField.appendChild(descLabel);
  descField.appendChild(descInput);

  // Assignee + Status row
  const row = document.createElement("div");
  row.className = "tf-row";

  const assigneeField = document.createElement("div");
  assigneeField.className = "tf-field";

  const assigneeLabel = document.createElement("label");
  assigneeLabel.className = "tf-label";
  assigneeLabel.setAttribute("for", "tf-input-assignee");
  assigneeLabel.textContent = "Assignee";

  const assigneeSelect = document.createElement("select");
  assigneeSelect.id = "tf-input-assignee";
  assigneeSelect.className = "tf-select";

  // Populate from cached project members. Agents are tagged inline so
  // the picker reads "Name · AI" — a visual cue that picking this option
  // will surface the reviewer field below.
  const members = getMembers();
  const agents = getAgents();
  const agentOwnerByUserId = new Map(
    agents.map((a) => [Number(a.user_id), a.owner?.user_id ?? null])
  );
  for (const m of members) {
    const o = document.createElement("option");
    o.value = m.user_id;
    const isAgent = agentOwnerByUserId.has(Number(m.user_id));
    o.textContent = isAgent ? `${m.full_name} · AI` : m.full_name;
    if (isAgent) o.dataset.agent = "true";
    assigneeSelect.appendChild(o);
  }
  const defaultId = defaultAssigneeId(members, getCurrentUser());
  if (defaultId != null) assigneeSelect.value = String(defaultId);

  assigneeField.appendChild(assigneeLabel);
  assigneeField.appendChild(assigneeSelect);

  const assigneeError = document.createElement("p");
  assigneeError.className = "tf-error";
  assigneeError.hidden = true;
  assigneeError.textContent = "Please select an assignee.";
  assigneeField.appendChild(assigneeError);

  const statusField = document.createElement("div");
  statusField.className = "tf-field";

  const statusLabel = document.createElement("label");
  statusLabel.className = "tf-label";
  statusLabel.setAttribute("for", "tf-input-status");
  statusLabel.textContent = "Status";

  const statusSelect = document.createElement("select");
  statusSelect.id = "tf-input-status";
  statusSelect.className = "tf-select";

  const statusOptions = [
    { value: "todo", label: "Todo" },
    { value: "in-progress", label: "In Progress" },
    { value: "done", label: "Done" },
  ];
  for (const opt of statusOptions) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    statusSelect.appendChild(o);
  }
  statusSelect.value = "todo";

  statusField.appendChild(statusLabel);
  statusField.appendChild(statusSelect);

  // Priority / urgency
  const priorityField = document.createElement("div");
  priorityField.className = "tf-field";

  const priorityLabel = document.createElement("label");
  priorityLabel.className = "tf-label";
  priorityLabel.setAttribute("for", "tf-input-priority");
  priorityLabel.textContent = "Priority";

  const prioritySelect = document.createElement("select");
  prioritySelect.id = "tf-input-priority";
  prioritySelect.className = "tf-select";

  const priorityOptions = [
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ];
  for (const opt of priorityOptions) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    prioritySelect.appendChild(o);
  }
  prioritySelect.value = "medium";

  priorityField.appendChild(priorityLabel);
  priorityField.appendChild(prioritySelect);

  row.appendChild(assigneeField);
  row.appendChild(statusField);
  row.appendChild(priorityField);

  body.appendChild(titleField);
  body.appendChild(descField);
  body.appendChild(row);

  // ── Pair selection (XP dashboard only) ─────────────────────
  // Two ways to pair, in one row:
  //   • "Existing pair" — pick a current Pair Programming session; it fills
  //     the assignee + pair partner from that session.
  //   • "Pair partner" — pick a second person directly; on submit, if they
  //     and the assignee aren't already a session, one is created (handled by
  //     the XP dashboard's createTask/edit handler).
  // pairPartnerSelect is referenced by submit()/prefill below, so it's declared
  // here regardless and only populated + shown when the XP flag is set.
  const showPairs = pairUiEnabled();
  const pairPartnerSelect = document.createElement("select");
  let existingPairSelect = null;
  let syncPairExclusion = null;

  if (showPairs) {
    const pairs = getPairs();

    const pairRow = document.createElement("div");
    pairRow.className = "tf-row";

    // Existing-pair dropdown.
    const existingPairField = document.createElement("div");
    existingPairField.className = "tf-field";
    const existingPairLabel = document.createElement("label");
    existingPairLabel.className = "tf-label";
    existingPairLabel.setAttribute("for", "tf-input-existing-pair");
    existingPairLabel.textContent = "Existing pair";
    existingPairSelect = document.createElement("select");
    existingPairSelect.id = "tf-input-existing-pair";
    existingPairSelect.className = "tf-select";
    const noPairOpt = document.createElement("option");
    noPairOpt.value = "";
    noPairOpt.textContent = pairs.length ? "— Select an existing pair —" : "No pairs yet";
    existingPairSelect.appendChild(noPairOpt);
    for (const p of pairs) {
      const o = document.createElement("option");
      o.value = String(p.pair_id);
      o.textContent = `${p.member1?.full_name ?? "?"} ↔ ${p.member2?.full_name ?? "?"}`;
      existingPairSelect.appendChild(o);
    }
    existingPairField.appendChild(existingPairLabel);
    existingPairField.appendChild(existingPairSelect);

    // Pair-partner dropdown (list of members).
    const pairPartnerField = document.createElement("div");
    pairPartnerField.className = "tf-field";
    const pairPartnerLabel = document.createElement("label");
    pairPartnerLabel.className = "tf-label";
    pairPartnerLabel.setAttribute("for", "tf-input-pair-partner");
    pairPartnerLabel.textContent = "Pair partner";
    pairPartnerSelect.id = "tf-input-pair-partner";
    pairPartnerSelect.className = "tf-select";
    const noPartnerOpt = document.createElement("option");
    noPartnerOpt.value = "";
    noPartnerOpt.textContent = "No pair";
    pairPartnerSelect.appendChild(noPartnerOpt);
    for (const m of members) {
      const o = document.createElement("option");
      o.value = m.full_name ?? "";
      o.textContent = m.full_name ?? "";
      pairPartnerSelect.appendChild(o);
    }
    pairPartnerField.appendChild(pairPartnerLabel);
    pairPartnerField.appendChild(pairPartnerSelect);

    pairRow.appendChild(existingPairField);
    pairRow.appendChild(pairPartnerField);
    body.appendChild(pairRow);

    // Disable picking the assignee as their own pair partner.
    syncPairExclusion = () => {
      const assigneeMember = members.find((m) => String(m.user_id) === assigneeSelect.value);
      const assigneeName = assigneeMember ? assigneeMember.full_name : "";
      for (const o of pairPartnerSelect.options) {
        o.disabled = o.value !== "" && o.value === assigneeName;
      }
      if (pairPartnerSelect.value && pairPartnerSelect.value === assigneeName) {
        pairPartnerSelect.value = "";
      }
    };

    // Find the session a member belongs to (if any) and return their partner.
    const sessionPartnerFor = (userId) => {
      const id = Number(userId);
      if (!id) return null;
      const session = pairs.find(
        (p) => Number(p.member1?.user_id) === id || Number(p.member2?.user_id) === id
      );
      if (!session) return null;
      return Number(session.member1?.user_id) === id ? session.member2 : session.member1;
    };

    // Picking an assignee who's already in a pair auto-applies that pair, so a
    // task created by just choosing a paired person still shows the partner on
    // its card. Leaves the partner untouched when the assignee isn't paired.
    const autofillPartnerFromSession = () => {
      const partner = sessionPartnerFor(assigneeSelect.value);
      if (
        partner?.full_name &&
        [...pairPartnerSelect.options].some((o) => o.value === partner.full_name)
      ) {
        pairPartnerSelect.value = partner.full_name;
      }
    };

    // Selecting a session fills both the assignee and the pair partner.
    existingPairSelect.addEventListener("change", () => {
      const p = pairs.find((x) => String(x.pair_id) === existingPairSelect.value);
      if (!p) return;
      assigneeSelect.value = String(p.member1?.user_id ?? "");
      syncReviewerField();
      syncPairExclusion();
      pairPartnerSelect.value = p.member2?.full_name ?? "";
    });

    // Editing the members directly means it's no longer "an existing pair".
    const markCustom = () => {
      existingPairSelect.value = "";
    };
    assigneeSelect.addEventListener("change", () => {
      syncPairExclusion();
      autofillPartnerFromSession();
      markCustom();
    });
    pairPartnerSelect.addEventListener("change", markCustom);

    syncPairExclusion();
    // Apply the initial assignee's pair (e.g. a column-locked create), unless
    // edit-mode prefill below sets its own partner.
    if (!isEdit) autofillPartnerFromSession();
  }

  // ── Reviewer field (only meaningful for agent assignees) ─────
  // Always rendered but auto-hidden + cleared when assignee is human or
  // unassigned. The label flips between "required" and "optional" to
  // match the API contract.
  const reviewerField = document.createElement("div");
  reviewerField.className = "tf-field tf-field--reviewer";
  reviewerField.hidden = true;

  const reviewerLabel = document.createElement("label");
  reviewerLabel.className = "tf-label";
  reviewerLabel.setAttribute("for", "tf-input-reviewer");
  reviewerLabel.innerHTML = 'Human reviewer <span class="tf-required">*</span>';

  const reviewerHint = document.createElement("p");
  reviewerHint.className = "tf-hint";
  reviewerHint.textContent =
    "AI-assigned tasks need a human owner to review the agent's work before completion.";

  const reviewerSelect = document.createElement("select");
  reviewerSelect.id = "tf-input-reviewer";
  reviewerSelect.className = "tf-select";

  // Reviewer options: every non-agent member. Building it once is fine
  // because the modal is short-lived.
  const placeholderOpt = document.createElement("option");
  placeholderOpt.value = "";
  placeholderOpt.textContent = "Select a reviewer";
  reviewerSelect.appendChild(placeholderOpt);
  for (const m of members) {
    if (agentOwnerByUserId.has(Number(m.user_id))) continue; // skip agents — they can't review
    const o = document.createElement("option");
    o.value = m.user_id;
    o.textContent = m.full_name;
    reviewerSelect.appendChild(o);
  }

  const reviewerError = document.createElement("p");
  reviewerError.className = "tf-error";
  reviewerError.hidden = true;
  reviewerError.textContent = "Pick a human reviewer for this AI-assigned task.";

  reviewerField.appendChild(reviewerLabel);
  reviewerField.appendChild(reviewerHint);
  reviewerField.appendChild(reviewerSelect);
  reviewerField.appendChild(reviewerError);
  body.appendChild(reviewerField);

  /**
   * Show/hide + reset the reviewer field based on the current assignee.
   * Called on initial render and whenever the assignee select changes.
   */
  function syncReviewerField() {
    const assigneeId = assigneeSelect.value ? Number(assigneeSelect.value) : null;
    const ownerId = assigneeId != null ? agentOwnerByUserId.get(assigneeId) : undefined;
    const isAgent = ownerId !== undefined;

    if (isAgent) {
      reviewerField.hidden = false;
      // Default the reviewer to the agent's owner if nothing is picked yet.
      if (!reviewerSelect.value && ownerId != null) {
        reviewerSelect.value = String(ownerId);
      }
    } else {
      // Hide the field and clear it — a non-agent assignee doesn't need
      // a reviewer, and leaving a stale value would post bad data.
      reviewerField.hidden = true;
      reviewerSelect.value = "";
      reviewerError.hidden = true;
    }
  }

  // ── Prefill (edit mode) ────────────────────────────
  // Populate the form from an existing task so the same modal doubles as
  // an editor. GET /tasks returns the assignee id as `user_id`; POST/PATCH
  // echo `assigned_to` — accept either. Pre-pick the existing reviewer
  // before the initial syncReviewerField() so it isn't overwritten.
  if (isEdit) {
    titleInput.value = task.title ?? "";
    descInput.value = task.description ?? "";
    const assigneeId = task.assigned_to ?? task.user_id ?? null;
    if (assigneeId != null) assigneeSelect.value = String(assigneeId);
    if (task.status && [...statusSelect.options].some((o) => o.value === task.status)) {
      statusSelect.value = task.status;
    }
    if (task.priority && [...prioritySelect.options].some((o) => o.value === task.priority)) {
      prioritySelect.value = task.priority;
    }
    if (task.reviewer_id != null) reviewerSelect.value = String(task.reviewer_id);
    if (
      showPairs &&
      task.pair_assignee &&
      [...pairPartnerSelect.options].some((o) => o.value === task.pair_assignee)
    ) {
      pairPartnerSelect.value = task.pair_assignee;
    }
    if (showPairs) syncPairExclusion?.();
  }

  assigneeSelect.addEventListener("change", syncReviewerField);
  syncReviewerField(); // initial state

  // ── Footer ─────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "tf-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "tf-btn tf-btn-secondary";
  cancelBtn.textContent = "Cancel";

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "tf-btn tf-btn-primary";
  submitBtn.textContent = isEdit ? "Save changes" : "Create task";

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // ── Behavior ───────────────────────────────────────
  function close() {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }

  function submit() {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }

    if (!assigneeSelect.value) {
      assigneeError.hidden = false;
      assigneeSelect.focus();
      return;
    }
    assigneeError.hidden = true;

    const assigneeId = assigneeSelect.value ? Number(assigneeSelect.value) : null;
    const isAgent = assigneeId != null && agentOwnerByUserId.has(assigneeId);
    const reviewerId = reviewerSelect.value ? Number(reviewerSelect.value) : null;

    if (isAgent && reviewerId == null) {
      reviewerError.hidden = false;
      reviewerSelect.focus();
      return;
    }
    reviewerError.hidden = true;

    onSubmit({
      title,
      description: descInput.value.trim(),
      assigned_to: assigneeId,
      status: statusSelect.value,
      priority: prioritySelect.value,
      reviewer_id: reviewerId,
      // Mark agent tasks as 'pending' on create so the badge shows up
      // immediately; non-agent tasks leave it null and let the API
      // default to 'not-required'.
      review_status: isAgent ? "pending" : null,
      // XP only: the chosen pair partner (a member's name), or null. Omitted
      // entirely on other dashboards so their tasks never carry a pair.
      ...(showPairs ? { pair_assignee: pairPartnerSelect.value || null } : {}),
    });
    close();
  }

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  submitBtn.addEventListener("click", submit);
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  document.addEventListener("keydown", onKeyDown);

  titleInput.focus();
}

// ── Self-initialization ───────────────────────────────
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    // Inject stylesheet
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "../task-form/task-form.css";
    document.head.appendChild(link);

    // Remove the old inline form
    document.getElementById("add-task-form")?.remove();

    // Hook up the existing add-task button
    document.getElementById("add-task-btn")?.addEventListener("click", () => {
      openTaskModal(async (data) => {
        await window.createTask(data);
        await window.loadTasks();
      });
    });
  });
}
