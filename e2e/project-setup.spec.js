import { test, expect } from "@playwright/test";

/** Base URL path for the project setup page. */
const SETUP_URL = "/project-setup/";

/** API endpoint intercepted by route mocks. */
const API_PROJECTS = "/api/projects";

/**
 * Mocks the POST /api/projects endpoint with a successful response.
 * @param {import('@playwright/test').Page} page
 */
async function mockProjectSuccess(page) {
  await page.route(`**${API_PROJECTS}`, (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        project: { project_id: 1, name: "Test Project", workflow: "scrum" },
      }),
    })
  );
}

test.describe("Project setup page", () => {
  /**
   * Verifies the page title, project name input, workflow radio buttons,
   * member invite input, and submit button are rendered on load.
   */
  test("renders form and key elements", async ({ page }) => {
    await page.goto(SETUP_URL);

    await expect(page).toHaveTitle(/Project Setup/);
    await expect(page.locator("#project-name")).toBeVisible();
    await expect(page.locator("#wf-scrum")).toBeChecked();
    await expect(page.locator("#wf-kanban")).not.toBeChecked();
    await expect(page.locator("#wf-xp")).not.toBeChecked();
    await expect(page.locator("#member-email")).toBeVisible();
    await expect(page.locator("#submit-btn")).toBeVisible();
    await expect(page.locator("#submit-btn")).toHaveText("Create project");
  });

  /**
   * Verifies submitting with no project name shows the name required error
   * and the form does not navigate away.
   */
  test("shows error on empty project name submit", async ({ page }) => {
    await mockProjectSuccess(page);
    await page.goto(SETUP_URL);
    await page.locator("#submit-btn").click();

    await expect(page.locator("#name-error")).toBeVisible();
    await expect(page.locator("#name-error")).toContainText("required");
    await expect(page).toHaveURL(/project-setup/);
  });

  /**
   * Verifies typing into the project name field hides the inline error.
   */
  test("clears name error when user types", async ({ page }) => {
    await page.goto(SETUP_URL);
    await page.locator("#submit-btn").click();
    await expect(page.locator("#name-error")).toBeVisible();

    await page.locator("#project-name").fill("A");
    await expect(page.locator("#name-error")).toBeHidden();
  });

  /**
   * Verifies that clicking Add with an invalid email shows the member
   * error and does not add anything to the member list.
   */
  test("shows error for invalid member email", async ({ page }) => {
    await page.goto(SETUP_URL);
    await page.locator("#member-email").fill("notanemail");
    await page.locator("#add-member-btn").click();

    await expect(page.locator("#member-error")).toBeVisible();
    await expect(page.locator("#member-error")).toContainText("valid email");
    await expect(page.locator("#member-list-wrap")).toBeHidden();
  });

  /**
   * Verifies that adding a valid email appends it to the visible member list.
   */
  test("adds a valid member to the list", async ({ page }) => {
    await page.goto(SETUP_URL);
    await page.locator("#member-email").fill("alice@example.com");
    await page.locator("#add-member-btn").click();

    await expect(page.locator("#member-list-wrap")).toBeVisible();
    await expect(page.locator("#member-list")).toContainText("alice@example.com");
  });

  /**
   * Verifies that adding the same email twice shows a duplicate error
   * and does not add a second list item.
   */
  test("shows error for duplicate member email", async ({ page }) => {
    await page.goto(SETUP_URL);
    await page.locator("#member-email").fill("alice@example.com");
    await page.locator("#add-member-btn").click();
    await page.locator("#member-email").fill("alice@example.com");
    await page.locator("#add-member-btn").click();

    await expect(page.locator("#member-error")).toBeVisible();
    await expect(page.locator("#member-error")).toContainText("already been added");
    await expect(page.locator("#member-list li")).toHaveCount(1);
  });

  /**
   * Verifies the remove button on a member chip deletes it from the list
   * and hides the member list section when empty.
   */
  test("removes a member from the list", async ({ page }) => {
    await page.goto(SETUP_URL);
    await page.locator("#member-email").fill("bob@example.com");
    await page.locator("#add-member-btn").click();
    await expect(page.locator("#member-list-wrap")).toBeVisible();

    await page.getByRole("button", { name: /remove bob@example\.com/i }).click();

    await expect(page.locator("#member-list-wrap")).toBeHidden();
  });

  /**
   * Mocks a failed API response and verifies the error banner shows the
   * server error message.
   */
  test("shows error banner on API failure", async ({ page }) => {
    await page.route(`**${API_PROJECTS}`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Database unavailable" }),
      })
    );

    await page.goto(SETUP_URL);
    await page.locator("#project-name").fill("My Project");
    await page.locator("#submit-btn").click();

    await expect(page.locator("#error-banner")).toBeVisible();
    await expect(page.locator("#error-banner")).toContainText("Database unavailable");
  });

  /**
   * Mocks a successful API response with the Scrum workflow selected and
   * verifies the page redirects to the Scrum dashboard.
   * Note: the static server strips .html extensions, so scrum.html → /dashboard/scrum.
   */
  test("redirects to scrum dashboard on successful create with scrum", async ({ page }) => {
    await mockProjectSuccess(page);
    await page.goto(SETUP_URL);
    await page.locator("#project-name").fill("Sprint Board");
    await page.locator('label[for="wf-scrum"]').click();
    await page.locator("#submit-btn").click();

    await expect(page).toHaveURL(/\/scrum/);
  });

  /**
   * Mocks a successful API response with the Kanban workflow selected and
   * verifies the page redirects to the Kanban dashboard.
   * Note: the static server strips .html extensions, so kanban.html → /dashboard/kanban.
   */
  test("redirects to kanban dashboard on successful create with kanban", async ({ page }) => {
    await page.route(`**${API_PROJECTS}`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          project: { project_id: 2, name: "Kanban Board", workflow: "kanban" },
        }),
      })
    );

    await page.goto(SETUP_URL);
    await page.locator("#project-name").fill("Kanban Board");
    await page.locator('label[for="wf-kanban"]').click();
    await page.locator("#submit-btn").click();

    await expect(page).toHaveURL(/\/kanban/);
  });

  /**
   * Mocks a successful API response with the XP workflow selected and
   * verifies the page redirects to the XP dashboard.
   * Note: the static server strips .html extensions, so xp.html → /dashboard/xp.
   */
  test("redirects to xp dashboard on successful create with xp", async ({ page }) => {
    await page.route(`**${API_PROJECTS}`, (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          project: { project_id: 3, name: "XP Team", workflow: "xp" },
        }),
      })
    );

    await page.goto(SETUP_URL);
    await page.locator("#project-name").fill("XP Team");
    await page.locator('label[for="wf-xp"]').click();
    await page.locator("#submit-btn").click();

    await expect(page).toHaveURL(/\/xp/);
  });
});
