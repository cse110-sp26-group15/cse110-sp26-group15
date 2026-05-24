# Blocker Card Component

A blocker rail for the dashboard: horizontally scrolling row of red "Blocker" cards with a header + count badge. Vanilla JS, no framework, no build step. Same DOM-builder style as `task-card/`.

Live demo: open `source/blocker-card/blocker-card-demo.html` via `npm run dev:pages` (modules don't work over `file://`).

## Quick start (drop-in on the dashboard)

Already wired on all four dashboard pages — `main.html`, `kanban.html`, `scrum.html`, `xp.html` — each of which loads:

```html
<link rel="stylesheet" href="../blocker-card/blocker-card.css" />
<script type="module" src="../blocker-card/blocker-card-init.js"></script>
```

On any page with `#dashboard-view`, `blocker-card-init.js`:

1. Creates a collapsible **"No current blockers" placeholder** (see [Placeholder & empty state](#placeholder--empty-state)) and inserts it immediately after `.section-header`.
2. Fetches `/api/blockers?general=true`. If there are active blockers, it builds a rail and inserts it at the same anchor — the placeholder is hidden while the rail is visible.

On pages without `#dashboard-view`, it does nothing — no errors, no side effects.

## Quick start (manual mount on another page)

```js
import { mountBlockerRail } from "../blocker-card/blocker-card-init.js";

const rail = await mountBlockerRail({
  container: document.getElementById("my-view"),
  anchor: document.querySelector("#my-view .first-section"), // optional
});

// after the user creates/resolves a blocker elsewhere:
await rail.refresh();

// on SPA route change / unmount:
rail.destroy();
```

## API

### `mountBlockerRail(options) → Promise<{ refresh, destroy }>`

Mount a rail, return a handle. **Use this from app code** — it handles fetching, mapping, navigation wiring, and DOM insertion.

| Option            | Type                                         | Default                           | Notes                                                              |
| ----------------- | -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `container`       | `HTMLElement`                                | _required_                        | Where the rail is inserted.                                        |
| `anchor`          | `HTMLElement \| null`                        | `null`                            | If set and a child of `container`, rail is inserted before it.     |
| `fetchBlockers`   | `() => Promise<object[]>`                    | hits `/api/blockers?general=true` | Should return raw API rows (the `blockers` array).                 |
| `findTask`        | `(taskName: string) => HTMLElement \| null`  | matches `#task-list .task-card`   | Footer click resolver. See **Footer linking** below.               |
| `resolveBlocker`  | `(blocker: object) => Promise<void> \| void` | stub that warns + throws          | Per-card Resolve button handler. See **Resolving blockers** below. |
| `includeResolved` | `boolean`                                    | `false`                           | When false, resolved blockers (`blocked: false`) are filtered out. |

Returns `{ refresh, destroy }`. Call `refresh()` after blocker state changes elsewhere in the app. Call `destroy()` to remove the rail node.

### Refresh from anywhere via custom event

You usually don't have a reference to the rail handle from feature code (e.g. a check-in form that creates blockers). Instead, dispatch a `blockers:changed` event on `document` — every mounted rail listens for it and refreshes itself:

```js
// in a form's submit handler, after POST /blockers resolves:
await fetch("/api/projects/1/blockers", { method: "POST", body: ... });
document.dispatchEvent(new CustomEvent("blockers:changed"));
```

No import, no shared state, no coupling to this module. The listener is wired by `mountBlockerRail` and torn down by `destroy()`.

### `createBlockerCard(blocker) → HTMLElement`

Pure DOM builder. Use only if you want a single card outside a rail.

### `createBlockerRail(blockers) → HTMLElement | null`

Pure DOM builder. Returns `null` when `blockers` is empty so callers can hide the rail entirely. The rail is collapsible — see [Collapsible behavior](#collapsible-behavior).

### `createBlockerPlaceholder() → HTMLElement`

Pure DOM builder for the dashed "No current blockers" empty-state. `mountBlockerRail`'s auto-mount calls this when a dashboard doesn't author one inline. Use directly only if you need to drop the placeholder somewhere other than the auto-mount location.

### `attachRailNavigation(rail, { findTask }) → void`

Attach click + Enter/Space activation. Call manually if you used `createBlockerRail` directly instead of `mountBlockerRail`.

### Pure helpers (also exported)

- `mapApiBlocker(apiRow)` — adapt one row from `/api/blockers` to the card shape. Returns `null` for non-object rows so callers can `.filter(Boolean)` a malformed API response without crashing the render.
- `filterActiveBlockers(blockers)` — drop resolved entries.
- `normalizeTaskName(str)` — same trim/lowercase rule used by `matchTaskByName`.
- `matchTaskByName(taskName, tasks)` — name-based task lookup (see caveat below).

### Collapse wiring (also exported)

- `wireCollapseToggle({ trigger, stateEl })` — attach click + Enter/Space toggling that flips `data-collapsed` on `stateEl` (defaults to `trigger`), keeps `aria-expanded` on the trigger in sync, and persists state to the shared `"blocker-rail:collapsed"` localStorage key. Used internally by `createBlockerRail` and the placeholder; export is exposed so any future blocker-adjacent surface can stay consistent with the same collapse contract.

## Blocker shape

```ts
{
  task: string | null; // task name; renders the footer when present
  blocked: boolean; // true → "BLOCKED", false → "RESOLVED" (and dimmed)
  helper: string | null; // helper name; renders the "Can help" row when present
  reportedBy: string | null; // who needs help; renders inline in the banner when present
  description: string; // main card body text (2-line clamp, scrollable on hover)
}
```

This is exactly the shape `mapApiBlocker` produces from a `/api/blockers?general=true` row, so most callers won't construct it by hand. `mapApiBlocker` also handles both the string and `{user_id, full_name}` object shapes for `reported_by` from the API.

## Placeholder & empty state

When there are no active blockers, dashboards still show a dashed-outline placeholder reading **"✓ No current blockers"**. It doubles as a reserved-space marker so teammates designing other dashboard UI can see where the rail will land.

```
┌──────────────────────────────────────────────────┐
│ ✓  No current blockers              HIDE  ▾      │
│                                                  │
│           (dashed border, ~170 px tall)          │
└──────────────────────────────────────────────────┘
```

- **Auto-created** by `mountBlockerRail` if no `[data-blocker-placeholder]` element already exists in the container. Inserted right after `.section-header`.
- **Hidden** (`hidden` attribute) whenever the rail has visible cards. Re-shown when the rail returns no active blockers, the fetch fails, or `destroy()` is called.
- **Opt out of auto-creation** by authoring your own placeholder inline:
  ```html
  <div class="blocker-rail-placeholder" data-blocker-placeholder>
    <!-- your custom content -->
  </div>
  ```
  The init script will use yours instead of creating one, but `setupPlaceholderToggle` still wires up the collapse behavior.

## Collapsible behavior

Both the rail header and the placeholder are click/keyboard-toggleable: click anywhere in the header (or focus it and press Enter/Space) to hide the card track, leaving just the title + count badge (or the empty-state line). A "SHOW / HIDE" label and rotating chevron indicate state.

- **State persists** in `localStorage` under the key `"blocker-rail:collapsed"` (`"true"` or `"false"`).
- **Shared** between the rail and placeholder — collapsing one carries over when the other becomes visible. A user who prefers "compact" sees compact in both states.
- **Survives refreshes** triggered by `blockers:changed` (the rail is recreated on every refresh; the new instance reads the saved state before being inserted, so there's no flash).
- **Surviving across pages** is intentional — switching from `main.html` to `kanban.html` keeps the user's preference. If you want per-page state instead, scope the key to include the page name.

## Resolving blockers

Each active card shows a small **"✓ Resolve"** button in its banner when a `resolveBlocker` handler is configured. Click flow:

1. Button enters a loading state (`disabled`, label → "Resolving…").
2. `resolveBlocker(blocker)` runs. On success, `mountBlockerRail` dispatches `blockers:changed` automatically, which triggers a refresh and removes the resolved card from the rail.
3. On error, the button shows "Failed — retry" and is re-enabled.

### Today's default (PATCH endpoint not yet implemented)

Issue #17 lists `PATCH /blockers/:blockerId` as planned but unbuilt. Until that lands, the default `resolveBlocker` logs a warning and throws — clicking the button on the live dashboard will show the "Failed — retry" state. **The demo page (`blocker-card-demo.html`) passes a working in-memory resolver so you can see the full success flow.**

### Wiring the real handler once the PATCH endpoint exists

When the endpoint lands and `/api/blockers` starts returning `blocker_id`, swap one function:

```js
mountBlockerRail({
  container: document.getElementById("dashboard-view"),
  anchor: document.querySelector(".section-header"),
  resolveBlocker: async (blocker) => {
    const res = await fetch(`/api/blockers/${blocker.blocker_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_resolved: true }),
    });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
  },
});
```

This means replacing the auto-mount in `blocker-card-init.js`, or calling `mountBlockerRail` manually from `main.js`.

## Footer linking — known limitation

Clicking a card's task footer **does not navigate to the task**. The current behavior:

1. Look up a `.task-card` in `#task-list` whose `.task-title` text matches `blocker.task` (case + whitespace insensitive).
2. **On match** → scroll into view and flash a red highlight.
3. **On miss** → the footer shakes, the arrow swaps to "Not in current view" for 1.6 s, and the change is announced to assistive tech via a `role="status"` live region.

**Why it's name-based:** the `/api/blockers` response doesn't include `task_id`. Once the API is extended to return it, replace `findTask` with an id-based lookup and delete the `matchTaskByName` fallback. Until then, editing a task title silently breaks the link.

## Accessibility

- Footer has `role="button"`, `tabIndex=0`, and `aria-label="Open task: <name>"`.
- Rail header and placeholder both have `role="button"`, `tabIndex=0`, `aria-expanded`, and a descriptive `aria-label` for the collapse toggle.
- `:focus-visible` shows a 2 px red outline (or gray, on the placeholder).
- Decorative glyphs (`›`, `▾`, `⚠`, `✓`) are `aria-hidden`.
- Missing-state changes are announced via a visually-hidden `role="status"` live region appended to the rail.

## Styling

### CSS load order — important

`blocker-card.css` references tokens defined in `dashboard/main.css` (`--color-text-primary`, `--color-text-secondary`, `--color-border`, `--color-bg`). **Load `main.css` first**, otherwise text colors and borders silently fall back to browser defaults.

```html
<link rel="stylesheet" href="../dashboard/main.css" />
<link rel="stylesheet" href="../blocker-card/blocker-card.css" />
```

### Tokens

The component defines its own red/green tokens, scoped to `.blocker-rail`, `.blocker-card`, and `.task-card--blocker-highlight` so they don't leak into the global cascade. Override by re-declaring them on the same selectors.

| Token                      | Default   | Used for                            |
| -------------------------- | --------- | ----------------------------------- |
| `--blocker-card-bg`        | `#fef2f2` | Card background                     |
| `--blocker-card-border`    | `#fecaca` | Card border, hover/highlight states |
| `--blocker-card-fg`        | `#b91c1c` | Header, status label, footer text   |
| `--blocker-card-fg-muted`  | `#c2515a` | Description copy                    |
| `--blocker-card-footer-bg` | `#fde2e2` | Task-link footer strip              |
| `--blocker-helper-bg`      | `#f0fdf4` | "Can help" avatar background        |
| `--blocker-helper-fg`      | `#15803d` | "Can help" avatar text              |
| `--blocker-rail-count-bg`  | `#b91c1c` | Count badge background              |

### Sizing

Cards are a fixed `240px` so they line up cleanly in the scroll rail. The rail uses `scroll-snap-type: x mandatory` and shows a thin scrollbar on hover.

## Files

- `blocker-card.js` — DOM builders (`createBlockerCard`, `createBlockerRail`, `createBlockerPlaceholder`), pure helpers (`mapApiBlocker`, `filterActiveBlockers`, `normalizeTaskName`, `matchTaskByName`), and the shared `wireCollapseToggle` collapse helper.
- `blocker-card-init.js` — `mountBlockerRail` factory, `attachRailNavigation` (footer click/keyboard behavior), placeholder auto-creation + toggle wiring (via `wireCollapseToggle`), and auto-mount on dashboards.
- `blocker-card.css` — styles + scoped tokens.
- `blocker-card-demo.html` + `blocker-card-demo.js` — live demo (rail with working in-memory Resolve + standalone cards).

## Tests

Pure helpers are covered in `source/src/tests/blocker-card.test.js` (run with `npm test`).

DOM-level behavior (mount/refresh/click flash) is **not** covered — the project doesn't have a DOM test environment configured. Add `jsdom` or `happy-dom` as a Vitest environment if you want to extend coverage there.
