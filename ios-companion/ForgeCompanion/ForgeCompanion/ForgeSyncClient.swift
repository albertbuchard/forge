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

    private struct MovementBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct SyncEnvelope: Decodable {
        let sync: SyncReceipt
    }

    private struct MovementBootstrapEnvelope: Decodable {
        let movement: SyncReceipt.MovementBootstrapEnvelope
    }

    private struct WatchBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct WatchBootstrapEnvelope: Decodable {
        let watch: ForgeWatchBootstrap
    }

    private struct WatchHabitCheckInRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let dedupeKey: String
        let dateKey: String
        let status: String
        let note: String
    }

    private struct WatchHabitCheckInEnvelope: Decodable {
        let watch: ForgeWatchBootstrap
    }

    private struct WatchCaptureBatchRequest: Encodable {
        struct Event: Encodable {
            let dedupeKey: String
            let eventType: String
            let recordedAt: String
            let promptId: String?
            let linkedContext: ForgeWatchLinkedContext
            let payload: [String: String]
        }

        let sessionId: String
        let pairingToken: String
        let device: ForgeWatchDeviceDescriptor
        let events: [Event]
    }

    private struct WatchCaptureBatchEnvelope: Decodable {
        let watch: ForgeWatchBootstrap
    }

    private struct ErrorEnvelope: Decodable {
        struct ValidationIssue: Decodable {
            let path: [String]
            let message: String
        }

        let error: String?
        let message: String?
        let details: [ValidationIssue]?
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
            "pushHealthSync start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl) sleep=\(payload.sleepSessions.count) workouts=\(payload.workouts.count) stays=\(payload.movement.stays.count) trips=\(payload.movement.trips.count)"
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

    func fetchMovementBootstrap(payload: PairingPayload) async throws -> SyncReceipt.MovementBootstrapEnvelope {
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementBootstrap start session=\(payload.sessionId)"
        )
        let envelope: MovementBootstrapEnvelope = try await sendRequest(
            path: "/mobile/movement/bootstrap",
            apiBaseUrl: payload.apiBaseUrl,
            body: MovementBootstrapRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementBootstrap success places=\(envelope.movement.places.count)"
        )
        return envelope.movement
    }

    func fetchWatchBootstrap(payload: PairingPayload) async throws -> ForgeWatchBootstrap {
        companionDebugLog(
            "ForgeSyncClient",
            "fetchWatchBootstrap start session=\(payload.sessionId)"
        )
        let envelope: WatchBootstrapEnvelope = try await sendRequest(
            path: "/mobile/watch/bootstrap",
            apiBaseUrl: payload.apiBaseUrl,
            body: WatchBootstrapRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "fetchWatchBootstrap success habits=\(envelope.watch.habits.count) prompts=\(envelope.watch.pendingPrompts.count)"
        )
        return envelope.watch
    }

    func submitWatchHabitCheckIn(
        envelopeId: String,
        action: ForgeWatchHabitCheckInAction,
        pairing: PairingPayload
    ) async throws -> ForgeWatchBootstrap {
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchHabitCheckIn start action=\(envelopeId) habit=\(action.habitId) status=\(action.status)"
        )
        let envelope: WatchHabitCheckInEnvelope = try await sendRequest(
            path: "/mobile/watch/habits/\(action.habitId)/check-ins",
            apiBaseUrl: pairing.apiBaseUrl,
            body: WatchHabitCheckInRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                dedupeKey: envelopeId,
                dateKey: action.dateKey,
                status: action.status,
                note: action.note
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchHabitCheckIn success action=\(envelopeId)"
        )
        return envelope.watch
    }

    func submitWatchCaptureBatch(
        envelopeId: String,
        device: ForgeWatchDeviceDescriptor,
        actions: [ForgeWatchCaptureEventAction],
        pairing: PairingPayload
    ) async throws -> ForgeWatchBootstrap {
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCaptureBatch start action=\(envelopeId) events=\(actions.count)"
        )
        let envelope: WatchCaptureBatchEnvelope = try await sendRequest(
            path: "/mobile/watch/capture-events:batch",
            apiBaseUrl: pairing.apiBaseUrl,
            body: WatchCaptureBatchRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                device: device,
                events: actions.map { action in
                    WatchCaptureBatchRequest.Event(
                        dedupeKey: envelopeId,
                        eventType: action.eventType,
                        recordedAt: action.recordedAt,
                        promptId: action.promptId,
                        linkedContext: action.linkedContext,
                        payload: action.payload
                    )
                }
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCaptureBatch success action=\(envelopeId)"
        )
        return envelope.watch
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
            let decodedError = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            let serverMessage = decodedError.flatMap { $0.message ?? $0.error }
            let validationMessage = decodedError?
                .details?
                .prefix(3)
                .map { issue in
                    let issuePath = issue.path.isEmpty ? "<root>" : issue.path.joined(separator: ".")
                    return "\(issuePath): \(issue.message)"
                }
                .joined(separator: " | ")
            let responseBody = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            companionDebugLog(
                "ForgeSyncClient",
                "sendRequest failure status=\(httpResponse.statusCode) message=\(serverMessage ?? "nil") validation=\(validationMessage ?? "nil") body=\(responseBody)"
            )
            throw NSError(
                domain: "ForgeSyncClient",
                code: httpResponse.statusCode,
                userInfo: [
                    NSLocalizedDescriptionKey: serverMessage
                        ?? "Forge rejected the request with status \(httpResponse.statusCode).",
                    NSLocalizedFailureReasonErrorKey: validationMessage ?? responseBody
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
        let path: String
        if trimmedPath.hasSuffix("/forge/api/v1") {
            path = trimmedPath.replacingOccurrences(
                of: "/forge/api/v1$",
                with: "/api/v1",
                options: .regularExpression
            )
        } else if trimmedPath == "/forge" {
            path = "/api/v1"
        } else if trimmedPath.hasSuffix("/api/v1") {
            path = trimmedPath
        } else {
            path = "\(trimmedPath)/api/v1"
        }
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
