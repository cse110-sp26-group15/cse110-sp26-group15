package com.sitrep.companion.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sitrep.companion.SitRepApp
import com.sitrep.companion.net.SessionStore
import com.sitrep.companion.sync.LocalStore
import com.sitrep.companion.sync.SitRepApi
import com.sitrep.companion.sync.SyncEngine
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The only thing in the app that talks to the server about queued writes.
 *
 * WorkManager, not a coroutine tied to a screen, because the queue has to
 * survive the user leaving the app, the process being killed, and the phone
 * having no network for hours. The work is registered under a unique name so a
 * burst of edits collapses into one drain rather than N racing ones.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = SitRepApp.from(applicationContext)
        return drainWith(app.session, app.localStore, app.api)
    }

    /**
     * The whole body of [doWork], with its three collaborators passed in.
     *
     * Split out so an instrumented test can run the real worker against an
     * endpoint it controls - a closed port, say - instead of depending on
     * whether the developer happens to have `wrangler pages dev` running on the
     * host. That dependency is not hypothetical: it silently turned this
     * worker's "no network" test into a "server returned 401" test.
     */
    internal suspend fun drainWith(
        session: SessionStore,
        store: LocalStore,
        api: SitRepApi,
    ): Result {
        if (!session.isSignedIn) return Result.success()

        val engine = SyncEngine(store, api)
        return when (val outcome = engine.drain()) {
            // No network, a timeout or a 5xx. WorkManager backs off and calls
            // us again; the queue is untouched, so nothing is lost meanwhile.
            is SyncEngine.Outcome.Retry -> Result.retry()

            // The session is gone. The engine already destroyed cached content;
            // drop the credential too and stop retrying.
            SyncEngine.Outcome.AuthLost -> {
                withContext(Dispatchers.IO) { session.clear() }
                Result.success()
            }

            // Conflicts are parked for a person. Retrying cannot help, so this
            // run is a success even though work is outstanding.
            is SyncEngine.Outcome.NeedsUser -> Result.success()

            SyncEngine.Outcome.Drained -> {
                // Only pull the server's view once the outbox is empty, so a
                // refresh can never overwrite an edit that has not landed.
                session.projectId.takeIf { it > 0L }?.let { engine.refresh(it) }
                Result.success()
            }
        }
    }

    companion object {
        const val UNIQUE_NAME = "sitrep-sync"

        fun enqueue(context: Context) {
            val request =
                OneTimeWorkRequestBuilder<SyncWorker>()
                    .setConstraints(
                        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                    )
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
        }
    }
}
