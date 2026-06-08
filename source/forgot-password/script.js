import { validateEmail, setFieldError, clearFieldError } from "../shared/utils.js";

/**
 * POST the email to /api/auth/forgot-password. Resolved to the parsed
 * body so callers can pick up the dev_token in local mode. Throws on
 * non-2xx (e.g. invalid-email 400).
 *
 * @param {string} email
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>}
 */
export async function requestPasswordReset(email, fetchImpl = fetch) {
  const res = await fetchImpl("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not send reset link.");
  }
  return res.json();
}

// DOM wiring — skipped under node so the export above is testable.
if (typeof document !== "undefined") {
  const fpForm = document.getElementById("fp-form");
  const emailInput = document.getElementById("email");
  const emailError = document.getElementById("email-error");
  const submitBtn = document.getElementById("submit-btn");
  const formState = document.getElementById("form-state");
  const successState = document.getElementById("success-state");
  const devTokenRow = document.getElementById("dev-token-row");
  const devResetLink = document.getElementById("dev-reset-link");

  emailInput.addEventListener("blur", () => {
    if (emailInput.value && !validateEmail(emailInput.value)) {
      setFieldError(emailInput, emailError, "Please enter a valid email address.");
    } else {
      clearFieldError(emailInput, emailError);
    }
  });

  emailInput.addEventListener("input", () => clearFieldError(emailInput, emailError));

  fpForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();

    if (!validateEmail(email)) {
      setFieldError(emailInput, emailError, "Please enter a valid email address.");
      emailInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const body = await requestPasswordReset(email);
      formState.hidden = true;
      successState.hidden = false;
      // Dev mode: the API surfaces the freshly minted token so the local
      // tester can complete the reset flow without an email provider.
      if (body.dev_token && devTokenRow && devResetLink) {
        devResetLink.href = `../reset-password/?token=${encodeURIComponent(body.dev_token)}`;
        devTokenRow.hidden = false;
      }
    } catch (err) {
      setFieldError(emailInput, emailError, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = "Send reset link";
    }
  });
}
