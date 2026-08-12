package com.aurel.forge.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class PairingPayload(
    val apiBaseUrl: String,
    val sessionId: String,
    val pairingToken: String,
    val expiresAt: String,
    val capabilities: Set<String>
) {
    companion object {
        fun parse(raw: String): PairingPayload {
            val root = JSONObject(raw.trim())
            val source = root.optJSONObject("qrPayload") ?: root
            val kind = source.optString("kind", source.optString("k", "forge-companion-pairing"))
            require(kind == "forge-companion-pairing" || kind == "fcp1") { "This is not a Forge companion pairing payload." }
            val apiBaseUrl = source.optString("apiBaseUrl", source.optString("a"))
            val uri = URI(apiBaseUrl)
            require(uri.scheme == "https") { "Android remote pairing requires an HTTPS Forge address." }
            val sessionId = source.optString("sessionId", source.optString("s"))
            val pairingToken = source.optString("pairingToken", source.optString("pt"))
            require(sessionId.isNotBlank() && pairingToken.isNotBlank()) { "The pairing payload is incomplete." }
            val capabilitiesJson = source.optJSONArray("capabilities") ?: source.optJSONArray("c")
            val capabilities = buildSet {
                if (capabilitiesJson != null) for (index in 0 until capabilitiesJson.length()) add(capabilitiesJson.getString(index))
            }
            return PairingPayload(
                apiBaseUrl = apiBaseUrl.trimEnd('/'),
                sessionId = sessionId,
                pairingToken = pairingToken,
                expiresAt = source.optString("expiresAt", source.optString("e")),
                capabilities = capabilities
            )
        }
    }

    fun toJson(): String = JSONObject()
        .put("apiBaseUrl", apiBaseUrl)
        .put("sessionId", sessionId)
        .put("pairingToken", pairingToken)
        .put("expiresAt", expiresAt)
        .put("capabilities", capabilities.toList())
        .toString()
}

class SecurePayloadCipher(private val alias: String) {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false)
                    .build()
            )
            generateKey()
        }
    }

    fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    fun decrypt(value: String): String {
        val separator = value.indexOf(':')
        require(separator > 0) { "Encrypted companion data is malformed." }
        val iv = Base64.decode(value.substring(0, separator), Base64.NO_WRAP)
        val encrypted = Base64.decode(value.substring(separator + 1), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }
}

class PairingStore(private val context: Context) {
    private val preferences = context.getSharedPreferences("forge_pairing", Context.MODE_PRIVATE)
    private val cipher = SecurePayloadCipher("forge_android_pairing_v1")

    fun save(payload: PairingPayload) {
        preferences.edit()
            .putString("encrypted", cipher.encrypt(payload.toJson()))
            .remove("ciphertext")
            .remove("iv")
            .apply()
    }

    fun load(): PairingPayload? = runCatching {
        PairingPayload.parse(cipher.decrypt(requireNotNull(preferences.getString("encrypted", null))))
    }.getOrNull()

    fun clear() = preferences.edit().clear().apply()
}
