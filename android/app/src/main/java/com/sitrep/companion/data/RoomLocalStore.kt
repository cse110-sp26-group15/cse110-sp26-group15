package com.sitrep.companion.data

import com.sitrep.companion.sync.LocalStore
import com.sitrep.companion.sync.OpKind
import com.sitrep.companion.sync.OpState
import com.sitrep.companion.sync.PendingOp
import com.sitrep.companion.sync.RemoteTask
import com.sitrep.companion.sync.TaskPayload

/** Room-backed implementation of the engine's durable side. */
class RoomLocalStore(db: SitRepDatabase) : LocalStore {

    private val tasks = db.tasks()
    private val outbox = db.outbox()
    private val notices = db.notices()

    override suspend fun nextPending(): PendingOp? = outbox.nextPending()?.toOp()

    override suspend fun serverIdFor(localId: String): Long? = tasks.serverIdFor(localId)

    override suspend fun onApplied(op: PendingOp, task: RemoteTask) {
        outbox.deleteById(op.opId)
        val existing = tasks.byLocalId(op.localId)
        // Another edit to the same task may already be queued behind this one.
        val stillPending = outbox.pendingFor(op.localId).isNotEmpty()
        tasks.upsert(
            (existing ?: newRow(op)).copy(
                serverTaskId = task.taskId,
                title = task.title,
                description = task.description,
                status = task.status,
                assignedTo = task.assignedTo ?: op.payload.assignedTo,
                assigneeName = task.assigneeName ?: existing?.assigneeName,
                version = task.version,
                pending = stillPending,
                conflict = false,
                remoteTitle = null,
                remoteDescription = null,
                remoteStatus = null,
                remoteVersion = null,
            )
        )
    }

    override suspend fun onConflict(op: PendingOp, current: RemoteTask) {
        outbox.byId(op.opId)?.let { outbox.update(it.copy(state = OpState.CONFLICT.name)) }
        val existing = tasks.byLocalId(op.localId) ?: newRow(op)
        tasks.upsert(
            existing.copy(
                serverTaskId = current.taskId,
                pending = true,
                conflict = true,
                remoteTitle = current.title,
                remoteDescription = current.description,
                remoteStatus = current.status,
                remoteVersion = current.version,
            )
        )
    }

    override suspend fun onRejected(op: PendingOp, status: Int, message: String) {
        outbox.byId(op.opId)?.let { outbox.update(it.copy(state = OpState.REJECTED.name)) }
        notices.insert(NoticeEntity(message = "“${op.payload.title}” ($status): $message"))
    }

    override suspend fun onAttempted(op: PendingOp) {
        outbox.byId(op.opId)?.let { outbox.update(it.copy(attempts = it.attempts + 1)) }
    }

    override suspend fun onAuthLost() {
        // Offline visibility must not outlive the credential that earned it.
        tasks.deleteAll()
        outbox.deleteAll()
    }

    override suspend fun onProjectAccessLost(projectId: Long) {
        tasks.deleteProject(projectId)
        outbox.deleteProject(projectId)
    }

    override suspend fun parkedCount(): Int = outbox.conflictCount()

    override suspend fun replaceProjectTasks(projectId: Long, remote: List<RemoteTask>) {
        // A row carrying an unsent local edit is left exactly as it is: taking
        // the server's copy would wipe the user's own change off the screen
        // before it had a chance to land.
        val local = tasks.listProject(projectId)
        val untouchable = local.filter { it.pending || it.conflict }
        val protectedServerIds = untouchable.mapNotNull { it.serverTaskId }.toSet()

        for (row in local) {
            if (row.pending || row.conflict) continue
            tasks.deleteByLocalId(row.localId)
        }

        for (task in remote) {
            if (task.taskId in protectedServerIds) continue
            tasks.upsert(
                CachedTaskEntity(
                    localId = "server-${task.taskId}",
                    serverTaskId = task.taskId,
                    projectId = projectId,
                    title = task.title,
                    description = task.description,
                    status = task.status,
                    assignedTo = task.assignedTo ?: 0L,
                    assigneeName = task.assigneeName,
                    version = task.version,
                )
            )
        }
    }

    private fun newRow(op: PendingOp) =
        CachedTaskEntity(
            localId = op.localId,
            serverTaskId = op.serverTaskId,
            projectId = op.projectId,
            title = op.payload.title,
            description = op.payload.description,
            status = op.payload.status,
            assignedTo = op.payload.assignedTo,
            assigneeName = null,
            version = op.baseVersion,
        )
}

fun OutboxEntity.toOp(): PendingOp =
    PendingOp(
        opId = opId,
        kind = OpKind.valueOf(kind),
        localId = localId,
        serverTaskId = serverTaskId,
        projectId = projectId,
        clientToken = clientToken,
        baseVersion = baseVersion,
        payload = TaskPayload(title, description, status, assignedTo),
        attempts = attempts,
        state = OpState.valueOf(state),
    )
