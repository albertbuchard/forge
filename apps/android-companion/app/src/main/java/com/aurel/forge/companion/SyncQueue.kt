package com.aurel.forge.companion

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

data class SyncQueueItem(
    val id: String,
    val payloadJson: String,
    val state: String,
    val attempts: Int,
    val lastError: String?,
    val createdAt: Long
)

class SyncQueue(context: Context) : SQLiteOpenHelper(context, "forge-sync-queue.db", null, 1) {
    private val cipher = SecurePayloadCipher("forge_android_sync_queue_v1")

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """CREATE TABLE sync_queue (
                id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('pending','sending','failed')),
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL
            )""".trimIndent()
        )
        database.execSQL("CREATE INDEX sync_queue_state_created ON sync_queue(state, created_at)")
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    override fun onOpen(database: SQLiteDatabase) {
        super.onOpen(database)
        database.execSQL("UPDATE sync_queue SET state='pending' WHERE state='sending'")
    }

    fun enqueue(payloadJson: String): String {
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("sync_queue", null, ContentValues().apply {
            put("id", id)
            put("payload_json", cipher.encrypt(payloadJson))
            put("state", "pending")
            put("created_at", System.currentTimeMillis())
        })
        writableDatabase.execSQL(
            "DELETE FROM sync_queue WHERE id IN (SELECT id FROM sync_queue ORDER BY created_at DESC LIMIT -1 OFFSET 500)"
        )
        return id
    }

    fun list(): List<SyncQueueItem> = readableDatabase.rawQuery(
        "SELECT id, payload_json, state, attempts, last_error, created_at FROM sync_queue ORDER BY created_at DESC LIMIT 100",
        emptyArray()
    ).use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(SyncQueueItem(cursor.getString(0), cipher.decrypt(cursor.getString(1)), cursor.getString(2), cursor.getInt(3), cursor.getString(4), cursor.getLong(5)))
        }
    }

    fun next(): SyncQueueItem? = readableDatabase.rawQuery(
        "SELECT id, payload_json, state, attempts, last_error, created_at FROM sync_queue WHERE state IN ('pending','failed') ORDER BY created_at LIMIT 1",
        emptyArray()
    ).use { cursor ->
        if (!cursor.moveToFirst()) null else SyncQueueItem(cursor.getString(0), cipher.decrypt(cursor.getString(1)), cursor.getString(2), cursor.getInt(3), cursor.getString(4), cursor.getLong(5))
    }

    fun sending(id: String) = writableDatabase.execSQL("UPDATE sync_queue SET state='sending', attempts=attempts+1, last_error=NULL WHERE id=?", arrayOf(id))
    fun failed(id: String, error: String) = writableDatabase.execSQL("UPDATE sync_queue SET state='failed', last_error=? WHERE id=?", arrayOf(error.take(500), id))
    fun complete(id: String) = writableDatabase.delete("sync_queue", "id=?", arrayOf(id))
    fun retry(id: String) = writableDatabase.execSQL("UPDATE sync_queue SET state='pending', last_error=NULL WHERE id=?", arrayOf(id))
    fun discard(id: String) = writableDatabase.delete("sync_queue", "id=?", arrayOf(id))
    fun clear() = writableDatabase.delete("sync_queue", null, null)
}
