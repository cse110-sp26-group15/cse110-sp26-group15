package com.sitrep.companion

import android.app.Application
import android.content.Context
import com.sitrep.companion.data.RoomLocalStore
import com.sitrep.companion.data.SitRepDatabase
import com.sitrep.companion.data.TaskRepository
import com.sitrep.companion.net.HttpSitRepApi
import com.sitrep.companion.net.SessionStore

/** Hand-wired dependencies. The app is small enough that a DI framework would be noise. */
class SitRepApp : Application() {

    val database: SitRepDatabase by lazy { SitRepDatabase.get(this) }
    val repository: TaskRepository by lazy { TaskRepository(database) }
    val localStore: RoomLocalStore by lazy { RoomLocalStore(database) }
    val session: SessionStore by lazy { SessionStore(this) }
    val api: HttpSitRepApi by lazy { HttpSitRepApi(BuildConfig.SITREP_BASE_URL, session) }

    companion object {
        /**
         * Resolve the dependency holder from any [Context].
         *
         * A worker must not cast its own `applicationContext` to this class.
         * `ListenableWorker.getApplicationContext()` returns whatever context the
         * factory that built the worker was handed, and androidx.work's own test
         * builder hands it the raw instrumentation `ContextImpl` - which is not an
         * [Application] at all, so the cast throws. Going through
         * [Context.getApplicationContext] is correct for both: on a base context it
         * resolves to the process's Application, and on the Application it returns
         * itself.
         */
        fun from(context: Context): SitRepApp = context.applicationContext as SitRepApp
    }
}
