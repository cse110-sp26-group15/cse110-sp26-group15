import { test, expect } from "@playwright/test";

function assertSecretsAbsent(records, secrets) {
  const joined = records.join("\n");
  for (const secret of secrets) {
    if (joined.includes(secret)) {
      throw new Error(`browser diagnostic captured a protected value: ${secret}`);
    }
  }
}

function collectBrowserDiagnostics(page) {
  const records = [];

  page.on("console", (message) => records.push(`console:${message.type()}:${message.text()}`));
  page.on("pageerror", (error) => records.push(`pageerror:${error.message}`));
  page.on("request", (request) => records.push(`request:${request.method()}:${request.url()}`));
  page.on("response", (response) =>
    records.push(`response:${response.status()}:${response.url()}`)
  );
  page.on("requestfailed", (request) =>
    records.push(`requestfailed:${request.url()}:${request.failure()?.errorText ?? "unknown"}`)
  );

  return records;
}

test.describe("Browser session diagnostics", () => {
  test("a legitimate login keeps credentials out of console, URL, response, and storage", async ({
    page,
    context,
  }) => {
    const password = "BrowserOnlyPassword!42";
    const sessionToken = "7".repeat(64);
    const diagnostics = collectBrowserDiagnostics(page);
    const loginResponseBody = JSON.stringify({
      user: { user_id: 1, email: "browser@example.com", full_name: "Browser Check" },
    });
    let loginBody;

    await page.route("**/api/auth/login", async (route) => {
      loginBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie": `sitrep_token=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
        },
        body: loginResponseBody,
      });
    });

    await page.goto("/login/");
    await page.locator("#email").fill("browser@example.com");
    await page.locator("#password").fill(password);

    const loginResponsePromise = page.waitForResponse("**/api/auth/login");
    await page.locator("#submit-btn").click();
    await loginResponsePromise;
    await expect(page).toHaveURL(/\/app/);

    expect(loginBody).toEqual({ email: "browser@example.com", password });
    expect(JSON.parse(loginResponseBody)).toEqual({
      user: { user_id: 1, email: "browser@example.com", full_name: "Browser Check" },
    });

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "sitrep_token");
    expect(sessionCookie).toMatchObject({
      value: sessionToken,
      httpOnly: true,
      sameSite: "Strict",
    });

    const browserStorage = await page.evaluate(() => ({
      local: Object.values(localStorage),
      session: Object.values(sessionStorage),
      readableCookies: document.cookie,
    }));
    assertSecretsAbsent(
      [
        ...diagnostics,
        ...browserStorage.local,
        ...browserStorage.session,
        browserStorage.readableCookies,
      ],
      [password, sessionToken]
    );
  });

  test("the diagnostic check fails when a protected value is seeded into a browser log", () => {
    const seeded = "seeded-browser-secret-for-negative-control";
    expect(() => assertSecretsAbsent([`console:log:${seeded}`], [seeded])).toThrow(
      "browser diagnostic captured a protected value"
    );
  });
});
