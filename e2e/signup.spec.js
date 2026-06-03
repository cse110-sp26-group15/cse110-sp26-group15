import { test, expect } from "@playwright/test";

/** Base URL path for the signup page. */
const SIGNUP_URL = "/signup/";

/** API endpoint intercepted by route mocks. */
const API_SIGNUP = "/api/auth/signup";

test.describe("Signup page", () => {
  /**
   * Verifies the page title, all three form inputs, and the submit
   * button are rendered correctly on initial load.
   */
  test("renders form and key elements", async ({ page }) => {
    await page.goto(SIGNUP_URL);

    await expect(page).toHaveTitle(/Create Account/);
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirm-password")).toBeVisible();
    await expect(page.locator("#submit-btn")).toBeVisible();
    await expect(page.locator("#submit-btn")).toHaveText("Create account");
  });

  /**
   * Verifies that submitting an empty form surfaces inline field errors
   * for email and password. The confirm-password error is not shown when
   * both fields are empty because they match ("" === "").
   */
  test("shows validation errors on empty submit", async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await page.locator("#submit-btn").click();

    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#password-error")).toBeVisible();
    await expect(page.locator("#confirm-error")).toBeHidden();
  });

  /**
   * Verifies the password-mismatch error appears when confirm-password
   * differs from password on blur.
   */
  test("shows mismatch error when passwords differ", async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await page.locator("#password").fill("password123");
    await page.locator("#confirm-password").fill("different99");
    await page.locator("#confirm-password").blur();

    await expect(page.locator("#confirm-error")).toBeVisible();
    await expect(page.locator("#confirm-error")).toContainText("do not match");
  });

  /**
   * Verifies no confirm-password error is shown when both password
   * fields match.
   */
  test("no mismatch error when passwords match", async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await page.locator("#password").fill("password123");
    await page.locator("#confirm-password").fill("password123");
    await page.locator("#confirm-password").blur();

    await expect(page.locator("#confirm-error")).toBeHidden();
  });

  /**
   * Verifies that typing into the confirm-password field after a mismatch
   * error clears the inline error message.
   */
  test("clears confirm error when user retypes", async ({ page }) => {
    await page.goto(SIGNUP_URL);
    await page.locator("#password").fill("password123");
    await page.locator("#confirm-password").fill("wrong");
    await page.locator("#confirm-password").blur();
    await expect(page.locator("#confirm-error")).toBeVisible();

    await page.locator("#confirm-password").fill("a");
    await expect(page.locator("#confirm-error")).toBeHidden();
  });

  /**
   * Mocks the signup API to return a 409 conflict, then verifies the
   * error banner surfaces the API error message.
   */
  test("shows error banner on API failure", async ({ page }) => {
    await page.route(`**${API_SIGNUP}`, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Email already in use" }),
      })
    );

    await page.goto(SIGNUP_URL);
    if (await page.locator("#full-name").count()) {
      await page.locator("#full-name").fill("Test User");
    }
    await page.locator("#email").fill("taken@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#confirm-password").fill("password123");
    await page.locator("#submit-btn").click();

    await expect(page.locator("#error-banner")).toBeVisible();
    await expect(page.locator("#error-banner")).toContainText("Email already in use");
  });

  /**
   * Mocks a successful signup API response and verifies the page
   * navigates to project-setup after a valid form submission.
   */
  test("redirects to project-setup on successful signup", async ({ page }) => {
    await page.route(`**${API_SIGNUP}`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          token: "fake-jwt-token",
          user: { id: 42, email: "new@example.com" },
        }),
      })
    );

    await page.goto(SIGNUP_URL);
    if (await page.locator("#full-name").count()) {
      await page.locator("#full-name").fill("Test User");
    }
    await page.locator("#email").fill("new@example.com");
    await page.locator("#password").fill("password123");
    await page.locator("#confirm-password").fill("password123");
    await page.locator("#submit-btn").click();

    await expect(page).toHaveURL(/project-setup/);
  });
});
