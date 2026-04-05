import Foundation
import UIKit

struct ForgeSyncClient {
    private struct PairingSessionRequest: Encodable {
        let label: String
        let capabilities: [String]
    }

    private struct PairingSessionEnvelope: Decodable {
        let qrPayload: PairingPayload
    }

    private struct OperatorSessionEnvelope: Decodable {
        let session: OperatorSession
    }

    private struct OperatorSession: Decodable {
        let id: String
        let actorLabel: String
        let expiresAt: String
    }

    private struct PairingVerificationRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let device: CompanionSyncPayload.Device
    }

    private struct SyncEnvelope: Decodable {
        let sync: SyncReceipt
    }

    private struct ErrorEnvelope: Decodable {
        let error: String?
        let message: String?
    }

    func verifyPairing(payload: PairingPayload, apiBaseUrl: String) async throws {
        companionDebugLog(
            "ForgeSyncClient",
            "verifyPairing start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl)"
        )
        let currentDevice = await MainActor.run {
            CompanionSyncPayload.Device(
                name: UIDevice.current.name,
                platform: "ios",
                appVersion: Bundle.main.object(
                    forInfoDictionaryKey: "CFBundleShortVersionString"
                ) as? String ?? "1.0",
                sourceDevice: UIDevice.current.model
            )
        }
        let requestBody = PairingVerificationRequest(
            sessionId: payload.sessionId,
            pairingToken: payload.pairingToken,
            device: currentDevice
        )
        _ = try await sendRequest(
            path: "/mobile/pairing/verify",
            apiBaseUrl: apiBaseUrl,
            body: requestBody
        ) as EmptyEnvelope
        companionDebugLog("ForgeSyncClient", "verifyPairing success session=\(payload.sessionId)")
    }

    func bootstrapPairingSession(
        baseUrl: String,
        label: String,
        capabilities: [String]
    ) async throws -> PairingPayload {
        companionDebugLog(
            "ForgeSyncClient",
            "bootstrapPairingSession start baseUrl=\(baseUrl) label=\(label)"
        )
        let session = makeSession()
        _ = try await sendRequest(
            path: "/auth/operator-session",
            apiBaseUrl: normalizedApiBaseUrl(from: baseUrl),
            method: "GET",
            body: Optional<String>.none as String?,
            session: session
        ) as OperatorSessionEnvelope

        let envelope: PairingSessionEnvelope = try await sendRequest(
            path: "/health/pairing-sessions",
            apiBaseUrl: normalizedApiBaseUrl(from: baseUrl),
            method: "POST",
            body: PairingSessionRequest(label: label, capabilities: capabilities),
            session: session
        )
        companionDebugLog(
            "ForgeSyncClient",
            "bootstrapPairingSession success session=\(envelope.qrPayload.sessionId)"
        )
        return envelope.qrPayload
    }

    func pushHealthSync(payload: CompanionSyncPayload, apiBaseUrl: String) async throws -> SyncReceipt {
        companionDebugLog(
            "ForgeSyncClient",
            "pushHealthSync start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl) sleep=\(payload.sleepSessions.count) workouts=\(payload.workouts.count)"
        )
        let envelope: SyncEnvelope = try await sendRequest(
            path: "/mobile/healthkit/sync",
            apiBaseUrl: apiBaseUrl,
            body: payload
        )
        companionDebugLog(
            "ForgeSyncClient",
            "pushHealthSync success created=\(envelope.sync.imported.createdCount) updated=\(envelope.sync.imported.updatedCount) merged=\(envelope.sync.imported.mergedCount)"
        )
        return envelope.sync
    }

    private func sendRequest<Body: Encodable, Response: Decodable>(
        path: String,
        apiBaseUrl: String,
        method: String = "POST",
        body: Body,
        session: URLSession = .shared
    ) async throws -> Response {
        guard let url = URL(string: "\(apiBaseUrl)\(path)") else {
            companionDebugLog(
                "ForgeSyncClient",
                "sendRequest badURL apiBaseUrl=\(apiBaseUrl) path=\(path)"
            )
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        if method != "GET" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        companionDebugLog(
            "ForgeSyncClient",
            "sendRequest start method=\(method) url=\(url.absoluteString) bodyBytes=\(request.httpBody?.count ?? 0)"
        )
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            companionDebugLog("ForgeSyncClient", "sendRequest badServerResponse url=\(url.absoluteString)")
            throw URLError(.badServerResponse)
        }

        companionDebugLog(
            "ForgeSyncClient",
            "sendRequest response method=\(method) url=\(url.absoluteString) status=\(httpResponse.statusCode) bytes=\(data.count)"
        )
        guard (200..<300).contains(httpResponse.statusCode) else {
            let serverMessage = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))
                .flatMap { $0.message ?? $0.error }
            companionDebugLog(
                "ForgeSyncClient",
                "sendRequest failure status=\(httpResponse.statusCode) message=\(serverMessage ?? "nil")"
            )
            throw NSError(
                domain: "ForgeSyncClient",
                code: httpResponse.statusCode,
                userInfo: [
                    NSLocalizedDescriptionKey: serverMessage
                        ?? "Forge rejected the request with status \(httpResponse.statusCode)."
                ]
            )
        }

        companionDebugLog("ForgeSyncClient", "sendRequest decode success url=\(url.absoluteString)")
        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func makeSession() -> URLSession {
        companionDebugLog("ForgeSyncClient", "makeSession ephemeral")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    private func normalizedApiBaseUrl(from rawValue: String) -> String {
        guard let url = URL(string: rawValue) else {
            companionDebugLog("ForgeSyncClient", "normalizedApiBaseUrl passthrough raw=\(rawValue)")
            return rawValue
        }
        let trimmedPath = url.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        let path = trimmedPath.hasSuffix("/api/v1") ? trimmedPath : "\(trimmedPath)/api/v1"
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = path
        let normalized = components?.url?.absoluteString ?? rawValue
        companionDebugLog(
            "ForgeSyncClient",
            "normalizedApiBaseUrl raw=\(rawValue) normalized=\(normalized)"
        )
        return normalized
    }
}

private struct EmptyEnvelope: Decodable {}
