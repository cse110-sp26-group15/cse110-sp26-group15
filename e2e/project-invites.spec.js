import { test, expect } from "@playwright/test";

const SETUP_URL = "/project-setup/";

/**
 * Seed a current user in sessionStorage before the page's module runs.
 * @param {import('@playwright/test').Page} page
 */
async function seedUser(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "sitrep_user",
      JSON.stringify({ user_id: 9, email: "ghost@x.com", full_name: "Ghost" })
    );
  });
}

test.describe("Onboarding pending invites", () => {
  test("shows pending invitations and joins on click", async ({ page }) => {
    await seedUser(page);
    await page.route("**/api/invites**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invites: [
            { invite_id: 1, project_id: 3, project_name: "Research Spike", workflow: "xp" },
          ],
        }),
      })
    );
    await page.route("**/api/projects/3/members", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ status: "added", member: { user_id: 9 } }),
      })
    );

    await page.goto(SETUP_URL);
    await expect(page.locator("#invites-section")).toBeVisible();
    await expect(page.locator("#invites-list")).toContainText("Research Spike");

    await page.getByRole("button", { name: "Join" }).click();
    await expect(page).toHaveURL(/\/xp/);
  });

  test("hides the invites section when there are none", async ({ page }) => {
    await seedUser(page);
    await page.route("**/api/invites**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invites: [] }),
      })
    );
    await page.goto(SETUP_URL);
    await expect(page.locator("#invites-section")).toBeHidden();
  });
});
