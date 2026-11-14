/**
 * Local-first task editing on the scrum board, in a real browser.
 *
 * The engine's semantics (both reconnect orders, replay dedup, 403, 401) are
 * pinned against the real API handlers in source/tests/task-sync.test.js;
 * what only a browser can prove is pinned here: the outbox living in real
 * localStorage across a real page reload, the status strip, the card badges,
 * and the keep-mine/keep-theirs dialog.
 *
 * Like every spec in this suite the API is mocked (the Playwright web server
 * is static - see playwright.config.js), but the PATCH mock reproduces the
 * server's actual compare-and-swap: apply and bump when `version` matches,
 * else 409 with `conflict: true` and the current row. "Offline" aborts every
 * /api/** request, which is what a dead network looks like to fetch().
 */

import { test, expect } from "@playwright/test";

const ok = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

function makeFakeServer() {
  return {
    task: {
      task_id: 1,
      title: "Write the spec",
      description: "Draft it",
      status: "todo",
      priority: "medium",
      assigned_to: 1,
      user_id: 1,
      full_name: "Ada",
      version: 1,
    },
    patches: [], // every PATCH body that actually reached the "server"
    apiDown: false,
  };
}

/**
 * Stub the API around `server`, a stateful fake whose PATCH handler enforces
 * the version compare-and-swap. Registration order matters: Playwright
 * matches the most recently added route first, so the catch-all goes first.
 */
async function mockScrumApp(page, server) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sitrep_project",
      JSON.stringify({ project_id: 1, name: "P", workflow: "scrum" })
    );
  });
  const gate = (r, respond) => (server.apiDown ? r.abort("internetdisconnected") : respond(r));

  await page.route("**/api/**", (r) =>
    gate(r, () => r.fulfill(ok({ tasks: [], members: [], agents: [], checkins: [], blockers: [] })))
  );
  await page.route("**/api/projects/1/members", (r) =>
    gate(r, () =>
      r.fulfill(
        ok({
          members: [
            { user_id: 1, full_name: "Ada", email: "ada@x.com" },
            { user_id: 2, full_name: "Bob", email: "bob@x.com" },
          ],
        })
      )
    )
  );
  await page.route("**/api/projects/1/tasks", (r) =>
    gate(r, () => r.fulfill(ok({ tasks: [server.task] })))
  );
  await page.route("**/api/tasks/1", (r) =>
    gate(r, () => {
      const body = r.request().postDataJSON();
      server.patches.push(body);
      if (body.version !== server.task.version) {
        return r.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "This task changed while you were editing it. Review the latest version and try again.",
            conflict: true,
            task: server.task,
          }),
        });
      }
      const fields = { ...body };
      delete fields.version;
      const next = { ...server.task };
      for (const [k, v] of Object.entries(fields)) {
        if (k === "assigned_to") next.user_id = v;
        else next[k] = v;
      }
      next.version = server.task.version + 1;
      server.task = next;
      return r.fulfill(ok({ task: server.task }));
    })
  );
}

/** Open the edit modal for the first card, retitle it, and save. */
async function editTitleTo(page, title) {
  await page.locator(".task-card-edit").first().click();
  // Scoped to the task form: the sync conflict dialog is aria-modal too and
  // may already be open by the time the form has closed.
  const modal = page.locator(".tf-modal");
  await expect(modal).toBeVisible();
  await page.locator("#tf-input-title").fill(title);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(modal).toHaveCount(0);
}

test.describe("offline task editing on the scrum board", () => {
  test("an inline assignee change uses the durable versioned outbox", async ({ page }) => {
    const server = makeFakeServer();
    await mockScrumApp(page, server);
    await page.goto("/dashboard/scrum.html");
    await expect(page.locator(".task-card").first()).toContainText("Write the spec");

    server.apiDown = true;
    await page.locator(".task-card__select--assignee").first().selectOption("2");
    await expect(page.locator(".sync-badge--queued").first()).toBeVisible();
    expect(server.patches).toHaveLength(0);

    server.apiDown = false;
    await page.locator("#sync-status").getByRole("button", { name: "Sync now" }).click();
    await expect(page.locator(".sync-badge--queued")).toHaveCount(0);
    expect(server.patches).toHaveLength(1);
    expect(server.patches[0]).toMatchObject({ assigned_to: 2, version: 1 });
  });

  test("an edit made while the API is down survives a reload and lands exactly once on reconnect", async ({
    page,
  }) => {
    const server = makeFakeServer();
    await mockScrumApp(page, server);
    await page.goto("/dashboard/scrum.html");
    await expect(page.locator(".task-card").first()).toContainText("Write the spec");

    // The backend dies; the user edits anyway.
    server.apiDown = true;
    await editTitleTo(page, "Edited while offline");

    // Local-first: the board shows the edit immediately, flagged as queued,
    // and the strip says why it has not landed.
    await expect(page.locator(".task-card").first()).toContainText("Edited while offline");
    await expect(page.locator(".sync-badge--queued").first()).toBeVisible();
    await expect(page.locator("#sync-status")).toContainText("will sync");

    // Reload with the API still down: the outbox and the last-synced board
    // both come back from localStorage. Nothing typed is lost.
    await page.reload();
    await expect(page.locator(".task-card").first()).toContainText("Edited while offline");
    await expect(page.locator(".sync-badge--queued").first()).toBeVisible();
    expect(server.patches).toHaveLength(0); // nothing reached the server yet

    // Reconnect and sync: exactly one PATCH, carrying the pinned version.
    server.apiDown = false;
    await page.locator("#sync-status").getByRole("button", { name: "Sync now" }).click();
    await expect(page.locator("#sync-status")).toBeHidden();
    await expect(page.locator(".sync-badge--queued")).toHaveCount(0);
    await expect(page.locator(".task-card").first()).toContainText("Edited while offline");
    expect(server.patches).toHaveLength(1);
    expect(server.patches[0].version).toBe(1);
    expect(server.patches[0].title).toBe("Edited while offline");
  });

  test("a conflicting save opens the decision dialog, and keep-mine rebases onto the server version", async ({
    page,
  }) => {
    const server = makeFakeServer();
    await mockScrumApp(page, server);
    await page.goto("/dashboard/scrum.html");
    await expect(page.locator(".task-card").first()).toContainText("Write the spec");

    // A teammate saves first (the row moves to v2 behind this browser's back).
    server.task = { ...server.task, title: "Renamed by a teammate", version: 2 };

    await editTitleTo(page, "My rename");

    // The save bounced off the compare-and-swap; both versions are on screen.
    const dialog = page.locator(".sync-modal");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This task changed while you were offline");
    await expect(dialog).toContainText("On the server (v2)");
    await expect(dialog).toContainText("Renamed by a teammate");
    await expect(dialog).toContainText("My rename");

    await dialog.getByRole("button", { name: "Keep mine" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#sync-status")).toBeHidden();
    await expect(page.locator(".task-card").first()).toContainText("My rename");

    // Two deliveries: the refused one at v1, then the rebase at v2.
    expect(server.patches.map((p) => p.version)).toEqual([1, 2]);
    expect(server.patches[1].title).toBe("My rename");
    expect(server.task.version).toBe(3);
  });

  test("a parked conflict survives a reload and keep-theirs adopts the server row without writing", async ({
    page,
  }) => {
    const server = makeFakeServer();
    await mockScrumApp(page, server);
    await page.goto("/dashboard/scrum.html");
    await expect(page.locator(".task-card").first()).toContainText("Write the spec");

    server.task = { ...server.task, title: "Renamed by a teammate", version: 2 };
    await editTitleTo(page, "My rename");
    await expect(page.locator(".sync-modal")).toBeVisible();

    // Closing the dialog decides nothing: the conflict stays parked.
    await page.keyboard.press("Escape");
    await expect(page.locator(".sync-modal")).toHaveCount(0);
    await expect(page.locator("#sync-status")).toContainText("needs your decision");
    await expect(page.locator(".sync-badge--conflict").first()).toBeVisible();

    // The decision is still waiting after a reload.
    await page.reload();
    await expect(page.locator("#sync-status")).toContainText("needs your decision");
    await expect(page.locator(".sync-badge--conflict").first()).toBeVisible();

    await page.locator(".task-card-resolve").first().click();
    const dialog = page.locator(".sync-modal");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep theirs" }).click();

    // Adopting the server's row sends nothing further.
    await expect(page.locator("#sync-status")).toBeHidden();
    await expect(page.locator(".sync-badge--conflict")).toHaveCount(0);
    await expect(page.locator(".task-card").first()).toContainText("Renamed by a teammate");
    expect(server.patches).toHaveLength(1); // only the original refused delivery
    expect(server.task.version).toBe(2); // untouched since the teammate's save
  });
});
