# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.js >> Login page >> shows email error for invalid email
- Location: e2e/login.spec.js:40:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#email-error')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('#email-error')
    14 × locator resolved to <p id="email-error" class="field-error"></p>
       - unexpected value "hidden"

```

```yaml
- complementary:
  - text: S SitRep
  - heading "What's the Situation with your team?" [level=1]
  - paragraph: Track check-ins, surface blockers, and keep your whole team — human and AI — in sync.
  - list "Features":
    - listitem: Daily check-ins
    - listitem: Blocker alerts
    - listitem: Team dashboard
    - listitem: AI agent tracking
    - listitem: Weekly reports
    - listitem: Scrum / Kanban / XP
  - text: 3/6 checked in today 2 active blockers 100% async friendly
- main:
  - heading "Welcome back" [level=2]
  - paragraph: Sign in to your team's SitRep
  - text: Email
  - textbox "Email":
    - /placeholder: you@example.com
    - text: notanemail
  - text: Password
  - textbox "Password":
    - /placeholder: ••••••••
  - button "Show password": show
  - link "Forgot password?":
    - /url: "#"
  - button "Sign in"
  - text: or
  - button "⬡ Continue with Slack"
  - paragraph:
    - text: Don't have an account?
    - link "Sign up":
      - /url: ../signup/
  - paragraph: By signing in you agree to the Terms of Service
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | /** Base URL path for the login page. */
  4   | const LOGIN_URL = "/login/";
  5   | 
  6   | /** API endpoint intercepted by route mocks. */
  7   | const API_LOGIN = "/api/auth/login";
  8   | 
  9   | test.describe("Login page", () => {
  10  |   /**
  11  |    * Verifies the page title, form inputs, and submit button are rendered
  12  |    * correctly on initial load.
  13  |    */
  14  |   test("renders form and key elements", async ({ page }) => {
  15  |     await page.goto(LOGIN_URL);
  16  | 
  17  |     await expect(page).toHaveTitle(/Sign In/);
  18  |     await expect(page.locator("#email")).toBeVisible();
  19  |     await expect(page.locator("#password")).toBeVisible();
  20  |     await expect(page.locator("#submit-btn")).toBeVisible();
  21  |     await expect(page.locator("#submit-btn")).toHaveText("Sign in");
  22  |   });
  23  | 
  24  |   /**
  25  |    * Verifies that submitting an empty form surfaces inline field errors
  26  |    * for both email and password without hitting the network.
  27  |    */
  28  |   test("shows validation errors on empty submit", async ({ page }) => {
  29  |     await page.goto(LOGIN_URL);
  30  |     await page.locator("#submit-btn").click();
  31  | 
  32  |     await expect(page.locator("#email-error")).toBeVisible();
  33  |     await expect(page.locator("#password-error")).toBeVisible();
  34  |   });
  35  | 
  36  |   /**
  37  |    * Verifies the email field shows a validation error when the user
  38  |    * blurs away from an invalid email value.
  39  |    */
  40  |   test("shows email error for invalid email", async ({ page }) => {
  41  |     await page.goto(LOGIN_URL);
  42  |     await page.locator("#email").fill("notanemail");
  43  |     await page.locator("#email").blur();
  44  | 
> 45  |     await expect(page.locator("#email-error")).toBeVisible();
      |                                                ^ Error: expect(locator).toBeVisible() failed
  46  |     await expect(page.locator("#email-error")).toContainText("valid email");
  47  |   });
  48  | 
  49  |   /**
  50  |    * Verifies the password field shows an error when the value is fewer
  51  |    * than 8 characters.
  52  |    */
  53  |   test("shows password error for short password", async ({ page }) => {
  54  |     await page.goto(LOGIN_URL);
  55  |     await page.locator("#password").fill("short");
  56  |     await page.locator("#password").blur();
  57  | 
  58  |     await expect(page.locator("#password-error")).toBeVisible();
  59  |     await expect(page.locator("#password-error")).toContainText("8 characters");
  60  |   });
  61  | 
  62  |   /**
  63  |    * Verifies that typing into an errored field hides the inline error message.
  64  |    */
  65  |   test("clears field error when user types", async ({ page }) => {
  66  |     await page.goto(LOGIN_URL);
  67  |     await page.locator("#submit-btn").click();
  68  |     await expect(page.locator("#email-error")).toBeVisible();
  69  | 
  70  |     await page.locator("#email").fill("a");
  71  |     await expect(page.locator("#email-error")).toBeHidden();
  72  |   });
  73  | 
  74  |   /**
  75  |    * Verifies the show/hide password toggle cycles the input type and
  76  |    * label text correctly.
  77  |    */
  78  |   test("toggles password visibility", async ({ page }) => {
  79  |     await page.goto(LOGIN_URL);
  80  |     const pwInput = page.locator("#password");
  81  |     const toggleLabel = page.locator("#toggle-label");
  82  | 
  83  |     await expect(pwInput).toHaveAttribute("type", "password");
  84  |     await expect(toggleLabel).toHaveText("show");
  85  | 
  86  |     await page.locator("#toggle-password").click();
  87  |     await expect(pwInput).toHaveAttribute("type", "text");
  88  |     await expect(toggleLabel).toHaveText("hide");
  89  | 
  90  |     await page.locator("#toggle-password").click();
  91  |     await expect(pwInput).toHaveAttribute("type", "password");
  92  |   });
  93  | 
  94  |   /**
  95  |    * Mocks the login API to return a 401, then verifies the error banner
  96  |    * surfaces the message returned by the API.
  97  |    */
  98  |   test("shows error banner on API failure", async ({ page }) => {
  99  |     await page.route(`**${API_LOGIN}`, (route) =>
  100 |       route.fulfill({
  101 |         status: 401,
  102 |         contentType: "application/json",
  103 |         body: JSON.stringify({ error: "Invalid credentials" }),
  104 |       })
  105 |     );
  106 | 
  107 |     await page.goto(LOGIN_URL);
  108 |     await page.locator("#email").fill("user@example.com");
  109 |     await page.locator("#password").fill("password123");
  110 |     await page.locator("#submit-btn").click();
  111 | 
  112 |     await expect(page.locator("#error-banner")).toBeVisible();
  113 |     await expect(page.locator("#error-banner")).toContainText("Invalid credentials");
  114 |   });
  115 | 
  116 |   /**
  117 |    * Mocks a successful login API response and verifies the page
  118 |    * navigates to project-setup after a valid form submission.
  119 |    */
  120 |   test("redirects to project-setup on successful login", async ({ page }) => {
  121 |     await page.route(`**${API_LOGIN}`, (route) =>
  122 |       route.fulfill({
  123 |         status: 200,
  124 |         contentType: "application/json",
  125 |         body: JSON.stringify({
  126 |           token: "fake-jwt-token",
  127 |           user: { id: 1, email: "user@example.com" },
  128 |         }),
  129 |       })
  130 |     );
  131 | 
  132 |     await page.goto(LOGIN_URL);
  133 |     await page.locator("#email").fill("user@example.com");
  134 |     await page.locator("#password").fill("password123");
  135 |     await page.locator("#submit-btn").click();
  136 | 
  137 |     await expect(page).toHaveURL(/project-setup/);
  138 |   });
  139 | });
  140 | 
```