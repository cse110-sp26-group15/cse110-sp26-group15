# Local-first task editing and conflict resolution

SitRep's task-edit workflow works offline on both clients and converges
deterministically when concurrent edits collide. This document is the
contract: what is guaranteed, what is deliberately not, how to reproduce
every claim, and the results measured on 2026-09-07.

The chosen workflow is **task editing** (title, description, status,
assignee, priority) through `PATCH /api/tasks/:taskId` - the one mutation
already real in both clients: the web board's edit dialog and the Android
companion's edit dialog.

This is **optimistic concurrency with explicit user resolution, not a CRDT**.
Nothing here merges structures mathematically; the server serializes writes
with a compare-and-swap, and the losing writer is shown both versions and
chooses. Do not describe it as CRDT-based.

## The pieces

| Layer           | Where                                                                            | Role                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server contract | `functions/api/tasks/[taskId].js`, `functions/api/projects/[projectId]/tasks.js` | `version` compare-and-swap on PATCH (409 + `conflict: true` + current row on a stale write); `client_token` idempotent create; membership checked at delivery time (403). |
| Schema          | `db/migrations/0015_add_task_version.sql`, `0016_add_task_client_token.sql`      | `tasks.version INTEGER NOT NULL DEFAULT 1`; partial unique index on `(project_id, client_token)`.                                                                         |
| Web engine      | `source/shared/task-sync.js`                                                     | Durable localStorage outbox per project, drain loop, 409 classification, offline task cache. DOM-free and injectable.                                                     |
| Web UI          | `source/dashboard/scrum.js` (+ `scrum.html`, `scrum.css`)                        | Sync status strip, queued/conflict badges on cards, keep-mine / keep-theirs dialog, offline board render from the cache.                                                  |
| Android         | `android/app/src/main/java/com/sitrep/companion/` (`sync/`, `data/`, `work/`)    | The original outbox implementation: Room `outbox` table, `SyncEngine`, `ConflictResolver`, WorkManager replay. `android/README.md` documents the same server contract.    |

The web engine is a deliberate port of the Android `SyncEngine` /
`ConflictResolver` semantics so the two clients treat every server answer
identically:

- **2xx** - op done, server row adopted.
- **409, row already holds everything the op wanted** - the op's own earlier
  delivery landed and the response was lost (or someone made the identical
  edit). Op finished; re-sending is what would double-write.
- **409, row moved somewhere the op did not intend** - parked as a conflict;
  only the user resolves it (keep mine = rebase onto the server version and
  resubmit; keep theirs = adopt the row, send nothing).
- **403** - membership was revoked while the edit waited. The op is dropped
  with a user-visible notice, everything else queued for the project is
  dropped, and the cached project data is cleared. Never retried.
- **404 / other 4xx** - dropped with a notice.
- **401** - session gone: outbox and cache destroyed (offline work must not
  outlive the credential), user routed to login.
- **Network failure** - op stays queued; retried on the `online` event, a
  30-second fallback timer, and every page load.

## Guarantees (each pinned by a test)

Web engine + real API handlers (`source/tests/task-sync.test.js`, run by
Vitest against the real migrations and middleware via
`source/tests/helpers/d1-harness.js`):

1. An edit queued offline survives a page refresh and lands exactly once on
   reconnect.
2. A delivery whose response was lost finishes on retry without a second
   write (the version bumps once, not twice).
3. Concurrent offline web + phone edits converge in **both** reconnect
   orders: the first to reconnect lands; the second parks and resolves
   explicitly; afterwards the database and both clients' reads are identical
   and no queued work remains.
4. Identical edits on both sides converge with no user involvement and one
   write.
5. A parked conflict survives a refresh and is never re-sent without a
   decision.
6. Membership removed while the edit waited: the write is refused (403),
   never applied, never retried, and the user is told; cached project data
   is cleared.
7. A dead session destroys the queue instead of replaying under it.
8. Two offline edits to one task coalesce into one delivery.

Browser-level (`e2e/offline-sync.spec.js`, Playwright, stateful CAS-aware
mock per repo convention): the strip/badges, the conflict dialog with both
versions, keep-mine sending the rebased version, keep-theirs sending
nothing, real-localStorage survival across a real `page.reload()`, and the
inline assignee control riding the same outbox.

Android (`android/app/src/test/`, JVM + Robolectric, no emulator):
`SyncEngineTest` (replay dedup, conflict parking, 403/401, ordering),
`OfflineJourneyTest` (real on-disk Room DB with process death simulated by
closing and reopening it; includes membership loss, logout wipe, and the
parked-conflict coalescing fix below), `ConflictResolverTest`,
`UpdateBodyTest`, `SyncStatusTextTest`.

Server-side guarantees were already pinned before this package:
`task-concurrency.test.js` (CAS semantics), `task-idempotency.test.js`
(idempotent create; removed-member 403 leaves rows byte-identical),
`authz-tenant.test.js` (tenant boundary).

### Negative controls (why the guard is necessary, not just present)

- `source/tests/task-sync.test.js` "negative controls" describe block and
  `npm run demo:offline` both demonstrate, against the real handlers, that
  the **pre-package behaviour loses data**: a versionless full-form save
  silently destroys a teammate's edit (200, no warning), and a blind retry
  after a lost response re-applies a stale payload over a newer edit. The
  same scenarios through the engine end in a 409 + parked conflict with the
  teammate's edit intact.
- A replayed `POST` without `client_token` creates a duplicate task; with
  the token the replay returns the existing row (`idempotent_replay: true`).

### Deterministic convergence, precisely

Given the same set of edits and the same resolution choices, the outcome is
a pure function of the serialization order the server assigns; no outcome
depends on a race. In both reconnect orders: the first writer lands, the
second is parked (never silently applied, never silently lost), and after
resolution every replica equals the server row. The final _content_ when the
two edits differ is decided by the human resolution, which is the design:
the package guarantees no write is ever silently destroyed and all replicas
converge, not that a machine picks the winner.

## Fixed while building this

- **Web:** the edit dialog's 409 handling was `alert()` + reload - the
  user's edit was thrown away (keep-theirs was the only behaviour). Offline,
  every edit failed outright and nothing survived a refresh.
- **Android:** editing a task already parked in CONFLICT inserted a second
  op with a stale base version (could only bounce, and was orphaned by the
  eventual resolution). Now folded into the parked op
  (`TaskRepository.editTask`, pinned in `OfflineJourneyTest`).
- **Android:** the app bar derived "Synced" from the PENDING count alone, so
  a board whose only queued work was a parked conflict claimed to be synced
  (`ui/SyncStatusText.kt`, pinned in `SyncStatusTextTest`).

## Assumptions

- One editor per browser profile per project at a time; the outbox coalesces
  per task, so ops are keyed by task, not by field-level history.
- localStorage is available and not evicted; if it is unavailable the board
  degrades to the old online-only behaviour (the engine no-ops), and a
  corrupt outbox document is treated as empty rather than crashing.
- The 409 classification is heuristic by design (the server has no PATCH
  idempotency token): if a teammate independently makes the _identical_
  edit first, the op is classified already-applied and dropped. That is the
  same trade-off the Android client has always made.
- `assigned_to: null` is refused by the server ("a task must be assigned"),
  so an empty assignee on the edit form means "leave it unchanged" - the
  same rule the Android client applies.
- There is no member-removal endpoint; removal is a direct
  `project_members` delete (matching the server test suite).

## Limitations (deliberate scope)

- Web coverage is the **scrum board** (`dashboard/scrum.js`). The XP
  (`main.js`) and kanban (`kanban.js`) dashboards keep their previous direct
  PATCH behaviour; the kanban status dropdown remains versionless
  last-write-wins by server design (`functions/api/tasks/[taskId].js`
  comment at the `version` check).
- Task **edits** only. Create and delete are not queued on the web (create
  is already idempotent server-side via `client_token`; the Android client
  queues creates).
- No service worker: a cold offline navigation cannot load the page itself.
  The offline story is "the page is open (or served) and the API/network is
  down" - the cached board render plus the durable outbox cover refresh
  during an outage.
- No field-level merge in the conflict dialog: keep mine / keep theirs only,
  matching the phone.
- Reads can be stale: there is no delta feed or push; refresh is a full GET
  once the queue drains.
- The Android instrumented (on-device) suites exist
  (`ScreensComposeTest`, `SyncWorkerInstrumentedTest`,
  `SessionStoreInstrumentedTest`) but were **not run** for the results
  below - they need a device/emulator (`./gradlew :app:connectedDebugAndroidTest`).

## Reproduce everything

```bash
# Web engine + API integration + all existing suites (no credentials, no network)
npm ci
npx vitest run

# Browser-level proof (strip, badges, dialog, reload survival)
npm run build
npx playwright test e2e/offline-sync.spec.js

# The full e2e suite
npm run test:e2e:ci

# The narrated end-to-end demo (real handlers + seed data, in-process)
npm run demo:offline

# Android JVM suite (JDK 17; sdk.dir in android/local.properties)
cd android && ./gradlew :app:testDebugUnitTest
```

Manual, against a real local deployment (`README.md` has the seed login
`arivera@ucsd.edu` / `TestPassword123`):

```bash
npm run build && npm run db:migrate:local && npm run db:seed:local
npm run dev:pages          # http://localhost:8788
```

Open the scrum board, cut the network in devtools (or stop wrangler), edit a
task, refresh, restore the network, and watch the strip drain; run the
Android app against the same server with
`./gradlew :app:installDebug -PsitrepBaseUrl=http://10.0.2.2:8788` and use
`adb shell cmd connectivity airplane-mode enable|disable` plus
`adb shell am force-stop com.sitrep.companion` for the phone half
(`android/README.md` walks through it).

## Measured results (2026-09-07, macOS, Node 26.8.1, JDK 17)

| Suite                                   | Command                                    | Result                                                                                                      |
| --------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Vitest (all, incl. 16 new engine tests) | `npx vitest run`                           | 30 files, 387 tests, 0 failures, 10.0 s                                                                     |
| Playwright (all, incl. offline spec)    | `npx playwright test`                      | 75 passed (71 baseline + 4 offline-sync), 10.7 s                                                            |
| Android JVM                             | `./gradlew :app:testDebugUnitTest --rerun` | 34 tests, 0 failures (ConflictResolver 6, UpdateBody 2, SyncEngine 12, OfflineJourney 10, SyncStatusText 4) |
| Demo                                    | `npm run demo:offline`                     | all checks pass, exit 0                                                                                     |
