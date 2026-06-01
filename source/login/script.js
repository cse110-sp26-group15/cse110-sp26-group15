import {
  validateEmail,
  validatePassword,
  setFieldError,
  clearFieldError,
  showBanner,
  hideBanner,
  navigateTo,
  apiLogin,
  saveToken,
  saveCurrentUser,
} from "../shared/utils.js";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const emailError = document.getElementById("email-error");
const pwInput = document.getElementById("password");
const pwError = document.getElementById("password-error");
const submitBtn = document.getElementById("submit-btn");
const banner = document.getElementById("error-banner");
const toggleBtn = document.getElementById("toggle-password");
const toggleLabel = document.getElementById("toggle-label");
const slackBtn = document.getElementById("slack-btn");
const slackNotice = document.getElementById("slack-notice");
const rememberMe = document.getElementById("remember-me");

// ── Remember Me — restore saved email on load ───────────
const savedEmail = localStorage.getItem("sitrep_remembered_email");
if (savedEmail) {
  emailInput.value = savedEmail;
  rememberMe.checked = true;
}

// ── Password show/hide ──────────────────────────────────
toggleBtn.addEventListener("click", () => {
  const isHidden = pwInput.type === "password";
  pwInput.type = isHidden ? "text" : "password";
  toggleLabel.textContent = isHidden ? "hide" : "show";
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

emailInput.addEventListener("input", () => clearFieldError(emailInput, emailError));
pwInput.addEventListener("input", () => clearFieldError(pwInput, pwError));

// ── Slack SSO — show inline notice instead of alert ─────
slackBtn.addEventListener("click", () => {
  slackNotice.hidden = false;
  slackNotice.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ── Form submit ─────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner(banner);

  const email = emailInput.value.trim();
  const password = pwInput.value;

  let valid = true;

  if (!validateEmail(email)) {
    setFieldError(emailInput, emailError, "Please enter a valid email address.");
    valid = false;
  }

  if (!validatePassword(password)) {
    setFieldError(pwInput, pwError, "Password must be at least 8 characters.");
    valid = false;
  }

  if (!valid) return;

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  submitBtn.textContent = "Signing in…";

  try {
    const { token, user } = await apiLogin({ email, password });
    saveToken(token);
    saveCurrentUser(user);

    // Persist or clear remembered email based on checkbox
    if (rememberMe.checked) {
      localStorage.setItem("sitrep_remembered_email", email);
    } else {
      localStorage.removeItem("sitrep_remembered_email");
    }

    navigateTo("../project-setup/");
  } catch (err) {
    showBanner(banner, err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("loading");
    submitBtn.textContent = "Sign in";
  }
});
