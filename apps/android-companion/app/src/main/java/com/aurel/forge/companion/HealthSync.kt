package com.aurel.forge.companion

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

enum class HealthCategory(val label: String, val description: String) {
    STEPS("Steps", "Daily total steps"),
    HEART_RATE("Heart rate", "Daily range, average, and latest sample"),
    WEIGHT("Weight", "Latest daily body weight")
}

fun permissionsFor(categories: Set<HealthCategory>): Set<String> = buildSet {
    if (HealthCategory.STEPS in categories) add(HealthPermission.getReadPermission(StepsRecord::class))
    if (HealthCategory.HEART_RATE in categories) add(HealthPermission.getReadPermission(HeartRateRecord::class))
    if (HealthCategory.WEIGHT in categories) add(HealthPermission.getReadPermission(WeightRecord::class))
}

class HealthPayloadBuilder(private val context: Context) {
    private val client by lazy { HealthConnectClient.getOrCreate(context) }

    fun available(): Boolean = HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    suspend fun build(categories: Set<HealthCategory>, backgroundRefreshEnabled: Boolean): String {
        require(categories.isNotEmpty()) { "Select at least one Health Connect category." }
        require(available()) { "Health Connect is unavailable on this device." }
        val required = permissionsFor(categories)
        val granted = client.permissionController.getGrantedPermissions()
        require(granted.containsAll(required)) { "Grant the selected Health Connect permissions before syncing." }

        val zone = ZoneId.systemDefault()
        val date = LocalDate.now(zone)
        val start = date.atStartOfDay(zone).toInstant()
        val end = ZonedDateTime.now(zone).toInstant()
        val metrics = JSONArray()

        if (HealthCategory.STEPS in categories) {
            val records = client.readRecords(ReadRecordsRequest(StepsRecord::class, TimeRangeFilter.between(start, end))).records
            val total = records.sumOf { it.count }.toDouble()
            if (records.isNotEmpty()) metrics.put(metric("steps", "Steps", "activity", "count", "steps", "cumulative", total, total, total, total, total, records.size, records.maxOf { it.endTime }))
        }
        if (HealthCategory.HEART_RATE in categories) {
            val samples = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.between(start, end))).records.flatMap { it.samples }
            if (samples.isNotEmpty()) {
                val values = samples.map { it.beatsPerMinute.toDouble() }
                val latest = samples.maxBy { it.time }
                metrics.put(metric("heart_rate", "Heart rate", "cardiovascular", "count/min", "bpm", "discrete", values.average(), values.min(), values.max(), latest.beatsPerMinute.toDouble(), null, samples.size, latest.time))
            }
        }
        if (HealthCategory.WEIGHT in categories) {
            val records = client.readRecords(ReadRecordsRequest(WeightRecord::class, TimeRangeFilter.between(start, end))).records
            if (records.isNotEmpty()) {
                val values = records.map { it.weight.inKilograms }
                val latest = records.maxBy { it.time }
                metrics.put(metric("weight", "Weight", "body", "kg", "kg", "discrete", values.average(), values.min(), values.max(), latest.weight.inKilograms, null, records.size, latest.time))
            }
        }

        return JSONObject()
            .put("device", JSONObject().put("name", android.os.Build.MODEL).put("platform", "android").put("appVersion", BuildConfig.VERSION_NAME).put("sourceDevice", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL))
            .put("permissions", JSONObject().put("healthKitAuthorized", true).put("backgroundRefreshEnabled", backgroundRefreshEnabled).put("motionReady", false).put("locationReady", false).put("screenTimeReady", false))
            .put("vitals", JSONObject().put("daySummaries", JSONArray().put(JSONObject().put("dateKey", date.toString()).put("sourceTimezone", zone.id).put("metrics", metrics))))
            .put("sourceStates", JSONObject().put("health", JSONObject().put("desiredEnabled", true).put("appliedEnabled", true).put("authorizationStatus", "approved").put("syncEligible", true).put("lastObservedAt", Instant.now().toString()).put("metadata", JSONObject().put("provider", "android_health_connect").put("selectedCategories", JSONArray(categories.map { it.name.lowercase() })))))
            .toString()
    }

    private fun metric(metric: String, label: String, category: String, unit: String, displayUnit: String, aggregation: String, average: Double?, minimum: Double?, maximum: Double?, latest: Double?, total: Double?, count: Int, latestAt: Instant): JSONObject = JSONObject()
        .put("metric", metric).put("label", label).put("category", category).put("unit", unit).put("displayUnit", displayUnit).put("aggregation", aggregation)
        .put("average", average).put("minimum", minimum).put("maximum", maximum).put("latest", latest).put("total", total).put("sampleCount", count).put("latestSampleAt", latestAt.toString())
}
