import {
  validateEmail,
  setFieldError,
  clearFieldError,
  showBanner,
  hideBanner,
  navigateTo,
  apiCreateProject,
  getCurrentUser,
  setCurrentProject,
  dashboardPathFor,
  apiGetInvites,
  apiAddMember,
} from "../shared/utils.js";

const form = document.getElementById("setup-form");
const nameInput = document.getElementById("project-name");
const nameError = document.getElementById("name-error");
const memberInput = document.getElementById("member-email");
const memberError = document.getElementById("member-error");
const addBtn = document.getElementById("add-member-btn");
const memberList = document.getElementById("member-list");
const memberWrap = document.getElementById("member-list-wrap");
const submitBtn = document.getElementById("submit-btn");
const banner = document.getElementById("error-banner");

/** @type {string[]} */
const members = [];

// ── Add member ──────────────────────────────────────────
function addMember() {
  const email = memberInput.value.trim();

  if (!validateEmail(email)) {
    setFieldError(memberInput, memberError, "Please enter a valid email address.");
    return;
  }

  if (members.includes(email)) {
    setFieldError(memberInput, memberError, "This email has already been added.");
    return;
  }

  clearFieldError(memberInput, memberError);
  members.push(email);
  renderMemberList();
  memberInput.value = "";
  memberInput.focus();
}

function removeMember(email) {
  const idx = members.indexOf(email);
  if (idx !== -1) members.splice(idx, 1);
  renderMemberList();
}

function renderMemberList() {
  memberList.innerHTML = "";

  if (members.length === 0) {
    memberWrap.hidden = true;
    return;
  }

  memberWrap.hidden = false;

  members.forEach((email) => {
    const li = document.createElement("li");
    li.className = "member-item";

    const span = document.createElement("span");
    span.className = "member-item-email";
    span.textContent = email;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove-member";
    removeBtn.setAttribute("aria-label", `Remove ${email}`);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeMember(email));

    li.appendChild(span);
    li.appendChild(removeBtn);
    memberList.appendChild(li);
  });
}

// ── Add member via button or Enter key ──────────────────
addBtn.addEventListener("click", addMember);

memberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addMember();
  }
});

memberInput.addEventListener("input", () => clearFieldError(memberInput, memberError));

// ── Project name validation on blur ─────────────────────
nameInput.addEventListener("blur", () => {
  if (nameInput.value.trim() === "") {
    setFieldError(nameInput, nameError, "Project name is required.");
  } else {
    clearFieldError(nameInput, nameError);
  }
});

nameInput.addEventListener("input", () => clearFieldError(nameInput, nameError));

// ── Form submit ─────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner(banner);

  const name = nameInput.value.trim();
  const workflow = form.querySelector('input[name="workflow"]:checked')?.value ?? "scrum";

  let valid = true;

  if (name === "") {
    setFieldError(nameInput, nameError, "Project name is required.");
    valid = false;
  }

  if (!valid) return;

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  submitBtn.innerHTML = "Creating workspace…";

  try {
    // The creator is taken from the session cookie by the server, so it is not
    // part of the payload. Persist the new project locally so the dashboards /
    // Profile / Settings pages can read it (via getCurrentProjectId()) without
    // an extra round-trip — the project_id is what makes each one load its own
    // data instead of hard-coding 1.
    const result = await apiCreateProject({ name, workflow, members: [...members] });
    const project = result?.project ?? { name, workflow };
    setCurrentProject({
      project_id: project.project_id,
      name: project.name ?? name,
      workflow: project.workflow ?? workflow,
    });
    navigateTo(dashboardPathFor(project.workflow ?? workflow));
  } catch (err) {
    showBanner(banner, err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
    submitBtn.innerHTML = 'Create workspace <span class="btn-arrow" aria-hidden="true">→</span>';
  }
});

// ── Pending invitations ─────────────────────────────────
const invitesSection = document.getElementById("invites-section");
const invitesList = document.getElementById("invites-list");

/**
 * Join a project from a pending invite: add the current user as a member,
 * store the project, and navigate to its dashboard.
 * @param {{ project_id: number, project_name: string, workflow: string }} invite
 * @param {string} email
 * @returns {Promise<void>}
 */
async function joinProject(invite, email) {
  try {
    await apiAddMember(invite.project_id, email);
    setCurrentProject({
      project_id: invite.project_id,
      name: invite.project_name,
      workflow: invite.workflow,
    });
    navigateTo(dashboardPathFor(invite.workflow));
  } catch (err) {
    showBanner(banner, err.message || "Could not join the project. Please try again.");
  }
}

/**
 * Fetch and render the signed-in user's pending invitations, if any.
 * No-op when there is no current user or no invites.
 * @returns {Promise<void>}
 */
async function loadInvites() {
  const user = getCurrentUser();
  if (!user?.email || !invitesSection || !invitesList) return;
  let invites = [];
  try {
    ({ invites = [] } = await apiGetInvites(user.email));
  } catch (err) {
    console.warn("[project-setup] invite lookup failed", err);
    return;
  }
  if (invites.length === 0) return;

  invitesList.innerHTML = "";
  for (const invite of invites) {
    const li = document.createElement("li");
    li.className = "invite-item";

    const span = document.createElement("span");
    span.className = "invite-item-name";
    span.textContent = invite.project_name;

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn-add-member";
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => joinProject(invite, user.email));

    li.appendChild(span);
    li.appendChild(joinBtn);
    invitesList.appendChild(li);
  }
  invitesSection.hidden = false;
}

loadInvites();
