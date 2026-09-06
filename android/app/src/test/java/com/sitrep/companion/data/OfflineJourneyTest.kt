package com.sitrep.companion.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.sitrep.companion.sync.ConflictResolver
import com.sitrep.companion.sync.FakeApi
import com.sitrep.companion.sync.FakeSitRepServer
import com.sitrep.companion.sync.OpState
import com.sitrep.companion.sync.SyncEngine
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The whole user flow against a real Room database on disk, with process death
 * simulated by closing the database and opening a new one over the same file.
 *
 * Robolectric supplies the Android runtime, so this still runs on the JVM: no
 * emulator, no device. What it proves that the engine tests cannot is that the
 * queue is genuinely durable - nothing here is held in memory between the two
 * halves of a "restart".
 */
@RunWith(RobolectricTestRunner::class)
class OfflineJourneyTest {

    private val projectId = 7L
    private val me = 1L

    private lateinit var context: Context
    private lateinit var server: FakeSitRepServer
    private var db: SitRepDatabase? = null

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        server = FakeSitRepServer()
        open()
    }

    @After
    fun tearDown() {
        db?.close()
    }

    /** Open (or re-open) the on-disk database. The file survives; nothing else does. */
    private fun open(): SitRepDatabase {
        db?.close()
        val fresh =
            Room.databaseBuilder(context, SitRepDatabase::class.java, "journey.db")
                .allowMainThreadQueries()
                .build()
        db = fresh
        return fresh
    }

    private fun repo() = TaskRepository(db!!)

    private fun engine() = SyncEngine(RoomLocalStore(db!!), FakeApi(server))

    /** Close everything and open a new database over the same file. */
    private fun killTheProcess() {
        open()
    }

    // ------------------------------------------------------------------ //

    @Test
    fun `create offline, die, reconnect, hit a browser edit, resolve it - one write each`() =
        runBlocking {
            // ---- 1. Offline. The user files a task from the phone. ----------
            server.offline = true
            val localId = repo().createTask(projectId, "Filed on the train", "Notes", "todo", me)

            assertEquals(1, db!!.outbox().count())
            assertEquals(1, db!!.tasks().count())
            val queuedToken = db!!.outbox().all().single().clientToken

            assertTrue(engine().drain() is SyncEngine.Outcome.Retry)
            assertEquals("nothing reached the server", 0, server.insertCount)

            // ---- 2. Process death. -----------------------------------------
            killTheProcess()

            // The queue is still there, with the same idempotency key, because
            // it lives in the database and not in a coroutine somebody killed.
            assertEquals(1, db!!.outbox().count())
            assertEquals(queuedToken, db!!.outbox().all().single().clientToken)
            assertEquals(OpState.PENDING.name, db!!.outbox().all().single().state)
            assertEquals("Filed on the train", db!!.tasks().byLocalId(localId)!!.title)

            // ---- 3. Network back. The create lands, exactly once. -----------
            server.offline = false
            assertEquals(SyncEngine.Outcome.Drained, engine().drain())
            assertEquals(1, server.insertCount)
            assertEquals(0, db!!.outbox().count())

            val afterCreate = db!!.tasks().byLocalId(localId)!!
            val serverTaskId = afterCreate.serverTaskId!!
            assertEquals(1, afterCreate.version)
            assertFalse(afterCreate.pending)

            // ---- 4. Offline again, and the user edits the task. -------------
            server.offline = true
            repo().editTask(localId, "Renamed on the phone", "Notes", "in-progress")
            assertEquals(1, db!!.outbox().count())
            assertEquals(1, db!!.outbox().all().single().baseVersion)
            assertTrue(engine().drain() is SyncEngine.Outcome.Retry)

            // A teammate moves the same card on the web while the phone is dark.
            server.browserEdit(serverTaskId, title = "Renamed in the browser")

            // ---- 5. Process death again, mid-conflict. ----------------------
            killTheProcess()
            assertEquals(1, db!!.outbox().count())

            // ---- 6. Reconnect. The server refuses the stale write. ----------
            server.offline = false
            assertEquals(SyncEngine.Outcome.NeedsUser(1), engine().drain())

            val conflicted = db!!.tasks().byLocalId(localId)!!
            assertTrue(conflicted.conflict)
            assertEquals("Renamed on the phone", conflicted.title)
            assertEquals("Renamed in the browser", conflicted.remoteTitle)
            assertEquals(2, conflicted.remoteVersion)
            assertEquals("the losing write did not land", 0, server.updateCount)

            // ---- 7. The user keeps their edit. ------------------------------
            repo().keepMine(localId)
            assertEquals(OpState.PENDING.name, db!!.outbox().all().single().state)
            assertEquals(2, db!!.outbox().all().single().baseVersion)

            assertEquals(SyncEngine.Outcome.Drained, engine().drain())

            // ---- 8. Exactly one create and one update reached the server. ---
            assertEquals(1, server.insertCount)
            assertEquals(1, server.updateCount)
            assertEquals(1, server.rows.size)
            val row = server.rows.getValue(serverTaskId)
            assertEquals("Renamed on the phone", row.title)
            assertEquals("in-progress", row.status)
            assertEquals(3, row.version)

            val settled = db!!.tasks().byLocalId(localId)!!
            assertFalse(settled.conflict)
            assertFalse(settled.pending)
            assertEquals(3, settled.version)
            assertEquals(0, db!!.outbox().count())
        }

    @Test
    fun `keep theirs drops the local edit and takes the server row`() = runBlocking {
        val serverTaskId = server.seed(projectId, "Original")
        engine().refresh(projectId)
        val localId = db!!.tasks().listProject(projectId).single().localId

        server.offline = true
        repo().editTask(localId, "Mine", null, "done")
        engine().drain()
        server.browserEdit(serverTaskId, title = "Theirs")
        server.offline = false
        engine().drain()

        assertTrue(db!!.tasks().byLocalId(localId)!!.conflict)

        repo().keepTheirs(localId)

        val row = db!!.tasks().byLocalId(localId)!!
        assertEquals("Theirs", row.title)
        assertFalse(row.conflict)
        assertFalse(row.pending)
        assertEquals(2, row.version)
        assertEquals("the local edit was dropped, not sent", 0, db!!.outbox().count())
        assertEquals(0, server.updateCount)
    }

    @Test
    fun `a second edit before the first has synced replaces it rather than queuing twice`() =
        runBlocking {
            server.offline = true
            val localId = repo().createTask(projectId, "First draft", null, "todo", me)
            repo().editTask(localId, "Second draft", null, "in-progress")

            assertEquals("one op, not two", 1, db!!.outbox().count())
            val op = db!!.outbox().all().single()
            assertEquals("CREATE", op.kind)
            assertEquals("Second draft", op.title)

            server.offline = false
            engine().drain()

            assertEquals(1, server.insertCount)
            assertEquals("Second draft", server.rows.values.single().title)
        }

    @Test
    fun `logout destroys every cached row and every queued write`() = runBlocking {
        server.offline = true
        repo().createTask(projectId, "Something private", null, "todo", me)
        engine().drain()
        assertTrue(db!!.tasks().count() > 0)
        assertTrue(db!!.outbox().count() > 0)

        repo().wipe()

        assertEquals(0, db!!.tasks().count())
        assertEquals(0, db!!.outbox().count())
        assertTrue(db!!.notices().all().isEmpty())

        // And it stays gone across a restart: the wipe is on disk, not in memory.
        killTheProcess()
        assertEquals(0, db!!.tasks().count())
        assertEquals(0, db!!.outbox().count())
    }

    @Test
    fun `a 401 during sync destroys the offline cache`() = runBlocking {
        server.seed(projectId, "Readable while signed in")
        engine().refresh(projectId)
        server.offline = true
        repo().createTask(projectId, "Queued", null, "todo", me)
        assertTrue(db!!.tasks().count() >= 2)

        server.offline = false
        server.sessionValid = false

        assertEquals(SyncEngine.Outcome.AuthLost, engine().drain())
        assertEquals(0, db!!.tasks().count())
        assertEquals(0, db!!.outbox().count())
    }

    @Test
    fun `losing membership refuses the queued write and clears that project locally`() =
        runBlocking {
            server.offline = true
            repo().createTask(projectId, "Filed before removal", null, "todo", me)
            engine().drain()

            server.revokedProjects += projectId
            server.offline = false

            assertEquals(SyncEngine.Outcome.Drained, engine().drain())

            assertEquals("the server wrote nothing", 0, server.insertCount)
            assertEquals(0, db!!.tasks().listProject(projectId).size)
            assertEquals(0, db!!.outbox().count())
            // The user is told rather than left wondering where the task went.
            assertEquals(1, db!!.notices().all().size)
            assertTrue(db!!.notices().all().single().message.contains("403"))
        }

    @Test
    fun `a refresh never overwrites a row that still has an unsent edit`() = runBlocking {
        val serverTaskId = server.seed(projectId, "Original")
        engine().refresh(projectId)
        val localId = db!!.tasks().listProject(projectId).single().localId

        server.offline = true
        repo().editTask(localId, "My unsent edit", null, "done")
        server.browserEdit(serverTaskId, title = "Server moved on")
        server.offline = false

        engine().refresh(projectId)

        val row = db!!.tasks().byLocalId(localId)!!
        assertEquals("My unsent edit", row.title)
        assertTrue(row.pending)
        assertNotNull(db!!.outbox().nextPending())
    }

    @Test
    fun `the conflict snapshot survives a restart so the user can still choose`() = runBlocking {
        val serverTaskId = server.seed(projectId, "Original")
        engine().refresh(projectId)
        val localId = db!!.tasks().listProject(projectId).single().localId

        server.offline = true
        repo().editTask(localId, "Mine", null, "done")
        engine().drain()
        server.browserEdit(serverTaskId, title = "Theirs")
        server.offline = false
        engine().drain()

        killTheProcess()

        val row = db!!.tasks().byLocalId(localId)!!
        assertTrue(row.conflict)
        assertEquals("Mine", row.title)
        assertEquals("Theirs", row.remoteTitle)
        assertEquals(OpState.CONFLICT.name, db!!.outbox().all().single().state)
        assertNull("a parked conflict is not resent on its own", db!!.outbox().nextPending())
    }
}
