import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  /**
   * Verifies the root index redirects to the login page via the meta-refresh
   * tag, so unauthenticated users always land on login first.
   */
  test("root redirects to login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/login/);
    await expect(page).toHaveTitle(/Sign In/);
  });

  /**
   * Verifies the login page has a visible link that navigates to signup.
   */
  test("login page links to signup", async ({ page }) => {
    await page.goto("/login/");
    const signupLink = page.getByRole("link", { name: /sign up/i });
    await expect(signupLink).toBeVisible();
    await signupLink.click();
    await expect(page).toHaveURL(/signup/);
  });

  /**
   * Verifies the signup page has a visible link that navigates back to login.
   */
  test("signup page links back to login", async ({ page }) => {
    await page.goto("/signup/");
    const loginLink = page.getByRole("link", { name: /sign in/i });
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/login/);
  });
});
