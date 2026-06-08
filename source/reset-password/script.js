import { setFieldError, clearFieldError } from "../shared/utils.js";

/**
 * POST a new password + the token from the reset link to
 * /api/auth/reset-password. Resolved to the parsed body; throws on
 * non-2xx so the caller can paint the inline error.
 *
 * @param {string} token
 * @param {string} newPassword
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>}
 */
export async function submitPasswordReset(token, newPassword, fetchImpl = fetch) {
  const res = await fetchImpl("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not reset password.");
  }
  return res.json();
}

/**
 * Read the reset token out of the URL query string. Returns null when
 * absent or empty so the page can render the "missing token" state.
 *
 * @param {string} search - location.search (e.g. "?token=abc").
 * @returns {string|null}
 */
export function tokenFromSearch(search) {
  const params = new URLSearchParams(search ?? "");
  const t = params.get("token");
  return t && t.trim() ? t.trim() : null;
}

if (typeof document !== "undefined") {
  const form = document.getElementById("reset-form");
  const passwordInput = document.getElementById("password");
  const passwordError = document.getElementById("password-error");
  const confirmInput = document.getElementById("confirm");
  const confirmError = document.getElementById("confirm-error");
  const submitBtn = document.getElementById("submit-btn");
  const formState = document.getElementById("form-state");
  const successState = document.getElementById("success-state");
  const missingState = document.getElementById("missing-token-state");

  const token = tokenFromSearch(window.location.search);
  if (!token) {
    formState.hidden = true;
    missingState.hidden = false;
  }

  passwordInput?.addEventListener("input", () => clearFieldError(passwordInput, passwordError));
  confirmInput?.addEventListener("input", () => clearFieldError(confirmInput, confirmError));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) return;

    const pw = passwordInput.value;
    const cf = confirmInput.value;

    if (pw.length < 8) {
      setFieldError(passwordInput, passwordError, "Password must be at least 8 characters.");
      passwordInput.focus();
      return;
    }
    if (pw !== cf) {
      setFieldError(confirmInput, confirmError, "Passwords don't match.");
      confirmInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";

    try {
      await submitPasswordReset(token, pw);
      formState.hidden = true;
      successState.hidden = false;
    } catch (err) {
      setFieldError(passwordInput, passwordError, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Update password";
    }
  });
}
