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

export function initUserMenu() {
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
  const initials = displayName
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
