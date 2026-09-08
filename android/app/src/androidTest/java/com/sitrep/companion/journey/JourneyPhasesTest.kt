package com.sitrep.companion.journey

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.sitrep.companion.MainActivity
import com.sitrep.companion.SitRepApp
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The full local-first lifecycle, driven through the real Compose UI on an
 * emulator against a real `wrangler pages dev` backend.
 *
 * The unit and Robolectric suites pin the engine's behaviour below the UI.
 * These phases pin the part those cannot see: that a person tapping the actual
 * screens - sign in, edit, Resolve, Keep mine, Keep theirs - moves the durable
 * state the engine tests only simulate, across real process death and real
 * airplane mode.
 *
 * Each @Test is one phase of the journey, launched as its own
 * `am instrument -e class ...#method` invocation by android/run-journey.sh,
 * which performs the host-side steps between phases (network toggles, process
 * kill, second-client writes, membership revocation, server-side checks).
 * App state carries across phases because everything durable lives in Room and
 * EncryptedSharedPreferences; each invocation is itself a fresh app process.
 *
 * Inputs arrive as instrumentation arguments, so no account, password or board
 * content is ever committed - the orchestrating script creates all of it
 * ephemerally against the local server.
 */
@RunWith(AndroidJUnit4::class)
class JourneyPhasesTest {

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val args = InstrumentationRegistry.getArguments()

    private fun arg(name: String): String =
        requireNotNull(args.getString(name)) { "missing instrumentation arg -e $name" }

    private val app: SitRepApp
        get() =
            InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
                as SitRepApp

    /** The one-line status label a TaskRow renders under the title. */
    private fun rowLabel(
        status: String,
        version: String?,
        queued: Boolean = false,
        conflict: Boolean = false,
    ): String = buildString {
        append(status)
        if (version != null) append("  ·  v$version")
        if (queued) append("  ·  queued")
        if (conflict) append("  ·  CONFLICT")
    }

    private fun textExists(text: String): Boolean =
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    private fun awaitText(text: String, timeoutMs: Long = 60_000) {
        try {
            compose.waitUntil(timeoutMs) { textExists(text) }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("timed out after ${timeoutMs}ms waiting for text: \"$text\"", e)
        }
    }

    private fun awaitGone(text: String, timeoutMs: Long = 60_000) {
        try {
            compose.waitUntil(timeoutMs) { !textExists(text) }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("timed out waiting for text to disappear: \"$text\"", e)
        }
    }

    /**
     * Wait for [texts] to all be on screen, tapping the board's Sync action
     * between checks. Sync is what a user does when the board looks stale, and
     * it keeps the phase deterministic whether the WorkManager pass or the
     * foreground drain gets to the server first.
     */
    private fun syncUntilVisible(vararg texts: String, attempts: Int = 15) {
        repeat(attempts) {
            if (texts.all { textExists(it) }) return
            if (textExists("Sync")) compose.onNodeWithText("Sync").performClick()
            try {
                compose.waitUntil(5_000) { texts.all { textExists(it) } }
                return
            } catch (e: ComposeTimeoutException) {
                // Not yet. Tap Sync again on the next pass.
            }
        }
        throw AssertionError("still missing one of ${texts.toList()} after $attempts sync attempts")
    }

    private val device: UiDevice =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    /** Run a shell command with shell privileges (airplane mode needs them). */
    private fun shell(command: String) {
        device.executeShellCommand(command)
        device.waitForIdle()
    }

    /**
     * Journey step 3: sign in through the Compose login screen and reach the
     * board with the seeded task synced. Also reused to sign back in after the
     * 401 phase destroyed the previous session.
     */
    @Test
    fun loginReachesTheBoard() {
        val email = arg("email")
        val password = arg("password")
        val expectTitle = arg("expectTitle")
        val expectLabel = rowLabel(arg("expectStatus"), arg("expectVersion"))

        awaitText("Sign in", 30_000)
        compose.onNodeWithContentDescription("email").performTextInput(email)
        compose.onNodeWithContentDescription("password").performTextInput(password)
        // The soft keyboard can cover the button on the emulator's small screen.
        Espresso.closeSoftKeyboard()
        compose.onNodeWithText("Sign in").performClick()

        awaitText(expectTitle, 90_000)
        syncUntilVisible(expectTitle, expectLabel, "Synced")
    }

    /**
     * Journey step 5 (and every later queued edit): edit the task through the
     * real dialog and verify the UI marks it pending rather than synced.
     * When `-e airplaneFirst true` is passed the phase cuts the network itself,
     * for control runs that must stay inside one app process; in the normal
     * journey the host script cuts it between phases.
     */
    @Test
    fun offlineEditIsMarkedPending() {
        val editTitle = arg("editTitle")
        val baseVersion = arg("baseVersion")

        if (args.getString("airplaneFirst") == "true") {
            shell("cmd connectivity airplane-mode enable")
            Thread.sleep(2_000)
        }

        awaitText("Edit")
        compose.onNodeWithText("Edit").performClick()
        awaitText("Edit task", 15_000)
        compose.onNodeWithContentDescription("task title").performTextReplacement(editTitle)
        // The selected status renders bracketed ("[in-progress]"), so an exact
        // "in-progress" match exists only when it is not already selected.
        if (textExists("in-progress")) compose.onNodeWithText("in-progress").performClick()
        compose.onNodeWithText("Save").performClick()

        awaitText(editTitle)
        awaitText("1 change(s) waiting to sync")
        awaitText(rowLabel("in-progress", baseVersion, queued = true))
        assertFalse("a queued edit must not read as synced", textExists("Synced"))
    }

    /**
     * Journey step 7: after the host force-stopped the process (step 6), the
     * relaunched app still shows the pending edit, from Room alone.
     */
    @Test
    fun pendingEditSurvivesProcessDeath() {
        val editTitle = arg("editTitle")
        val baseVersion = arg("baseVersion")

        awaitText(editTitle)
        awaitText("1 change(s) waiting to sync")
        awaitText(rowLabel("in-progress", baseVersion, queued = true))
    }

    /**
     * Journey step 8: network is back; the queued edit drains to the server
     * and the board reads synced at the server's new version.
     */
    @Test
    fun reconnectDeliversTheEdit() {
        val editTitle = arg("editTitle")
        val newVersion = arg("newVersion")

        awaitText(editTitle)
        syncUntilVisible(rowLabel("in-progress", newVersion), "Synced")
        assertTrue("the edited title must survive the sync", textExists(editTitle))
        assertFalse(textExists("CONFLICT"))
    }

    /**
     * Journey steps 9-10a: the second client moved the row while the phone's
     * edit was queued; the 409 parks the op, the dialog shows both sides, and
     * "Keep mine" rebases the phone's values onto the server's version.
     */
    @Test
    fun conflictKeepMine() {
        val phoneTitle = arg("phoneTitle")
        val remoteTitle = arg("remoteTitle")
        val remoteVersion = arg("remoteVersion")
        val baseVersion = arg("baseVersion")
        val mergedVersion = arg("mergedVersion")

        awaitText(phoneTitle)
        syncUntilVisible("Resolve", rowLabel("in-progress", baseVersion, conflict = true))

        compose.onNodeWithText("Resolve").performClick()
        awaitText("This task changed while you were offline", 15_000)
        awaitText("Your edit", 15_000)
        awaitText("$phoneTitle · in-progress", 15_000)
        awaitText("On the server (v$remoteVersion)", 15_000)
        awaitText("$remoteTitle · done", 15_000)

        compose.onNodeWithText("Keep mine").performClick()
        syncUntilVisible(rowLabel("in-progress", mergedVersion), "Synced")
        assertTrue("keep mine must keep the phone's title", textExists(phoneTitle))
        assertFalse("the conflict must be resolved", textExists("Resolve"))
    }

    /**
     * Journey step 10b: same conflict shape, opposite decision. "Keep theirs"
     * adopts the server row and sends nothing.
     */
    @Test
    fun conflictKeepTheirs() {
        val phoneTitle = arg("phoneTitle")
        val remoteTitle = arg("remoteTitle")
        val remoteVersion = arg("remoteVersion")
        val baseVersion = arg("baseVersion")

        awaitText(phoneTitle)
        syncUntilVisible("Resolve", rowLabel("in-progress", baseVersion, conflict = true))

        compose.onNodeWithText("Resolve").performClick()
        awaitText("This task changed while you were offline", 15_000)
        awaitText("$phoneTitle · in-progress", 15_000)
        awaitText("On the server (v$remoteVersion)", 15_000)
        awaitText("$remoteTitle · done", 15_000)

        compose.onNodeWithText("Keep theirs").performClick()
        awaitText(remoteTitle)
        awaitText(rowLabel("done", remoteVersion))
        awaitGone(phoneTitle)
        syncUntilVisible(remoteTitle, rowLabel("done", remoteVersion), "Synced")
        assertFalse("keep theirs must clear the conflict", textExists("Resolve"))
        assertFalse(textExists("CONFLICT"))
    }

    /**
     * Journey step 12a: the session was revoked server-side while an edit was
     * queued. The 401 must destroy the credential, the queue and the cached
     * board - not retry forever. The phase launches offline (so the queued op
     * is provably still there), restores the network itself, and drives the
     * drain from the Sync action.
     */
    @Test
    fun staleCredentialIsDroppedAfter401() {
        val editTitle = arg("editTitle")

        awaitText(editTitle)
        awaitText("1 change(s) waiting to sync")

        shell("cmd connectivity airplane-mode disable")

        var dropped = false
        repeat(20) {
            if (!dropped) {
                if (textExists("Sync")) compose.onNodeWithText("Sync").performClick()
                try {
                    compose.waitUntil(4_000) {
                        textExists("Sign in") || app.session.token == null
                    }
                    dropped = true
                } catch (e: ComposeTimeoutException) {
                    // Network may still be settling; sync again.
                }
            }
        }
        assertTrue("the 401 was never processed", dropped)

        assertNull("the stale credential must be destroyed", app.session.token)
        assertEquals(
            "the queued op must not survive auth loss",
            0,
            runBlocking { app.database.outbox().count() },
        )
        assertEquals(
            "cached board content must not outlive the session",
            0,
            runBlocking { app.database.tasks().count() },
        )
    }

    /** Journey step 12b: a fresh launch after the 401 lands on the login screen. */
    @Test
    fun relaunchLandsOnLoginScreen() {
        awaitText("Sign in", 30_000)
        awaitText("SitRep companion", 30_000)
        assertFalse("no board actions may be offered signed out", textExists("Sign out"))
        assertFalse(textExists("Sync"))
        assertFalse(app.session.isSignedIn)
    }

    /**
     * Journey step 11: membership was revoked while an edit was queued. The
     * server's 403 is terminal: the op is quarantined as rejected, the
     * project's cached rows are destroyed, the user is told, and nothing
     * retries - the attempt count must not move on later syncs.
     */
    @Test
    fun revokedMembershipWriteIsQuarantined() {
        val editTitle = arg("editTitle")

        awaitText(editTitle)
        awaitText("1 change(s) waiting to sync")

        shell("cmd connectivity airplane-mode disable")

        repeat(20) {
            if (!textExists("Changes the server refused")) {
                if (textExists("Sync")) compose.onNodeWithText("Sync").performClick()
                try {
                    compose.waitUntil(4_000) { textExists("Changes the server refused") }
                } catch (e: ComposeTimeoutException) {
                    // Network may still be settling; sync again.
                }
            }
        }
        awaitText("Changes the server refused", 10_000)
        awaitGone(editTitle)

        // The refusal is terminal: the op is dropped outright (the engine marks
        // it rejected and then deletes the revoked project's queue), the cached
        // rows are destroyed, and the notice is the durable record of what the
        // server refused.
        assertEquals(
            "the refused write must not stay queued",
            0,
            runBlocking { app.database.outbox().count() },
        )
        val notices = runBlocking { app.database.notices().all() }
        assertTrue(
            "the user must be told the server refused the write",
            notices.any { it.message.contains("(403)") },
        )
        assertEquals(
            "the revoked project's cached rows must be gone",
            0,
            runBlocking { app.database.tasks().count() },
        )

        // Two more user-driven syncs must not resurrect or re-send anything.
        compose.onNodeWithText("Sync").performClick()
        Thread.sleep(3_000)
        compose.onNodeWithText("Sync").performClick()
        Thread.sleep(3_000)
        assertEquals(0, runBlocking { app.database.outbox().count() })
        assertEquals(
            "no new refusals may appear once the queue is empty",
            notices.size,
            runBlocking { app.database.notices().all() }.size,
        )
        awaitText("Synced")
    }
}
