package com.aurel.forge.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingPayloadTest {
    @Test
    fun parsesOnlyCompleteHttpsForgePairingPayloads() {
        val payload = PairingPayload.parse(
            """{
              "kind":"forge-companion-pairing",
              "apiBaseUrl":"https://forge.example/api/",
              "sessionId":"pairing-session",
              "pairingToken":"one-time-token",
              "expiresAt":"2026-08-12T13:00:00.000Z",
              "capabilities":["health.steps","health.heart_rate"]
            }""".trimIndent()
        )

        assertEquals("https://forge.example/api", payload.apiBaseUrl)
        assertEquals("pairing-session", payload.sessionId)
        assertEquals("one-time-token", payload.pairingToken)
        assertEquals(setOf("health.steps", "health.heart_rate"), payload.capabilities)
    }

    @Test
    fun rejectsPlainHttpWrongKindsAndMissingSecrets() {
        val http = assertThrows(IllegalArgumentException::class.java) {
            PairingPayload.parse(
                """{"kind":"forge-companion-pairing","apiBaseUrl":"http://forge.example","sessionId":"s","pairingToken":"p"}"""
            )
        }
        assertTrue(http.message.orEmpty().contains("HTTPS"))

        assertThrows(IllegalArgumentException::class.java) {
            PairingPayload.parse(
                """{"kind":"another-product","apiBaseUrl":"https://forge.example","sessionId":"s","pairingToken":"p"}"""
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            PairingPayload.parse(
                """{"kind":"fcp1","a":"https://forge.example","s":"","pt":""}"""
            )
        }
    }
}
