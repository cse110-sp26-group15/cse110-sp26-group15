# ADR: Deploy the Project Website on Cloudflare Pages

## Context and Problem Statement

The project requires a website for delivering the software; tech constraints restrict this to GitHub pages, Cloudflare pages, or as a downloadable asset. Server-side technologies must work on Cloudflare or GitHub pages only.

Our application is expected to support team-wide updates, blockers, check-ins, etc. Thus, we believe it's beneficial to use a shared deployed web app rather than a downloadable artifact. That restricts our deployment to Cloudflare or GitHub.

## Decision Drivers

* Static deployment with automatic deployment.
* Integratable with the GitHub repo that our code lives in.
* Able to access CRUD operations on database.

## Considered Options

* GitHub Pages
* Cloudflare Pages
* Downloadable Asset

## Decision Outcome

Chosen option: "Cloudflare Pages", because it is the only option that fulfills all decision drivers.

### Consequences

* Good, because it supports direct integration with Cloudflare D1 databases.
* Good, because it offers page functions, which are scripts that can function similar to an API. This gives us the ability to perform CRUD on the database despite the app being statically hosted.
* Bad, because it provides another platform (layer of complexity) to learn.
* Bad, because some deployment configuration must live outside of the GitHub.

## More Information

Page functions will live in `/functions/api/` and be of the form `function.js`. These functions are primarily used to access the database and can be called via `fetch` from the rest of the source code.