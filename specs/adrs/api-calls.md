---
# Configuration for the Jekyll template "Just the Docs"
parent: Decisions
nav_order: 101
title: Blocker API Endpoint

status: accepted
date: 2026-05-14
decision-makers: Team 15
---

# Blocker API Endpoint

## Context and Problem Statement

The project required an API endpoint for retrieving blocker information for both individual tasks and general team-wide blockers. The endpoint needed to support multiple blockers per task and return structured JSON data for the frontend dashboard.

## Decision Drivers

- Support multiple blockers per task
- Simple frontend integration
- Consistent JSON response structure
- Easy future expansion
- Automated testability

## Considered Options

- Return only the latest blocker
- Return all blockers for a task
- Separate endpoints for task/general blockers
- Single endpoint using query parameters

## Decision Outcome

Chosen option: "Single endpoint using query parameters with support for multiple blockers per task."

The API supports:

- `?task=frontend`
- `?general=true`
- `?task=general`

The endpoint returns all blockers for a task and dynamically determines whether the task is blocked based on unresolved blockers.

### Consequences

- Good, because frontend integration is simplified
- Good, because multiple blockers can be displayed
- Good, because the API structure is reusable
- Bad, because response objects are slightly more complex

### Confirmation

The endpoint was validated using Vitest tests covering:

- missing query parameters
- general blocker queries
- multiple blockers
- resolved vs unresolved blockers
- whitespace trimming

## More Information

Example response:

```json
{
  "task": "frontend",
  "blocked": true,
  "blockers": [
    {
      "blocked": true,
      "helper": "Alice",
      "description": "Merge conflict"
    }
  ]
}
```
