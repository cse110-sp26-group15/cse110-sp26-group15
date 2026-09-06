package com.sitrep.companion.sync

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The rule that separates "my write already landed" from "somebody else changed
 * this", which is the difference between a silent success and asking the user a
 * question they should not have been asked.
 */
class ConflictResolverTest {

    private val intended = TaskPayload("Edited on the phone", "My notes", "in-progress", 1L)

    private fun row(
        title: String = intended.title,
        description: String? = intended.description,
        status: String = intended.status,
        version: Int = 2,
        assignedTo: Long? = 1L,
    ) = RemoteTask(10L, title, description, status, version, assignedTo, "Alice")

    @Test
    fun `a row that already holds every intended value is our own write coming back`() {
        assertEquals(ConflictVerdict.ALREADY_APPLIED, ConflictResolver.classify(intended, row()))
    }

    @Test
    fun `a different title means somebody else moved the row`() {
        assertEquals(
            ConflictVerdict.NEEDS_DECISION,
            ConflictResolver.classify(intended, row(title = "Renamed in the browser")),
        )
    }

    @Test
    fun `a different status means somebody else moved the row`() {
        assertEquals(
            ConflictVerdict.NEEDS_DECISION,
            ConflictResolver.classify(intended, row(status = "done")),
        )
    }

    @Test
    fun `a description that was edited after us needs a decision`() {
        assertEquals(
            ConflictVerdict.NEEDS_DECISION,
            ConflictResolver.classify(intended, row(description = "Their notes")),
        )
    }

    @Test
    fun `an empty description and a missing one are the same edit`() {
        val blank = intended.copy(description = null)
        assertEquals(
            ConflictVerdict.ALREADY_APPLIED,
            ConflictResolver.classify(blank, row(description = "")),
        )
    }

    @Test
    fun `keep mine rebases onto the server version without changing the user's values`() {
        val op =
            PendingOp(
                opId = 3,
                kind = OpKind.UPDATE,
                localId = "local",
                serverTaskId = null,
                projectId = 7,
                clientToken = "t",
                baseVersion = 1,
                payload = intended,
                attempts = 4,
                state = OpState.CONFLICT,
            )

        val rebased = ConflictResolver.keepMine(op, row(title = "Theirs", version = 9))

        assertEquals(OpState.PENDING, rebased.state)
        assertEquals(9, rebased.baseVersion)
        assertEquals(10L, rebased.serverTaskId)
        assertEquals(0, rebased.attempts)
        assertEquals(intended, rebased.payload)
    }
}
