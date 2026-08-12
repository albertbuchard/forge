package com.aurel.forge.companion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

class ForgeApiClient {
    fun verify(pairing: PairingPayload) {
        post(pairing, "/mobile/pairing/verify", JSONObject()
            .put("sessionId", pairing.sessionId)
            .put("pairingToken", pairing.pairingToken)
            .put("device", device()))
    }

    fun sync(pairing: PairingPayload, payloadJson: String) {
        post(
            pairing,
            "/mobile/healthkit/sync",
            JSONObject(payloadJson)
                .put("sessionId", pairing.sessionId)
                .put("pairingToken", pairing.pairingToken)
        )
    }

    private fun device(): JSONObject = JSONObject()
        .put("name", android.os.Build.MODEL)
        .put("platform", "android")
        .put("appVersion", BuildConfig.VERSION_NAME)
        .put("sourceDevice", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)

    private fun post(pairing: PairingPayload, route: String, body: JSONObject): JSONObject {
        val target = URI(pairing.apiBaseUrl.trimEnd('/') + route).toURL()
        require(target.protocol == "https") { "Forge Companion refuses unencrypted remote transport." }
        val connection = target.openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 45_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrNull().takeUnless { it.isNullOrBlank() } ?: "Forge returned HTTP $code."
                throw IllegalStateException(message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }
}
