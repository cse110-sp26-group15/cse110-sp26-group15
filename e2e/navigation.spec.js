import { test, expect } from "@playwright/test";

const STORED_PROJECT = { project_id: 1, name: "Test Project", workflow: "kanban" };

/** Seed sitrep_project before the page script runs. */
async function seedProject(page, project = STORED_PROJECT) {
  await page.addInitScript((p) => {
    localStorage.setItem("sitrep_project", JSON.stringify(p));
  }, project);
}

/** Minimal API mocks for the kanban dashboard (main.js) initial load. */
async function mockKanbanLoad(page, projectId = 1) {
  const ok = (body) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route(`**/api/projects/${projectId}/tasks`, (route) =>
    route.fulfill(ok({ tasks: [] }))
  );
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill(ok({ members: [] }))
  );
  await page.route(`**/api/projects/${projectId}/agents`, (route) =>
    route.fulfill(ok({ agents: [] }))
  );
  await page.route(`**/api/projects/${projectId}/checkins`, (route) =>
    route.fulfill(ok({ checkins: [] }))
  );
  await page.route(`**/api/projects/${projectId}/dashboard`, (route) =>
    route.fulfill(ok({ checkins: { entries: [] }, blockers: { entries: [] } }))
  );
}

/** Minimal API mocks for the check-in page initial load. */
async function mockCheckinLoad(page, projectId = 1) {
  const ok = (body) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route(`**/api/projects/${projectId}/checkins`, (route) =>
    route.fulfill(ok({ checkins: [] }))
  );
  await page.route(`**/api/projects/${projectId}/tasks`, (route) =>
    route.fulfill(ok({ tasks: [] }))
  );
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill(ok({ members: [] }))
  );
}

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

  test("check-in Team sidebar link points at the workflow dashboard's team view", async ({
    page,
  }) => {
    await seedProject(page);
    await mockCheckinLoad(page);
    await page.goto("/check-in/check-in.html");

    // After b787cfe the Team nav is no longer rendered in-page on check-in —
    // it navigates to the team section of the project's dashboard. With
    // workflow="kanban" seeded that resolves to kanban.html#team.
    await expect(page.locator("#nav-team")).toHaveAttribute(
      "href",
      "../dashboard/kanban.html#team"
    );
  });

  test("profile sidebar links preserve workflow and destinations", async ({ page }) => {
    await seedProject(page);
    await page.goto("/profile/");

    await expect(page.locator("#nav-check-ins")).toHaveAttribute(
      "href",
      "../check-in/check-in.html"
    );
    await expect(page.locator("#nav-team")).toHaveAttribute(
      "href",
      "../dashboard/kanban.html#team"
    );
    // Weekly Report is its own page now (per b787cfe — accessible from any
    // nav, not buried inside a dashboard hash).
    await expect(page.locator("#nav-weekly-report")).toHaveAttribute(
      "href",
      "../weekly-report/index.html"
    );
  });

  test("profile My Check-ins navigates to the check-in page", async ({ page }) => {
    await seedProject(page);
    await mockCheckinLoad(page);
    await page.goto("/profile/");

    await page.locator("#nav-check-ins").click();
    await expect(page).toHaveURL(/check-in\/check-in/);
  });

  test("profile Team link opens the Team placeholder on the workflow dashboard", async ({
    page,
  }) => {
    await seedProject(page);
    await mockKanbanLoad(page);
    await page.goto("/profile/");

    await page.locator("#nav-team").click();
    await expect(page).toHaveURL(/dashboard\/kanban#team/);
    await expect(page.locator("#team-view")).toBeVisible();
    await expect(page.getByRole("link", { name: "Team" })).toHaveClass(/active/);
  });

  test("profile redirects to projects when no session project is stored", async ({ page }) => {
    await page.goto("/profile/");
    await expect(page).toHaveURL(/projects\/projects/);
  });
});
