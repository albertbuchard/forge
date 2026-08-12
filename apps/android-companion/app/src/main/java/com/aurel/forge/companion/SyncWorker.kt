package com.aurel.forge.companion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val pairing = PairingStore(applicationContext).load() ?: return Result.success()
        val preferences = applicationContext.getSharedPreferences("forge_health", Context.MODE_PRIVATE)
        if (!preferences.getBoolean("sync_enabled", false)) return Result.success()
        val categories = preferences.getStringSet("categories", emptySet()).orEmpty().mapNotNull { name -> runCatching { HealthCategory.valueOf(name) }.getOrNull() }.toSet()
        if (categories.isEmpty()) return Result.success()
        val queue = SyncQueue(applicationContext)
        return runCatching {
            drainSyncQueue(pairing, queue)
            queue.enqueue(HealthPayloadBuilder(applicationContext).build(categories, true))
            drainSyncQueue(pairing, queue)
            Result.success()
        }.getOrElse { Result.retry() }
    }

    companion object {
        private const val NAME = "forge-health-connect-sync"
        fun schedule(context: Context, enabled: Boolean) {
            val manager = WorkManager.getInstance(context)
            if (!enabled) {
                manager.cancelUniqueWork(NAME)
                return
            }
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build()
            manager.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}

fun drainSyncQueue(pairing: PairingPayload, queue: SyncQueue) {
    val client = ForgeApiClient()
    while (true) {
        val item = queue.next() ?: return
        queue.sending(item.id)
        try {
            client.sync(pairing, item.payloadJson)
            queue.complete(item.id)
        } catch (error: Throwable) {
            queue.failed(item.id, error.message ?: "Sync failed")
            throw error
        }
    }
}
