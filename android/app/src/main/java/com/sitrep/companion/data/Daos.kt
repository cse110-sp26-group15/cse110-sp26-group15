package com.sitrep.companion.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {
    @Query("SELECT * FROM cached_tasks WHERE projectId = :projectId ORDER BY serverTaskId IS NULL DESC, serverTaskId ASC")
    fun observeProject(projectId: Long): Flow<List<CachedTaskEntity>>

    @Query("SELECT * FROM cached_tasks WHERE projectId = :projectId ORDER BY serverTaskId IS NULL DESC, serverTaskId ASC")
    suspend fun listProject(projectId: Long): List<CachedTaskEntity>

    @Query("SELECT * FROM cached_tasks WHERE localId = :localId")
    suspend fun byLocalId(localId: String): CachedTaskEntity?

    @Query("SELECT serverTaskId FROM cached_tasks WHERE localId = :localId")
    suspend fun serverIdFor(localId: String): Long?

    @Query("SELECT * FROM cached_tasks WHERE serverTaskId = :serverTaskId")
    suspend fun byServerId(serverTaskId: Long): CachedTaskEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(task: CachedTaskEntity)

    @Query("DELETE FROM cached_tasks WHERE projectId = :projectId")
    suspend fun deleteProject(projectId: Long)

    @Query("DELETE FROM cached_tasks WHERE localId = :localId")
    suspend fun deleteByLocalId(localId: String)

    @Query("DELETE FROM cached_tasks")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM cached_tasks")
    suspend fun count(): Int
}

@Dao
interface OutboxDao {
    @Query("SELECT * FROM outbox WHERE state = 'PENDING' ORDER BY opId ASC LIMIT 1")
    suspend fun nextPending(): OutboxEntity?

    @Query("SELECT * FROM outbox WHERE localId = :localId AND state = 'PENDING' ORDER BY opId ASC")
    suspend fun pendingFor(localId: String): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE opId = :opId")
    suspend fun byId(opId: Long): OutboxEntity?

    @Query("SELECT * FROM outbox WHERE state = 'CONFLICT' ORDER BY opId ASC")
    fun observeConflicts(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox ORDER BY opId ASC")
    suspend fun all(): List<OutboxEntity>

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'PENDING'")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'CONFLICT'")
    suspend fun conflictCount(): Int

    @Insert
    suspend fun insert(op: OutboxEntity): Long

    @Update
    suspend fun update(op: OutboxEntity)

    @Delete
    suspend fun delete(op: OutboxEntity)

    @Query("DELETE FROM outbox WHERE opId = :opId")
    suspend fun deleteById(opId: Long)

    @Query("DELETE FROM outbox WHERE projectId = :projectId")
    suspend fun deleteProject(projectId: Long)

    @Query("DELETE FROM outbox")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM outbox")
    suspend fun count(): Int
}

@Dao
interface NoticeDao {
    @Query("SELECT * FROM sync_notices ORDER BY noticeId DESC")
    fun observe(): Flow<List<NoticeEntity>>

    @Query("SELECT * FROM sync_notices ORDER BY noticeId DESC")
    suspend fun all(): List<NoticeEntity>

    @Insert
    suspend fun insert(notice: NoticeEntity)

    @Query("DELETE FROM sync_notices")
    suspend fun deleteAll()
}
