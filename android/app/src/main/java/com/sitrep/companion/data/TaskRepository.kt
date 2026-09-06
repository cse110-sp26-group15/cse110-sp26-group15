package com.sitrep.companion.data

import com.sitrep.companion.sync.ConflictResolver
import com.sitrep.companion.sync.OpKind
import com.sitrep.companion.sync.OpState
import com.sitrep.companion.sync.RemoteTask
import java.util.UUID
import kotlinx.coroutines.flow.Flow

/**
 * Everything the UI is allowed to do to local state.
 *
 * The rule the whole design rests on: a user action writes to Room and returns.
 * It never waits on the network and never fails because the network is down.
 * Sync is a separate, retryable job reading the same rows.
 */
class TaskRepository(private val db: SitRepDatabase) {

    private val tasks = db.tasks()
    private val outbox = db.outbox()
    private val notices = db.notices()

    fun observeTasks(projectId: Long): Flow<List<CachedTaskEntity>> = tasks.observeProject(projectId)

    fun observePendingCount(): Flow<Int> = outbox.observePendingCount()

    fun observeNotices(): Flow<List<NoticeEntity>> = notices.observe()

    /** Queue a new task. Returns the local id the UI can keep showing immediately. */
    suspend fun createTask(
        projectId: Long,
        title: String,
        description: String?,
        status: String,
        assignedTo: Long,
    ): String {
        val localId = UUID.randomUUID().toString()
        tasks.upsert(
            CachedTaskEntity(
                localId = localId,
                serverTaskId = null,
                projectId = projectId,
                title = title,
                description = description,
                status = status,
                assignedTo = assignedTo,
                assigneeName = null,
                version = null,
                pending = true,
            )
        )
        outbox.insert(
            OutboxEntity(
                kind = OpKind.CREATE.name,
                localId = localId,
                serverTaskId = null,
                projectId = projectId,
                // One token per queued create, generated here and never
                // regenerated: a retry must carry the same one or the server
                // cannot tell a replay from a new task.
                clientToken = UUID.randomUUID().toString(),
                baseVersion = null,
                title = title,
                description = description,
                status = status,
                assignedTo = assignedTo,
            )
        )
        return localId
    }

    /**
     * Queue an edit.
     *
     * A second edit to a task that still has an unsent op is folded into that
     * op rather than appended behind it. Two reasons: an UPDATE queued behind an
     * unsent CREATE has no task id to address, and sending "A then B" when the
     * user only ever wanted B is two writes where one will do.
     */
    suspend fun editTask(localId: String, title: String, description: String?, status: String) {
        val row = tasks.byLocalId(localId) ?: return
        tasks.upsert(row.copy(title = title, description = description, status = status, pending = true))

        val existing = outbox.pendingFor(localId).firstOrNull()
        if (existing != null) {
            outbox.update(existing.copy(title = title, description = description, status = status))
            return
        }
        outbox.insert(
            OutboxEntity(
                kind = OpKind.UPDATE.name,
                localId = localId,
                serverTaskId = row.serverTaskId,
                projectId = row.projectId,
                clientToken = UUID.randomUUID().toString(),
                // The version this edit was built from. The server refuses the
                // write unless the row is still on it.
                baseVersion = row.version,
                title = title,
                description = description,
                status = status,
                assignedTo = row.assignedTo,
            )
        )
    }

    /** Conflict resolution: re-submit the user's values against the server's version. */
    suspend fun keepMine(localId: String) {
        val row = tasks.byLocalId(localId) ?: return
        val op = outbox.pendingOrConflictedFor(localId) ?: return
        val remote =
            RemoteTask(
                taskId = row.serverTaskId ?: return,
                title = row.remoteTitle.orEmpty(),
                description = row.remoteDescription,
                status = row.remoteStatus ?: row.status,
                version = row.remoteVersion ?: return,
                assignedTo = row.assignedTo,
                assigneeName = row.assigneeName,
            )
        val rebased = ConflictResolver.keepMine(op.toOp(), remote)
        outbox.update(
            op.copy(
                state = rebased.state.name,
                baseVersion = rebased.baseVersion,
                serverTaskId = rebased.serverTaskId,
                attempts = rebased.attempts,
            )
        )
        tasks.upsert(row.copy(conflict = false, pending = true))
    }

    /** Conflict resolution: throw away the local edit and take the server's row. */
    suspend fun keepTheirs(localId: String) {
        val row = tasks.byLocalId(localId) ?: return
        outbox.pendingOrConflictedFor(localId)?.let { outbox.delete(it) }
        tasks.upsert(
            row.copy(
                title = row.remoteTitle ?: row.title,
                description = row.remoteDescription,
                status = row.remoteStatus ?: row.status,
                version = row.remoteVersion ?: row.version,
                pending = false,
                conflict = false,
                remoteTitle = null,
                remoteDescription = null,
                remoteStatus = null,
                remoteVersion = null,
            )
        )
    }

    suspend fun dismissNotices() = notices.deleteAll()

    /**
     * Logout. Every cached task, every queued write and every notice is
     * destroyed, so nothing the previous session could see survives on the
     * device. The caller clears the credential itself.
     */
    suspend fun wipe() {
        tasks.deleteAll()
        outbox.deleteAll()
        notices.deleteAll()
    }
}

/** The op the conflict UI is about: still pending, or parked as a conflict. */
private suspend fun OutboxDao.pendingOrConflictedFor(localId: String): OutboxEntity? =
    all().firstOrNull { it.localId == localId && it.state != OpState.REJECTED.name }
