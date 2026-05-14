# ADR: Use Cloudflare D1 for Persistent Shared Data

## Context and Problem Statement

Based on application deployment on Cloudflare Pages, we need a database solution that works with this solution.

## Decision Drivers

- Must share persistent team data.
- Clean integration with current hosting.
- Must satisfy course deployment/server-side constraints.

## Considered Options

- Cloudflare D1
- Browser storage via `localstorage` or `IndexedDB`
- Static JSON files
- Third party backend + database service

## Decision Outcome

Chosen option: Cloudflare D1, because it meets all technical constraints without requiring further TA approval. Browser storage and static JSON files do not permit cross device access (each device has its own version of the data). Third party backends/databases require approval before usage and likely require further cost as some do not have a free tier.

### Consequences

- Good, because it uses SQL-style relational data, appropriately fitting project entities.
- Good, because it is relatively simple to implement and does not need a separate backend server.
- Good, because the schema can be versioned in the repo through SQL migration files.
- Bad, because it requires extra Cloudflare specific setup.
- Bad, because it is dependent on Cloudflare page functions usage.\

## More Information

Local development will require Cloudflare's CLI tool, Wrangler, for DB access.
