import { getCurrentUser, saveCurrentUser, requireStoredProject } from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";

// ── Shared helpers ────────────────────────────────────

/** Resolve display name with consistent priority across the app:
 *  1. localStorage "sitrep_display_name" (set by signup / profile edit)
 *  2. full_name from sessionStorage user object
 *  3. email prefix (everything before @)
 *  4. fallback "User"
 */
function resolveDisplayName(user) {
  const stored = localStorage.getItem("sitrep_display_name");
  if (stored) return stored;
  if (user?.full_name) return user.full_name;
  if (user?.email) return user.email.split("@")[0];
  return "User";
}

function buildInitials(name) {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

const DASH_MAP = {
  scrum: "../dashboard/scrum.html",
  kanban: "../dashboard/kanban.html",
  xp: "../dashboard/xp.html",
};

// ── Bootstrap ─────────────────────────────────────────
const project = requireStoredProject("/projects/projects.html");
if (!project) {
  // Redirecting to the projects list — skip wiring this page.
} else {
const user = getCurrentUser();
const workflow = project.workflow ?? "scrum";
const dashboardUrl = DASH_MAP[workflow] ?? DASH_MAP.scrum;

// The logo opens the Projects page; each nav item has an explicit target.
document.getElementById("sidebar-logo-link").href = "../projects/projects.html";
document.getElementById("nav-dashboard").href = dashboardUrl;
document.getElementById("nav-check-ins").href = "../check-in/check-in.html";
document.getElementById("nav-team").href = `${dashboardUrl}#team`;
document.getElementById("nav-weekly-report").href = `${dashboardUrl}#weekly-report`;

// ── Populate profile content ──────────────────────────
const displayName = resolveDisplayName(user);
const email = user?.email ?? "—";
const projectName = project?.name ?? "—";
const workflowLabel = { scrum: "Scrum", kanban: "Kanban", xp: "XP" }[workflow] ?? "—";

document.getElementById("display-name").textContent = displayName;
document.getElementById("display-email").textContent = email;
document.getElementById("display-project").textContent = projectName;
document.getElementById("display-workflow").textContent = workflowLabel;

// ── Init user menu (sidebar bottom-left) ─────────────
initUserMenu();

// ── Edit / save personal info ─────────────────────────
const editBtn = document.getElementById("edit-personal-btn");
const viewEl = document.getElementById("personal-view");
const editEl = document.getElementById("personal-edit");
const editNameInput = document.getElementById("edit-name");
const saveBtn = document.getElementById("save-personal-btn");
const cancelBtn = document.getElementById("cancel-personal-btn");

editBtn.addEventListener("click", () => {
  editNameInput.value = document.getElementById("display-name").textContent;
  viewEl.hidden = true;
  editEl.hidden = false;
  editBtn.hidden = true;
  editNameInput.focus();
});

cancelBtn.addEventListener("click", () => {
  viewEl.hidden = false;
  editEl.hidden = true;
  editBtn.hidden = false;
});

saveBtn.addEventListener("click", () => {
  const newName = editNameInput.value.trim();
  if (!newName) return;

  // Persist
  localStorage.setItem("sitrep_display_name", newName);
  if (user) saveCurrentUser({ ...user, full_name: newName });

  // Update profile display
  document.getElementById("display-name").textContent = newName;

  // Update sidebar user card in-place (same DOM)
  const newInitials = buildInitials(newName);
  const avatarEl = document.getElementById("user-avatar");
  const nameEl = document.getElementById("user-name");
  if (avatarEl) avatarEl.textContent = newInitials;
  if (nameEl) nameEl.textContent = newName;

  // Collapse edit mode
  viewEl.hidden = false;
  editEl.hidden = true;
  editBtn.hidden = false;
});
}
