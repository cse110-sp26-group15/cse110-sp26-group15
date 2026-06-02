/**
 * Shared user-menu initializer for all dashboard pages.
 *
 * Expected HTML in sidebar footer:
 *   <div class="sidebar-footer">
 *     <div class="user-menu" id="user-menu">
 *       <button class="user-menu-trigger" id="user-menu-trigger" ...>
 *         <div class="avatar" id="user-avatar">U</div>
 *         <div class="user-info">
 *           <p class="user-name" id="user-name"></p>
 *           <p class="user-role" id="user-email"></p>
 *         </div>
 *         <!-- chevron svg -->
 *       </button>
 *       <div class="user-dropdown" id="user-dropdown" hidden>
 *         <!-- Profile / Settings / Log Out items -->
 *       </div>
 *     </div>
 *   </div>
 */

import { getCurrentUser, saveCurrentUser, navigateTo } from "./utils.js";

// ── Mobile sidebar drawer ─────────────────────────────────
// Injects a hamburger top bar + overlay so the fixed sidebar can
// slide in/out under the responsive breakpoint (styled in main.css).
// Runs on every shell page because each one calls initUserMenu().
function initSidebarDrawer() {
  const shell = document.querySelector(".app-shell");
  const sidebar = shell?.querySelector(".sidebar");
  const main = shell?.querySelector(".main-content");
  if (!shell || !sidebar || !main) return;
  if (shell.querySelector(".sidebar-overlay")) return; // idempotent

  if (!sidebar.id) sidebar.id = "app-sidebar";

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.hidden = true;
  shell.appendChild(overlay);

  // Slim bar that only hosts the hamburger toggle. It intentionally has no
  // title: the drawer already carries the "SitRep" wordmark, and each page
  // renders its own heading below, so a title here would just duplicate one
  // of them.
  const topbar = document.createElement("div");
  topbar.className = "mobile-topbar";
  topbar.innerHTML = `
    <button type="button" class="sidebar-toggle" id="sidebar-toggle"
            aria-controls="${sidebar.id}" aria-expanded="false" aria-label="Open menu">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>`;
  main.prepend(topbar);

  const toggle = topbar.querySelector(".sidebar-toggle");

  const open = () => {
    shell.classList.add("is-sidebar-open");
    overlay.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
    sidebar.querySelector(".nav-item, a, button")?.focus();
  };
  const close = ({ restoreFocus = true } = {}) => {
    shell.classList.remove("is-sidebar-open");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () =>
    shell.classList.contains("is-sidebar-open") ? close() : open()
  );
  overlay.addEventListener("click", () => close());
  sidebar
    .querySelectorAll(".nav-item")
    .forEach((item) => item.addEventListener("click", () => close({ restoreFocus: false })));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && shell.classList.contains("is-sidebar-open")) close();
  });
  // Reset to the desktop layout cleanly when the viewport grows.
  window.matchMedia("(min-width: 769px)").addEventListener("change", (e) => {
    if (e.matches) close({ restoreFocus: false });
  });
}

export function initUserMenu() {
  // Guard: do nothing in non-browser environments (e.g. Vitest / Node).
  if (typeof document === "undefined") return;

  // Wire the responsive drawer first so it works even on shell pages
  // that lack the user-menu markup (which triggers the early return below).
  initSidebarDrawer();

  const trigger = document.getElementById("user-menu-trigger");
  const dropdown = document.getElementById("user-dropdown");
  const avatarEl = document.getElementById("user-avatar");
  const nameEl = document.getElementById("user-name");
  const emailEl = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");

  if (!trigger || !dropdown) return;

  // Resolve display name: localStorage (from signup) > server user object > email prefix
  const user = getCurrentUser();
  const storedName = localStorage.getItem("sitrep_display_name");
  const displayName = storedName || user?.full_name || user?.email?.split("@")[0] || "User";
  const email = user?.email ?? "";

  // Build initials from first letters of name words (max 2)
  const initials =
    displayName
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = email;

  // ── Toggle dropdown ───────────────────────────────────
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = trigger.getAttribute("aria-expanded") === "true";
    const next = !isOpen;
    trigger.setAttribute("aria-expanded", String(next));
    dropdown.hidden = !next;
  });

  // Close when clicking anywhere outside the menu
  document.addEventListener("click", () => {
    trigger.setAttribute("aria-expanded", "false");
    dropdown.hidden = true;
  });

  // Prevent clicks inside the dropdown from closing it
  dropdown.addEventListener("click", (e) => e.stopPropagation());

  // ── Log out ───────────────────────────────────────────
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      saveCurrentUser(null);
      // Keep sitrep_display_name so the login page can show "Welcome back, X"
      // if the team adds that feature later. Clear sensitive session data only.
      sessionStorage.clear();
      navigateTo("../login/index.html");
    });
  }
}
