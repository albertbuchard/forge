package com.aurel.forge.companion

import android.app.Application
import android.content.Context

class ForgeCompanionApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val enabled = getSharedPreferences("forge_health", Context.MODE_PRIVATE).getBoolean("sync_enabled", false)
        SyncWorker.schedule(this, enabled)
    }
}
