package com.sitrep.companion.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.sitrep.companion.data.CachedTaskEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The two screens a user reads to learn that an offline edit has not landed.
 *
 * Everything else in the module was already covered by JVM and instrumented
 * tests; the Compose UI was not. These run the composables on a real device
 * through the Compose test rule, so "the card says the change is queued" and
 * "the conflict dialog shows both sides" are checked rather than assumed.
 */
@RunWith(AndroidJUnit4::class)
class ScreensComposeTest {

    @get:Rule val compose = createComposeRule()

    private fun task(
        title: String = "Offline field report",
        serverTaskId: Long? = null,
        version: Int? = null,
        pending: Boolean = true,
        conflict: Boolean = false,
    ) =
        CachedTaskEntity(
            localId = "local-1",
            serverTaskId = serverTaskId,
            projectId = 1,
            title = title,
            description = "Filed from the phone with no network",
            status = "in-progress",
            assignedTo = 1,
            assigneeName = "Alex Rivera",
            version = version,
            pending = pending,
            conflict = conflict,
            remoteTitle = "Create user personas",
            remoteDescription = "Wayne reworked the persona list in the browser",
            remoteStatus = "done",
            remoteVersion = 2,
        )

    @Test
    fun a_task_created_offline_says_it_is_not_on_the_server_yet() {
        compose.setContent { TaskRow(task(), onEdit = {}, onResolve = {}) }

        compose.onNodeWithText("Offline field report").assertIsDisplayed()
        compose
            .onNodeWithText("in-progress  ·  not on the server yet  ·  queued")
            .assertIsDisplayed()
        assertEquals(
            "a row with no conflict must not offer a decision",
            0,
            compose.onAllNodesWithText("Resolve").fetchSemanticsNodes().size,
        )
    }

    @Test
    fun a_conflicted_task_offers_a_resolve_action() {
        var resolved = false
        compose.setContent {
            TaskRow(
                task(serverTaskId = 1, version = 3, conflict = true),
                onEdit = {},
                onResolve = { resolved = true },
            )
        }

        compose.onNodeWithText("in-progress  ·  v3  ·  CONFLICT").assertIsDisplayed()
        compose.onNodeWithText("Resolve").performClick()
        assertTrue("tapping Resolve must reach the caller", resolved)
    }

    @Test
    fun the_conflict_dialog_shows_the_local_edit_and_the_server_row() {
        var keptMine = false
        compose.setContent {
            ConflictDialog(
                task =
                    task(
                        title = "Create user personas - phone edit",
                        serverTaskId = 1,
                        version = 3,
                        conflict = true,
                    ),
                onDismiss = {},
                onKeepMine = { keptMine = true },
                onKeepTheirs = {},
            )
        }

        compose.onNodeWithText("This task changed while you were offline").assertIsDisplayed()
        // Both sides, or the user cannot make the choice the dialog asks for.
        compose.onNodeWithText("Your edit").assertIsDisplayed()
        compose.onNodeWithText("Create user personas - phone edit · in-progress").assertIsDisplayed()
        compose.onNodeWithText("On the server (v2)").assertIsDisplayed()
        compose.onNodeWithText("Create user personas · done").assertIsDisplayed()
        compose.onNodeWithText("Wayne reworked the persona list in the browser").assertIsDisplayed()

        compose.onNodeWithText("Keep mine").performClick()
        assertTrue("keeping the local edit must reach the caller", keptMine)
    }

    @Test
    fun the_edit_dialog_hands_back_what_was_typed() {
        var saved: Triple<String, String, String>? = null
        compose.setContent {
            TaskDialog(
                title = "Edit task",
                initialTitle = "Triage backlog for sprint 3",
                initialDescription = "",
                initialStatus = "todo",
                onDismiss = {},
                onSave = { t, d, s -> saved = Triple(t, d, s) },
            )
        }

        compose.onNodeWithText("in-progress").performClick()
        compose.onNodeWithText("Save").performClick()

        assertEquals(Triple("Triage backlog for sprint 3", "", "in-progress"), saved)
    }
}
