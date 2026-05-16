// ── Task Creation Modal ───────────────────────────────

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

  const assigneeInput = document.createElement("input");
  assigneeInput.type = "text";
  assigneeInput.id = "tf-input-assignee";
  assigneeInput.className = "tf-input";
  assigneeInput.placeholder = "Name or leave blank";

  assigneeField.appendChild(assigneeLabel);
  assigneeField.appendChild(assigneeInput);

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
    onSubmit({
      title,
      description: descInput.value.trim(),
      assigned_to: assigneeInput.value.trim(),
      status: statusSelect.value,
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
  link.href = "task-form.css";
  document.head.appendChild(link);

  // Remove the old inline form
  document.getElementById("add-task-form")?.remove();

  // Hook up the existing add-task button
  document.getElementById("add-task-btn")?.addEventListener("click", () => {
    openTaskModal((data) => {
      console.log("New task:", data);
    });
  });
});
