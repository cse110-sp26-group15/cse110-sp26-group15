# Task Card Component

A shared card component used across the kanban, scrum, and XP dashboards. One function in / DOM element out — no framework, no build step.

Live demo: open `source/task-card-demo.html`.

## Quick start

```html
<!-- include BOTH stylesheets, in this order. Adjust the relative paths to wherever you import from. -->
<link rel="stylesheet" href="../dashboard/main.css" />
<link rel="stylesheet" href="task-card.css" />

<!-- modules require a server (wrangler pages dev); file:// won't work -->
<script type="module">
  import { createTaskCard } from "./task-card.js";

  const task = {
    task_id: 1,
    title: "Fix login timeout",
    full_name: "Alex K.",
    status: "in-progress",
    priority: "urgent",
  };

  document.getElementById("my-column").appendChild(createTaskCard(task, "kanban"));
</script>
```

## API

```js
createTaskCard(task, projectType?, options?) → HTMLElement
```

| Param         | Type                              | Default    | Notes                                         |
| ------------- | --------------------------------- | ---------- | --------------------------------------------- |
| `task`        | object                            | _required_ | See **Task shape** below                      |
| `projectType` | `"kanban"` \| `"scrum"` \| `"xp"` | `"kanban"` | Controls which conditional fields render      |
| `options`     | `{ compact?: boolean }`           | `{}`       | `compact: true` hides the description preview |

Returns a detached `<article>` element. Append it wherever you want.

## Task shape

Missing fields are tolerated — the card degrades gracefully.

| Field            | Type                                                   | Used by | Notes                                                 |
| ---------------- | ------------------------------------------------------ | ------- | ----------------------------------------------------- |
| `task_id`        | number \| string                                       | all     | Set on `data-task-id`                                 |
| `title`          | string                                                 | all     | Always rendered                                       |
| `description`    | string                                                 | all     | 1-line preview, click title/preview to expand         |
| `full_name`      | string                                                 | all     | Assignee name; missing → "Unassigned"                 |
| `status`         | `"todo"` \| `"in-progress"` \| `"done"` \| `"blocked"` | all     | Defaults to `"todo"`                                  |
| `priority`       | `"urgent"` \| `"high"` \| `"medium"` \| `"low"`        | all     | Defaults to `"low"` (gray banner)                     |
| `due_date`       | string (ISO `YYYY-MM-DD`)                              | all     | Formatted as e.g. "May 18"                            |
| `tags`           | string[]                                               | all     | Rendered as colored pills                             |
| `is_blocked`     | boolean                                                | all     | Shows red blocker chip + overrides status             |
| `blocker_reason` | string                                                 | all     | Shown inside the blocker chip                         |
| `story_points`   | number                                                 | scrum   | Circle in priority banner                             |
| `sprint`         | string                                                 | scrum   | Appended to priority label (e.g. "Urgent · Sprint 3") |
| `story_type`     | string                                                 | scrum   | Prepended to tags row                                 |
| `estimate_hours` | number                                                 | xp      | "~Nh" pill in priority banner                         |
| `pair_assignee`  | string                                                 | xp      | Second overlapping avatar + "X & Y" name              |

## Project type behavior

- **kanban** — base card only
- **scrum** — adds sprint label + story points in banner, story type tag
- **xp** — adds hour estimate in banner, pair avatar + "X & Y" name

If the relevant scrum/xp fields aren't on the task object, the variant renders the same as kanban (no empty placeholders).

## Compact mode

```js
createTaskCard(task, "kanban", { compact: true });
```

Hides the description preview. Useful for tight kanban columns where every pixel counts.

## Gotcha: CSS load order

`main.css` defines an older `.task-card` rule (single-row layout from before this component existed). `task-card.css` must load **after** `main.css` or your cards will inherit the old flex-row styles. Both files together = correct rendering.

## Files

- `task-card.js` — component
- `task-card.css` — styles + design tokens for priority/blocker/status colors
- `task-card-demo.html` + `task-card-demo.js` — live demo with all 9 variants
