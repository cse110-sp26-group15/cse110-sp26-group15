import { getCurrentUser } from "../shared/utils.js";
import { initUserMenu } from "../shared/user-menu.js";

// ── Helpers ───────────────────────────────────────────

function readProject() {
  try {
    return JSON.parse(localStorage.getItem("sitrep_project") ?? "null");
  } catch {
    return null;
  }
}

const DASH_MAP = {
  scrum: "../dashboard/scrum.html",
  kanban: "../dashboard/kanban.html",
  xp: "../dashboard/xp.html",
};

// ── Bootstrap ─────────────────────────────────────────
const project = readProject();
const workflow = project?.workflow ?? "scrum";
const dashboardUrl = DASH_MAP[workflow] ?? DASH_MAP.scrum;

// The logo opens the Projects page; the Dashboard nav item stays on the
// current project's board.
document.getElementById("sidebar-logo-link").href = "../projects/projects.html";
document.getElementById("nav-dashboard").href = dashboardUrl;

// All other nav items route back to dashboard
document.querySelectorAll(".sidebar-nav .nav-item").forEach((item) => {
  if (!item.id) item.href = dashboardUrl;
});

// ── Populate About section ────────────────────────────
const workflowLabel = { scrum: "Scrum", kanban: "Kanban", xp: "XP" }[workflow] ?? "—";
document.getElementById("about-workspace").textContent = project?.name ?? "—";
document.getElementById("about-workflow").textContent = workflowLabel;

// ── Init user menu ────────────────────────────────────
initUserMenu();

// ── Theme management (Light / Dark only) ─────────────
const THEME_KEY = "sitrep_theme";

function applyTheme(value) {
  document.documentElement.setAttribute("data-theme", value);
}

function setActiveThemeBtn(value) {
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    const isActive = btn.dataset.theme === value;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

const savedTheme = localStorage.getItem(THEME_KEY) ?? "light";
applyTheme(savedTheme);
setActiveThemeBtn(savedTheme);

document.querySelectorAll(".theme-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme; // "light" | "dark"
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    setActiveThemeBtn(theme);
  });
});

// ── Login Preferences — Remember email toggle ─────────
const REMEMBER_KEY = "sitrep_remembered_email";
const rememberToggle = document.getElementById("remember-email-toggle");

// Reflect current state: checkbox is checked if an email is stored
rememberToggle.checked = !!localStorage.getItem(REMEMBER_KEY);

rememberToggle.addEventListener("change", () => {
  if (!rememberToggle.checked) {
    localStorage.removeItem(REMEMBER_KEY);
  } else {
    // If no email saved yet, pre-populate from the current session user
    if (!localStorage.getItem(REMEMBER_KEY)) {
      const user = getCurrentUser();
      if (user?.email) localStorage.setItem(REMEMBER_KEY, user.email);
    }
  }
});
