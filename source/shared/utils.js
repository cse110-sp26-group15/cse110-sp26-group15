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

// ── Loading state ───────────────────────────────────────
// A centered spinner overlay shown over a container (default: the
// dashboard content area) during its initial data fetch. Styled in
// dashboard/main.css. Idempotent and announced to assistive tech via
// role="status" so screen readers hear the loading state.

export function showLoading(target = document.getElementById("page-content"), label = "Loading…") {
  if (!target || target.querySelector(".loading-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.setAttribute("role", "status");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "loading-overlay__label";
  text.textContent = label;
  overlay.append(spinner, text);
  target.appendChild(overlay);
}

export function hideLoading(target = document.getElementById("page-content")) {
  target?.querySelector(".loading-overlay")?.remove();
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
    // 401 = no/expired session. Bounce to login here (not in every caller) so
    // every guarded fetch behaves the same, but skip it when we're already on
    // an auth page to avoid a redirect loop. Still throw so the in-flight
    // caller stops cleanly while the navigation happens.
    if (
      res.status === 401 &&
      typeof location !== "undefined" &&
      !location.pathname.includes("/login") &&
      !location.pathname.includes("/signup")
    ) {
      const here = encodeURIComponent(location.pathname + location.search);
      location.href = `/login/?next=${here}`;
    }
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
 * full_name is optional — included in the payload if provided but ignored
 * gracefully if the backend doesn't support it yet.
 */
export async function apiSignup({ email, password, full_name }) {
  const body = { email, password };
  if (full_name) body.full_name = full_name;

  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
 * The creator is taken from the session cookie by the server, so it is not part
 * of the payload.
 *
 * @param {object}    args
 * @param {string}    args.name          Project display name.
 * @param {string}    args.workflow      One of 'scrum' | 'kanban' | 'xp'.
 * @param {string[]}  args.members       Invited member emails.
 * @returns {Promise<{ project: object, invited: Array<{user_id:number,email:string}>, not_found: string[] }>}
 * @throws {Error} When the server responds with a non-2xx status.
 */
export async function apiCreateProject({ name, workflow, members }) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, workflow, members }),
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

// ── Current project helpers ─────────────────────────────

const CURRENT_PROJECT_KEY = "sitrep_project";

/**
 * Read the id of the project the user is currently working in. Project setup
 * stores `{ project_id, name, workflow }` under `sitrep_project`; the dashboards
 * and check-in page read the id from here instead of hard-coding it, so each
 * project shows its own data rather than always loading project 1.
 *
 * Falls back to `fallback` when nothing is stored, the stored value predates
 * this field, or storage is unavailable (e.g. under Node during tests) — this
 * keeps direct navigation and the unit suite working unchanged.
 *
 * @param {number} [fallback=1]
 * @returns {number}
 */
export function getCurrentProjectId(fallback = 1) {
  try {
    const raw = localStorage.getItem(CURRENT_PROJECT_KEY);
    const id = raw ? JSON.parse(raw)?.project_id : null;
    return Number.isInteger(id) && id > 0 ? id : fallback;
  } catch {
    return fallback;
  }
}
