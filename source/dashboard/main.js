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

// ── Pair sessions (XP dashboard) ──────────────────────
// Static placeholder cards live in xp.html. When the pairing API lands
// (expected: GET /api/projects/:id/pairs → { pairs: [...] }), call
// window.renderPairs(pairs) to replace the placeholders. Expected pair
// shape: { pair_id, title, is_ai_pair, status_text, driver: { full_name,
// role }, partner: { full_name, role, is_agent } }
function initialsFor(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function renderPairs(pairs) {
  const list = document.getElementById("pair-list");
  if (!list || !Array.isArray(pairs) || pairs.length === 0) return;

  list.innerHTML = pairs
    .map((p) => {
      const isAI = p.is_ai_pair || p.partner?.is_agent;
      const driver = p.driver ?? {};
      const partner = p.partner ?? {};
      const driverName = driver.full_name ?? "—";
      const partnerName = partner.full_name ?? "—";
      const driverRole = driver.role ?? "driving";
      const partnerRole = partner.role ?? (isAI ? "co-pilot" : "navigating");
      const baseTitle = p.title ?? "Pair Session";
      const title = isAI ? `${baseTitle} · Human + AI` : baseTitle;
      const meta = p.status_text ?? "active";

      return `
      <article class="pair-card${isAI ? " pair-card-ai" : ""}" data-pair-id="${p.pair_id ?? ""}">
        <div class="pair-card-header">
          <span class="pair-card-title">${title}</span>
        </div>
        <div class="pair-card-body">
          <div class="pair-member">
            <div class="avatar pair-avatar">${initialsFor(driverName)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${driverName}</p>
              <p class="pair-member-role">${driverRole}</p>
            </div>
          </div>
          <span class="pair-arrow" aria-hidden="true">⇄</span>
          <div class="pair-member">
            <div class="avatar pair-avatar${isAI ? " pair-avatar-ai" : ""}">${isAI ? "AI" : initialsFor(partnerName)}</div>
            <div class="pair-member-info">
              <p class="pair-member-name">${partnerName}</p>
              <p class="pair-member-role">${partnerRole}</p>
            </div>
          </div>
        </div>
        <div class="pair-card-footer">
          <p class="pair-meta">${meta}</p>
        </div>
      </article>`;
    })
    .join("");
}

// Expose to task-form module
window.getProjectMembers = () => projectMembers;
window.createTask = createTask;
window.loadTasks = loadTasks;
window.renderPairs = renderPairs;

// ── Init ──────────────────────────────────────────────
async function init() {
  projectMembers = await fetchMembers();
  populateCreateFormAssignees();
  await loadTasks();
}

init();
