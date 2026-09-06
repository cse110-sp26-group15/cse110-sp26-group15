package com.sitrep.companion.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [CachedTaskEntity::class, OutboxEntity::class, NoticeEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class SitRepDatabase : RoomDatabase() {
    abstract fun tasks(): TaskDao
    abstract fun outbox(): OutboxDao
    abstract fun notices(): NoticeDao

    companion object {
        @Volatile private var instance: SitRepDatabase? = null

        fun get(context: Context): SitRepDatabase =
            instance
                ?: synchronized(this) {
                    instance
                        ?: Room.databaseBuilder(
                                context.applicationContext,
                                SitRepDatabase::class.java,
                                "sitrep-companion.db",
                            )
                            .build()
                            .also { instance = it }
                }
    }
}
