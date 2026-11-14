package com.sitrep.companion.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Regression fence for the app-bar subtitle. The bug this pins: the line was
 * derived from the PENDING count alone, so a queue holding only parked
 * conflicts - the one state that never resolves without the user - read
 * "Synced".
 */
class SyncStatusTextTest {

    @Test
    fun `a parked conflict is never reported as synced`() {
        assertEquals("1 change(s) need a decision", syncSubtitle(pending = 0, conflicts = 1))
    }

    @Test
    fun `a conflict outranks queued work because only the user can clear it`() {
        assertEquals("2 change(s) need a decision", syncSubtitle(pending = 3, conflicts = 2))
    }

    @Test
    fun `plain queued work reads as waiting`() {
        assertEquals("3 change(s) waiting to sync", syncSubtitle(pending = 3, conflicts = 0))
    }

    @Test
    fun `an empty queue is synced`() {
        assertEquals("Synced", syncSubtitle(pending = 0, conflicts = 0))
    }
}
