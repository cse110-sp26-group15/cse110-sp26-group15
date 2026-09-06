package com.sitrep.companion.sync

/**
 * A stand-in for the SitRep API that reproduces the two server rules the client
 * is built against, and nothing else.
 *
 * Those rules are not guessed: both are pinned against the real Cloudflare Pages
 * handlers with a real SQLite database in `source/tests/task-idempotency.test.js`
 * and `source/tests/task-concurrency.test.js`. What this fake buys is the
 * ability to make the *hard* deliveries happen on demand - a write that
 * commits and then loses its response, a membership revoked between two ops -
 * which a live server will not do to order.
 *
 *   1. UPDATE is compare-and-swap on `version`. A write whose version is not
 *      the row's current one changes nothing and comes back 409 with the row.
 *   2. CREATE is at-most-once per `client_token` per project.
 */
class FakeSitRepServer {

    /** taskId -> row. */
    val rows = linkedMapOf<Long, RemoteTask>()

    /** (projectId, client_token) -> taskId, the server's idempotency index. */
    private val tokens = mutableMapOf<Pair<Long, String>, Long>()

    /** taskId -> projectId. */
    private val owner = mutableMapOf<Long, Long>()

    private var nextId = 1L

    // Fault injection.
    var offline = false
    var sessionValid = true
    var revokedProjects = mutableSetOf<Long>()

    /**
     * When true the next mutating call commits and then reports the network
     * dying, which is exactly the case that makes a naive retry duplicate.
     */
    var loseNextResponse = false

    // Observability for the tests.
    var insertCount = 0
        private set

    var updateCount = 0
        private set

    val seenClientTokens = mutableListOf<String>()

    fun seed(projectId: Long, title: String, status: String = "todo", assignedTo: Long = 1L): Long {
        val id = nextId++
        rows[id] = RemoteTask(id, title, null, status, 1, assignedTo, "Alice")
        owner[id] = projectId
        return id
    }

    fun create(projectId: Long, payload: TaskPayload, clientToken: String): ApiResult {
        seenClientTokens += clientToken
        if (offline) return ApiResult.Unreachable("no route to host")
        if (!sessionValid) return ApiResult.Unauthorized
        if (projectId in revokedProjects) {
            return ApiResult.Forbidden("You do not have access to this project.")
        }

        tokens[projectId to clientToken]?.let { existing ->
            // The replay path: a read of the row the first delivery created.
            return ApiResult.Ok(rows.getValue(existing), replay = true)
        }

        val id = nextId++
        insertCount += 1
        val row =
            RemoteTask(id, payload.title, payload.description, payload.status, 1, payload.assignedTo, "Alice")
        rows[id] = row
        owner[id] = projectId
        tokens[projectId to clientToken] = id
        return if (loseNextResponse) {
            loseNextResponse = false
            ApiResult.Unreachable("connection reset after commit")
        } else {
            ApiResult.Ok(row)
        }
    }

    fun update(taskId: Long, payload: TaskPayload, version: Int): ApiResult {
        if (offline) return ApiResult.Unreachable("no route to host")
        if (!sessionValid) return ApiResult.Unauthorized
        val projectId = owner[taskId]
        if (projectId != null && projectId in revokedProjects) {
            return ApiResult.Forbidden("You do not have access to this project.")
        }
        val current = rows[taskId] ?: return ApiResult.NotFound

        // UPDATE tasks SET ..., version = version + 1 WHERE task_id = ? AND version = ?
        if (current.version != version) return ApiResult.Conflict(current)

        updateCount += 1
        val next =
            current.copy(
                title = payload.title,
                description = payload.description,
                status = payload.status,
                assignedTo = payload.assignedTo,
                version = current.version + 1,
            )
        rows[taskId] = next
        return if (loseNextResponse) {
            loseNextResponse = false
            ApiResult.Unreachable("connection reset after commit")
        } else {
            ApiResult.Ok(next)
        }
    }

    /** Somebody edits the task on the web while the phone is away. */
    fun browserEdit(taskId: Long, title: String? = null, status: String? = null) {
        val current = rows.getValue(taskId)
        rows[taskId] =
            current.copy(
                title = title ?: current.title,
                status = status ?: current.status,
                version = current.version + 1,
            )
    }

    fun tasksIn(projectId: Long): List<RemoteTask> =
        rows.values.filter { owner[it.taskId] == projectId }
}

class FakeApi(private val server: FakeSitRepServer) : SitRepApi {
    override suspend fun createTask(projectId: Long, payload: TaskPayload, clientToken: String) =
        server.create(projectId, payload, clientToken)

    override suspend fun updateTask(taskId: Long, payload: TaskPayload, baseVersion: Int) =
        server.update(taskId, payload, baseVersion)

    override suspend fun listTasks(projectId: Long): Result<List<RemoteTask>> =
        if (server.offline) Result.failure(java.io.IOException("offline"))
        else Result.success(server.tasksIn(projectId))
}

/**
 * In-memory [LocalStore]. Room's own implementation is exercised separately in
 * `RoomLocalStoreTest`; this one keeps the engine tests about the engine.
 */
class InMemoryStore : LocalStore {
    val ops = mutableListOf<PendingOp>()
    val cached = linkedMapOf<String, RemoteTask>()
    val serverIds = mutableMapOf<String, Long>()
    val rejected = mutableListOf<Triple<Long, Int, String>>()
    val conflicts = mutableListOf<Pair<Long, RemoteTask>>()
    val attempts = mutableMapOf<Long, Int>()
    var authLost = false
    val projectsLost = mutableListOf<Long>()

    private var nextOpId = 1L

    fun enqueue(op: PendingOp): PendingOp {
        val stored = op.copy(opId = nextOpId++)
        ops += stored
        return stored
    }

    fun op(opId: Long): PendingOp? = ops.firstOrNull { it.opId == opId }

    override suspend fun nextPending(): PendingOp? = ops.firstOrNull { it.state == OpState.PENDING }

    override suspend fun serverIdFor(localId: String): Long? = serverIds[localId]

    override suspend fun onApplied(op: PendingOp, task: RemoteTask) {
        ops.removeAll { it.opId == op.opId }
        cached[op.localId] = task
        serverIds[op.localId] = task.taskId
    }

    override suspend fun onConflict(op: PendingOp, current: RemoteTask) {
        replace(op.copy(state = OpState.CONFLICT))
        conflicts += op.opId to current
        serverIds[op.localId] = current.taskId
    }

    override suspend fun onRejected(op: PendingOp, status: Int, message: String) {
        replace(op.copy(state = OpState.REJECTED))
        rejected += Triple(op.opId, status, message)
    }

    override suspend fun onAttempted(op: PendingOp) {
        attempts[op.opId] = (attempts[op.opId] ?: 0) + 1
        replace(op.copy(attempts = attempts.getValue(op.opId)))
    }

    override suspend fun onAuthLost() {
        authLost = true
        ops.clear()
        cached.clear()
        serverIds.clear()
    }

    override suspend fun onProjectAccessLost(projectId: Long) {
        projectsLost += projectId
        ops.removeAll { it.projectId == projectId && it.state == OpState.PENDING }
        val gone = cached.filterValues { false }.keys
        gone.forEach { cached.remove(it) }
    }

    override suspend fun parkedCount(): Int = ops.count { it.state == OpState.CONFLICT }

    override suspend fun replaceProjectTasks(projectId: Long, tasks: List<RemoteTask>) {
        tasks.forEach { cached["server-${it.taskId}"] = it }
    }

    private fun replace(op: PendingOp) {
        val i = ops.indexOfFirst { it.opId == op.opId }
        if (i >= 0) ops[i] = op
    }
}
