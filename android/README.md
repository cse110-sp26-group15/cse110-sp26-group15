# SitRep Android companion

A small native client for the SitRep board: see the work assigned to you, record
an update while the phone has no network, and sync it back without losing
anybody's edit.

It is a standalone Gradle build inside this repo. `npm run build`, `npm test`
and the Cloudflare Pages deploy do not see this directory.

- Kotlin + Jetpack Compose for the UI
- Room for durable local state (the cached board and the write queue)
- WorkManager for retryable background sync
- EncryptedSharedPreferences (Android Keystore) for the session token

## The server contract this client is built against

The companion does not invent a sync protocol. Both halves of the contract are
enforced by the existing Cloudflare Pages handlers and pinned by tests in
`source/tests/`.

### 1. Updates: compare-and-swap on `version`

`tasks.version` (`db/migrations/0015_add_task_version.sql`) is an integer that
starts at 1 and advances on every accepted write.

`PATCH /api/tasks/:taskId` accepts an optional `version`. When it is present the
guard is part of the UPDATE statement, not a separate read:

```sql
UPDATE tasks SET ..., version = version + 1 WHERE task_id = ? AND version = ?
```

- 0 rows changed and the row exists: **409**, body
  `{ error, conflict: true, task: { ...current row..., version } }`, nothing written.
- 0 rows changed and the row is gone: **404**.
- Otherwise: **200** with the updated row, whose `version` is one higher.

Omitting `version` keeps last-write-wins. The companion always sends it.

Pinned by `source/tests/task-concurrency.test.js`.

### 2. Creates: idempotent on `client_token`

`POST /api/projects/:projectId/tasks` accepts an optional `client_token`
(`db/migrations/0016_add_task_client_token.sql`, added for this client):

- First delivery: **201** with the created task.
- Any later delivery of the same `(project_id, client_token)`: **200** with
  `idempotent_replay: true` and the row _as it stands now_. It is a read, so a
  replay can never resurrect the original payload over edits made since.
- A partial unique index on `(project_id, client_token) WHERE client_token IS NOT NULL`
  makes this a database invariant, so two deliveries racing to the INSERT still
  produce one row.
- `client_token` must be a non-empty string of at most 128 characters, or the
  request is **400**.
- Callers that send no token are completely unaffected. The web client sends none.

Pinned by `source/tests/task-idempotency.test.js`.

### 3. Authorization is decided when the write arrives, not when it was queued

Every route under `/api/projects/:projectId/*` runs
`requireProjectMember` from the scoped middleware, and the two routes with no
`:projectId` in the URL (`PATCH`/`DELETE /api/tasks/:id`) resolve the owning
project off the row and check membership before mutating.

So a write that was queued while the user was a member, and delivered after they
were removed, is refused with **403** and changes nothing. The client treats 403
as permanent: the op is marked rejected, never retried, the project's cached rows
are deleted from the device, and the user is told.

There is no member-removal endpoint in the API, so removal can only happen as a
direct delete from `project_members` today. The refusal is enforced either way.

### 4. Sessions

`POST /api/auth/login` returns `{ user, token }` and sets an httpOnly
`sitrep_token` cookie with a 7-day lifetime. A native client is not a browser, so
it reads the token from the body, keeps it in the Keystore-backed store, and
sets `Cookie: sitrep_token=...` itself. A 401 from any route means the session is
gone.

### What the server does NOT provide

- No delta or change feed. Refresh is a full `GET .../tasks`.
- No server-side conflict merge. The 409 hands back the row; resolving is the
  client's job.
- No idempotency on `PATCH`, and none on any route other than task creation.
  Update replays are made safe by the version check instead.
- No push. The client polls when the user asks or when WorkManager runs.

## How the client uses it

A user action writes to Room and returns. It never waits on the network and
never fails because the network is down.

```
UI  ->  TaskRepository  ->  Room (cached_tasks + outbox)
                                   ^
                                   |
        WorkManager -> SyncWorker -> SyncEngine -> HttpSitRepApi -> SitRep
```

- `outbox` is the only record of an unsent edit. Nothing is held in memory
  between the user's tap and the server's acknowledgement, which is why process
  death is survivable.
- Ops drain oldest first and the loop stops at the first one that needs the
  network back, so edits reach the server in the order they were made.
- A second edit to a task that still has an unsent op is folded into that op
  rather than appended behind it.
- On 409 the client does not assume a conflict. `ConflictResolver.classify`
  compares the fields the op meant to write against the row the server returned:
  if they all already match, this delivery is a replay of one that landed and the
  op is finished. Otherwise it is parked and the user picks "keep mine" (rebase
  onto the server's version and re-send) or "keep theirs".
- On 401 every cached task, queued op and notice is destroyed, and so is the
  token. Signing out does the same. Content cached while signed in is not
  readable after signing out.

## Local setup

Prerequisites: JDK 17 and the Android SDK command line tools. There is no
Android Studio requirement.

```bash
# 1. SDK components (once)
export ANDROID_HOME="$HOME/Library/Android/sdk"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# 2. Point the build at the SDK
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties

# 3. Build
./gradlew :app:assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk

# 4. JVM tests (no emulator needed)
./gradlew :app:testDebugUnitTest
# -> app/build/reports/tests/testDebugUnitTest/index.html
```

`android/gradle.properties` pins `org.gradle.java.home` to a JDK 17 install
because AGP 8.7 does not support the newest JDKs. Change it if your JDK 17 lives
somewhere else.

### Pointing it at a server

`SITREP_BASE_URL` defaults to `http://10.0.2.2:8788`, which is how the emulator
reaches `wrangler pages dev` on the host machine:

```bash
# from the repo root
npm run build
npx wrangler pages dev dist --port 8788
```

Override for any other target:

```bash
./gradlew :app:assembleDebug -PsitrepBaseUrl=https://your-deployment.pages.dev
```

Cleartext HTTP is permitted only for `10.0.2.2` and `localhost`
(`res/xml/network_security_config.xml`); everything else must be HTTPS.

### Running on an emulator

```bash
sdkmanager --sdk_root="$ANDROID_HOME" "emulator" "system-images;android-35;aosp_atd;arm64-v8a"
avdmanager create avd -n sitrep -k "system-images;android-35;aosp_atd;arm64-v8a" -d pixel_6
"$ANDROID_HOME"/emulator/emulator -avd sitrep -no-window -no-audio -no-boot-anim &
adb wait-for-device
./gradlew :app:installDebug
./gradlew :app:connectedDebugAndroidTest
```

To exercise the offline path by hand:

```bash
adb shell cmd connectivity airplane-mode enable    # queue an edit in the app
adb shell am force-stop com.sitrep.companion       # process death
adb shell cmd connectivity airplane-mode disable   # reopen the app and sync
```

## Tests

| Where                                                     | What it covers                                                                                               | Needs                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `app/src/test/.../sync/SyncEngineTest.kt`                 | queue while offline, reconnect, replayed create, replayed update, real browser conflict, 403, 401, ordering  | JVM only                      |
| `app/src/test/.../sync/ConflictResolverTest.kt`           | the already-applied vs needs-decision rule                                                                   | JVM only                      |
| `app/src/test/.../data/OfflineJourneyTest.kt`             | the full flow against a real on-disk Room database, with process death simulated by closing and reopening it | JVM (Robolectric)             |
| `app/src/androidTest/.../SessionStoreInstrumentedTest.kt` | the token is not plaintext on disk; logout clears it                                                         | device or emulator (Keystore) |
| `app/src/androidTest/.../SyncWorkerInstrumentedTest.kt`   | the real WorkManager worker returns retry and keeps the queue when the server is unreachable                 | device or emulator            |
