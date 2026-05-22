/**
 * Shared utilities for SitRep auth pages.
 */

// ── Validation ──────────────────────────────────────────

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password) {
  return password.length >= 8;
}

// ── Field error helpers ─────────────────────────────────

export function setFieldError(inputEl, errorEl, message) {
  inputEl.classList.add("invalid");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add("visible");
  }
}

export function clearFieldError(inputEl, errorEl) {
  inputEl.classList.remove("invalid");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.remove("visible");
  }
}

export function showBanner(bannerEl, message) {
  bannerEl.textContent = message;
  bannerEl.classList.add("visible");
}

export function hideBanner(bannerEl) {
  bannerEl.textContent = "";
  bannerEl.classList.remove("visible");
}

// ── Navigation ──────────────────────────────────────────

export function navigateTo(path) {
  window.location.href = path;
}

// ── API helpers ─────────────────────────────────────────

/**
 * POST /api/auth/login
 */
export async function apiLogin({ email, password }) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Login failed");
  }

  return res.json();
}

/**
 * POST /api/auth/signup
 */
export async function apiSignup({ email, password }) {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Signup failed");
  }

  return res.json();
}

/**
 * POST /api/projects
 *
 * Creates a project on the backend and (optionally) seeds the creator and
 * invited member emails into `project_members`.
 *
 * @param {object}    args
 * @param {string}    args.name          Project display name.
 * @param {string}    args.workflow      One of 'scrum' | 'kanban' | 'xp'.
 * @param {string[]}  args.members       Invited member emails.
 * @param {number|null} [args.created_by] user_id of the creator, if known.
 * @returns {Promise<{ project: object, invited: Array<{user_id:number,email:string}>, not_found: string[] }>}
 * @throws {Error} When the server responds with a non-2xx status.
 */
export async function apiCreateProject({ name, workflow, members, created_by = null }) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, workflow, members, created_by }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create project");
  }

  return res.json();
}

// ── Token helpers ───────────────────────────────────────

export function saveToken() {
  // Token is automatically set as httpOnly cookie by server
  // Client no longer needs to store it
}

export function getToken() {
  // Token is automatically sent by browser in httpOnly cookie
  // Client cannot access it (by design for security)
  return null;
}

// ── Current user helpers ────────────────────────────────

const CURRENT_USER_KEY = "sitrep_user";

/**
 * Persist the logged-in user to sessionStorage so other pages (e.g. project
 * setup) can read `user_id` without an extra round-trip. Used as a stop-gap
 * until a sessions table lets the server resolve the cookie to a user.
 *
 * @param {{ user_id: number, email: string, full_name?: string } | null} user
 */
export function saveCurrentUser(user) {
  try {
    if (user) sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(CURRENT_USER_KEY);
  } catch {
    /* sessionStorage unavailable — ignore */
  }
}

/**
 * Read the logged-in user previously stashed by {@link saveCurrentUser}.
 * Returns null if nothing is stored or the stored value is corrupt.
 *
 * @returns {{ user_id: number, email: string, full_name?: string } | null}
 */
export function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

