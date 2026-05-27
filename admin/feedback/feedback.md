# Code Peer Review

| Field | Details |
|---|---|
| **Reviewing Team** | The League Of Super Acquaintances (#15) |
| **Team Reviewed** | Team #11 |
| **GitHub Repository** | [cse110-sp26-group11/SE-SitRep](https://github.com/cse110-sp26-group11/SE-SitRep) |
| **Date** | 05/26/2026 |

---

## Strength

> What is the team doing particularly well? Be specific — reference actual files, functions, or design decisions from the repo.

They built a clean, modular backend in the `workers/` directory, cleanly separating architectural concerns into dedicated `handlers/`, a distinct `router.js`, and a `lib/` folder for validation, mappers, responses, and configuration. This structured approach makes the codebase highly navigable and easily extendable. Furthermore, onboarding and frontend integration are streamlined by impressively thorough API reference materials within the `backend-docs/` folder, complete with practical examples and consistent error formatting.

---

## Improvement 1

> What is one concrete thing that could be improved? Reference the specific part of the codebase and explain why this change would help.

One concrete improvement would be expanding the frontend user flow so the application feels more complete from the user perspective. The backend structure inside `workers/` is very modular and well organized, but the repository currently focuses more heavily on API architecture than on a connected onboarding or dashboard experience. Adding clearer frontend flows, navigation structure, and more visible user-facing interactions would help make the product feel more polished and accessible.

---

## Improvement 2

> What is a second concrete improvement? Again, be specific and grounded in what you saw in the repository.

Another improvement would be creating a more unified shared UI system as the project grows. Since the repository already has strong backend separation through `handlers/`, `router.js`, and `lib/`, applying a similarly centralized structure for frontend components, styling, and navigation patterns could improve long-term maintainability and make the overall application feel more cohesive.

---

## Question

> A thoughtful question about a design choice, implementation decision, or project direction.

How does the team plan to expand the frontend user experience as the project grows, since the current repository structure appears to focus more heavily on backend/API organization and worker architecture?

---

## Suggestion

> A practical next step or idea they could implement going forward.

The calendar section of your project is a cool idea, but I would suggest a few improvements. From your video, the calendar does not seem to include the date. I'd suggest adding a label for the month above the grid and a day number to each cell. Also, scrolling horizontally on a desktop is tedious — consider making the grid wide enough to avoid requiring desktop users to scroll horizontally.

---

> **Note:** Keep total feedback to one page. Be specific, respectful, and constructive.

---
---

# Code Peer Review

| Field | Details |
|---|---|
| **Reviewing Team** | Team #15 |
| **Team Reviewed** | Team #14 |
| **GitHub Repository** | [cse110-sp26-group14](https://github.com/cse110-sp26-group14/cse110-sp26-group14) |
| **Date** | 05/26/2026 |

---

## Strength

> What is the team doing particularly well? Be specific — reference actual files, functions, or design decisions from the repo.

There is a strong authentication setup here. Looking within `source/worker/src/password.js`, we can see that there is usage of `scrypt` that uses a per-user salt that randomizes each time. This adds proper security. It's paired with bearer-token sessions within `source/worker/src/auth.js`, which adds to the security aspect. This tells me that they take certain authentication factors seriously and would like their clients/users to be secure in their product.

---

## Improvement 1

> What is one concrete thing that could be improved? Reference the specific part of the codebase and explain why this change would help.

One concrete improvement would be pulling the inline styles out of `DashboardView.js`, where `render()` has hardcoded styles like `style = "display: flex; gap: 1rem;"` mixed into a 100+ line template literal, which makes the existing `.stylelintrc.json` completely blind to most of the app's CSS. The fix is moving those styles into their own stylesheet with proper class names and using the templating system that already exists in the project. The infrastructure is already there and just not being used, so this is a straightforward cleanup that makes the linter actually work and keeps all the styles in one maintainable place.

---

## Improvement 2

> What is a second concrete improvement? Again, be specific and grounded in what you saw in the repository.

Another improvement would be adding the ADR and removing the current placeholder in `specs/adr`. Currently the codebase does not have an ADR, which is questionable since the code appears quite developed with many architectural decisions already made. Team 14 should be documenting their architectural decisions throughout these sprints rather than waiting until the end of the project to fulfill all their ADRs.

---

## Question

> A thoughtful question about a design choice, implementation decision, or project direction.

How does the team plan to balance the current engineering-focused architecture with future user experience improvements as more frontend functionality is added?

---

## Suggestion

> A practical next step or idea they could implement going forward.

Consider revisiting `source/worker/src/api.js`, since the file is essentially one large `if` statement chain. The most vulnerable spot is around lines 58–60, where the deciding factor for whether a route requires login is a single string check (`pathname.startsWith('/api/')`) with hardcoded exceptions for `/api/auth/` and `/api/health`. This makes it easy to accidentally expose a sensitive endpoint or block a public one.

A possible fix would be using a route table where each route has its own `auth: true/false` flag next to the handler, so the decision of whether something is public or private lives within the route definition itself — rather than in a central if-chain that's easy to get wrong.

---

> **Note:** Keep total feedback to one page. Be specific, respectful, and constructive.
