import { test, expect } from "@playwright/test";

const STORED_PROJECT = { project_id: 1, name: "Test Project", workflow: "kanban" };

// How many tasks to pile into a single column to force overflow. Large enough
// that the cards cannot all fit in the column at once on any normal viewport.
const TODO_TASK_COUNT = 40;

/** Seed sitrep_project before the page script runs. */
async function seedProject(page, project = STORED_PROJECT) {
  await page.addInitScript((p) => {
    localStorage.setItem("sitrep_project", JSON.stringify(p));
  }, project);
}

/**
 * Builds a list of identical-content kanban tasks for one status. Identical
 * content means every card renders at the same natural height, so a height
 * mismatch in the assertions can only come from compression.
 * @param {number} count
 * @param {string} status
 * @param {number} startId
 * @returns {object[]}
 */
function makeTasks(count, status, startId) {
  return Array.from({ length: count }, (_, i) => ({
    task_id: startId + i,
    title: `Task ${startId + i}`,
    description: "A representative task description used for the scroll test.",
    status,
    priority: "medium",
    assigned_to: null,
  }));
}

/**
 * Mocks the kanban dashboard's initial load (main.js) with a large task list
 * so the To Do column overflows. Mirrors the mock set used in navigation.spec.js.
 * @param {import('@playwright/test').Page} page
 * @param {number} projectId
 */
async function mockKanbanLoadWithManyTasks(page, projectId = 1) {
  const ok = (body) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  const tasks = [
    ...makeTasks(TODO_TASK_COUNT, "todo", 1),
    ...makeTasks(5, "in-progress", 1000),
    ...makeTasks(5, "done", 2000),
  ];

  await page.route(`**/api/projects/${projectId}/tasks`, (route) => route.fulfill(ok({ tasks })));
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

test.describe("Kanban column scrolling", () => {
  test("renders every task and scrolls instead of compressing the cards", async ({ page }) => {
    await seedProject(page);
    await mockKanbanLoadWithManyTasks(page);
    await page.goto("/dashboard/kanban.html");

    const cards = page.locator("#cards-todo > .task-card");

    // Acceptance: all tasks are present (none dropped to make room).
    await expect(cards).toHaveCount(TODO_TASK_COUNT);
    await expect(page.locator("#count-todo")).toHaveText(String(TODO_TASK_COUNT));

    // Acceptance: the column actually scrolls — its content is taller than the
    // visible area. If the cards were being compressed to fit, scrollHeight
    // would collapse toward clientHeight and this would fail.
    const list = page.locator("#cards-todo");
    const overflow = await list.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight + 100);

    // Acceptance: cards remain readable — each keeps a sane height and they are
    // all the same size (identical content ⇒ identical, uncompressed height).
    const firstBox = await cards.first().boundingBox();
    const lastBox = await cards.last().boundingBox();
    expect(firstBox.height).toBeGreaterThanOrEqual(56);
    expect(Math.abs(firstBox.height - lastBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(firstBox.width - lastBox.width)).toBeLessThanOrEqual(1);
  });

  test("columns stay usable when the viewport is short", async ({ page }) => {
    // A short viewport would otherwise let the flex board collapse to a sliver.
    await page.setViewportSize({ width: 1024, height: 420 });
    await seedProject(page);
    await mockKanbanLoadWithManyTasks(page);
    await page.goto("/dashboard/kanban.html");

    await expect(page.locator("#cards-todo > .task-card")).toHaveCount(TODO_TASK_COUNT);

    // The board keeps its min-height floor rather than collapsing.
    const board = await page.locator("#kanban-board").boundingBox();
    expect(board.height).toBeGreaterThanOrEqual(316);

    // With the board floored, the content area scrolls the page so the board
    // and the section above it both stay reachable.
    const content = page.locator(".content-area");
    const scrolls = await content.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
  });
});
