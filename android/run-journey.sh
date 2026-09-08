#!/usr/bin/env bash
# The SitRep Android journey: one command that provisions the real local
# backend, boots the emulator, installs a fresh APK, and drives the entire
# local-first lifecycle through the actual Compose UI:
#
#   sign in -> board -> airplane mode -> edit marked pending -> process death
#   -> pending edit survives -> reconnect -> server delivery -> version
#   conflict from a second client -> Keep mine -> Keep theirs -> session
#   revoked server-side (401 drops credential + cache) -> re-login ->
#   membership revoked while queued (403 quarantines, never retries).
#
# Usage:
#   ./run-journey.sh                  the positive journey (the gate)
#   ./run-journey.sh control-outbox   negative control: local store made
#                                     non-durable; process-death recovery fails
#   ./run-journey.sh control-version  negative control: version token dropped
#                                     from PATCH; the conflict never surfaces
#   ./run-journey.sh control-403      negative control: 403 treated as
#                                     retryable; the quarantine test fails and
#                                     the server log shows the endless retries
#
# Control runs mutate one source file, prove the journey fails, then restore
# the file and rebuild, so the tree is never left broken.
#
# Accounts, passwords, the project and its tasks are all created fresh against
# the throwaway local database on every run. Nothing secret exists to commit.
#
# Evidence lands in $JOURNEY_OUT (default: android/app/build/journey/<mode>):
# server.log, one log per phase, the server-state JSON checks, and summary.txt.
set -euo pipefail

MODE="${1:-journey}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
AVD="${JOURNEY_AVD:-sitrep}"
PORT="${JOURNEY_PORT:-8788}"
BASE="http://127.0.0.1:$PORT"
OUT="${JOURNEY_OUT:-$ROOT/android/app/build/journey/$MODE}"
PERSIST="$OUT/wrangler-state"
APP_ID="com.sitrep.companion"
RUNNER="com.sitrep.companion.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS="com.sitrep.companion.journey.JourneyPhasesTest"

mkdir -p "$OUT"
: > "$OUT/summary.txt"

log() { printf '\n== %s\n' "$*"; }
note() { echo "$*" | tee -a "$OUT/summary.txt"; }
die() { note "ABORT $*"; exit 1; }

cleanup() {
  # Only if this run started the backend: kill the recorded pid AND whatever
  # is still listening on the port (npx leaves wrangler/workerd children).
  if [ -f "$OUT/server.pid" ]; then
    kill "$(cat "$OUT/server.pid")" >/dev/null 2>&1 || true
    rm -f "$OUT/server.pid"
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------- tiny JSON reader (node is already a repo prerequisite) ----------

jget() { # jget '<json>' 'path.like.this'
  node -e '
    const o = JSON.parse(process.argv[1]);
    let v = o;
    for (const k of process.argv[2].split(".")) v = v?.[k];
    if (v === undefined || v === null) process.exit(2);
    console.log(String(v));
  ' "$1" "$2"
}

# ---------- HTTP against the local server ----------

api() { # api METHOD /path token-or-empty [json-body]
  local method="$1" path="$2" token="$3" body="${4:-}"
  local args=(-sS -X "$method" "$BASE$path" -H 'Content-Type: application/json')
  if [ -n "$token" ]; then args+=(-H "Cookie: sitrep_token=$token"); fi
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  curl "${args[@]}"
}

login_token() { # login_token email password -> session token
  curl -sS -i -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: sitrep_token=\([^;]*\).*/\1/p' | head -1
}

d1_exec() { # d1_exec 'SQL'
  (cd "$ROOT" && npx wrangler d1 execute cse110-sp26-group15 --local \
    --persist-to "$PERSIST" --command "$1") >> "$OUT/d1.log" 2>&1 \
    || (sleep 2 && cd "$ROOT" && npx wrangler d1 execute cse110-sp26-group15 --local \
      --persist-to "$PERSIST" --command "$1") >> "$OUT/d1.log" 2>&1
}

# ---------- server-side evidence ----------

server_tasks() { api GET "/api/projects/$PROJECT_ID/tasks" "$B_TOKEN"; }

expect_server_task() { # expect_server_task check-name expected-title expected-version
  local json title version
  json="$(server_tasks)"
  echo "$json" > "$OUT/server-check-$1.json"
  title="$(jget "$json" tasks.0.title)"
  version="$(jget "$json" tasks.0.version)"
  if [ "$title" = "$2" ] && [ "$version" = "$3" ]; then
    note "PASS  server-check $1: title=$title version=$version"
  else
    die "server-check $1: got title=$title version=$version, want title=$2 version=$3"
  fi
}

b_patch() { # b_patch new-title base-version -> prints new version
  local resp
  resp="$(api PATCH "/api/tasks/$TASK_ID" "$B_TOKEN" \
    "{\"title\":\"$1\",\"status\":\"done\",\"version\":$2}")"
  echo "$resp" > "$OUT/second-client-patch-$1.json"
  jget "$resp" task.version
}

mark_server_log() { LOG_MARK="$(wc -l < "$OUT/server.log" | tr -d ' ')"; }
count_since_mark() { tail -n "+$((LOG_MARK + 1))" "$OUT/server.log" | grep -c "$1" || true; }

# ---------- emulator + app plumbing ----------

net_off() { "$ADB" shell cmd connectivity airplane-mode enable; sleep 2; }
net_on() { "$ADB" shell cmd connectivity airplane-mode disable; sleep 3; }
kill_app() { "$ADB" shell am force-stop "$APP_ID"; sleep 1; }

run_instrument() { # run_instrument logname 'Class#m1[,Class#m2]' [-e k v ...]
  local logname="$1" methods="$2"; shift 2
  "$ADB" shell am instrument -w -e class "$methods" "$@" "$RUNNER" \
    > "$OUT/phase-$logname.log" 2>&1 || true
}

run_phase() { # run_phase logname method [-e k v ...]
  local logname="$1" method="$2"; shift 2
  log "phase $logname ($method)"
  run_instrument "$logname" "$TEST_CLASS#$method" "$@"
  if grep -q "OK (1 test)" "$OUT/phase-$logname.log"; then
    note "PASS  $logname"
  else
    note "FAIL  $logname (log: $OUT/phase-$logname.log)"
    tail -60 "$OUT/phase-$logname.log"
    "$ADB" logcat -d > "$OUT/logcat-$logname.txt" 2>/dev/null || true
    exit 1
  fi
}

run_phase_expect_fail() { # run_phase_expect_fail logname method [-e k v ...]
  local logname="$1" method="$2"; shift 2
  log "phase $logname ($method) - EXPECTED TO FAIL under this control"
  run_instrument "$logname" "$TEST_CLASS#$method" "$@"
  if grep -Eq 'FAILURES!!!|Process crashed' "$OUT/phase-$logname.log"; then
    note "PASS  $logname failed as the control predicts (log: $OUT/phase-$logname.log)"
  else
    note "CONTROL BROKEN  $logname did not fail (log: $OUT/phase-$logname.log)"
    exit 1
  fi
}

build_and_install_app() {
  (cd "$ROOT/android" && ./gradlew -q :app:assembleDebug)
  "$ADB" install -r -t "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
}

# ---------- provisioning ----------

provision() {
  log "preflight"
  command -v node >/dev/null || die "node is required"
  command -v curl >/dev/null || die "curl is required"
  [ -x "$ADB" ] || die "adb not found at $ADB"
  [ -f "$ROOT/android/local.properties" ] || echo "sdk.dir=$SDK" > "$ROOT/android/local.properties"

  log "web build + fresh throwaway database"
  [ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm ci)
  (cd "$ROOT" && npm run build) > "$OUT/web-build.log" 2>&1
  rm -rf "$PERSIST"
  (cd "$ROOT" && npx wrangler d1 migrations apply cse110-sp26-group15 --local \
    --persist-to "$PERSIST") > "$OUT/migrate.log" 2>&1

  log "local backend on :$PORT"
  if curl -s -o /dev/null "$BASE/index.html"; then
    die "port $PORT is already serving something; stop it or set JOURNEY_PORT"
  fi
  # stdin must be detached: wrangler dev reads it for interactive hotkeys and
  # can shut down when it inherits a pipe that closes mid-run.
  (cd "$ROOT" && nohup npx wrangler pages dev dist --port "$PORT" --persist-to "$PERSIST" \
    > "$OUT/server.log" 2>&1 < /dev/null & echo $! > "$OUT/server.pid")
  local i=0
  until curl -s -o /dev/null "$BASE/index.html"; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "backend did not come up (see $OUT/server.log)"
    sleep 2
  done
  note "backend up: $BASE"

  log "emulator ($AVD)"
  if ! "$ADB" devices | grep -q "device$"; then
    [ -x "$EMU" ] || die "emulator not found at $EMU"
    ("$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim \
      > "$OUT/emulator.log" 2>&1 &)
    "$ADB" wait-for-device
    i=0
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      i=$((i + 1)); [ "$i" -le 90 ] || die "emulator did not finish booting"
      sleep 2
    done
  fi
  "$ADB" shell wm dismiss-keyguard >/dev/null 2>&1 || true
  "$ADB" shell settings put global window_animation_scale 0
  "$ADB" shell settings put global transition_animation_scale 0
  "$ADB" shell settings put global animator_duration_scale 0
  net_on

  log "build + install the app and its test APK"
  (cd "$ROOT/android" && ./gradlew -q :app:assembleDebug :app:assembleDebugAndroidTest) \
    > "$OUT/gradle-build.log" 2>&1
  "$ADB" install -r -t "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
  "$ADB" install -r -t \
    "$ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null

  log "ephemeral accounts, project, seed task"
  RUN_ID="$(date +%s)"
  A_EMAIL="phone-$RUN_ID@journey.local"
  B_EMAIL="browser-$RUN_ID@journey.local"
  A_PASS="$(openssl rand -hex 12)"
  B_PASS="$(openssl rand -hex 12)"

  local resp
  resp="$(api POST /api/auth/signup '' \
    "{\"email\":\"$A_EMAIL\",\"password\":\"$A_PASS\",\"full_name\":\"Journey Phone\"}")"
  A_UID="$(jget "$resp" user.user_id)"
  resp="$(api POST /api/auth/signup '' \
    "{\"email\":\"$B_EMAIL\",\"password\":\"$B_PASS\",\"full_name\":\"Journey Browser\"}")"
  B_UID="$(jget "$resp" user.user_id)"
  A_TOKEN="$(login_token "$A_EMAIL" "$A_PASS")"
  B_TOKEN="$(login_token "$B_EMAIL" "$B_PASS")"
  [ -n "$A_TOKEN" ] || die "no session token for the phone user"
  [ -n "$B_TOKEN" ] || die "no session token for the second client"

  resp="$(api POST /api/projects "$A_TOKEN" \
    "{\"name\":\"journey-board-$RUN_ID\",\"workflow\":\"kanban\",\"members\":[\"$B_EMAIL\"]}")"
  PROJECT_ID="$(jget "$resp" project.project_id)"
  resp="$(api POST "/api/projects/$PROJECT_ID/tasks" "$A_TOKEN" \
    "{\"title\":\"journey-seed-task\",\"description\":\"seeded for the journey\",\"status\":\"todo\",\"assigned_to\":$A_UID}")"
  TASK_ID="$(jget "$resp" task.task_id)"
  note "provisioned: users $A_UID/$B_UID, project $PROJECT_ID, task $TASK_ID"

  "$ADB" shell pm clear "$APP_ID" >/dev/null
}

# ---------- the positive journey ----------

journey() {
  run_phase 01-login loginReachesTheBoard \
    -e email "$A_EMAIL" -e password "$A_PASS" \
    -e expectTitle journey-seed-task -e expectStatus todo -e expectVersion 1

  net_off
  run_phase 02-offline-edit offlineEditIsMarkedPending \
    -e editTitle journey-offline-edit -e baseVersion 1

  kill_app
  run_phase 03-process-death pendingEditSurvivesProcessDeath \
    -e editTitle journey-offline-edit -e baseVersion 1

  net_on
  mark_server_log
  run_phase 04-reconnect reconnectDeliversTheEdit \
    -e editTitle journey-offline-edit -e newVersion 2
  expect_server_task delivery journey-offline-edit 2
  local delivered
  delivered="$(count_since_mark "PATCH /api/tasks/$TASK_ID")"
  [ "$delivered" -ge 1 ] || die "server log shows no PATCH delivery"
  note "PASS  server-log delivery: $delivered PATCH request(s) for task $TASK_ID"

  net_off
  run_phase 05-edit-before-conflict offlineEditIsMarkedPending \
    -e editTitle journey-keep-mine-phone -e baseVersion 2
  local v3
  v3="$(b_patch journey-keep-mine-browser 2)"
  [ "$v3" = "3" ] || die "second client bump expected v3, got $v3"
  net_on
  run_phase 06-keep-mine conflictKeepMine \
    -e phoneTitle journey-keep-mine-phone -e remoteTitle journey-keep-mine-browser \
    -e remoteVersion 3 -e baseVersion 2 -e mergedVersion 4
  expect_server_task keep-mine journey-keep-mine-phone 4

  net_off
  run_phase 07-edit-before-conflict offlineEditIsMarkedPending \
    -e editTitle journey-keep-theirs-phone -e baseVersion 4
  local v5
  v5="$(b_patch journey-keep-theirs-browser 4)"
  [ "$v5" = "5" ] || die "second client bump expected v5, got $v5"
  net_on
  run_phase 08-keep-theirs conflictKeepTheirs \
    -e phoneTitle journey-keep-theirs-phone -e remoteTitle journey-keep-theirs-browser \
    -e remoteVersion 5 -e baseVersion 4
  expect_server_task keep-theirs journey-keep-theirs-browser 5

  net_off
  run_phase 09-edit-before-401 offlineEditIsMarkedPending \
    -e editTitle journey-stale-credential-edit -e baseVersion 5
  d1_exec "DELETE FROM sessions WHERE user_id = $A_UID;"
  run_phase 10-stale-credential staleCredentialIsDroppedAfter401 \
    -e editTitle journey-stale-credential-edit
  kill_app
  run_phase 11-relaunch-login relaunchLandsOnLoginScreen
  expect_server_task after-401 journey-keep-theirs-browser 5

  run_phase 12-relogin loginReachesTheBoard \
    -e email "$A_EMAIL" -e password "$A_PASS" \
    -e expectTitle journey-keep-theirs-browser -e expectStatus done -e expectVersion 5

  net_off
  run_phase 13-edit-before-403 offlineEditIsMarkedPending \
    -e editTitle journey-revoked-edit -e baseVersion 5
  d1_exec "DELETE FROM project_members WHERE project_id = $PROJECT_ID AND user_id = $A_UID;"
  mark_server_log
  run_phase 14-quarantine revokedMembershipWriteIsQuarantined \
    -e editTitle journey-revoked-edit
  expect_server_task after-403 journey-keep-theirs-browser 5
  local tries tries_later
  tries="$(count_since_mark "PATCH /api/tasks/$TASK_ID")"
  [ "$tries" -ge 1 ] || die "server log shows no refused PATCH attempt"
  sleep 15
  tries_later="$(count_since_mark "PATCH /api/tasks/$TASK_ID")"
  [ "$tries" = "$tries_later" ] \
    || die "the rejected op kept retrying: $tries then $tries_later attempts"
  note "PASS  server-log quarantine: $tries refused PATCH attempt(s), none after"

  log "journey complete"
  cat "$OUT/summary.txt"
}

# ---------- negative controls ----------

require_clean() { # require_clean path-relative-to-root
  git -C "$ROOT" diff --quiet -- "$1" || die "$1 already modified; refusing to run a control"
}

restore_file() { # restore_file path-relative-to-root
  git -C "$ROOT" checkout -- "$1"
  build_and_install_app
  note "restored $1 and reinstalled the untouched build"
}

require_patched() { # require_patched path-relative-to-root
  if git -C "$ROOT" diff --quiet -- "$1"; then
    die "control patch did not change $1; refusing to run a meaningless control"
  fi
}

control_outbox() {
  local f="android/app/src/main/java/com/sitrep/companion/data/SitRepDatabase.kt"
  require_clean "$f"
  note "CONTROL: local store made non-durable (in-memory Room)"
  perl -0pi -e 's/Room\.databaseBuilder\(\s*context\.applicationContext,\s*SitRepDatabase::class\.java,\s*"sitrep-companion\.db",\s*\)/Room.inMemoryDatabaseBuilder(context.applicationContext, SitRepDatabase::class.java)/s' "$ROOT/$f"
  require_patched "$f"
  build_and_install_app
  "$ADB" shell pm clear "$APP_ID" >/dev/null

  # Sign in and queue an offline edit inside ONE app process (the in-memory
  # store lives exactly as long as the process), then kill it.
  log "control phases: login + offline edit in one process"
  run_instrument c1-login-and-edit \
    "$TEST_CLASS#loginReachesTheBoard,$TEST_CLASS#offlineEditIsMarkedPending" \
    -e email "$A_EMAIL" -e password "$A_PASS" \
    -e expectTitle journey-seed-task -e expectStatus todo -e expectVersion 1 \
    -e editTitle journey-offline-edit -e baseVersion 1 -e airplaneFirst true
  grep -q "OK (2 tests)" "$OUT/phase-c1-login-and-edit.log" \
    || die "control setup phases failed (log: $OUT/phase-c1-login-and-edit.log)"
  note "PASS  c1: board reached and edit queued in the non-durable store"

  kill_app
  run_phase_expect_fail c2-process-death pendingEditSurvivesProcessDeath \
    -e editTitle journey-offline-edit -e baseVersion 1

  net_on
  restore_file "$f"
}

control_version() {
  local f="android/app/src/main/java/com/sitrep/companion/net/HttpSitRepApi.kt"
  require_clean "$f"
  note "CONTROL: expected-version token dropped from PATCH bodies"
  perl -0pi -e 's/\n\s*put\("version", JsonPrimitive\(baseVersion\)\)//' "$ROOT/$f"
  require_patched "$f"
  build_and_install_app
  "$ADB" shell pm clear "$APP_ID" >/dev/null

  run_phase c1-login loginReachesTheBoard \
    -e email "$A_EMAIL" -e password "$A_PASS" \
    -e expectTitle journey-seed-task -e expectStatus todo -e expectVersion 1
  net_off
  run_phase c2-offline-edit offlineEditIsMarkedPending \
    -e editTitle journey-keep-mine-phone -e baseVersion 1
  local v2
  v2="$(b_patch journey-keep-mine-browser 1)"
  [ "$v2" = "2" ] || die "second client bump expected v2, got $v2"
  net_on
  run_phase_expect_fail c3-conflict-never-surfaces conflictKeepMine \
    -e phoneTitle journey-keep-mine-phone -e remoteTitle journey-keep-mine-browser \
    -e remoteVersion 2 -e baseVersion 1 -e mergedVersion 3

  # The damage the token exists to prevent: the second client's write was
  # silently overwritten instead of surfacing as a conflict.
  server_tasks > "$OUT/control-version-server-state.json"
  note "server state after silent clobber: $OUT/control-version-server-state.json"

  restore_file "$f"
}

control_403() {
  local f="android/app/src/main/java/com/sitrep/companion/sync/SyncEngine.kt"
  require_clean "$f"
  note "CONTROL: 403 terminal-state handling removed (treated as retryable)"
  perl -0pi -e 's/is ApiResult\.Forbidden -> \{\s*store\.onRejected\(op, 403, result\.message\)\s*store\.onProjectAccessLost\(op\.projectId\)\s*\}/is ApiResult.Forbidden -> return Outcome.Retry(result.message)/s' "$ROOT/$f"
  require_patched "$f"
  build_and_install_app
  "$ADB" shell pm clear "$APP_ID" >/dev/null

  run_phase c1-login loginReachesTheBoard \
    -e email "$A_EMAIL" -e password "$A_PASS" \
    -e expectTitle journey-seed-task -e expectStatus todo -e expectVersion 1
  net_off
  run_phase c2-offline-edit offlineEditIsMarkedPending \
    -e editTitle journey-revoked-edit -e baseVersion 1
  d1_exec "DELETE FROM project_members WHERE project_id = $PROJECT_ID AND user_id = $A_UID;"
  mark_server_log
  run_phase_expect_fail c3-quarantine-never-happens revokedMembershipWriteIsQuarantined \
    -e editTitle journey-revoked-edit

  local retries
  retries="$(count_since_mark "PATCH /api/tasks/$TASK_ID")"
  [ "$retries" -ge 2 ] || die "expected repeated refused PATCHes, saw $retries"
  note "server log shows $retries refused PATCH attempts: the write retried forever"

  restore_file "$f"
}

# ---------- main ----------

provision
case "$MODE" in
  journey) journey ;;
  control-outbox) control_outbox ;;
  control-version) control_version ;;
  control-403) control_403 ;;
  *) die "unknown mode: $MODE" ;;
esac

log "done ($MODE). Evidence: $OUT"
