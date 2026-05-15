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
 * TODO: Replace mock with real backend when API is ready.
 * POST /api/login
 */
export async function apiLogin({ email }) {
  // Mock: simulate network delay
  await mockDelay(600);

  // TODO: Remove mock and uncomment fetch below
  /*
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Login failed");
  }
  return res.json();
  */

  // Mock success – any email accepted
  return { token: "mock-token-login", user: { email } };
}

/**
 * TODO: Replace mock with real backend when API is ready.
 * POST /api/signup
 */
export async function apiSignup({ email }) {
  await mockDelay(600);

  // TODO: Remove mock and uncomment fetch below
  /*
  const res = await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Signup failed");
  }
  return res.json();
  */

  return { token: "mock-token-signup", user: { email } };
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

export function saveToken(token) {
  // TODO: Use httpOnly cookie via backend for production
  sessionStorage.setItem("sitrep_token", token);
}

export function getToken() {
  return sessionStorage.getItem("sitrep_token");
}

// ── Internal ─────────────────────────────────────────────

function mockDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
