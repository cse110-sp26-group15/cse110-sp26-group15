import { mockTasks, mockMembers } from "./mock-data.js";

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

    switchView(item.textContent.trim());
  });
});

// ── View switching ────────────────────────────────────
const VIEWS = {
  Dashboard: "dashboard-view",
  "My Check-ins": "checkins-view",
  Team: "team-view",
  "Weekly Report": "weekly-view",
  Settings: "settings-view",
};

function switchView(label) {
  document.querySelectorAll(".page-view").forEach((v) => v.classList.add("hidden"));

  const viewId = VIEWS[label];
  if (!viewId) return;

  let view = document.getElementById(viewId);

  if (!view) {
    view = document.createElement("div");
    view.id = viewId;
    view.className = "page-view placeholder";
    view.innerHTML = `<p>${label}</p><span>Coming soon</span>`;
    document.getElementById("page-content")?.appendChild(view);
  }

  view.classList.remove("hidden");
}

// ── Task API ──────────────────────────────────────────
const PROJECT_ID = 1; // TODO: replace with actual logged-in project context

// ── Mock data (swap out for real API calls when deploying) ────
let mockTasksLocal = [...mockTasks];

async function fetchTasks() {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`);
  // const data = await res.json();
  // return data.tasks ?? [];
  return mockTasksLocal;
}

async function fetchMembers() {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/members`);
  // const data = await res.json();
  // return data.members ?? [];
  return mockMembers;
}

async function createTask(title, assignedTo) {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ title, assigned_to: assignedTo || null }),
  // });
  // return res.json();
  const member = mockMembers.find((m) => m.user_id === assignedTo) ?? null;
  const newTask = {
    task_id: Date.now(),
    title,
    status: "todo",
    user_id: assignedTo ?? null,
    full_name: member?.full_name ?? null,
  };
  mockTasksLocal.push(newTask);
  return { task: newTask };
}

async function updateTask(taskId, fields) {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks/${taskId}`, {
  //   method: "PATCH",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(fields),
  // });
  // return res.json();
  const task = mockTasksLocal.find((t) => String(t.task_id) === String(taskId));
  if (task) Object.assign(task, fields);
  return { task };
}

async function deleteTask(taskId) {
  // TODO: swap back to real API when deploying
  // const res = await fetch(`/api/projects/${PROJECT_ID}/tasks/${taskId}`, { method: "DELETE" });
  // return res.json();
  mockTasksLocal = mockTasksLocal.filter((t) => String(t.task_id) !== String(taskId));
  return { success: true };
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

// ── Task UI (original flat list renderer — kept for reference) ─
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

// ── Board rendering (kanban) ──────────────────────────
function renderBoard(tasks) {
  const groups = { todo: [], "in-progress": [], done: [] };
  for (const task of tasks) {
    const bucket = groups[task.status];
    if (bucket) bucket.push(task);
    else groups.todo.push(task);
  }

  const COLUMNS = ["todo", "in-progress", "done"];
  for (const status of COLUMNS) {
    const container = document.getElementById(`cards-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    const colTasks = groups[status];

    if (countEl) countEl.textContent = String(colTasks.length);
    if (!container) continue;
    container.innerHTML = "";

    if (colTasks.length === 0) {
      container.innerHTML = `<p class="kanban-col__empty">No tasks yet</p>`;
      continue;
    }

    for (const task of colTasks) {
      const card = document.createElement("div");
      card.className = "task-card";
      card.dataset.taskId = task.task_id;
      card.setAttribute("draggable", "true");
      card.innerHTML = `
        <span class="task-title">${task.title}</span>
        <div class="task-meta">
          <select class="assignee-select" data-task-id="${task.task_id}">
            ${buildAssigneeOptions(task.user_id)}
          </select>
          <button class="btn-delete" data-task-id="${task.task_id}">Delete</button>
        </div>`;

      card.querySelector(".assignee-select").addEventListener("change", async (e) => {
        const userId = e.target.value ? Number(e.target.value) : null;
        await updateTask(task.task_id, { assigned_to: userId });
      });

      card.querySelector(".btn-delete").addEventListener("click", async () => {
        await deleteTask(task.task_id);
        loadTasks();
      });

      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(task.task_id));
        card.classList.add("task-card--dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("task-card--dragging"));

      container.appendChild(card);
    }
  }
}

// ── Blocker banner ────────────────────────────────────
async function refreshBlockerBanner() {
  // TODO: swap back to real API when deploying
}

async function loadTasks() {
  const tasks = await fetchTasks();
  renderBoard(tasks);
  await refreshBlockerBanner();
}

// Expose to task-form module
window.getProjectMembers = () => projectMembers;
window.createTask = createTask;
window.loadTasks = loadTasks;

// ── Drop zones (init once) ────────────────────────────
document.querySelectorAll(".kanban-col__cards").forEach((zone) => {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("kanban-col__cards--over");
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("kanban-col__cards--over");
  });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("kanban-col__cards--over");
    const taskId = e.dataTransfer.getData("text/plain");
    const newStatus = zone.closest(".kanban-col")?.dataset.status;
    if (!taskId || !newStatus) return;
    await updateTask(taskId, { status: newStatus });
    loadTasks();
  });
});

// ── Init ──────────────────────────────────────────────
async function init() {
  projectMembers = await fetchMembers();
  populateCreateFormAssignees();
  await loadTasks();
}

init();
