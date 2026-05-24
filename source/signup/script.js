import {
  validateEmail,
  validatePassword,
  setFieldError,
  clearFieldError,
  showBanner,
  hideBanner,
  navigateTo,
  apiSignup,
  saveToken,
  saveCurrentUser,
} from "../shared/utils.js";

const form = document.getElementById("signup-form");
const emailInput = document.getElementById("email");
const emailError = document.getElementById("email-error");
const pwInput = document.getElementById("password");
const pwError = document.getElementById("password-error");
const confirmInput = document.getElementById("confirm-password");
const confirmError = document.getElementById("confirm-error");
const submitBtn = document.getElementById("submit-btn");
const banner = document.getElementById("error-banner");
const toggleBtn = document.getElementById("toggle-password");
const toggleLabel = document.getElementById("toggle-label");
const toggleConfirm = document.getElementById("toggle-confirm");
const toggleConfirmLabel = document.getElementById("toggle-confirm-label");

// ── Password show/hide ──────────────────────────────────
toggleBtn.addEventListener("click", () => {
  const isHidden = pwInput.type === "password";
  pwInput.type = isHidden ? "text" : "password";
  toggleLabel.textContent = isHidden ? "hide" : "show";
});

toggleConfirm.addEventListener("click", () => {
  const isHidden = confirmInput.type === "password";
  confirmInput.type = isHidden ? "text" : "password";
  toggleConfirmLabel.textContent = isHidden ? "hide" : "show";
});

// ── Inline validation on blur ───────────────────────────
emailInput.addEventListener("blur", () => {
  if (!validateEmail(emailInput.value)) {
    setFieldError(emailInput, emailError, "Please enter a valid email address.");
  } else {
    clearFieldError(emailInput, emailError);
  }
});

pwInput.addEventListener("blur", () => {
  if (!validatePassword(pwInput.value)) {
    setFieldError(pwInput, pwError, "Password must be at least 8 characters.");
  } else {
    clearFieldError(pwInput, pwError);
  }
});

confirmInput.addEventListener("blur", () => {
  if (confirmInput.value !== pwInput.value) {
    setFieldError(confirmInput, confirmError, "Passwords do not match.");
  } else {
    clearFieldError(confirmInput, confirmError);
  }
});

// Clear on input
emailInput.addEventListener("input", () => clearFieldError(emailInput, emailError));
pwInput.addEventListener("input", () => clearFieldError(pwInput, pwError));
confirmInput.addEventListener("input", () => clearFieldError(confirmInput, confirmError));

// ── Form submit ─────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner(banner);

  const email = emailInput.value.trim();
  const password = pwInput.value;
  const confirm = confirmInput.value;

  let valid = true;

  if (!validateEmail(email)) {
    setFieldError(emailInput, emailError, "Please enter a valid email address.");
    valid = false;
  }

  if (!validatePassword(password)) {
    setFieldError(pwInput, pwError, "Password must be at least 8 characters.");
    valid = false;
  }

  if (confirm !== password) {
    setFieldError(confirmInput, confirmError, "Passwords do not match.");
    valid = false;
  }

  if (!valid) return;

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  submitBtn.textContent = "Creating account…";

  try {
    const { token, user } = await apiSignup({ email, password });
    saveToken(token);
    saveCurrentUser(user);
    navigateTo("../project-setup/");
  } catch (err) {
    showBanner(banner, err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
    submitBtn.textContent = "Create account";
  }
});
