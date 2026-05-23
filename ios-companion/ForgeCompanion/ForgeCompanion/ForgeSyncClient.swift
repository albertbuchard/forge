import Foundation
import CryptoKit
import UIKit

@_silgen_name("forge_iroh_http_request_json")
private func forge_iroh_http_request_json(_ inputJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_silgen_name("forge_iroh_free_string")
private func forge_iroh_free_string(_ value: UnsafeMutablePointer<CChar>?)

struct ForgeIrohTransportResult {
    let data: Data
    let statusCode: Int
    let headers: [String: String]
}

enum ForgeIrohTransportClient {
    private static let requestTimeoutNanoseconds: UInt64 = 45 * 1_000_000_000

    private struct Header: Codable {
        let name: String
        let value: String
    }

    private struct RequestEnvelope: Encodable {
        let pairPayload: PairingTransportPairPayload
        let method: String
        let path: String
        let headers: [Header]
        let bodyBase64: String?
    }

    private struct ResponseEnvelope: Decodable {
        let ok: Bool
        let status: Int?
        let headers: [Header]
        let bodyBase64: String?
        let error: String?
    }

    static func send(
        method: String,
        path: String,
        headers: [String: String],
        body: Data?,
        transport: PairingTransport
    ) async throws -> ForgeIrohTransportResult {
        guard transport.isIrohTransport else {
            throw URLError(.unsupportedURL)
        }
        guard let pairPayload = transport.pairPayload else {
            throw NSError(
                domain: "ForgeIrohTransport",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Iroh pairing payload is missing."]
            )
        }
        let envelope = RequestEnvelope(
            pairPayload: pairPayload,
            method: method,
            path: path,
            headers: headers
                .map { Header(name: $0.key, value: $0.value) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending },
            bodyBase64: body?.base64EncodedString()
        )
        let task = Task.detached(priority: .userInitiated) { () throws -> ForgeIrohTransportResult in
            let inputData = try JSONEncoder().encode(envelope)
            guard let inputJson = String(data: inputData, encoding: .utf8) else {
                throw URLError(.cannotDecodeRawData)
            }
            let outputJson: String = try inputJson.withCString { pointer in
                guard let outputPointer = forge_iroh_http_request_json(pointer) else {
                    throw URLError(.badServerResponse)
                }
                defer { forge_iroh_free_string(outputPointer) }
                return String(cString: outputPointer)
            }
            let response = try JSONDecoder().decode(
                ResponseEnvelope.self,
                from: Data(outputJson.utf8)
            )
            guard response.ok else {
                throw NSError(
                    domain: "ForgeIrohTransport",
                    code: response.status ?? -1,
                    userInfo: [
                        NSLocalizedDescriptionKey: response.error ?? "Forge Iroh request failed."
                    ]
                )
            }
            let responseData: Data
            if let bodyBase64 = response.bodyBase64,
               let decodedBody = Data(base64Encoded: bodyBase64) {
                responseData = decodedBody
            } else {
                responseData = Data()
            }
            var headerMap: [String: String] = [:]
            for header in response.headers {
                headerMap[header.name] = header.value
            }
            return ForgeIrohTransportResult(
                data: responseData,
                statusCode: response.status ?? 500,
                headers: headerMap
            )
        }
        do {
            return try await awaitResult(task, timeoutNanoseconds: requestTimeoutNanoseconds)
        } catch {
            task.cancel()
            throw error
        }
    }

    private static func awaitResult(
        _ task: Task<ForgeIrohTransportResult, Error>,
        timeoutNanoseconds: UInt64
    ) async throws -> ForgeIrohTransportResult {
        try await withThrowingTaskGroup(of: ForgeIrohTransportResult.self) { group in
            group.addTask {
                try await task.value
            }
            group.addTask {
                try await Task.sleep(nanoseconds: timeoutNanoseconds)
                throw NSError(
                    domain: "ForgeIrohTransport",
                    code: URLError.timedOut.rawValue,
                    userInfo: [
                        NSLocalizedDescriptionKey: "Forge Iroh request timed out.",
                        NSLocalizedFailureReasonErrorKey: "No response arrived within 45 seconds."
                    ]
                )
            }
            guard let result = try await group.next() else {
                throw URLError(.unknown)
            }
            group.cancelAll()
            return result
        }
    }
}

struct ForgeSyncClient {
    static let movementTimelineServerCompatibleLimit = 120

    private static let bootstrapSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = true
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

    private struct PairingVerificationEnvelope: Decodable {
        let pairing: PairingVerificationResult
    }

    private struct PairingVerificationResult: Decodable {
        let pairingSession: CompanionPairingSessionState
    }

    private struct PairingHeartbeatRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let device: CompanionSyncPayload.Device
    }

    private struct PairingHeartbeatEnvelope: Decodable {
        let pairingSession: CompanionPairingSessionState
    }

    private struct MovementBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct SyncEnvelope: Decodable {
        let sync: SyncReceipt
    }

    struct HealthSyncUploadSession: Decodable {
        let syncSessionId: String
        let schemaVersion: String
        let chunkTargetBytes: Int
        let chunkMaxBytes: Int
        let chunkPayloadEncoding: String?
        let acceptedPayloadEncodings: [String]?
        let supportsCompression: Bool
        let acceptedFamilies: [String]
        let receivedChunkIds: [String]
        let receivedChunkIdSet: Set<String>

        enum CodingKeys: String, CodingKey {
            case syncSessionId
            case schemaVersion
            case chunkTargetBytes
            case chunkMaxBytes
            case chunkPayloadEncoding
            case acceptedPayloadEncodings
            case supportsCompression
            case acceptedFamilies
            case receivedChunkIds
        }

        init(
            syncSessionId: String,
            schemaVersion: String,
            chunkTargetBytes: Int,
            chunkMaxBytes: Int,
            chunkPayloadEncoding: String?,
            acceptedPayloadEncodings: [String]?,
            supportsCompression: Bool,
            acceptedFamilies: [String],
            receivedChunkIds: [String]
        ) {
            self.syncSessionId = syncSessionId
            self.schemaVersion = schemaVersion
            self.chunkTargetBytes = chunkTargetBytes
            self.chunkMaxBytes = chunkMaxBytes
            self.chunkPayloadEncoding = chunkPayloadEncoding
            self.acceptedPayloadEncodings = acceptedPayloadEncodings
            self.supportsCompression = supportsCompression
            self.acceptedFamilies = acceptedFamilies
            self.receivedChunkIds = receivedChunkIds
            self.receivedChunkIdSet = Set(receivedChunkIds)
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let receivedChunkIds = try container.decode([String].self, forKey: .receivedChunkIds)
            self.init(
                syncSessionId: try container.decode(String.self, forKey: .syncSessionId),
                schemaVersion: try container.decode(String.self, forKey: .schemaVersion),
                chunkTargetBytes: try container.decode(Int.self, forKey: .chunkTargetBytes),
                chunkMaxBytes: try container.decode(Int.self, forKey: .chunkMaxBytes),
                chunkPayloadEncoding: try container.decodeIfPresent(String.self, forKey: .chunkPayloadEncoding),
                acceptedPayloadEncodings: try container.decodeIfPresent([String].self, forKey: .acceptedPayloadEncodings),
                supportsCompression: try container.decode(Bool.self, forKey: .supportsCompression),
                acceptedFamilies: try container.decode([String].self, forKey: .acceptedFamilies),
                receivedChunkIds: receivedChunkIds
            )
        }

        var supportsByteStablePayloadEncoding: Bool {
            chunkPayloadEncoding == "payload_json_base64" ||
                (acceptedPayloadEncodings ?? []).contains("payload_json_base64")
        }
    }

    struct HealthSyncChunkProgress: Decodable {
        let receivedCounts: [String: Int]?
        let byteTotals: [String: Int]?
        let chunkCount: Int?
        let receivedBytes: Int?
    }

    struct HealthSyncChunkReceipt: Decodable {
        let accepted: Bool
        let duplicate: Bool
        let receivedCount: Int
        let receivedBytes: Int
        let progress: HealthSyncChunkProgress?
    }

    struct HealthSyncChunkUploadEvent {
        let chunkId: String
        let family: String
        let sequence: Int
        let recordCount: Int
        let byteCount: Int
        let compressedByteCount: Int?
        let duplicate: Bool
        let skipped: Bool
        let receivedCount: Int?
        let receivedBytes: Int?

        var transferByteCount: Int {
            compressedByteCount ?? byteCount
        }
    }

    typealias HealthSyncChunkUploadHandler = (HealthSyncChunkUploadEvent) async -> Void

    private struct HealthSyncSessionStartRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let device: CompanionSyncPayload.Device
        let permissions: CompanionSyncPayload.Permissions
        let sourceStates: CompanionSyncPayload.SourceStates
        let schemaVersion: String
        let requestedFamilies: [String]
        let expectedCounts: [String: Int]
        let metadata: [String: String]
    }

    private struct HealthSyncSessionStartEnvelope: Decodable {
        let upload: HealthSyncUploadSession
    }

    private struct EmptyDecodableEnvelope: Decodable {}

    private struct HealthSyncChunkEnvelope: Decodable {
        let chunk: HealthSyncChunkReceipt
    }

    private struct HealthSyncChunkRequest: Encodable {
        let chunkId: String
        let sequence: Int
        let family: String
        let recordCount: Int
        let byteCount: Int
        let compressedByteCount: Int?
        let checksumSha256: String
        let payloadJsonDeflateBase64: String?
        let payloadJsonBase64: String?
    }

    struct HealthSyncChunkWirePayload {
        let payloadData: Data
        let compressedPayloadData: Data?
        let payloadJsonBase64: String
        let payloadJsonDeflateBase64: String?
        let checksumSha256: String
        let byteCount: Int
        let compressedByteCount: Int?
    }

    private struct HealthSyncSessionCompleteRequest: Encodable {
        let finalCursor: [String: CompanionSyncPayload.ScalarValue]
        let expectedCounts: [String: Int]
    }

    private struct SleepNightsChunkPayload: Encodable {
        let sleepNights: [CompanionSyncPayload.SleepNight]
    }

    private struct SleepSegmentsChunkPayload: Encodable {
        let sleepSegments: [CompanionSyncPayload.SleepSegment]
    }

    private struct SleepRawRecordsChunkPayload: Encodable {
        let sleepRawRecords: [CompanionSyncPayload.SleepRawRecord]
    }

    private struct WorkoutSummariesChunkPayload: Encodable {
        let workouts: [CompanionSyncPayload.WorkoutSession]
    }

    private struct WorkoutArchiveChunkPayload: Encodable {
        let workouts: [CompanionSyncPayload.WorkoutSession]
    }

    private struct WorkoutTimeSeriesChunkPayload: Encodable {
        struct Workout: Encodable {
            let externalUid: String
            let samples: [CompanionSyncPayload.WorkoutTimeSeriesSample]
        }

        let workoutTimeSeries: [Workout]
    }

    private struct WorkoutRoutesChunkPayload: Encodable {
        struct Workout: Encodable {
            let externalUid: String
            let routePoints: [CompanionSyncPayload.WorkoutRoutePoint]
        }

        let workoutRoutes: [Workout]
    }

    private struct VitalsChunkPayload: Encodable {
        let vitals: CompanionSyncPayload.VitalsPayload
    }

    private struct MovementChunkPayload: Encodable {
        let movement: CompanionSyncPayload.MovementPayload
    }

    private struct ScreenTimeChunkPayload: Encodable {
        let screenTime: CompanionSyncPayload.ScreenTimePayload
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

        let code: String?
        let error: String?
        let message: String?
        let details: [ValidationIssue]?
        let recommendedMode: String?
        let maxBytes: Int?
    }

    func verifyPairing(payload: PairingPayload, apiBaseUrl: String) async throws -> CompanionPairingSessionState {
        companionDebugLog(
            "ForgeSyncClient",
            "verifyPairing start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl)"
        )
        let currentDevice = await currentDeviceDescriptor()
        let requestBody = PairingVerificationRequest(
            sessionId: payload.sessionId,
            pairingToken: payload.pairingToken,
            device: currentDevice
        )
        let envelope: PairingVerificationEnvelope = try await sendRequest(
            path: "/mobile/pairing/verify",
            apiBaseUrl: apiBaseUrl,
            body: requestBody,
            transport: payload.transport
        )
        companionDebugLog("ForgeSyncClient", "verifyPairing success session=\(payload.sessionId)")
        return envelope.pairing.pairingSession
    }

    func heartbeatPairing(payload: PairingPayload, apiBaseUrl: String) async throws -> CompanionPairingSessionState {
        companionDebugLog(
            "ForgeSyncClient",
            "heartbeatPairing start session=\(payload.sessionId) apiBaseUrl=\(apiBaseUrl)"
        )
        let envelope: PairingHeartbeatEnvelope = try await sendRequest(
            path: "/mobile/pairing/heartbeat",
            apiBaseUrl: apiBaseUrl,
            body: PairingHeartbeatRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken,
                device: await currentDeviceDescriptor()
            ),
            transport: payload.transport
        )
        companionDebugLog(
            "ForgeSyncClient",
            "heartbeatPairing success session=\(payload.sessionId) status=\(envelope.pairingSession.status)"
        )
        return envelope.pairingSession
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

    func pushHealthSync(payload: CompanionSyncPayload, pairing: PairingPayload) async throws -> SyncReceipt {
        companionDebugLog(
            "ForgeSyncClient",
            "pushHealthSync start session=\(payload.sessionId) apiBaseUrl=\(pairing.apiBaseUrl) raw=\(payload.sleepRawRecords.count) nights=\(payload.sleepNights.count) segments=\(payload.sleepSegments.count) legacySleep=\(payload.sleepSessions.count) workouts=\(payload.workouts.count) vitalsDays=\(payload.vitals.daySummaries.count) stays=\(payload.movement.stays.count) trips=\(payload.movement.trips.count)"
        )
        let envelope: SyncEnvelope = try await sendRequest(
            path: "/mobile/healthkit/sync",
            apiBaseUrl: pairing.apiBaseUrl,
            body: payload,
            transport: pairing.transport
        )
        companionDebugLog(
            "ForgeSyncClient",
            "pushHealthSync success created=\(envelope.sync.imported.createdCount) updated=\(envelope.sync.imported.updatedCount) merged=\(envelope.sync.imported.mergedCount)"
        )
        return envelope.sync
    }

    func startHealthSyncSession(
        pairing: PairingPayload,
        permissions: CompanionSyncPayload.Permissions,
        sourceStates: CompanionSyncPayload.SourceStates,
        resumeSyncSessionId: String? = nil,
        requestedFamilies: [String] = [
            "sleep_nights",
            "sleep_segments",
            "sleep_raw_records",
            "workout_summaries",
            "workout_archive",
            "workout_time_series",
            "workout_routes",
            "workout_tombstones",
            "vitals",
            "movement",
            "screen_time"
        ]
    ) async throws -> HealthSyncUploadSession {
        companionDebugLog(
            "ForgeSyncClient",
            "startHealthSyncSession start session=\(pairing.sessionId) families=\(requestedFamilies.joined(separator: ","))"
        )
        let envelope: HealthSyncSessionStartEnvelope = try await sendRequest(
            path: "/mobile/healthkit/sync-sessions",
            apiBaseUrl: pairing.apiBaseUrl,
            body: HealthSyncSessionStartRequest(
                sessionId: pairing.sessionId,
                pairingToken: pairing.pairingToken,
                device: await currentDeviceDescriptor(),
                permissions: permissions,
                sourceStates: sourceStates,
                schemaVersion: "healthkit-sync-v2",
                requestedFamilies: requestedFamilies,
                expectedCounts: [:],
                metadata: [
                    "clientMode": "chunked",
                    "clientPlatform": "ios",
                    "resumeSyncSessionId": resumeSyncSessionId ?? ""
                ]
            ),
            transport: pairing.transport
        )
        companionDebugLog(
            "ForgeSyncClient",
            "startHealthSyncSession success uploadSession=\(envelope.upload.syncSessionId) target=\(envelope.upload.chunkTargetBytes) max=\(envelope.upload.chunkMaxBytes) payloadEncoding=\(envelope.upload.chunkPayloadEncoding ?? "missing") acceptedFamilies=\(envelope.upload.acceptedFamilies.joined(separator: ","))"
        )
        guard envelope.upload.supportsByteStablePayloadEncoding else {
            companionDebugLog(
                "ForgeSyncClient",
                "startHealthSyncSession rejected runtime without payload_json_base64 support uploadSession=\(envelope.upload.syncSessionId)"
            )
            throw NSError(
                domain: "ForgeSyncClient",
                code: 426,
                userInfo: [
                    NSLocalizedDescriptionKey: "Forge runtime needs an update or restart before HealthKit chunk sync.",
                    NSLocalizedFailureReasonErrorKey: "healthkit_chunk_protocol_unsupported"
                ]
            )
        }
        let missingFamilies = requestedFamilies.filter { envelope.upload.acceptedFamilies.contains($0) == false }
        if missingFamilies.isEmpty == false {
            if resumeSyncSessionId != nil {
                companionDebugLog(
                    "ForgeSyncClient",
                    "startHealthSyncSession stale resumed uploadSession=\(envelope.upload.syncSessionId) missingFamilies=\(missingFamilies.joined(separator: ",")); aborting and starting fresh"
                )
                await abortHealthSyncSession(uploadSession: envelope.upload, pairing: pairing)
                return try await startHealthSyncSession(
                    pairing: pairing,
                    permissions: permissions,
                    sourceStates: sourceStates,
                    resumeSyncSessionId: nil,
                    requestedFamilies: requestedFamilies
                )
            }
            companionDebugLog(
                "ForgeSyncClient",
                "startHealthSyncSession rejected runtime missingFamilies=\(missingFamilies.joined(separator: ",")) uploadSession=\(envelope.upload.syncSessionId)"
            )
            throw NSError(
                domain: "ForgeSyncClient",
                code: 426,
                userInfo: [
                    NSLocalizedDescriptionKey: "Forge runtime needs an update or restart before HealthKit archive sync.",
                    NSLocalizedFailureReasonErrorKey: "healthkit_sync_family_unsupported",
                    "ForgeHealthSyncMissingFamilies": missingFamilies.joined(separator: ",")
                ]
            )
        }
        return envelope.upload
    }

    func uploadBaseHealthSyncChunks(
        payload: CompanionSyncPayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        var sequence = startingSequence
        sequence = try await uploadArrayHealthSyncChunks(
            records: payload.sleepNights,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "sleep_nights",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { SleepNightsChunkPayload(sleepNights: $0) }
        sequence = try await uploadArrayHealthSyncChunks(
            records: payload.sleepSegments,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "sleep_segments",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { SleepSegmentsChunkPayload(sleepSegments: $0) }
        sequence = try await uploadArrayHealthSyncChunks(
            records: payload.sleepRawRecords,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "sleep_raw_records",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { SleepRawRecordsChunkPayload(sleepRawRecords: $0) }
        sequence = try await uploadArrayHealthSyncChunks(
            records: payload.vitals.daySummaries,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "vitals",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { VitalsChunkPayload(vitals: .init(daySummaries: $0)) }
        sequence = try await uploadMovementHealthSyncChunks(
            payload.movement,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        )
        sequence = try await uploadScreenTimeHealthSyncChunks(
            payload.screenTime,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        )
        return sequence
    }

    func uploadWorkoutHealthSyncChunks(
        workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        var sequence = startingSequence
        let summaries = workouts.map(summaryOnlyWorkout)
        sequence = try await uploadChunkedWorkoutSummaries(
            summaries,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        )
        sequence = try await uploadChunkedWorkoutTimeSeries(
            workouts,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        )
        sequence = try await uploadChunkedWorkoutRoutes(
            workouts,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        )
        return sequence
    }

    func uploadWorkoutArchiveHealthSyncChunks(
        workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        guard workouts.isEmpty == false else {
            return startingSequence
        }
        guard uploadSession.acceptedFamilies.contains("workout_archive") else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadWorkoutArchiveHealthSyncChunks rejected unsupported family=workout_archive uploadSession=\(uploadSession.syncSessionId)"
            )
            throw NSError(
                domain: "ForgeSyncClient",
                code: 426,
                userInfo: [
                    NSLocalizedDescriptionKey: "Forge runtime needs an update or restart before workout archive sync.",
                    NSLocalizedFailureReasonErrorKey: "healthkit_workout_archive_unsupported"
                ]
            )
        }
        return try await uploadArrayHealthSyncChunks(
            records: workouts,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "workout_archive",
            startingSequence: startingSequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            WorkoutArchiveChunkPayload(workouts: records)
        }
    }

    func completeHealthSyncSession(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        expectedCounts: [String: Int] = [:]
    ) async throws -> SyncReceipt {
        companionDebugLog(
            "ForgeSyncClient",
            "completeHealthSyncSession start uploadSession=\(uploadSession.syncSessionId)"
        )
        let envelope: SyncEnvelope = try await sendRequest(
            path: "/mobile/healthkit/sync-sessions/\(uploadSession.syncSessionId)/complete",
            apiBaseUrl: pairing.apiBaseUrl,
            body: HealthSyncSessionCompleteRequest(
                finalCursor: [:],
                expectedCounts: expectedCounts
            ),
            transport: pairing.transport
        )
        companionDebugLog(
            "ForgeSyncClient",
            "completeHealthSyncSession success created=\(envelope.sync.imported.createdCount) updated=\(envelope.sync.imported.updatedCount) merged=\(envelope.sync.imported.mergedCount)"
        )
        return envelope.sync
    }

    func abortHealthSyncSession(uploadSession: HealthSyncUploadSession, pairing: PairingPayload) async {
        do {
            let _: EmptyDecodableEnvelope = try await sendRequest(
                path: "/mobile/healthkit/sync-sessions/\(uploadSession.syncSessionId)",
                apiBaseUrl: pairing.apiBaseUrl,
                method: "DELETE",
                body: Optional<String>.none as String?,
                transport: pairing.transport
            )
        } catch {
            companionDebugLog(
                "ForgeSyncClient",
                "abortHealthSyncSession failed uploadSession=\(uploadSession.syncSessionId) error=\(error.localizedDescription)"
            )
        }
    }

    private func uploadArrayHealthSyncChunks<Record, Payload: Encodable>(
        records: [Record],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        family: String,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?,
        makePayload: ([Record]) -> Payload
    ) async throws -> Int {
        var sequence = startingSequence
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        var current: [Record] = []
        for record in records {
            let candidate = current + [record]
            if current.isEmpty == false && encodedByteCount(makePayload(candidate)) > targetBytes {
                sequence = try await uploadHealthSyncChunk(
                    uploadSession: uploadSession,
                    pairing: pairing,
                    sequence: sequence,
                    family: family,
                    recordCount: current.count,
                    payload: makePayload(current),
                    onChunkUploaded: onChunkUploaded
                )
                current = [record]
            } else {
                current = candidate
            }
        }
        sequence = try await uploadHealthSyncChunk(
            uploadSession: uploadSession,
            pairing: pairing,
            sequence: sequence,
            family: family,
            recordCount: current.count,
            payload: makePayload(current),
            onChunkUploaded: onChunkUploaded
        )
        return sequence
    }

    private func uploadMovementHealthSyncChunks(
        _ movement: CompanionSyncPayload.MovementPayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        sequence = try await uploadArrayHealthSyncChunks(
            records: movement.knownPlaces,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "movement",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: movement.settings,
                    knownPlaces: records,
                    stays: [],
                    trips: []
                )
            )
        }
        sequence = try await uploadArrayHealthSyncChunks(
            records: movement.stays,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "movement",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: movement.settings,
                    knownPlaces: [],
                    stays: records,
                    trips: []
                )
            )
        }
        sequence = try await uploadArrayHealthSyncChunks(
            records: movement.trips,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "movement",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: movement.settings,
                    knownPlaces: [],
                    stays: [],
                    trips: records
                )
            )
        }
        return sequence
    }

    private func uploadScreenTimeHealthSyncChunks(
        _ screenTime: CompanionSyncPayload.ScreenTimePayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        sequence = try await uploadArrayHealthSyncChunks(
            records: screenTime.daySummaries,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "screen_time",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            ScreenTimeChunkPayload(
                screenTime: .init(
                    settings: screenTime.settings,
                    daySummaries: records,
                    hourlySegments: []
                )
            )
        }
        sequence = try await uploadArrayHealthSyncChunks(
            records: screenTime.hourlySegments,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "screen_time",
            startingSequence: sequence,
            onChunkUploaded: onChunkUploaded
        ) { records in
            ScreenTimeChunkPayload(
                screenTime: .init(
                    settings: screenTime.settings,
                    daySummaries: [],
                    hourlySegments: records
                )
            )
        }
        return sequence
    }

    private func uploadChunkedWorkoutSummaries(
        _ workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard workouts.isEmpty == false else {
            return startingSequence
        }
        var sequence = startingSequence
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        var current: [CompanionSyncPayload.WorkoutSession] = []
        for workout in workouts {
            let candidate = current + [workout]
            let candidatePayload = WorkoutSummariesChunkPayload(workouts: candidate)
            if current.isEmpty == false && encodedByteCount(candidatePayload) > targetBytes {
                sequence = try await uploadHealthSyncChunk(
                    uploadSession: uploadSession,
                    pairing: pairing,
                    sequence: sequence,
                    family: "workout_summaries",
                    recordCount: current.count,
                    payload: WorkoutSummariesChunkPayload(workouts: current),
                    onChunkUploaded: onChunkUploaded
                )
                current = [workout]
            } else {
                current = candidate
            }
        }
        if current.isEmpty == false {
            sequence = try await uploadHealthSyncChunk(
                uploadSession: uploadSession,
                pairing: pairing,
                sequence: sequence,
                family: "workout_summaries",
                recordCount: current.count,
                payload: WorkoutSummariesChunkPayload(workouts: current),
                onChunkUploaded: onChunkUploaded
            )
        }
        return sequence
    }

    private func uploadChunkedWorkoutTimeSeries(
        _ workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        var currentEntries: [WorkoutTimeSeriesChunkPayload.Workout] = []
        var currentRecordCount = 0

        func flushCurrent() async throws {
            guard currentEntries.isEmpty == false else { return }
            sequence = try await uploadHealthSyncChunk(
                uploadSession: uploadSession,
                pairing: pairing,
                sequence: sequence,
                family: "workout_time_series",
                recordCount: currentRecordCount,
                payload: WorkoutTimeSeriesChunkPayload(workoutTimeSeries: currentEntries),
                onChunkUploaded: onChunkUploaded
            )
            currentEntries = []
            currentRecordCount = 0
        }

        for workout in workouts {
            var current: [CompanionSyncPayload.WorkoutTimeSeriesSample] = []
            for sample in workout.timeSeriesSamples {
                let candidate = current + [sample]
                let candidatePayload = WorkoutTimeSeriesChunkPayload(
                    workoutTimeSeries: [
                        .init(externalUid: workout.externalUid, samples: candidate)
                    ]
                )
                if current.isEmpty == false && encodedByteCount(candidatePayload) > targetBytes {
                    let entry = WorkoutTimeSeriesChunkPayload.Workout(
                        externalUid: workout.externalUid,
                        samples: current
                    )
                    let candidateEntries = currentEntries + [entry]
                    if currentEntries.isEmpty == false &&
                        encodedByteCount(WorkoutTimeSeriesChunkPayload(workoutTimeSeries: candidateEntries)) > targetBytes
                    {
                        try await flushCurrent()
                    }
                    currentEntries.append(entry)
                    currentRecordCount += entry.samples.count
                    current = [sample]
                } else {
                    current = candidate
                }
            }
            if current.isEmpty == false {
                let entry = WorkoutTimeSeriesChunkPayload.Workout(
                    externalUid: workout.externalUid,
                    samples: current
                )
                let candidateEntries = currentEntries + [entry]
                if currentEntries.isEmpty == false &&
                    encodedByteCount(WorkoutTimeSeriesChunkPayload(workoutTimeSeries: candidateEntries)) > targetBytes
                {
                    try await flushCurrent()
                }
                currentEntries.append(entry)
                currentRecordCount += entry.samples.count
            }
        }
        try await flushCurrent()
        return sequence
    }

    private func uploadChunkedWorkoutRoutes(
        _ workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        var currentEntries: [WorkoutRoutesChunkPayload.Workout] = []
        var currentRecordCount = 0

        func flushCurrent() async throws {
            guard currentEntries.isEmpty == false else { return }
            sequence = try await uploadHealthSyncChunk(
                uploadSession: uploadSession,
                pairing: pairing,
                sequence: sequence,
                family: "workout_routes",
                recordCount: currentRecordCount,
                payload: WorkoutRoutesChunkPayload(workoutRoutes: currentEntries),
                onChunkUploaded: onChunkUploaded
            )
            currentEntries = []
            currentRecordCount = 0
        }

        for workout in workouts {
            var current: [CompanionSyncPayload.WorkoutRoutePoint] = []
            for point in workout.routePoints {
                let candidate = current + [point]
                let candidatePayload = WorkoutRoutesChunkPayload(
                    workoutRoutes: [
                        .init(externalUid: workout.externalUid, routePoints: candidate)
                    ]
                )
                if current.isEmpty == false && encodedByteCount(candidatePayload) > targetBytes {
                    let entry = WorkoutRoutesChunkPayload.Workout(
                        externalUid: workout.externalUid,
                        routePoints: current
                    )
                    let candidateEntries = currentEntries + [entry]
                    if currentEntries.isEmpty == false &&
                        encodedByteCount(WorkoutRoutesChunkPayload(workoutRoutes: candidateEntries)) > targetBytes
                    {
                        try await flushCurrent()
                    }
                    currentEntries.append(entry)
                    currentRecordCount += entry.routePoints.count
                    current = [point]
                } else {
                    current = candidate
                }
            }
            if current.isEmpty == false {
                let entry = WorkoutRoutesChunkPayload.Workout(
                    externalUid: workout.externalUid,
                    routePoints: current
                )
                let candidateEntries = currentEntries + [entry]
                if currentEntries.isEmpty == false &&
                    encodedByteCount(WorkoutRoutesChunkPayload(workoutRoutes: candidateEntries)) > targetBytes
                {
                    try await flushCurrent()
                }
                currentEntries.append(entry)
                currentRecordCount += entry.routePoints.count
            }
        }
        try await flushCurrent()
        return sequence
    }

    private func uploadHealthSyncChunk<Payload: Encodable>(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        sequence: Int,
        family: String,
        recordCount: Int,
        payload: Payload,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard uploadSession.acceptedFamilies.contains(family) else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk skipped unsupported family=\(family) uploadSession=\(uploadSession.syncSessionId)"
            )
            return sequence
        }
        let chunkId = "\(uploadSession.syncSessionId)-\(String(format: "%06d", sequence))-\(family)"
        if uploadSession.receivedChunkIdSet.contains(chunkId) {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk skipped previously accepted family=\(family) sequence=\(sequence) chunkId=\(chunkId)"
            )
            await onChunkUploaded?(
                HealthSyncChunkUploadEvent(
                    chunkId: chunkId,
                    family: family,
                    sequence: sequence,
                    recordCount: recordCount,
                    byteCount: 0,
                    compressedByteCount: nil,
                    duplicate: true,
                    skipped: true,
                    receivedCount: nil,
                    receivedBytes: nil
                )
            )
            return sequence + 1
        }
        let wirePayload = try Self.healthSyncChunkWirePayload(
            payload,
            compress: uploadSession.supportsCompression
        )
        companionDebugLog(
            "ForgeSyncClient",
            "uploadHealthSyncChunk prepared family=\(family) sequence=\(sequence) chunkId=\(chunkId) records=\(recordCount) bytes=\(wirePayload.byteCount) compressedBytes=\(wirePayload.compressedByteCount ?? 0) checksumPrefix=\(String(wirePayload.checksumSha256.prefix(12))) transport=\(pairing.transport?.protocolName ?? "urlsession")"
        )
        let envelope: HealthSyncChunkEnvelope
        do {
            envelope = try await sendRequest(
                path: "/mobile/healthkit/sync-sessions/\(uploadSession.syncSessionId)/chunks",
                apiBaseUrl: pairing.apiBaseUrl,
                body: HealthSyncChunkRequest(
                    chunkId: chunkId,
                    sequence: sequence,
                    family: family,
                    recordCount: recordCount,
                    byteCount: wirePayload.byteCount,
                    compressedByteCount: wirePayload.compressedByteCount,
                    checksumSha256: wirePayload.checksumSha256,
                    payloadJsonDeflateBase64: wirePayload.payloadJsonDeflateBase64,
                    payloadJsonBase64: wirePayload.payloadJsonDeflateBase64 == nil ? wirePayload.payloadJsonBase64 : nil
                ),
                transport: pairing.transport
            )
        } catch {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk failed family=\(family) sequence=\(sequence) chunkId=\(chunkId) records=\(recordCount) bytes=\(wirePayload.byteCount) checksumPrefix=\(String(wirePayload.checksumSha256.prefix(12))) error=\(error.localizedDescription)"
            )
            throw Self.healthSyncChunkUploadError(
                wrapping: error,
                chunkId: chunkId,
                family: family,
                sequence: sequence,
                byteCount: wirePayload.byteCount,
                checksumSha256: wirePayload.checksumSha256
            )
        }
        companionDebugLog(
            "ForgeSyncClient",
            "uploadHealthSyncChunk accepted family=\(family) sequence=\(sequence) records=\(recordCount) bytes=\(wirePayload.byteCount) compressedBytes=\(wirePayload.compressedByteCount ?? 0) duplicate=\(envelope.chunk.duplicate) received=\(envelope.chunk.receivedCount)"
        )
        await onChunkUploaded?(
            HealthSyncChunkUploadEvent(
                chunkId: chunkId,
                family: family,
                sequence: sequence,
                recordCount: recordCount,
                byteCount: wirePayload.byteCount,
                compressedByteCount: wirePayload.compressedByteCount,
                duplicate: envelope.chunk.duplicate,
                skipped: false,
                receivedCount: envelope.chunk.receivedCount,
                receivedBytes: envelope.chunk.receivedBytes
            )
        )
        return sequence + 1
    }

    private func summaryOnlyWorkout(
        _ workout: CompanionSyncPayload.WorkoutSession
    ) -> CompanionSyncPayload.WorkoutSession {
        CompanionSyncPayload.WorkoutSession(
            externalUid: workout.externalUid,
            workoutType: workout.workoutType,
            sourceSystem: workout.sourceSystem,
            sourceBundleIdentifier: workout.sourceBundleIdentifier,
            sourceProductType: workout.sourceProductType,
            activity: workout.activity,
            details: workout.details,
            startedAt: workout.startedAt,
            endedAt: workout.endedAt,
            activeEnergyKcal: workout.activeEnergyKcal,
            totalEnergyKcal: workout.totalEnergyKcal,
            distanceMeters: workout.distanceMeters,
            stepCount: workout.stepCount,
            exerciseMinutes: workout.exerciseMinutes,
            averageHeartRate: workout.averageHeartRate,
            maxHeartRate: workout.maxHeartRate,
            sourceDevice: workout.sourceDevice,
            timeSeriesSamples: [],
            routePoints: [],
            captureQuality: workout.captureQuality,
            syncCursor: workout.syncCursor,
            links: workout.links,
            annotations: workout.annotations
        )
    }

    private func effectiveHealthSyncChunkTarget(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        let protocolTarget = min(uploadSession.chunkTargetBytes, max(64_000, uploadSession.chunkMaxBytes - 32_000))
        if pairing.transport?.isIrohTransport == true {
            return max(64_000, Int(Double(protocolTarget) * 0.65))
        }
        return max(64_000, protocolTarget)
    }

    private func encodedByteCount(_ value: some Encodable) -> Int {
        do {
            return try JSONEncoder().encode(value).count
        } catch {
            return Int.max
        }
    }

    static func healthSyncChunkWirePayloadForTesting(_ payload: some Encodable) throws -> HealthSyncChunkWirePayload {
        try healthSyncChunkWirePayload(payload)
    }

    static func compressedHealthSyncChunkWirePayloadForTesting(_ payload: some Encodable) throws -> HealthSyncChunkWirePayload {
        try healthSyncChunkWirePayload(payload, compress: true)
    }

    private static func healthSyncChunkWirePayload(
        _ payload: some Encodable,
        compress: Bool = false
    ) throws -> HealthSyncChunkWirePayload {
        let payloadData = try JSONEncoder().encode(payload)
        let compressedData = compress ? try? (payloadData as NSData).compressed(using: .zlib) as Data : nil
        return HealthSyncChunkWirePayload(
            payloadData: payloadData,
            compressedPayloadData: compressedData,
            payloadJsonBase64: payloadData.base64EncodedString(),
            payloadJsonDeflateBase64: compressedData?.base64EncodedString(),
            checksumSha256: sha256Hex(payloadData),
            byteCount: payloadData.count,
            compressedByteCount: compressedData?.count
        )
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func healthSyncChunkUploadError(
        wrapping error: Error,
        chunkId: String,
        family: String,
        sequence: Int,
        byteCount: Int,
        checksumSha256: String
    ) -> Error {
        let nsError = error as NSError
        var userInfo = nsError.userInfo
        userInfo["ForgeHealthSyncChunkId"] = chunkId
        userInfo["ForgeHealthSyncChunkFamily"] = family
        userInfo["ForgeHealthSyncChunkSequence"] = "\(sequence)"
        userInfo["ForgeHealthSyncChunkByteCount"] = "\(byteCount)"
        userInfo["ForgeHealthSyncChunkChecksumPrefix"] = String(checksumSha256.prefix(12))
        return NSError(domain: nsError.domain, code: nsError.code, userInfo: userInfo)
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
            ),
            transport: payload.transport
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
            ),
            transport: payload.transport
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
            ),
            transport: payload.transport
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
        limit: Int = movementTimelineServerCompatibleLimit
    ) async throws -> ForgeMovementTimelinePage {
        let requestLimit = min(max(limit, 1), Self.movementTimelineServerCompatibleLimit)
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementTimeline start session=\(payload.sessionId) before=\(before ?? "nil") limit=\(requestLimit)"
        )
        let envelope: MovementTimelineEnvelope = try await sendRequest(
            path: "/mobile/movement/timeline",
            apiBaseUrl: payload.apiBaseUrl,
            body: MovementTimelineRequest(
                sessionId: payload.sessionId,
                pairingToken: payload.pairingToken,
                before: before,
                limit: requestLimit
            ),
            transport: payload.transport
        )
        companionDebugLog(
            "ForgeSyncClient",
            "fetchMovementTimeline success segments=\(envelope.movement.segments.count) sleepOverlays=\(envelope.movement.sleepOverlays.count) hasMore=\(envelope.movement.hasMore)"
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
            ),
            transport: pairing.transport
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
        session: URLSession? = nil,
        transport: PairingTransport? = nil
    ) async throws -> Response {
        guard let url = URL(string: "\(apiBaseUrl)\(path)") else {
            companionDebugLog(
                "ForgeSyncClient",
                "sendRequest badURL apiBaseUrl=\(apiBaseUrl) path=\(path)"
            )
            throw URLError(.badURL)
        }

        var requestHeaders: [String: String] = [
            "Accept": "application/json"
        ]
        let requestBody: Data?
        if method != "GET" {
            requestHeaders["Content-Type"] = "application/json"
            requestBody = try JSONEncoder().encode(body)
        } else {
            requestBody = nil
        }

        companionDebugLog(
            "ForgeSyncClient",
            "sendRequest start method=\(method) url=\(url.absoluteString) bodyBytes=\(requestBody?.count ?? 0) transport=\(transport?.protocolName ?? "urlsession")"
        )
        let data: Data
        let httpResponse: HTTPURLResponse
        if let transport, transport.isIrohTransport {
            let irohResult = try await ForgeIrohTransportClient.send(
                method: method,
                path: apiRequestPath(apiBaseUrl: apiBaseUrl, endpointPath: path),
                headers: requestHeaders,
                body: requestBody,
                transport: transport
            )
            data = irohResult.data
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: irohResult.statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: irohResult.headers
            ) else {
                throw URLError(.badServerResponse)
            }
            httpResponse = response
        } else {
            var request = URLRequest(url: url)
            request.httpMethod = method
            for (name, value) in requestHeaders {
                request.setValue(value, forHTTPHeaderField: name)
            }
            request.httpBody = requestBody
            request.timeoutInterval = 20
            let (urlSessionData, response) = try await (session ?? Self.bootstrapSession).data(for: request)
            guard let urlSessionResponse = response as? HTTPURLResponse else {
                companionDebugLog("ForgeSyncClient", "sendRequest badServerResponse url=\(url.absoluteString)")
                throw URLError(.badServerResponse)
            }
            data = urlSessionData
            httpResponse = urlSessionResponse
        }

        companionDebugLog(
            "ForgeSyncClient",
            "sendRequest response method=\(method) url=\(url.absoluteString) status=\(httpResponse.statusCode) bytes=\(data.count)"
        )
        guard (200..<300).contains(httpResponse.statusCode) else {
            let decodedError = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            let serverMessage = decodedError.flatMap { $0.message ?? $0.error }
            let typedReason: String? = {
                guard let decodedError else { return nil }
                var parts: [String] = []
                if let code = decodedError.code, code.isEmpty == false {
                    parts.append("Forge code: \(code)")
                }
                if let recommendedMode = decodedError.recommendedMode, recommendedMode.isEmpty == false {
                    parts.append("Recommended mode: \(recommendedMode)")
                }
                if let maxBytes = decodedError.maxBytes {
                    parts.append("Max bytes: \(maxBytes)")
                }
                return parts.isEmpty ? nil : parts.joined(separator: ". ")
            }()
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
            var userInfo: [String: String] = [
                NSLocalizedDescriptionKey: serverMessage
                    ?? "Forge rejected the request with status \(httpResponse.statusCode)."
            ]
            if let failureReason = validationMessage ?? typedReason {
                userInfo[NSLocalizedFailureReasonErrorKey] = failureReason
            }
            throw NSError(
                domain: "ForgeSyncClient",
                code: httpResponse.statusCode,
                userInfo: userInfo
            )
        }

        companionDebugLog("ForgeSyncClient", "sendRequest decode success url=\(url.absoluteString)")
        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func apiRequestPath(apiBaseUrl: String, endpointPath: String) -> String {
        let basePath: String
        if let url = URL(string: apiBaseUrl) {
            basePath = url.path
                .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        } else {
            basePath = "/api/v1"
        }
        let normalizedBasePath = basePath.isEmpty ? "/api/v1" : basePath
        let normalizedEndpointPath = endpointPath.hasPrefix("/")
            ? endpointPath
            : "/\(endpointPath)"
        return "\(normalizedBasePath)\(normalizedEndpointPath)"
    }

    private func makeSession() -> URLSession {
        companionDebugLog("ForgeSyncClient", "makeSession persistent")
        return Self.bootstrapSession
    }

    private func currentDeviceDescriptor() async -> CompanionSyncPayload.Device {
        await MainActor.run {
            CompanionSyncPayload.Device(
                name: UIDevice.current.name,
                platform: "ios",
                appVersion: Bundle.main.object(
                    forInfoDictionaryKey: "CFBundleShortVersionString"
                ) as? String ?? "1.0",
                sourceDevice: UIDevice.current.model
            )
        }
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
