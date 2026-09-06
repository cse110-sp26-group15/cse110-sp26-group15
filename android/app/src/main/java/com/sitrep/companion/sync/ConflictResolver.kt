package com.sitrep.companion.sync

/** What the client should do with a 409 the server just returned. */
enum class ConflictVerdict {
    /**
     * The server row already holds every value this op wanted to write. Either
     * this delivery is a replay of one that landed and whose response was lost,
     * or somebody made the identical edit first. Re-sending would be a second
     * write of a change that is already there, so the op is finished.
     */
    ALREADY_APPLIED,

    /**
     * The row moved somewhere this op did not intend. Only a person can say
     * whether their edit or the other one should win, so the op is parked.
     */
    NEEDS_DECISION,
}

/**
 * The one piece of judgement in the sync loop, kept as a pure function so it is
 * testable without a database, a network or an emulator.
 *
 * A 409 alone does not mean the user lost an edit. The server's compare-and-swap
 * (functions/api/tasks/[taskId].js) refuses any write whose `version` is not the
 * row's current one, and a retry of an op that already succeeded is exactly that
 * shape: the phone sends version N, the row is at N+1 because of its own earlier
 * delivery. Treating every 409 as a conflict would make an unreliable network
 * look like a colleague fighting you for the card.
 *
 * The conflict body carries the current row, so the two cases are separable:
 * compare the fields this op meant to write against what the row now holds.
 */
object ConflictResolver {

    fun classify(intended: TaskPayload, current: RemoteTask): ConflictVerdict {
        val same =
            current.title == intended.title &&
                normalize(current.description) == normalize(intended.description) &&
                current.status == intended.status &&
                (current.assignedTo == null || current.assignedTo == intended.assignedTo)
        return if (same) ConflictVerdict.ALREADY_APPLIED else ConflictVerdict.NEEDS_DECISION
    }

    /**
     * Rebase a parked op onto the server's row so "keep mine" re-submits the
     * user's values against a version the server will accept, instead of
     * bouncing off the same compare-and-swap forever.
     */
    fun keepMine(op: PendingOp, current: RemoteTask): PendingOp =
        op.copy(
            state = OpState.PENDING,
            baseVersion = current.version,
            serverTaskId = op.serverTaskId ?: current.taskId,
            attempts = 0,
        )

    /** An empty description and a missing one are the same edit. */
    private fun normalize(value: String?): String? = value?.takeIf { it.isNotEmpty() }
}
