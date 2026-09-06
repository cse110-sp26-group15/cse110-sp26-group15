package com.sitrep.companion.sync

/**
 * Drains the outbox against the SitRep API.
 *
 * The whole engine is ordinary Kotlin over two interfaces, so the behaviour
 * that actually matters - what happens to a queued write on 409, on 403, on
 * 401, on a dead network - is pinned by JVM unit tests rather than asserted.
 *
 * Ordering is strict and single-threaded: ops are drained oldest first and the
 * loop stops at the first one that needs the network back. Two edits to the
 * same task therefore reach the server in the order the user made them, and an
 * UPDATE queued behind an unsent CREATE never overtakes it.
 */
class SyncEngine(
    private val store: LocalStore,
    private val api: SitRepApi,
    private val maxOpsPerRun: Int = 200,
) {

    sealed interface Outcome {
        /** Queue drained. Nothing left that the network can fix. */
        data object Drained : Outcome

        /** Stopped on a transient failure. The caller should retry with backoff. */
        data class Retry(val reason: String) : Outcome

        /** 401. The session is gone and cached content has been destroyed. */
        data object AuthLost : Outcome

        /** Finished, but [parked] ops need a person to resolve a conflict. */
        data class NeedsUser(val parked: Int) : Outcome
    }

    suspend fun drain(): Outcome {
        var handled = 0

        while (handled < maxOpsPerRun) {
            val op = store.nextPending() ?: break
            handled += 1
            store.onAttempted(op)

            val result =
                when (op.kind) {
                    OpKind.CREATE -> api.createTask(op.projectId, op.payload, op.clientToken)
                    OpKind.UPDATE -> {
                        val taskId = op.serverTaskId ?: store.serverIdFor(op.localId)
                        if (taskId == null) {
                            // The CREATE this edit sits behind has not landed. It
                            // is ahead of us in the queue, so the only reason we
                            // are here is that it failed; stop and retry the run.
                            return Outcome.Retry("create for ${op.localId} has no server id yet")
                        }
                        // baseVersion is null only for an edit made against a
                        // row the phone has never seen from the server, which
                        // the queue cannot produce; treat it as version 1 rather
                        // than sending a versionless (last-write-wins) PATCH.
                        api.updateTask(taskId, op.payload, op.baseVersion ?: 1)
                    }
                }

            when (result) {
                is ApiResult.Ok -> store.onApplied(op, result.task)

                is ApiResult.Conflict ->
                    when (ConflictResolver.classify(op.payload, result.current)) {
                        // Our own earlier delivery already wrote this. Adopt the
                        // server's row (and its new version) and drop the op:
                        // re-sending is what would produce a duplicate write.
                        ConflictVerdict.ALREADY_APPLIED -> store.onApplied(op, result.current)
                        ConflictVerdict.NEEDS_DECISION -> store.onConflict(op, result.current)
                    }

                // Membership was revoked while the phone was offline. The server
                // refused the write at the execution boundary, which is the
                // authoritative answer; the client must not retry it, and must
                // stop showing that project's cached work.
                is ApiResult.Forbidden -> {
                    store.onRejected(op, 403, result.message)
                    store.onProjectAccessLost(op.projectId)
                }

                is ApiResult.NotFound -> store.onRejected(op, 404, "This task no longer exists.")

                is ApiResult.Rejected -> store.onRejected(op, result.status, result.message)

                ApiResult.Unauthorized -> {
                    store.onAuthLost()
                    return Outcome.AuthLost
                }

                is ApiResult.Unreachable -> return Outcome.Retry(result.cause)
            }
        }

        // Asked of the store rather than counted on this pass: a drain that
        // parks nothing because the queue holds only conflicts is still not
        // "up to date", and reporting Drained there let the screen say so while
        // an edit waited for a decision.
        val parked = store.parkedCount()
        return if (parked > 0) Outcome.NeedsUser(parked) else Outcome.Drained
    }

    /**
     * Pull the project's tasks down. Kept separate from [drain] because a
     * refresh must never run before the outbox is empty: overwriting the cache
     * with the server's view while a local edit is still queued would make the
     * user's own change disappear from the screen until it lands.
     */
    suspend fun refresh(projectId: Long): Outcome {
        val result = api.listTasks(projectId)
        return result.fold(
            onSuccess = {
                store.replaceProjectTasks(projectId, it)
                Outcome.Drained
            },
            onFailure = { Outcome.Retry(it.message ?: "refresh failed") },
        )
    }
}
