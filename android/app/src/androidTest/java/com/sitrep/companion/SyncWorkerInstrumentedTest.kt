package com.sitrep.companion

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import com.sitrep.companion.data.SitRepDatabase
import com.sitrep.companion.data.TaskRepository
import com.sitrep.companion.net.HttpSitRepApi
import com.sitrep.companion.work.SyncWorker
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The real WorkManager worker on a real device, against a server that is not
 * there.
 *
 * The engine's own behaviour is covered on the JVM; what only a device can show
 * is that the worker wiring is right - that a drain which cannot reach the
 * server comes back as [ListenableWorker.Result.Retry] (so WorkManager keeps
 * the job and backs off) rather than swallowing the queued write.
 */
@RunWith(AndroidJUnit4::class)
class SyncWorkerInstrumentedTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder()
                .setMinimumLoggingLevel(android.util.Log.DEBUG)
                .setExecutor(SynchronousExecutor())
                .build(),
        )
        val app = SitRepApp.from(context)
        runBlocking { app.repository.wipe() }
        app.session.clear()
    }

    @Test
    fun withNoSessionTheWorkerSucceedsWithoutTouchingTheNetwork() = runBlocking {
        val worker = TestListenableWorkerBuilder<SyncWorker>(context).build()
        assertEquals(ListenableWorker.Result.success(), worker.doWork())
    }

    @Test
    fun anUnreachableServerLeavesTheQueueIntactAndAsksForARetry() = runBlocking {
        val app = SitRepApp.from(context)
        app.session.token = "not-a-real-session-token"
        app.session.projectId = 1L

        val db: SitRepDatabase = app.database
        val repo = TaskRepository(db)
        repo.createTask(1L, "Queued with nothing listening", null, "todo", 1L)
        assertEquals(1, db.outbox().count())

        // Port 1 on the emulator's own loopback. Nothing can be listening there,
        // so this is a real OkHttp connect failure and not an assumption about
        // what is running on the developer's machine. BuildConfig.SITREP_BASE_URL
        // points at the host, and a `wrangler pages dev` left running there
        // answers 401/403 - which is a different, and correct, code path.
        val unreachable = HttpSitRepApi("http://127.0.0.1:1", app.session)
        val worker = TestListenableWorkerBuilder<SyncWorker>(context).build()
        val result = worker.drainWith(app.session, app.localStore, unreachable)

        assertEquals(ListenableWorker.Result.retry(), result)
        assertEquals("the queued write must survive a failed run", 1, db.outbox().count())
        assertTrue(db.outbox().all().single().attempts >= 1)

        repo.wipe()
        app.session.clear()
    }

    /**
     * The production path: enqueued through [SyncWorker.enqueue], constructed by
     * WorkManager's own worker factory, run by WorkManager's own runner.
     *
     * [TestListenableWorkerBuilder] hands the worker whatever context it was
     * given, so it is the harness that exposed the hard `applicationContext as
     * SitRepApp` cast. This test asks the sharper question: does the real
     * WorkManager path survive it? A worker that throws is recorded FAILED, and
     * a FAILED unique work item is never retried - the queued offline edits
     * would sit in the outbox forever with nothing telling the user.
     */
    @Test
    fun theRealWorkManagerPathRunsTheWorkerToACompletedState() {
        SyncWorker.enqueue(context)
        val manager = WorkManager.getInstance(context)
        val id = manager.getWorkInfosForUniqueWork(SyncWorker.UNIQUE_NAME).get().single().id
        WorkManagerTestInitHelper.getTestDriver(context)!!.setAllConstraintsMet(id)

        // A CoroutineWorker runs on its own dispatcher, so SynchronousExecutor
        // gets the run started but does not make it finish inline.
        val deadline = System.currentTimeMillis() + 10_000
        var state = manager.getWorkInfoById(id).get().state
        while (!state.isFinished && System.currentTimeMillis() < deadline) {
            Thread.sleep(50)
            state = manager.getWorkInfoById(id).get().state
        }
        assertEquals(
            "the worker must not crash on the real WorkManager path",
            WorkInfo.State.SUCCEEDED,
            state,
        )
    }
}
