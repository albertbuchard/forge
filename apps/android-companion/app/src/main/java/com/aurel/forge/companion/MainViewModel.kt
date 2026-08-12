package com.aurel.forge.companion

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class CompanionState(
    val pairing: PairingPayload? = null,
    val selectedCategories: Set<HealthCategory> = emptySet(),
    val syncEnabled: Boolean = false,
    val queue: List<SyncQueueItem> = emptyList(),
    val busy: Boolean = false,
    val notice: String? = null,
    val error: String? = null
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val context = application.applicationContext
    private val pairingStore = PairingStore(context)
    private val queue = SyncQueue(context)
    private val healthPreferences = context.getSharedPreferences("forge_health", Context.MODE_PRIVATE)
    private val mutableState = MutableStateFlow(
        CompanionState(
            pairing = pairingStore.load(),
            selectedCategories = healthPreferences.getStringSet("categories", emptySet()).orEmpty().mapNotNull { runCatching { HealthCategory.valueOf(it) }.getOrNull() }.toSet(),
            syncEnabled = healthPreferences.getBoolean("sync_enabled", false),
            queue = queue.list()
        )
    )
    val state: StateFlow<CompanionState> = mutableState.asStateFlow()

    fun pair(raw: String) = runBusy("Pairing verified.") {
        val payload = PairingPayload.parse(raw)
        ForgeApiClient().verify(payload)
        pairingStore.save(payload)
        mutableState.value = mutableState.value.copy(pairing = payload)
    }

    fun disconnect() {
        pairingStore.clear()
        queue.clear()
        healthPreferences.edit().putBoolean("sync_enabled", false).apply()
        SyncWorker.schedule(context, false)
        mutableState.value = mutableState.value.copy(pairing = null, syncEnabled = false, queue = emptyList(), notice = "This device is no longer paired. Its queued health payloads were deleted.", error = null)
    }

    fun toggleCategory(category: HealthCategory) {
        val next = mutableState.value.selectedCategories.toMutableSet().apply {
            if (!add(category)) remove(category)
        }.toSet()
        healthPreferences.edit().putStringSet("categories", next.map { it.name }.toSet()).apply()
        mutableState.value = mutableState.value.copy(selectedCategories = next, notice = null, error = null)
    }

    fun setSyncEnabled(enabled: Boolean) {
        healthPreferences.edit().putBoolean("sync_enabled", enabled).apply()
        SyncWorker.schedule(context, enabled)
        mutableState.value = mutableState.value.copy(syncEnabled = enabled, notice = if (enabled) "Background sync is enabled for the categories you selected." else "Background sync is paused.", error = null)
    }

    fun syncNow() = runBusy("Health Connect data synced.") {
        val pairing = mutableState.value.pairing ?: error("Pair this device before syncing.")
        val payload = HealthPayloadBuilder(context).build(
            mutableState.value.selectedCategories,
            mutableState.value.syncEnabled
        )
        queue.enqueue(payload)
        mutableState.value = mutableState.value.copy(queue = queue.list())
        drainSyncQueue(pairing, queue)
        mutableState.value = mutableState.value.copy(queue = queue.list())
    }

    fun retry(itemId: String) = runBusy("Queued sync retried.") {
        val pairing = mutableState.value.pairing ?: error("Pair this device before retrying.")
        queue.retry(itemId)
        drainSyncQueue(pairing, queue)
        mutableState.value = mutableState.value.copy(queue = queue.list())
    }

    fun discard(itemId: String) {
        queue.discard(itemId)
        mutableState.value = mutableState.value.copy(queue = queue.list(), notice = "Queued sync discarded.", error = null)
    }

    private fun runBusy(success: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(busy = true, notice = null, error = null)
            runCatching { withContext(Dispatchers.IO) { block() } }
                .onSuccess { mutableState.value = mutableState.value.copy(busy = false, notice = success, queue = queue.list()) }
                .onFailure { error -> mutableState.value = mutableState.value.copy(busy = false, error = error.message ?: "The operation failed.", queue = queue.list()) }
        }
    }
}
