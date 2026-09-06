/**
 * C29 - accessibility.
 *
 * Two halves, and only the first is automated:
 *
 *   1. An axe-core scan of every page. Automated scanning catches a minority of
 *      WCAG criteria; a clean run here is a regression fence, NOT a claim of
 *      WCAG conformance.
 *   2. Keyboard walkthroughs of the app's core task - create a task and move it
 *      to another column - plus the dialog semantics, focus behaviour and error
 *      announcement that axe cannot judge. These encode checks that were done
 *      by hand first (see RECORD_sitrep.md).
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const ok = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const TASK = {
  task_id: 1,
  title: "Write the spec",
  description: "Draft it",
  status: "todo",
  priority: "medium",
  assigned_to: 1,
  user_id: 1,
  full_name: "Ada",
  version: 3,
};

/**
 * Seed the stored project and stub the API so the dashboard renders without a
 * backend. Registration order matters: Playwright matches the most recently
 * added route first, so the catch-all goes in before the specific routes.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array} [calls] Collects the mutating requests the page makes.
 */
async function mockApp(page, calls = []) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sitrep_project",
      JSON.stringify({ project_id: 1, name: "P", workflow: "kanban" })
    );
    localStorage.setItem("sitrep_project_id", "1");
  });
  await page.route("**/api/**", (r) =>
    r.fulfill(ok({ tasks: [], members: [], agents: [], checkins: [], blockers: [], entries: [] }))
  );
  await page.route("**/api/projects/1/members", (r) =>
    r.fulfill(
      ok({ members: [{ user_id: 1, full_name: "Ada", email: "ada@x.com" }], pending_invites: [] })
    )
  );
  await page.route("**/api/projects/1/tasks", (r) => {
    if (r.request().method() === "POST") {
      calls.push({
        method: "POST",
        url: "/api/projects/1/tasks",
        body: r.request().postDataJSON(),
      });
      return r.fulfill(ok({ task: { ...TASK, task_id: 9 } }));
    }
    return r.fulfill(ok({ tasks: [TASK] }));
  });
  await page.route("**/api/tasks/1", (r) => {
    calls.push({
      method: r.request().method(),
      url: "/api/tasks/1",
      body: r.request().postDataJSON(),
    });
    return r.fulfill(ok({ task: { ...TASK, status: "done", version: 4 } }));
  });
  return calls;
}

/** A compact description of document.activeElement, for focus assertions. */
const focusInfo = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { tag: "body", inDialog: false, id: null, text: "" };
    return {
      tag: a.tagName.toLowerCase(),
      id: a.id || null,
      cls: typeof a.className === "string" ? a.className : "",
      text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 30),
      inDialog: !!a.closest("[aria-modal='true']"),
      visibleRing:
        getComputedStyle(a).outlineStyle !== "none" || getComputedStyle(a).boxShadow !== "none",
    };
  });

/* ── 1. Automated scan ──────────────────────────────────────────────────── */

const PAGES = [
  ["login", "/login/"],
  ["signup", "/signup/"],
  ["forgot password", "/forgot-password/"],
  ["reset password", "/reset-password/?token=abc"],
  ["project setup", "/project-setup/"],
  ["projects", "/projects/projects.html"],
  ["kanban dashboard", "/dashboard/kanban.html"],
  ["scrum dashboard", "/dashboard/scrum.html"],
  ["check-in", "/check-in/check-in.html"],
  ["profile", "/profile/"],
  ["settings", "/settings/"],
];

test.describe("axe-core scan", () => {
  for (const [name, url] of PAGES) {
    test(`${name} has no axe violations`, async ({ page }) => {
      await mockApp(page);
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        violations.map((v) => `${v.id} (${v.impact}) @ ${v.nodes.map((n) => n.target).join(", ")}`)
      ).toEqual([]);
    });
  }

  // The scans above run in the default light theme. The contrast fixes for the
  // kanban column header, the sprint health text and the settings theme picker
  // all resolve through theme tokens that flip in dark mode, so they have to be
  // checked there too - and scoping the palette selectors to :root (so the
  // settings page's own data-theme="dark" button stops picking up the whole
  // dark palette) is exactly the kind of change that could break dark mode.
  for (const [name, url] of [
    ["kanban dashboard", "/dashboard/kanban.html"],
    ["scrum dashboard", "/dashboard/scrum.html"],
    ["settings", "/settings/"],
  ]) {
    test(`${name} has no axe violations in dark mode`, async ({ page }) => {
      await mockApp(page);
      await page.goto(url);
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await page.waitForLoadState("networkidle");
      // Guard against the theme silently not applying, which would make this
      // test a light-mode duplicate that passes for the wrong reason.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg, "dark palette should be in effect").toBe("rgb(11, 17, 30)");
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        violations.map((v) => `${v.id} (${v.impact}) @ ${v.nodes.map((n) => n.target).join(", ")}`)
      ).toEqual([]);
    });
  }

  test("the task dialog has no axe violations while it is open", async ({ page }) => {
    // The scans above only see the page at rest; the dialog is the densest bit
    // of UI in the app and is never in that snapshot.
    await mockApp(page);
    await page.goto("/dashboard/kanban.html");
    await page.locator("#add-task-btn").click();
    await expect(page.locator("[aria-modal='true']")).toBeVisible();
    // The backdrop fades in over 150ms (task-form.css tf-fade-in). Scanning
    // mid-fade makes axe compute contrast against a half-transparent composite
    // and report colour failures that do not exist once the dialog has settled,
    // so wait for the animation to finish before measuring.
    await page
      .locator(".tf-backdrop")
      .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      violations.map((v) => `${v.id} (${v.impact}) @ ${v.nodes.map((n) => n.target).join(", ")}`)
    ).toEqual([]);
  });
});

/* ── 2. Keyboard operation of the core task ─────────────────────────────── */

test.describe("keyboard: create a task", () => {
  test("the whole flow works without a mouse", async ({ page }) => {
    const calls = await mockApp(page);
    await page.goto("/dashboard/kanban.html");
    await page.waitForLoadState("networkidle");

    // Reach the trigger by tabbing, not by scripting focus onto it: this is the
    // check that the control is actually in the tab order.
    let reached = false;
    for (let i = 0; i < 15 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = (await focusInfo(page)).id === "add-task-btn";
    }
    expect(reached, "'+ Add Task' should be reachable by Tab").toBe(true);
    expect((await focusInfo(page)).visibleRing, "focused control must be visibly focused").toBe(
      true
    );

    await page.keyboard.press("Enter");
    await expect(page.locator("[aria-modal='true']")).toBeVisible();

    // Focus must land inside the dialog, not stay behind it.
    const opened = await focusInfo(page);
    expect(opened.inDialog).toBe(true);
    expect(opened.id).toBe("tf-input-title");

    await page.keyboard.type("Keyboard-created task");
    // Tab to the submit button and activate it.
    let onSubmit = false;
    for (let i = 0; i < 12 && !onSubmit; i++) {
      await page.keyboard.press("Tab");
      onSubmit = (await focusInfo(page)).text === "Create task";
    }
    expect(onSubmit, "'Create task' should be reachable by Tab from the title field").toBe(true);
    await page.keyboard.press("Enter");

    await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body.title)).toEqual([
      "Keyboard-created task",
    ]);
  });
});

test.describe("keyboard: move a task to another column", () => {
  test("the status can be changed and saved without a mouse", async ({ page }) => {
    const calls = await mockApp(page);
    await page.goto("/dashboard/kanban.html");
    await page.waitForLoadState("networkidle");

    // Cards are draggable, and drag-and-drop is inherently pointer-only. The
    // keyboard-equivalent route for the same function is Edit → Status → Save,
    // which is what WCAG 2.1.1 requires; this test is that route.
    await expect(page.locator(".task-card").first()).toHaveAttribute("draggable", "true");

    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = (await focusInfo(page)).text === "Edit";
    }
    expect(reached, "the card's Edit button should be reachable by Tab").toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.locator("[aria-modal='true']")).toBeVisible();

    const status = page.locator("#tf-input-status");
    await status.focus();
    await status.selectOption("done");
    expect(await status.inputValue()).toBe("done");

    let onSave = false;
    for (let i = 0; i < 12 && !onSave; i++) {
      await page.keyboard.press("Tab");
      onSave = (await focusInfo(page)).text === "Save changes";
    }
    expect(onSave, "'Save changes' should be reachable by Tab").toBe(true);
    await page.keyboard.press("Enter");

    await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch, "the save should PATCH the task").toBeTruthy();
    expect(patch.body.status).toBe("done");
    // The concurrency guard travels with the edit form (see task-concurrency.test.js).
    expect(patch.body.version).toBe(TASK.version);
  });
});

/* ── 3. Dialog semantics, focus behaviour, error announcement ───────────── */

test.describe("task dialog", () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page);
    await page.goto("/dashboard/kanban.html");
    await page.waitForLoadState("networkidle");
  });

  test("is announced with a name, not just as 'dialog'", async ({ page }) => {
    await page.locator("#add-task-btn").click();
    const dialog = page.locator("[aria-modal='true']");
    await expect(dialog).toHaveAttribute("role", "dialog");
    const labelledBy = await dialog.getAttribute("aria-labelledby");
    expect(labelledBy, "role=dialog needs an accessible name").toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveText("New task");
  });

  test("Tab stays inside it while it declares the page inert", async ({ page }) => {
    await page.locator("#add-task-btn").click();
    await expect(page.locator("[aria-modal='true']")).toBeVisible();
    // aria-modal="true" tells assistive tech the rest of the page is hidden, so
    // keyboard focus must not walk out into it either.
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const f = await focusInfo(page);
      expect(
        f.inDialog,
        `focus escaped the dialog after ${i + 1} tabs (onto ${f.tag}#${f.id})`
      ).toBe(true);
    }
  });

  test("Escape closes it and returns focus to whatever opened it", async ({ page }) => {
    await page.locator("#add-task-btn").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[aria-modal='true']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
    expect((await focusInfo(page)).id).toBe("add-task-btn");
  });

  test("closing by Cancel also returns focus to the opener", async ({ page }) => {
    await page.locator("#add-task-btn").focus();
    await page.keyboard.press("Enter");
    await page.locator("[aria-modal='true'] button", { hasText: "Cancel" }).click();
    expect((await focusInfo(page)).id).toBe("add-task-btn");
  });

  test("a rejected save announces why and points at the offending field", async ({ page }) => {
    await page.locator("#add-task-btn").click();
    // Submit with the title empty. Previously this only moved focus, which tells
    // a screen-reader user nothing about what went wrong.
    await page.locator("[aria-modal='true'] button", { hasText: "Create task" }).click();

    const error = page.locator("#tf-error-title");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(error).toHaveText(/title/i);

    const title = page.locator("#tf-input-title");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toHaveAttribute("aria-describedby", "tf-error-title");
    expect((await focusInfo(page)).id).toBe("tf-input-title");

    // Fixing it clears the error state rather than leaving a stale alert.
    await title.fill("Now it has a title");
    await page.locator("[aria-modal='true'] button", { hasText: "Create task" }).click();
    await expect(page.locator("[aria-modal='true']")).toHaveCount(0);
  });

  test("every control in the dialog has an accessible name", async ({ page }) => {
    await page.locator("#add-task-btn").click();
    const unnamed = await page.evaluate(() => {
      const dialog = document.querySelector("[aria-modal='true']");
      const out = [];
      for (const el of dialog.querySelectorAll("input, select, textarea, button")) {
        const name = (
          el.getAttribute("aria-label") ||
          el.labels?.[0]?.textContent ||
          el.textContent ||
          ""
        ).trim();
        if (!name) out.push(`${el.tagName.toLowerCase()}#${el.id || "?"}`);
      }
      return out;
    });
    expect(unnamed).toEqual([]);
  });
});

/* ── 4. Focus visibility and target size on the auth pages ──────────────── */

test.describe("login page keyboard basics", () => {
  test("every tab stop is visibly focused", async ({ page }) => {
    await page.goto("/login/");
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const f = await focusInfo(page);
      if (f.tag === "body") break;
      expect(f.visibleRing, `${f.tag}#${f.id} has no visible focus indicator`).toBe(true);
    }
  });

  test("the show-password control meets the 24x24 target minimum", async ({ page }) => {
    await page.goto("/login/");
    const box = await page.locator("#toggle-password").boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });

  test("validation errors are wired to their fields", async ({ page }) => {
    await page.goto("/login/");
    await page.locator("#submit-btn").click();
    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#password-error")).toBeVisible();
  });
});
