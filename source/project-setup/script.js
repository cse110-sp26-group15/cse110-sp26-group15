import {
  validateEmail,
  setFieldError,
  clearFieldError,
  showBanner,
  hideBanner,
  navigateTo,
  apiCreateProject,
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
  submitBtn.textContent = "Creating project…";

  try {
    await apiCreateProject({ name, workflow, members: [...members] });
    const dashMap = {
      scrum: "../dashboard/scrum.html",
      kanban: "../dashboard/kanban.html",
      xp: "../dashboard/xp.html",
    };
    navigateTo(dashMap[workflow] ?? "../dashboard/scrum.html");
  } catch (err) {
    showBanner(banner, err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
    submitBtn.textContent = "Create project";
  }
});
