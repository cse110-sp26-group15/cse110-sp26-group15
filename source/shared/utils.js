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
 * TODO: Replace mock with real backend when API is ready.
 * POST /api/projects
 */
export async function apiCreateProject({ name, workflow, members }) {
  await mockDelay(700);

  // TODO: Remove mock and uncomment fetch below
  /*
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ name, workflow, members }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to create project");
  }
  return res.json();
  */

  return { id: "mock-project-id", name, workflow, members };
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

// ── Internal ─────────────────────────────────────────────

function mockDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
