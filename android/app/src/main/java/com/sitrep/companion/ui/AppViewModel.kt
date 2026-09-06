package com.sitrep.companion.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.sitrep.companion.SitRepApp
import com.sitrep.companion.data.CachedTaskEntity
import com.sitrep.companion.data.NoticeEntity
import com.sitrep.companion.sync.SyncEngine
import com.sitrep.companion.work.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class UiState(
    val signedIn: Boolean = false,
    val email: String? = null,
    val projectId: Long = 0L,
    val projectName: String = "",
    val projects: List<Pair<Long, String>> = emptyList(),
    val tasks: List<CachedTaskEntity> = emptyList(),
    val pending: Int = 0,
    val notices: List<NoticeEntity> = emptyList(),
    val busy: Boolean = false,
    val message: String? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val app = application as SitRepApp
    private val repo = app.repository
    private val session = app.session

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private val projectIdFlow = MutableStateFlow(0L)

    init {
        _state.value =
            _state.value.copy(
                signedIn = session.isSignedIn,
                email = session.email,
                projectId = session.projectId,
            )
        projectIdFlow.value = session.projectId

        viewModelScope.launch {
            projectIdFlow
                .flatMapLatest { if (it == 0L) flowOf(emptyList()) else repo.observeTasks(it) }
                .collect { tasks -> _state.value = _state.value.copy(tasks = tasks) }
        }
        viewModelScope.launch {
            repo.observePendingCount().collect { _state.value = _state.value.copy(pending = it) }
        }
        viewModelScope.launch {
            repo.observeNotices().collect { _state.value = _state.value.copy(notices = it) }
        }
        if (session.isSignedIn) loadProjects()
    }

    fun login(email: String, password: String) {
        _state.value = _state.value.copy(busy = true, message = null)
        viewModelScope.launch {
            app.api
                .login(email, password)
                .onSuccess { result ->
                    // SessionStore writes the credential synchronously so it is
                    // durable when it returns, so keep it off the main thread.
                    withContext(Dispatchers.IO) {
                        session.token = result.token
                        session.userId = result.userId
                        session.email = email
                    }
                    _state.value =
                        _state.value.copy(signedIn = true, email = email, busy = false)
                    loadProjects()
                }
                .onFailure {
                    _state.value =
                        _state.value.copy(busy = false, message = it.message ?: "Sign-in failed")
                }
        }
    }

    fun logout() {
        viewModelScope.launch {
            SyncWorker.cancel(app)
            // Credential and cached content go together: anything readable
            // offline was readable because of the session that is ending.
            repo.wipe()
            withContext(Dispatchers.IO) { session.clear() }
            projectIdFlow.value = 0L
            _state.value = UiState(message = "Signed out. Offline copies were deleted.")
        }
    }

    private fun loadProjects() {
        viewModelScope.launch {
            app.api
                .listProjects()
                .onSuccess { projects ->
                    val chosen =
                        projects.firstOrNull { it.first == session.projectId } ?: projects.firstOrNull()
                    if (chosen != null) selectProject(chosen.first, chosen.second)
                    _state.value = _state.value.copy(projects = projects)
                }
                .onFailure {
                    _state.value =
                        _state.value.copy(message = "Offline: showing the last synced board.")
                }
        }
    }

    fun selectProject(projectId: Long, name: String) {
        session.projectId = projectId
        projectIdFlow.value = projectId
        _state.value = _state.value.copy(projectId = projectId, projectName = name)
        syncNow()
    }

    fun createTask(title: String, description: String?, status: String) {
        val projectId = _state.value.projectId
        if (projectId == 0L || title.isBlank()) return
        viewModelScope.launch {
            repo.createTask(projectId, title.trim(), description, status, session.userId)
            SyncWorker.enqueue(app)
        }
    }

    fun editTask(localId: String, title: String, description: String?, status: String) {
        viewModelScope.launch {
            repo.editTask(localId, title.trim(), description, status)
            SyncWorker.enqueue(app)
        }
    }

    fun keepMine(localId: String) {
        viewModelScope.launch {
            repo.keepMine(localId)
            SyncWorker.enqueue(app)
        }
    }

    fun keepTheirs(localId: String) {
        viewModelScope.launch { repo.keepTheirs(localId) }
    }

    fun dismissNotices() {
        viewModelScope.launch { repo.dismissNotices() }
    }

    /**
     * Foreground sync. Runs the same engine WorkManager runs, so a manual
     * "sync now" and a background pass cannot drift apart.
     */
    fun syncNow() {
        viewModelScope.launch {
            val engine = SyncEngine(app.localStore, app.api)
            val message =
                when (val outcome = engine.drain()) {
                    is SyncEngine.Outcome.Retry -> {
                        SyncWorker.enqueue(app)
                        "Offline. ${_state.value.pending} change(s) queued."
                    }
                    SyncEngine.Outcome.AuthLost -> {
                        withContext(Dispatchers.IO) { session.clear() }
                        projectIdFlow.value = 0L
                        _state.value = UiState()
                        "Session expired. Offline copies were deleted."
                    }
                    is SyncEngine.Outcome.NeedsUser ->
                        "${outcome.parked} change(s) need you to resolve a conflict."
                    SyncEngine.Outcome.Drained -> {
                        _state.value.projectId.takeIf { it > 0L }?.let { engine.refresh(it) }
                        "Up to date."
                    }
                }
            _state.value = _state.value.copy(message = message)
        }
    }
}
