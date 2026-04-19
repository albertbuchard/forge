import Foundation
import UIKit

struct ForgeSyncClient {
    private static let bootstrapSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

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
        let pairingSession: CompanionPairingSessionState?
        let movement: SyncReceipt.MovementBootstrapEnvelope
    }

    private struct SourceStateUpdateRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let source: String
        let desiredEnabled: Bool
        let appliedEnabled: Bool
        let authorizationStatus: String
        let syncEligible: Bool
        let lastObservedAt: String?
        let metadata: [String: String]
    }

    private struct SourceStateUpdateEnvelope: Decodable {
        let pairingSession: CompanionPairingSessionState
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

    private struct MovementTimelineRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let before: String?
        let limit: Int
    }

    private struct MovementTimelineEnvelope: Decodable {
        let movement: ForgeMovementTimelinePage
    }

    private struct MovementBoxDetailEnvelope: Decodable {
        let movement: ForgeMovementBoxDetail
    }

    private struct MovementPlaceMutationRequest: Encodable {
        struct Place: Encodable {
            let externalUid: String
            let label: String
            let aliases: [String]
            let latitude: Double
            let longitude: Double
            let radiusMeters: Double
            let categoryTags: [String]
            let visibility: String
            let wikiNoteId: String?
            let linkedEntities: [[String: String]]
            let linkedPeople: [[String: String]]
            let metadata: [String: String]
        }

        let sessionId: String
        let pairingToken: String
        let place: Place
    }

    private struct MovementPlaceEnvelope: Decodable {
        let place: ForgeMovementTimelinePlace
    }

    static func generatedMovementPlaceExternalUid() -> String {
        "ios-place-\(UUID().uuidString.lowercased())"
    }

    private struct MovementUserBoxCreateRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let box: ForgeMovementUserBoxPayload
    }

    private struct MovementUserBoxPatchRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let patch: ForgeMovementUserBoxPayload
    }

    private struct MovementUserBoxPreflightDraftRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let draft: ForgeMovementUserBoxPreflightPayload
    }

    private struct MovementUserBoxEnvelope: Decodable {
        let box: ForgeMovementTimelineSegment
    }

    private struct MovementStayPatchRequest: Encodable {
        struct Patch: Encodable {
            let placeExternalUid: String?
            let placeLabel: String?
        }

        let sessionId: String
        let pairingToken: String
        let patch: Patch
    }

    private struct MovementStayPatchEnvelope: Decodable {
        let place: ForgeMovementTimelinePlace?
    }

    private struct MovementUserBoxPreflightEnvelope: Decodable {
        let preflight: ForgeMovementUserBoxPreflight
    }

    private struct MovementUserBoxDeleteRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct MovementUserBoxDeleteEnvelope: Decodable {
        let deletedBoxId: String
    }

    private struct MovementAutomaticInvalidateRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let invalidate: ForgeMovementUserBoxPayload
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
            "pushHealthSync start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl) raw=\(payload.sleepRawRecords.count) nights=\(payload.sleepNights.count) segments=\(payload.sleepSegments.count) legacySleep=\(payload.sleepSessions.count) workouts=\(payload.workouts.count) vitalsDays=\(payload.vitals.daySummaries.count) stays=\(payload.movement.stays.count) trips=\(payload.movement.trips.count)"
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

    func fetchMovementBootstrap(
        payload: PairingPayload
    ) async throws -> (pairingSession: CompanionPairingSessionState?, movement: SyncReceipt.MovementBootstrapEnvelope) {
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
        return (pairingSession: envelope.pairingSession, movement: envelope.movement)
    }

    func updateSourceState(
        payload: PairingPayload,
        source: String,
        desiredEnabled: Bool,
        appliedEnabled: Bool,
        authorizationStatus: String,
        syncEligible: Bool,
        lastObservedAt: String?,
        metadata: [String: String] = [:]
    ) async throws -> CompanionPairingSessionState {
        let envelope: SourceStateUpdateEnvelope = try await sendRequest(
            path: "/mobile/source-state",
            apiBaseUrl: payload.apiBaseUrl,
            body: SourceStateUpdateRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken,
                source: source,
                desiredEnabled: desiredEnabled,
                appliedEnabled: appliedEnabled,
                authorizationStatus: authorizationStatus,
                syncEligible: syncEligible,
                lastObservedAt: lastObservedAt,
                metadata: metadata
            )
        )
        return envelope.pairingSession
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

    func fetchMovementTimeline(
        payload: PairingPayload,
        before: String?,
        limit: Int = 36
    ) async throws -> ForgeMovementTimelinePage {
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementTimeline start session=\(payload.sessionId) before=\(before ?? "nil") limit=\(limit)"
        )
        let envelope: MovementTimelineEnvelope = try await sendRequest(
            path: "/mobile/movement/timeline",
            apiBaseUrl: payload.apiBaseUrl,
            body: MovementTimelineRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken,
                before: before,
                limit: limit
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementTimeline success segments=\(envelope.movement.segments.count) hasMore=\(envelope.movement.hasMore)"
        )
        return envelope.movement
    }

    func createMovementUserBox(
        box: ForgeMovementUserBoxPayload,
        pairing: PairingPayload
    ) async throws -> ForgeMovementTimelineSegment {
        companionDebugLog(
            "ForgeSyncClient",
            "createMovementUserBox start session=\(pairing.sessionId)"
        )
        let envelope: MovementUserBoxEnvelope = try await sendRequest(
            path: "/mobile/movement/user-boxes",
            apiBaseUrl: pairing.apiBaseUrl,
            body: MovementUserBoxCreateRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                box: box
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "createMovementUserBox success box=\(envelope.box.id)"
        )
        return envelope.box
    }

    func patchMovementUserBox(
        boxId: String,
        patch: ForgeMovementUserBoxPayload,
        pairing: PairingPayload
    ) async throws -> ForgeMovementTimelineSegment {
        companionDebugLog(
            "ForgeSyncClient",
            "patchMovementUserBox start box=\(boxId)"
        )
        let envelope: MovementUserBoxEnvelope = try await sendRequest(
            path: "/mobile/movement/user-boxes/\(boxId)",
            apiBaseUrl: pairing.apiBaseUrl,
            method: "PATCH",
            body: MovementUserBoxPatchRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                patch: patch
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "patchMovementUserBox success box=\(boxId)"
        )
        return envelope.box
    }

    func preflightMovementUserBox(
        draft: ForgeMovementUserBoxPreflightPayload,
        pairing: PairingPayload
    ) async throws -> ForgeMovementUserBoxPreflight {
        companionDebugLog(
            "ForgeSyncClient",
            "preflightMovementUserBox start session=\(pairing.sessionId)"
        )
        let envelope: MovementUserBoxPreflightEnvelope = try await sendRequest(
            path: "/mobile/movement/user-boxes/preflight",
            apiBaseUrl: pairing.apiBaseUrl,
            body: MovementUserBoxPreflightDraftRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                draft: draft
            )
        )
        return envelope.preflight
    }

    func deleteMovementUserBox(
        boxId: String,
        pairing: PairingPayload
    ) async throws -> String {
        companionDebugLog(
            "ForgeSyncClient",
            "deleteMovementUserBox start box=\(boxId)"
        )
        let envelope: MovementUserBoxDeleteEnvelope = try await sendRequest(
            path: "/mobile/movement/user-boxes/\(boxId)",
            apiBaseUrl: pairing.apiBaseUrl,
            method: "DELETE",
            body: MovementUserBoxDeleteRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "deleteMovementUserBox success box=\(boxId)"
        )
        return envelope.deletedBoxId
    }

    func invalidateAutomaticMovementBox(
        boxId: String,
        payload: ForgeMovementUserBoxPayload,
        pairing: PairingPayload
    ) async throws -> ForgeMovementTimelineSegment {
        companionDebugLog(
            "ForgeSyncClient",
            "invalidateAutomaticMovementBox start box=\(boxId)"
        )
        let envelope: MovementUserBoxEnvelope = try await sendRequest(
            path: "/mobile/movement/automatic-boxes/\(boxId)/invalidate",
            apiBaseUrl: pairing.apiBaseUrl,
            body: MovementAutomaticInvalidateRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                invalidate: payload
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "invalidateAutomaticMovementBox success box=\(boxId)"
        )
        return envelope.box
    }

    func createMovementPlace(
        label: String,
        latitude: Double,
        longitude: Double,
        categoryTags: [String],
        pairing: PairingPayload
    ) async throws -> ForgeMovementTimelinePlace {
        let externalUid = Self.generatedMovementPlaceExternalUid()
        companionDebugLog(
            "ForgeSyncClient",
            "createMovementPlace start label=\(label) externalUid=\(externalUid)"
        )
        let envelope: MovementPlaceEnvelope = try await sendRequest(
            path: "/mobile/movement/places",
            apiBaseUrl: pairing.apiBaseUrl,
            body: MovementPlaceMutationRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                place: .init(
                    externalUid: externalUid,
                    label: label,
                    aliases: [],
                    latitude: latitude,
                    longitude: longitude,
                    radiusMeters: 100,
                    categoryTags: categoryTags,
                    visibility: "shared",
                    wikiNoteId: nil,
                    linkedEntities: [],
                    linkedPeople: [],
                    metadata: [:]
                )
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "createMovementPlace success label=\(label) externalUid=\(envelope.place.externalUid) placeId=\(envelope.place.id)"
        )
        return envelope.place
    }

    func fetchMovementBoxDetail(
        boxId: String,
        pairing: PairingPayload
    ) async throws -> ForgeMovementBoxDetail {
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementBoxDetail start box=\(boxId)"
        )
        let envelope: MovementBoxDetailEnvelope = try await sendRequest(
            path: "/mobile/movement/boxes/\(boxId)/detail",
            apiBaseUrl: pairing.apiBaseUrl,
            body: MovementBootstrapRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementBoxDetail success box=\(boxId)"
        )
        return envelope.movement
    }

    func patchMovementStay(
        stayId: String,
        placeExternalUid: String,
        placeLabel: String,
        pairing: PairingPayload
    ) async throws -> ForgeMovementTimelinePlace? {
        companionDebugLog(
            "ForgeSyncClient",
            "patchMovementStay start stay=\(stayId)"
        )
        let envelope: MovementStayPatchEnvelope = try await sendRequest(
            path: "/mobile/movement/stays/\(stayId)",
            apiBaseUrl: pairing.apiBaseUrl,
            method: "PATCH",
            body: MovementStayPatchRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                patch: .init(
                    placeExternalUid: placeExternalUid,
                    placeLabel: placeLabel
                )
            )
        )
        companionDebugLog(
            "ForgeSyncClient",
            "patchMovementStay success stay=\(stayId)"
        )
        return envelope.place
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
        companionDebugLog("ForgeSyncClient", "makeSession persistent")
        return Self.bootstrapSession
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
        if components?.host?.contains(".ts.net") == true, components?.scheme == "http" {
            components?.scheme = "https"
        }
        let normalized = components?.url?.absoluteString ?? rawValue
        companionDebugLog(
            "ForgeSyncClient",
            "normalizedApiBaseUrl raw=\(rawValue) normalized=\(normalized)"
        )
        return normalized
    }
}

private struct EmptyEnvelope: Decodable {}
