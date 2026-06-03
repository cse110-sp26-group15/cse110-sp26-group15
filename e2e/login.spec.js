import { test, expect } from "@playwright/test";

/** Base URL path for the login page. */
const LOGIN_URL = "/login/";

/** API endpoint intercepted by route mocks. */
const API_LOGIN = "/api/auth/login";

test.describe("Login page", () => {
  /**
   * Verifies the page title, form inputs, and submit button are rendered
   * correctly on initial load.
   */
  test("renders form and key elements", async ({ page }) => {
    await page.goto(LOGIN_URL);

    await expect(page).toHaveTitle(/Sign In/);
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#submit-btn")).toBeVisible();
    await expect(page.locator("#submit-btn")).toHaveText("Sign in");
  });

  /**
   * Verifies that submitting an empty form surfaces inline field errors
   * for both email and password without hitting the network.
   */
  test("shows validation errors on empty submit", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.locator("#submit-btn").click();

    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#password-error")).toBeVisible();
  });

  /**
   * Verifies the email field shows a validation error when the user
   * blurs away from an invalid email value.
   */
  test("shows email error for invalid email", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.locator("#email").fill("notanemail");
    await page.locator("#email").blur();

    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#email-error")).toContainText("valid email");
  });

  /**
   * Verifies the password field shows an error when the value is fewer
   * than 8 characters.
   */
  test("shows password error for short password", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.locator("#password").fill("short");
    await page.locator("#password").blur();

    await expect(page.locator("#password-error")).toBeVisible();
    await expect(page.locator("#password-error")).toContainText("8 characters");
  });

  /**
   * Verifies that typing into an errored field hides the inline error message.
   */
  test("clears field error when user types", async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.locator("#submit-btn").click();
    await expect(page.locator("#email-error")).toBeVisible();

    await page.locator("#email").fill("a");
    await expect(page.locator("#email-error")).toBeHidden();
  });

  /**
   * Verifies the show/hide password toggle cycles the input type and
   * label text correctly.
   */
  test("toggles password visibility", async ({ page }) => {
    await page.goto(LOGIN_URL);
    const pwInput = page.locator("#password");
    const toggleLabel = page.locator("#toggle-label");

    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(toggleLabel).toHaveText("show");

    await page.locator("#toggle-password").click();
    await expect(pwInput).toHaveAttribute("type", "text");
    await expect(toggleLabel).toHaveText("hide");

    await page.locator("#toggle-password").click();
    await expect(pwInput).toHaveAttribute("type", "password");
  });

  /**
   * Mocks the login API to return a 401, then verifies the error banner
   * surfaces the message returned by the API.
   */
  test("shows error banner on API failure", async ({ page }) => {
    await page.route(`**${API_LOGIN}`, (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid credentials" }),
      })
    );

    await page.goto(LOGIN_URL);
    await page.locator("#email").fill("user@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#submit-btn").click();

    await expect(page.locator("#error-banner")).toBeVisible();
    await expect(page.locator("#error-banner")).toContainText("Invalid credentials");
  });

  /**
   * Mocks a successful login API response and verifies the page
   * navigates to project-setup after a valid form submission.
   */
  test("redirects to project-setup on successful login", async ({ page }) => {
    await page.route(`**${API_LOGIN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "fake-jwt-token",
          user: { id: 1, email: "user@example.com" },
        }),
      })
    );

    await page.goto(LOGIN_URL);
    await page.locator("#email").fill("user@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#submit-btn").click();

    await expect(page).toHaveURL(/project-setup/);
  });
});
