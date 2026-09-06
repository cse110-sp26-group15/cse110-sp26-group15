package com.sitrep.companion.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The offline write path, end to end, on the JVM.
 *
 * These run under plain JUnit with no emulator and no Android runtime: the
 * engine only knows [LocalStore] and [SitRepApi], so the interesting sequences
 * (queue while offline, reconnect, replay a delivery whose response was lost,
 * lose membership mid-queue) can be produced exactly rather than approximated.
 */
class SyncEngineTest {

    private lateinit var server: FakeSitRepServer
    private lateinit var store: InMemoryStore
    private lateinit var engine: SyncEngine

    private val projectId = 7L
    private val me = 1L

    @Before
    fun setUp() {
        server = FakeSitRepServer()
        store = InMemoryStore()
        engine = SyncEngine(store, FakeApi(server))
    }

    private fun queueCreate(
        title: String,
        status: String = "todo",
        localId: String = "local-1",
        clientToken: String = "token-1",
    ) =
        store.enqueue(
            PendingOp(
                opId = 0,
                kind = OpKind.CREATE,
                localId = localId,
                serverTaskId = null,
                projectId = projectId,
                clientToken = clientToken,
                baseVersion = null,
                payload = TaskPayload(title, null, status, me),
            )
        )

    private fun queueUpdate(
        serverTaskId: Long?,
        payload: TaskPayload,
        baseVersion: Int,
        localId: String = "local-1",
    ) =
        store.enqueue(
            PendingOp(
                opId = 0,
                kind = OpKind.UPDATE,
                localId = localId,
                serverTaskId = serverTaskId,
                projectId = projectId,
                clientToken = "update-token",
                baseVersion = baseVersion,
                payload = payload,
            )
        )

    // ------------------------------------------------------------------ //
    // Offline, then reconnect
    // ------------------------------------------------------------------ //

    @Test
    fun `an edit made offline stays queued and nothing reaches the server`() = runTest {
        server.offline = true
        val op = queueCreate("Filed on the train")

        val outcome = engine.drain()

        assertTrue(outcome is SyncEngine.Outcome.Retry)
        assertEquals(0, server.insertCount)
        assertEquals(OpState.PENDING, store.op(op.opId)!!.state)
    }

    @Test
    fun `reconnecting lands the queued create exactly once`() = runTest {
        server.offline = true
        val op = queueCreate("Filed on the train")
        engine.drain()

        server.offline = false
        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.Drained, outcome)
        assertEquals(1, server.insertCount)
        assertNull(store.op(op.opId))
        assertEquals("Filed on the train", store.cached["local-1"]!!.title)
        assertEquals(1, store.cached["local-1"]!!.version)
    }

    // ------------------------------------------------------------------ //
    // Duplicate retries
    // ------------------------------------------------------------------ //

    @Test
    fun `a create whose response was lost is not inserted twice on retry`() = runTest {
        val op = queueCreate("Filed on the train")

        // First delivery: the server commits, then the connection dies before
        // the response gets back. The phone cannot tell this from "never sent".
        server.loseNextResponse = true
        assertTrue(engine.drain() is SyncEngine.Outcome.Retry)
        assertEquals(1, server.insertCount)
        assertEquals(OpState.PENDING, store.op(op.opId)!!.state)

        // Second delivery: same op, therefore the same client_token.
        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.Drained, outcome)
        assertEquals("the create must not be inserted a second time", 1, server.insertCount)
        assertEquals(1, server.rows.size)
        assertEquals(listOf("token-1", "token-1"), server.seenClientTokens)
        assertNull(store.op(op.opId))
    }

    @Test
    fun `an update whose response was lost is not applied twice on retry`() = runTest {
        val taskId = server.seed(projectId, "Original")
        val payload = TaskPayload("Edited on the phone", null, "in-progress", me)
        val op = queueUpdate(taskId, payload, baseVersion = 1)

        server.loseNextResponse = true
        assertTrue(engine.drain() is SyncEngine.Outcome.Retry)
        assertEquals(1, server.updateCount)
        assertEquals(2, server.rows.getValue(taskId).version)

        // The retry still carries version 1, so the server refuses it with 409.
        // That 409 is not a conflict: the row already holds what we wanted.
        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.Drained, outcome)
        assertEquals("the update must not be applied a second time", 1, server.updateCount)
        assertEquals(2, server.rows.getValue(taskId).version)
        assertEquals(0, store.conflicts.size)
        assertNull(store.op(op.opId))
        // The client adopted the server's version, so the next edit is not stale.
        assertEquals(2, store.cached["local-1"]!!.version)
    }

    // ------------------------------------------------------------------ //
    // A real conflicting edit from the browser
    // ------------------------------------------------------------------ //

    @Test
    fun `a browser edit during the outage parks the local edit for a decision`() = runTest {
        val taskId = server.seed(projectId, "Original")
        server.offline = true
        val op = queueUpdate(taskId, TaskPayload("Phone title", null, "done", me), baseVersion = 1)
        engine.drain()

        // A teammate moves the same card on the web while the phone is dark.
        server.browserEdit(taskId, title = "Browser title")
        server.offline = false

        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.NeedsUser(1), outcome)
        assertEquals(OpState.CONFLICT, store.op(op.opId)!!.state)
        assertEquals("Browser title", server.rows.getValue(taskId).title)
        assertEquals("the losing write must not have landed", 0, server.updateCount)
        assertEquals(1, store.conflicts.size)
        assertEquals(2, store.conflicts.single().second.version)
    }

    @Test
    fun `a drain that finds an already-parked conflict still reports it`() = runTest {
        val taskId = server.seed(projectId, "Original")
        val op = queueUpdate(taskId, TaskPayload("Phone title", null, "done", me), baseVersion = 1)
        server.browserEdit(taskId, title = "Browser title")

        assertEquals(SyncEngine.Outcome.NeedsUser(1), engine.drain())

        // Found on an emulator: WorkManager drains on reconnect and parks the
        // conflict, then the user taps "Sync". That second drain sees no
        // PENDING op, so it used to report Drained and the screen said "Up to
        // date." while the edit sat waiting for a decision. A user who does not
        // scroll to the card never learns their change has not landed.
        val second = engine.drain()

        assertEquals(SyncEngine.Outcome.NeedsUser(1), second)
        assertEquals(OpState.CONFLICT, store.op(op.opId)!!.state)
        assertEquals("the second drain must not re-send anything", 0, server.updateCount)
    }

    @Test
    fun `keep mine rebases onto the server version and lands on the next drain`() = runTest {
        val taskId = server.seed(projectId, "Original")
        val op = queueUpdate(taskId, TaskPayload("Phone title", null, "done", me), baseVersion = 1)
        server.browserEdit(taskId, title = "Browser title")
        engine.drain()

        val parked = store.op(op.opId)!!
        val current = store.conflicts.single().second
        val rebased = ConflictResolver.keepMine(parked, current)
        store.ops[store.ops.indexOfFirst { it.opId == op.opId }] = rebased

        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.Drained, outcome)
        assertEquals("Phone title", server.rows.getValue(taskId).title)
        assertEquals(3, server.rows.getValue(taskId).version)
        assertEquals("exactly one write, no retry storm", 1, server.updateCount)
    }

    // ------------------------------------------------------------------ //
    // Authorization
    // ------------------------------------------------------------------ //

    @Test
    fun `a queued write refused with 403 is never retried and the project cache is dropped`() =
        runTest {
            server.offline = true
            val op = queueCreate("Filed before I was removed")
            engine.drain()

            // The user is taken off the project while the phone is offline.
            server.revokedProjects += projectId
            server.offline = false

            val outcome = engine.drain()

            assertEquals(SyncEngine.Outcome.Drained, outcome)
            assertEquals("the server refused, so nothing was written", 0, server.insertCount)
            assertEquals(listOf(projectId), store.projectsLost)
            assertEquals(1, store.rejected.size)
            assertEquals(403, store.rejected.single().second)

            // A second pass must not try again: the answer will not change, and
            // hammering a 403 is how a client leaks that the project exists.
            engine.drain()
            assertEquals(0, server.insertCount)
        }

    @Test
    fun `a 401 destroys every cached row and stops the run`() = runTest {
        server.seed(projectId, "Something the user could read")
        store.cached["local-1"] = server.rows.values.first()
        queueCreate("Filed with a dead session")
        server.sessionValid = false

        val outcome = engine.drain()

        assertEquals(SyncEngine.Outcome.AuthLost, outcome)
        assertTrue(store.authLost)
        assertTrue("offline copies must not outlive the session", store.cached.isEmpty())
        assertTrue(store.ops.isEmpty())
    }

    // ------------------------------------------------------------------ //
    // Ordering
    // ------------------------------------------------------------------ //

    @Test
    fun `an update queued behind an unsent create waits for it and then addresses the right row`() =
        runTest {
            server.offline = true
            queueCreate("Draft")
            queueUpdate(null, TaskPayload("Draft, revised", null, "in-progress", me), baseVersion = 1)
            engine.drain()

            server.offline = false
            val outcome = engine.drain()

            assertEquals(SyncEngine.Outcome.Drained, outcome)
            assertEquals(1, server.insertCount)
            assertEquals(1, server.rows.size)
            val row = server.rows.values.single()
            assertEquals("Draft, revised", row.title)
            assertEquals("in-progress", row.status)
            assertEquals(2, row.version)
        }

    @Test
    fun `the queue stops at the first op that needs the network back`() = runTest {
        queueCreate("First", localId = "a", clientToken = "t-a")
        queueCreate("Second", localId = "b", clientToken = "t-b")

        // The first lands, then the network dies.
        server.loseNextResponse = false
        val firstPass = engine.drain()
        assertEquals(SyncEngine.Outcome.Drained, firstPass)
        assertEquals(2, server.insertCount)

        // Now the reverse: nothing sends at all.
        server.offline = true
        queueCreate("Third", localId = "c", clientToken = "t-c")
        queueCreate("Fourth", localId = "d", clientToken = "t-d")
        assertTrue(engine.drain() is SyncEngine.Outcome.Retry)
        assertEquals(2, server.insertCount)
        assertEquals(2, store.ops.size)
    }

    @Test
    fun `refresh brings the board down once the queue is clean`() = runTest {
        server.seed(projectId, "On the server")
        val outcome = engine.refresh(projectId)

        assertEquals(SyncEngine.Outcome.Drained, outcome)
        assertNotNull(store.cached["server-1"])
        assertEquals("On the server", store.cached["server-1"]!!.title)
    }
}
