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

/** Default timeout for {@link apiFetch} in milliseconds. */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/**
 * Thrown when an API call returns a non-2xx response or aborts.
 * Carries the HTTP status (or 0 for network/timeout failures) so callers
 * can branch on "auth failed" vs "server down" without re-parsing.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Fetch wrapper that guarantees one of two outcomes:
 *   • resolves with the parsed JSON body, or
 *   • throws an {@link ApiError} (timeout, network failure, or non-2xx).
 *
 * Every request is bounded by an AbortController timeout (default 10s)
 * so a hung backend can never leave the UI stuck on a spinner — callers
 * just render an error state in the catch block.
 *
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function apiFetch(url, opts = {}) {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new ApiError(`Request to ${url} timed out after ${timeoutMs}ms`, { status: 0 });
    }
    throw new ApiError(`Network error calling ${url}: ${err?.message ?? err}`, { status: 0 });
  }
  clearTimeout(timer);

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* response had no JSON body */
  }

  if (!res.ok) {
    const message = body?.error || `Request to ${url} failed (${res.status})`;
    throw new ApiError(message, { status: res.status, body });
  }

  return body ?? {};
}

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
