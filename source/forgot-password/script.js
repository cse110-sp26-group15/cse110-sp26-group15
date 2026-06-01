import { validateEmail, setFieldError, clearFieldError } from "../shared/utils.js";

const fpForm = document.getElementById("fp-form");
const emailInput = document.getElementById("email");
const emailError = document.getElementById("email-error");
const submitBtn = document.getElementById("submit-btn");
const formState = document.getElementById("form-state");
const successState = document.getElementById("success-state");

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

  // Simulate network delay for UX feedback, then show success state.
  // No actual API call — placeholder until reset endpoint is implemented.
  await new Promise((resolve) => setTimeout(resolve, 800));

  formState.hidden = true;
  successState.hidden = false;
});
