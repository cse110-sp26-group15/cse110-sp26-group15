// ── Navigation ────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");

    const topbarTitle = document.querySelector(".topbar-title");
    if (topbarTitle) {
      topbarTitle.textContent = item.textContent.trim();
    }
  });
});

// ── Task API ──────────────────────────────────────────
const PROJECT_ID = 1; // TODO: replace with actual logged-in project context

async function fetchTasks() {
  const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
  const data = await res.json();
  return data.tasks ?? [];
}

async function fetchMembers() {
  const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
  const data = await res.json();
  return data.members ?? [];
}

async function createTask(title, assignedTo) {
  const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, assigned_to: assignedTo || null }),
  });
  return res.json();
}

async function updateTask(taskId, fields) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return res.json();
}

async function deleteTask(taskId) {
  const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  return res.json();
}

// ── Members cache ─────────────────────────────────────
let projectMembers = [];

function buildAssigneeOptions(selectedUserId) {
  const unassigned = `<option value=""${!selectedUserId ? " selected" : ""}>Unassigned</option>`;
  const memberOpts = projectMembers
    .map(
      (m) =>
        `<option value="${m.user_id}"${m.user_id === selectedUserId ? " selected" : ""}>${m.full_name}</option>`
    )
    .join("");
  return unassigned + memberOpts;
}

function populateCreateFormAssignees() {
  const sel = document.getElementById("new-task-assignee");
  if (!sel) return;
  sel.innerHTML = buildAssigneeOptions(null);
}

// ── Task UI ───────────────────────────────────────────
function renderTasks(tasks) {
  const list = document.getElementById("task-list");
  if (!list) return;

  if (tasks.length === 0) {
    list.innerHTML = `<p class="task-empty">No tasks yet. Add one above.</p>`;
    return;
  }

  list.innerHTML = tasks
    .map(
      (t) => `
    <div class="task-card" data-task-id="${t.task_id}">
      <span class="task-title">${t.title}</span>
      <div class="task-meta">
        <select class="assignee-select" data-task-id="${t.task_id}">
          ${buildAssigneeOptions(t.user_id)}
        </select>
        <select class="status-select status-${t.status}" data-task-id="${t.task_id}">
          <option value="todo" ${t.status === "todo" ? "selected" : ""}>Todo</option>
          <option value="in-progress" ${t.status === "in-progress" ? "selected" : ""}>In Progress</option>
          <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
        </select>
        <button class="btn-delete" data-task-id="${t.task_id}">Delete</button>
      </div>
    </div>`
    )
    .join("");

  // Status change handler
  list.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const newStatus = e.target.value;
      e.target.className = `status-select status-${newStatus}`;
      await updateTask(taskId, { status: newStatus });
    });
  });

  // Assignee change handler
  list.querySelectorAll(".assignee-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const taskId = e.target.dataset.taskId;
      const userId = e.target.value ? Number(e.target.value) : null;
      await updateTask(taskId, { assigned_to: userId });
    });
  });

  // Delete handler
  list.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const taskId = e.target.dataset.taskId;
      await deleteTask(taskId);
      loadTasks();
    });
  });
}

async function loadTasks() {
  const tasks = await fetchTasks();
  renderTasks(tasks);
}

// ── Add Task Form ─────────────────────────────────────
document.getElementById("add-task-btn")?.addEventListener("click", () => {
  document.getElementById("add-task-form").classList.remove("hidden");
  document.getElementById("new-task-title").focus();
});

document.getElementById("cancel-task-btn")?.addEventListener("click", () => {
  document.getElementById("add-task-form").classList.add("hidden");
  document.getElementById("new-task-title").value = "";
  document.getElementById("new-task-assignee").value = "";
});

document.getElementById("submit-task-btn")?.addEventListener("click", async () => {
  const input = document.getElementById("new-task-title");
  const assigneeSelect = document.getElementById("new-task-assignee");
  const title = input.value.trim();
  if (!title) return;

  const assignedTo = assigneeSelect.value ? Number(assigneeSelect.value) : null;
  await createTask(title, assignedTo);
  input.value = "";
  assigneeSelect.value = "";
  document.getElementById("add-task-form").classList.add("hidden");
  loadTasks();
});

// ── Init ──────────────────────────────────────────────
async function init() {
  projectMembers = await fetchMembers();
  populateCreateFormAssignees();
  await loadTasks();
}

init();
