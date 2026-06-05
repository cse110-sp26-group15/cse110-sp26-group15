import { apiFetch, apiCreateProject, apiDeleteProject, validateEmail } from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";

// Wire up the shared sidebar account menu (avatar/name/email, Profile,
// Settings, Log Out) so the footer behaves like it does on the dashboards.
initUserMenu();

const WORKFLOW_DASHBOARD = {
  scrum: "../dashboard/scrum.html",
  kanban: "../dashboard/kanban.html",
  xp: "../dashboard/xp.html",
};

/** localStorage key the dashboards read the active project from. */
const CURRENT_PROJECT_KEY = "sitrep_project";

const listEl = document.getElementById("project-list");
const emptyEl = document.getElementById("empty");
const errorEl = document.getElementById("error");

const createForm = document.getElementById("create-form");
const nameInput = document.getElementById("new-name");
const workflowSelect = document.getElementById("new-workflow");
const createBtn = document.getElementById("create-btn");
const createError = document.getElementById("create-error");
const createNote = document.getElementById("create-note");

const memberEmail = document.getElementById("member-email");
const addMemberBtn = document.getElementById("add-member-btn");
const memberError = document.getElementById("member-error");
const memberList = document.getElementById("member-list");

/** Invited teammate emails for the project being created. */
const members = [];

// Set the chosen project active (dashboards read this via getCurrentProjectId)
// and navigate to the board for its workflow.
function openProject(p) {
  localStorage.setItem(
    CURRENT_PROJECT_KEY,
    JSON.stringify({ project_id: p.project_id, name: p.name, workflow: p.workflow })
  );
  window.location.href = WORKFLOW_DASHBOARD[p.workflow] ?? WORKFLOW_DASHBOARD.scrum;
}

// Remove the chosen project after a confirmation prompt, then refresh the
// list. If the deleted project was the one currently loaded in the dashboards,
// clear that pointer so they don't try to reopen a project that's gone.
async function deleteProject(p) {
  const confirmed = window.confirm(
    `Delete "${p.name}"? This permanently removes the project and all of its related information. This can't be undone.`
  );
  if (!confirmed) return;

  errorEl.hidden = true;
  try {
    await apiDeleteProject(p.project_id);

    try {
      const active = JSON.parse(localStorage.getItem(CURRENT_PROJECT_KEY) || "null");
      if (active?.project_id === p.project_id) localStorage.removeItem(CURRENT_PROJECT_KEY);
    } catch {
      /* malformed stored value — ignore */
    }

    await loadProjects();
  } catch (err) {
    errorEl.textContent = `Couldn't delete the project: ${err.message}`;
    errorEl.hidden = false;
  }
}

function render(projects) {
  listEl.innerHTML = "";
  emptyEl.hidden = projects.length > 0;

  for (const p of projects) {
    const li = document.createElement("li");
    li.className = "project-card";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-card__btn";
    btn.addEventListener("click", () => openProject(p));

    const name = document.createElement("span");
    name.className = "project-card__name";
    name.textContent = p.name;

    const meta = document.createElement("span");
    meta.className = "project-card__meta";
    meta.textContent = `${p.workflow} · ${p.member_count} member${p.member_count === 1 ? "" : "s"}`;

    btn.append(name, meta);
    li.append(btn);

    // Only the creator can delete a project, so only show the control to them.
    // `is_owner` is computed server-side from the session (see GET /api/projects)
    // so the control reliably appears regardless of client-side state; the
    // server enforces the same rule on the DELETE itself.
    if (p.is_owner) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "project-card__delete";
      del.setAttribute("aria-label", `Delete ${p.name}`);
      del.title = "Delete project";
      del.textContent = "✕";
      del.addEventListener("click", () => deleteProject(p));
      li.append(del);
    }

    listEl.append(li);
  }
}

// Fetch + render the caller's projects. apiFetch sends the session cookie and
// redirects to /login/ on 401, so we only handle the success + error display.
async function loadProjects() {
  try {
    const { projects } = await apiFetch("/api/projects");
    render(projects ?? []);
  } catch (err) {
    errorEl.textContent = `Couldn't load your projects: ${err.message}`;
    errorEl.hidden = false;
  }
}

// ── Teammate invites (mirrors project-setup) ──────────────
function renderMembers() {
  memberList.innerHTML = "";
  for (const email of members) {
    const li = document.createElement("li");
    li.className = "member-item";

    const span = document.createElement("span");
    span.className = "member-item__email";
    span.textContent = email;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "member-item__remove";
    remove.setAttribute("aria-label", `Remove ${email}`);
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      const i = members.indexOf(email);
      if (i !== -1) members.splice(i, 1);
      renderMembers();
    });

    li.append(span, remove);
    memberList.append(li);
  }
}

function addMember() {
  const email = memberEmail.value.trim();
  if (!validateEmail(email)) {
    memberError.textContent = "Please enter a valid email address.";
    memberError.hidden = false;
    return;
  }
  if (members.includes(email)) {
    memberError.textContent = "This email has already been added.";
    memberError.hidden = false;
    return;
  }
  memberError.hidden = true;
  members.push(email);
  renderMembers();
  memberEmail.value = "";
  memberEmail.focus();
}

addMemberBtn.addEventListener("click", addMember);

// Enter in the email field adds a teammate instead of submitting the form.
memberEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addMember();
  }
});

// ── Create ────────────────────────────────────────────────
// Create a project (with any invited teammates), then refresh the list. The
// creator is added as a member server-side (from the session); invited emails
// that match existing users are added too, and any that don't are reported.
createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  createError.hidden = true;
  createNote.hidden = true;

  const name = nameInput.value.trim();
  if (!name) {
    createError.textContent = "Project name is required.";
    createError.hidden = false;
    return;
  }

  createBtn.disabled = true;
  try {
    const result = await apiCreateProject({
      name,
      workflow: workflowSelect.value,
      members: [...members],
    });

    // Surface emails that didn't match an existing user (not added as members).
    const notFound = result?.not_found ?? [];
    if (notFound.length > 0) {
      createNote.textContent = `Created. These emails weren't found and weren't added: ${notFound.join(", ")}`;
      createNote.hidden = false;
    }

    nameInput.value = "";
    members.length = 0;
    renderMembers();
    await loadProjects();
  } catch (err) {
    createError.textContent = `Couldn't create the project: ${err.message}`;
    createError.hidden = false;
  } finally {
    createBtn.disabled = false;
  }
});

loadProjects();
