package com.sitrep.companion.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * The task as the phone shows it: the server's last known row with any unsent
 * local edit already applied on top, so the board reads the same before and
 * after a reboot.
 *
 * `localId` rather than the server's `task_id` is the primary key because a
 * task created offline has no server id yet, and everything that references it
 * (the queued op, the screen the user is looking at) has to keep working until
 * the create lands.
 */
@Entity(tableName = "cached_tasks", indices = [Index("projectId"), Index("serverTaskId")])
data class CachedTaskEntity(
    @PrimaryKey val localId: String,
    val serverTaskId: Long?,
    val projectId: Long,
    val title: String,
    val description: String?,
    val status: String,
    val assignedTo: Long,
    val assigneeName: String?,
    /** The server's `version` for this row, or null while it has never been sent. */
    val version: Int?,
    /** True while an unsent edit is sitting in the outbox for this task. */
    val pending: Boolean = false,
    /** True when the server refused an edit on `version` and a person must choose. */
    val conflict: Boolean = false,
    // The server's side of an unresolved conflict, shown next to the local edit.
    val remoteTitle: String? = null,
    val remoteDescription: String? = null,
    val remoteStatus: String? = null,
    val remoteVersion: Int? = null,
)

/**
 * The durable write queue. A row here means "the user changed something and the
 * server has not accepted it yet"; nothing else in the app is allowed to be the
 * record of an unsent edit, which is what makes process death survivable.
 */
@Entity(tableName = "outbox", indices = [Index("localId"), Index("state")])
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val opId: Long = 0,
    /** "CREATE" or "UPDATE". */
    val kind: String,
    val localId: String,
    val serverTaskId: Long?,
    val projectId: Long,
    /**
     * Idempotency key. Generated once, when the op is queued, and re-sent
     * unchanged on every retry - so a create whose response was lost is
     * recognised by the server instead of inserted twice.
     */
    val clientToken: String,
    /** The `version` the edit was built from. Null for a create. */
    val baseVersion: Int?,
    val title: String,
    val description: String?,
    val status: String,
    val assignedTo: Long,
    val attempts: Int = 0,
    /** "PENDING", "CONFLICT" or "REJECTED". */
    val state: String = "PENDING",
    val queuedAt: Long = System.currentTimeMillis(),
)

/** Something the user needs to be told about a queued write that will never land. */
@Entity(tableName = "sync_notices")
data class NoticeEntity(
    @PrimaryKey(autoGenerate = true) val noticeId: Long = 0,
    val message: String,
    val at: Long = System.currentTimeMillis(),
)
