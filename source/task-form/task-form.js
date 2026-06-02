// ── Task Creation Modal ───────────────────────────────
//
// Modal also enforces the "agent-assigned tasks need a human reviewer"
// rule on the client side: when the assignee picker lands on an AI
// agent, the reviewer select becomes required and is auto-defaulted to
// that agent's owning human. The API also enforces this — the client
// rule is a UX nicety, not a security boundary.

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

export function openTaskModal(onSubmit) {
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
  heading.textContent = "New task";

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

  const unassignedOpt = document.createElement("option");
  unassignedOpt.value = "";
  unassignedOpt.textContent = "Unassigned";
  assigneeSelect.appendChild(unassignedOpt);

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

  assigneeField.appendChild(assigneeLabel);
  assigneeField.appendChild(assigneeSelect);

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

  row.appendChild(assigneeField);
  row.appendChild(statusField);

  body.appendChild(titleField);
  body.appendChild(descField);
  body.appendChild(row);

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
  submitBtn.textContent = "Create task";

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
      reviewer_id: reviewerId,
      // Mark agent tasks as 'pending' on create so the badge shows up
      // immediately; non-agent tasks leave it null and let the API
      // default to 'not-required'.
      review_status: isAgent ? "pending" : null,
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
