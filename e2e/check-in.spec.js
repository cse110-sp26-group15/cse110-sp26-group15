import { test, expect } from "@playwright/test";

/** URL of the check-in page (not an index.html shortcut — explicit filename). */
const CHECKIN_URL = "/check-in/check-in.html";

/** Project ID used when sitrep_project is seeded for the session. */
const PROJECT_ID = 1;

const STORED_PROJECT = { project_id: PROJECT_ID, name: "Test Project", workflow: "scrum" };

/** Seed sitrep_project before the page script runs. */
async function seedProject(page, project = STORED_PROJECT) {
  await page.addInitScript((p) => {
    localStorage.setItem("sitrep_project", JSON.stringify(p));
  }, project);
}

/**
 * Sets up the three GET mocks the check-in page fires on load:
 *   - GET /api/projects/1/checkins  → provided checkins array
 *   - GET /api/projects/1/tasks     → empty (blocker picker still works)
 *   - GET /api/projects/1/members   → empty (blocker picker still works)
 *
 * @param {import('@playwright/test').Page} page
 * @param {object[]} checkins - Check-ins to return on the initial load.
 */
async function mockPageLoad(page, checkins = []) {
  await page.route(`**/api/projects/${PROJECT_ID}/checkins`, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkins }),
    });
  });

  await page.route(`**/api/projects/${PROJECT_ID}/tasks`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tasks: [] }),
    })
  );

  await page.route(`**/api/projects/${PROJECT_ID}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ members: [] }),
    })
  );
}

/**
 * Builds a minimal check-in object dated today, owned by user_id 1 (the
 * unauthenticated fallback used by check-in.js when localStorage is empty).
 *
 * @param {Partial<object>} overrides
 * @returns {object}
 */
function todayCheckin(overrides = {}) {
  return {
    checkin_id: 1,
    user_id: 1,
    checkin_date: new Date().toISOString(),
    work_done: "Reviewed PRs",
    work_planned: "Write tests",
    status_mood: "workload:moderate",
    ...overrides,
  };
}

test.describe("Check-in page", () => {
  /**
   * Verifies the page title and key structural elements are present.
   */
  test("renders page title and form", async ({ page }) => {
    await seedProject(page);
    await mockPageLoad(page);
    await page.goto(CHECKIN_URL);

    await expect(page).toHaveTitle(/Check-ins/);
    await expect(page.locator("#checkin-form")).toBeVisible();
    await expect(page.locator("#field-work-done")).toBeVisible();
    await expect(page.locator("#field-work-planned")).toBeVisible();
    await expect(page.locator("#field-workload")).toBeVisible();
    await expect(page.locator("#submit-checkin-btn")).toBeVisible();
  });

  /**
   * Verifies the "please check in" prompt is shown when no check-in exists
   * for today, and the form is visible.
   */
  test("shows check-in prompt when no check-in today", async ({ page }) => {
    await seedProject(page);
    await mockPageLoad(page, []);
    await page.goto(CHECKIN_URL);

    await expect(page.locator("#checkin-prompt")).toBeVisible();
    await expect(page.locator("#checkin-done")).toBeHidden();
    await expect(page.locator("#checkin-form")).toBeVisible();
  });

  /**
   * Verifies the "already done" banner is shown and the form is hidden when
   * the API returns a check-in for today owned by the current user (user_id 1).
   */
  test("shows done banner when today's check-in already exists", async ({ page }) => {
    await seedProject(page);
    await mockPageLoad(page, [todayCheckin()]);
    await page.goto(CHECKIN_URL);

    await expect(page.locator("#checkin-done")).toBeVisible();
    await expect(page.locator("#checkin-prompt")).toBeHidden();
    await expect(page.locator("#checkin-form")).toBeHidden();
  });

  /**
   * Verifies an inline error appears when the form is submitted with all
   * required fields empty, without hitting the network.
   */
  test("shows validation error on empty submit", async ({ page }) => {
    await seedProject(page);
    await mockPageLoad(page);
    await page.goto(CHECKIN_URL);
    await page.locator("#submit-checkin-btn").click();

    await expect(page.locator("#checkin-form-error")).toBeVisible();
    await expect(page.locator("#checkin-form-error")).toContainText("Please fill in what you did");
  });

  /**
   * Verifies the blocker panel is hidden by default and becomes visible after
   * clicking the toggle button. Clicking again closes it.
   */
  test("toggles blocker panel open and closed", async ({ page }) => {
    await seedProject(page);
    await mockPageLoad(page);
    await page.goto(CHECKIN_URL);

    await expect(page.locator("#blocker-panel")).toBeHidden();

    await page.locator("#blocker-toggle-btn").click();
    await expect(page.locator("#blocker-panel")).toBeVisible();
    await expect(page.locator("#blocker-toggle-btn")).toHaveAttribute("aria-expanded", "true");

    await page.locator("#blocker-toggle-btn").click();
    await expect(page.locator("#blocker-panel")).toBeHidden();
    await expect(page.locator("#blocker-toggle-btn")).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * Mocks a successful POST /api/projects/1/checkins and verifies the form
   * submits cleanly and the done banner replaces the form afterwards.
   */
  test("submits check-in and shows done banner on success", async ({ page }) => {
    const submitted = todayCheckin({ work_done: "Fixed bugs", work_planned: "Write e2e tests" });

    let getCallCount = 0;
    await page.route(`**/api/projects/${PROJECT_ID}/checkins`, (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ checkin: submitted }),
        });
      }
      getCallCount++;
      const checkins = getCallCount === 1 ? [] : [submitted];
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ checkins }),
      });
    });

    await page.route(`**/api/projects/${PROJECT_ID}/tasks`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tasks: [] }),
      })
    );
    await page.route(`**/api/projects/${PROJECT_ID}/members`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ members: [] }),
      })
    );

    await seedProject(page);
    await page.goto(CHECKIN_URL);
    await page.locator("#field-work-done").fill("Fixed bugs");
    await page.locator("#field-work-planned").fill("Write e2e tests");
    await page.locator("#field-workload").selectOption("moderate");
    await page.locator("#submit-checkin-btn").click();

    await expect(page.locator("#checkin-done")).toBeVisible();
    await expect(page.locator("#checkin-form")).toBeHidden();
  });

  /**
   * Verifies that past check-ins returned by the API are rendered as cards
   * in the check-in history section.
   */
  test("renders past check-ins from the API", async ({ page }) => {
    const pastCheckin = {
      checkin_id: 99,
      user_id: 2,
      checkin_date: "2026-05-30T10:00:00.000Z",
      work_done: "Deployed feature",
      work_planned: "Monitor rollout",
      status_mood: "workload:light",
      user: { full_name: "Alice Smith" },
    };
    await seedProject(page);
    await mockPageLoad(page, [pastCheckin]);
    await page.goto(CHECKIN_URL);

    const list = page.locator("#checkin-list");
    await expect(list).toContainText("Alice Smith");
    await expect(list).toContainText("Deployed feature");
    await expect(list).toContainText("Monitor rollout");
  });
});
