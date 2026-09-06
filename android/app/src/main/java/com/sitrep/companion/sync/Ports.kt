package com.sitrep.companion.sync

/**
 * The two seams the sync engine talks through. Room implements [LocalStore] and
 * OkHttp implements [SitRepApi] in the app; the JVM tests implement both with
 * in-memory fakes, which is why the engine's behaviour can be pinned without an
 * emulator.
 */

interface SitRepApi {
    /**
     * POST /api/projects/:projectId/tasks with `client_token` set, so a replay
     * of the same queued op returns the row the first delivery created instead
     * of inserting a second one.
     */
    suspend fun createTask(projectId: Long, payload: TaskPayload, clientToken: String): ApiResult

    /**
     * PATCH /api/tasks/:taskId with `version` set to the value the edit was
     * built from, so the server refuses a stale write rather than clobbering.
     */
    suspend fun updateTask(taskId: Long, payload: TaskPayload, baseVersion: Int): ApiResult

    /** GET /api/projects/:projectId/tasks. */
    suspend fun listTasks(projectId: Long): Result<List<RemoteTask>>
}

interface LocalStore {
    /** The oldest op still in [OpState.PENDING], or null when the queue is drained. */
    suspend fun nextPending(): PendingOp?

    /** The server id a CREATE earned for [localId], once it has one. */
    suspend fun serverIdFor(localId: String): Long?

    /** The op landed: cache the server's row and remove the op from the queue. */
    suspend fun onApplied(op: PendingOp, task: RemoteTask)

    /** The op needs a human: cache the server's row alongside the local edit. */
    suspend fun onConflict(op: PendingOp, current: RemoteTask)

    /** The op can never succeed. It stays visible so the user is told. */
    suspend fun onRejected(op: PendingOp, status: Int, message: String)

    /** Record an attempt so the UI can show that sync is trying. */
    suspend fun onAttempted(op: PendingOp)

    /**
     * The session is gone (401 or an explicit logout). Every cached task and
     * every queued op is destroyed: offline visibility must not outlive the
     * credential that earned it.
     */
    suspend fun onAuthLost()

    /**
     * The caller is no longer a member of [projectId]. The server has already
     * refused the write; the client drops that project's cached rows so the
     * phone stops showing work the user can no longer see on the web.
     */
    suspend fun onProjectAccessLost(projectId: Long)

    /** Replace the cached rows for a project with what the server just returned. */
    suspend fun replaceProjectTasks(projectId: Long, tasks: List<RemoteTask>)
}
