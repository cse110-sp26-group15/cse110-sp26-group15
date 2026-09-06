package com.sitrep.companion.sync

/**
 * The sync vocabulary. Deliberately free of Android imports so the engine that
 * uses it runs under a plain JVM JUnit test, with no emulator and no
 * Robolectric.
 */

/** The mutable half of a task: what an edit on the phone can change. */
data class TaskPayload(
    val title: String,
    val description: String?,
    val status: String,
    val assignedTo: Long,
)

/** A task as the server describes it, including the row's current version. */
data class RemoteTask(
    val taskId: Long,
    val title: String,
    val description: String?,
    val status: String,
    val version: Int,
    val assignedTo: Long?,
    val assigneeName: String?,
)

enum class OpKind { CREATE, UPDATE }

enum class OpState {
    /** Waiting for the network. The only state the engine will send. */
    PENDING,

    /** The server refused on `version` and a human has to choose. */
    CONFLICT,

    /** The server refused permanently (403, 404, 4xx). Never retried. */
    REJECTED,
}

/**
 * One queued write. Durable: this is what survives process death, so it carries
 * everything needed to re-send without any in-memory state.
 *
 * @param localId Stable client-side identity for the task, assigned before the
 *   server knows about it, so an UPDATE queued behind an unsent CREATE still
 *   knows which row it is about.
 * @param clientToken The idempotency key sent as `client_token` on CREATE. It
 *   is generated once, when the op is queued, and reused on every retry: that
 *   is what makes a replayed create at-most-once at the server.
 * @param baseVersion The `version` the edit was built from. Sent on UPDATE so
 *   the server's compare-and-swap can refuse a stale write. Null for CREATE.
 */
data class PendingOp(
    val opId: Long,
    val kind: OpKind,
    val localId: String,
    val serverTaskId: Long?,
    val projectId: Long,
    val clientToken: String,
    val baseVersion: Int?,
    val payload: TaskPayload,
    val attempts: Int = 0,
    val state: OpState = OpState.PENDING,
)

/**
 * Everything the transport can tell the engine, normalized off HTTP so tests
 * can produce any of these without a socket.
 */
sealed interface ApiResult {
    /** 200 or 201. `replay` is the server's `idempotent_replay` flag. */
    data class Ok(val task: RemoteTask, val replay: Boolean = false) : ApiResult

    /** 409 from the version compare-and-swap. Carries the row as it stands. */
    data class Conflict(val current: RemoteTask) : ApiResult

    /** 401: the session is gone. Cached content must not stay readable. */
    data object Unauthorized : ApiResult

    /** 403: not a member of the project any more (or never was). */
    data class Forbidden(val message: String) : ApiResult

    /** 404: the task was deleted server-side. */
    data object NotFound : ApiResult

    /** Any other 4xx: a permanently bad request. Retrying cannot help. */
    data class Rejected(val status: Int, val message: String) : ApiResult

    /** No network, a timeout, or a 5xx. Retrying is the right move. */
    data class Unreachable(val cause: String) : ApiResult
}
