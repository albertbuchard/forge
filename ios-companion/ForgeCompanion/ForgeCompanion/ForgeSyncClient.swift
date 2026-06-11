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
    private static let defaultRequestTimeoutSeconds: TimeInterval = 45

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

        private enum CodingKeys: String, CodingKey {
            case ok
            case status
            case headers
            case bodyBase64
            case error
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            ok = (try? container.decode(Bool.self, forKey: .ok)) ?? false
            status = try? container.decode(Int.self, forKey: .status)
            headers = (try? container.decode([Header].self, forKey: .headers)) ?? []
            bodyBase64 = try? container.decode(String.self, forKey: .bodyBase64)
            error = try? container.decode(String.self, forKey: .error)
        }
    }

    static func send(
        method: String,
        path: String,
        headers: [String: String],
        body: Data?,
        transport: PairingTransport,
        timeoutInterval: TimeInterval? = nil
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
            let response = try decodeResponseEnvelope(outputJson)
            guard response.ok else {
                throw NSError(
                    domain: "ForgeIrohTransport",
                    code: response.status ?? -1,
                    userInfo: [
                        NSLocalizedDescriptionKey: response.error
                            ?? decodedResponseBodyString(response.bodyBase64)
                            ?? "Forge Iroh request failed."
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
            return try await awaitResult(
                task,
                timeoutNanoseconds: timeoutNanoseconds(timeoutInterval: timeoutInterval)
            )
        } catch {
            task.cancel()
            throw error
        }
    }

    static func decodedResponseEnvelopeForTesting(
        _ outputJson: String
    ) throws -> (ok: Bool, status: Int?, headers: [String: String], body: Data, error: String?) {
        let response = try decodeResponseEnvelope(outputJson)
        var headerMap: [String: String] = [:]
        for header in response.headers {
            headerMap[header.name] = header.value
        }
        let body: Data
        if let bodyBase64 = response.bodyBase64,
           let decodedBody = Data(base64Encoded: bodyBase64) {
            body = decodedBody
        } else {
            body = Data()
        }
        return (
            ok: response.ok,
            status: response.status,
            headers: headerMap,
            body: body,
            error: response.error
        )
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
                        NSLocalizedFailureReasonErrorKey: "No response arrived within \(timeoutSecondsDescription(timeoutNanoseconds)) seconds."
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

    private static func decodeResponseEnvelope(_ outputJson: String) throws -> ResponseEnvelope {
        do {
            return try JSONDecoder().decode(
                ResponseEnvelope.self,
                from: Data(outputJson.utf8)
            )
        } catch {
            throw NSError(
                domain: "ForgeIrohTransport",
                code: URLError.cannotDecodeRawData.rawValue,
                userInfo: [
                    NSLocalizedDescriptionKey: "Forge Iroh response could not be decoded.",
                    NSLocalizedFailureReasonErrorKey: outputJson.prefix(500).description
                ]
            )
        }
    }

    private static func decodedResponseBodyString(_ bodyBase64: String?) -> String? {
        guard let bodyBase64,
              let decodedBody = Data(base64Encoded: bodyBase64),
              let body = String(data: decodedBody, encoding: .utf8),
              body.isEmpty == false
        else {
            return nil
        }
        return body
    }

    private static func timeoutNanoseconds(timeoutInterval: TimeInterval?) -> UInt64 {
        let seconds = max(timeoutInterval ?? defaultRequestTimeoutSeconds, defaultRequestTimeoutSeconds)
        return UInt64(seconds * 1_000_000_000)
    }

    private static func timeoutSecondsDescription(_ timeoutNanoseconds: UInt64) -> String {
        String(format: "%.0f", Double(timeoutNanoseconds) / 1_000_000_000)
    }
}

final class ForgeBackgroundUploadCoordinator: NSObject, URLSessionDataDelegate {
    static let shared = ForgeBackgroundUploadCoordinator()
    static let sessionIdentifier = "com.albertbuchard.ForgeCompanion.healthkit.uploads"
    static let uploadBodyWriteOptions: Data.WritingOptions = []

    private final class UploadCancellationState: @unchecked Sendable {
        private let lock = NSLock()
        private var taskIdentifier: Int?
        private var cancelled = false

        func bind(taskIdentifier: Int) -> Bool {
            lock.lock()
            self.taskIdentifier = taskIdentifier
            let shouldCancel = cancelled
            lock.unlock()
            return shouldCancel
        }

        func cancel() {
            let identifier: Int?
            lock.lock()
            cancelled = true
            identifier = taskIdentifier
            lock.unlock()
            if let identifier {
                ForgeBackgroundUploadCoordinator.shared.cancelPendingUpload(taskIdentifier: identifier)
            }
        }
    }

    private struct PendingUpload {
        var data = Data()
        var response: URLResponse?
        let fileURL: URL
        let task: URLSessionUploadTask
        let continuation: CheckedContinuation<(Data, URLResponse), Error>
    }

    private let lock = NSLock()
    private var pendingUploads: [Int: PendingUpload] = [:]
    private var backgroundCompletionHandlers: [String: () -> Void] = [:]

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 60 * 60
        configuration.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
    }

    func upload(request: URLRequest, body: Data) async throws -> (Data, URLResponse) {
        var uploadRequest = request
        uploadRequest.httpBody = nil
        uploadRequest.setValue("\(body.count)", forHTTPHeaderField: "Content-Length")
        let fileURL = try writeUploadBody(body)
        let cancellationState = UploadCancellationState()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let task = session.uploadTask(with: uploadRequest, fromFile: fileURL)
                lock.lock()
                pendingUploads[task.taskIdentifier] = PendingUpload(
                    fileURL: fileURL,
                    task: task,
                    continuation: continuation
                )
                lock.unlock()
                if cancellationState.bind(taskIdentifier: task.taskIdentifier) {
                    cancelPendingUpload(taskIdentifier: task.taskIdentifier)
                } else {
                    task.resume()
                }
            }
        } onCancel: {
            cancellationState.cancel()
        }
    }

    private func cancelPendingUpload(taskIdentifier: Int) {
        lock.lock()
        let pending = pendingUploads.removeValue(forKey: taskIdentifier)
        lock.unlock()
        guard let pending else {
            return
        }
        pending.task.cancel()
        try? FileManager.default.removeItem(at: pending.fileURL)
        pending.continuation.resume(throwing: CancellationError())
    }

    func setBackgroundEventsCompletionHandler(
        _ completionHandler: @escaping () -> Void,
        for identifier: String
    ) {
        lock.lock()
        backgroundCompletionHandlers[identifier] = completionHandler
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        lock.lock()
        if var pending = pendingUploads[dataTask.taskIdentifier] {
            pending.response = response
            pendingUploads[dataTask.taskIdentifier] = pending
        }
        lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive data: Data
    ) {
        lock.lock()
        if var pending = pendingUploads[dataTask.taskIdentifier] {
            pending.data.append(data)
            pendingUploads[dataTask.taskIdentifier] = pending
        }
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        lock.lock()
        let pending = pendingUploads.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let pending else {
            companionDebugLog(
                "ForgeSyncClient",
                "background upload completed without active waiter task=\(task.taskIdentifier) error=\(error?.localizedDescription ?? "nil"); backend session status refresh will reconcile accepted chunks"
            )
            return
        }
        try? FileManager.default.removeItem(at: pending.fileURL)
        if let error {
            pending.continuation.resume(throwing: error)
            return
        }
        guard let response = pending.response ?? task.response else {
            pending.continuation.resume(throwing: URLError(.badServerResponse))
            return
        }
        pending.continuation.resume(returning: (pending.data, response))
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler: (() -> Void)?
        lock.lock()
        handler = backgroundCompletionHandlers.removeValue(forKey: session.configuration.identifier ?? "")
        lock.unlock()
        DispatchQueue.main.async {
            handler?()
        }
    }

    private func writeUploadBody(_ body: Data) throws -> URL {
        let directory = FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("ForgeBackgroundHealthUploads", isDirectory: true)
            ?? FileManager.default.temporaryDirectory
                .appendingPathComponent("ForgeBackgroundHealthUploads", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appendingPathComponent("\(UUID().uuidString).json")
        try body.write(to: fileURL, options: Self.uploadBodyWriteOptions)
        return fileURL
    }
}

struct ForgeSyncClient {
    static let movementTimelineServerCompatibleLimit = 120
    static let legacyHTTPHealthSyncChunkingVersion = "http-v1"
    static let httpBackgroundHealthSyncChunkingVersion = "http-background-v6-content-addressed-base"
    static let irohHealthSyncChunkingVersion = "iroh-v7-balanced-content-addressed-base"
    static let irohHealthSyncChunkTargetBytes = 500_000
    static let foregroundHealthSyncChunkUploadConcurrency = 4
    static let foregroundHTTPMaximumConnectionsPerHost = 6
    private static let workoutTimeSeriesEstimatedBytesPerRecord = 640
    private static let workoutRouteEstimatedBytesPerRecord = 520
    private static let healthSyncMinimumCompressionBytes = 256
    private static let lowercaseHexDigits = Array("0123456789abcdef".utf8)

    static func healthSyncChunkingVersion(for pairing: PairingPayload) -> String {
        if pairing.transport?.isIrohTransport == true {
            return irohHealthSyncChunkingVersion
        }
        return httpBackgroundHealthSyncChunkingVersion
    }

    static func shouldUseBackgroundUploadForHealthSyncChunk(
        pairing _: PairingPayload,
        appIsForegroundActive: Bool
    ) -> Bool {
        return appIsForegroundActive == false
    }

    static func healthSyncChunkUploadConcurrency(
        pairing: PairingPayload,
        useBackgroundUpload: Bool
    ) -> Int {
        if useBackgroundUpload || pairing.transport?.isIrohTransport == true {
            return 1
        }
        return foregroundHealthSyncChunkUploadConcurrency
    }

    static func shouldFallbackFromIrohToUrlSessionForTesting(
        apiBaseUrl: String,
        errorDomain: String,
        errorCode: Int,
        errorDescription: String
    ) -> Bool {
        let error = NSError(
            domain: errorDomain,
            code: errorCode,
            userInfo: [NSLocalizedDescriptionKey: errorDescription]
        )
        return shouldFallbackFromIrohToUrlSession(apiBaseUrl: apiBaseUrl, error: error)
    }

    private static let bootstrapSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = true
        configuration.httpMaximumConnectionsPerHost = foregroundHTTPMaximumConnectionsPerHost
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

        private enum CodingKeys: String, CodingKey {
            case pairingSession
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if container.contains(.pairingSession) {
                pairingSession = try container.decode(
                    CompanionPairingSessionState.self,
                    forKey: .pairingSession
                )
                return
            }
            pairingSession = try CompanionPairingSessionState(from: decoder)
        }
    }

    private struct MovementBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct SyncEnvelope: Decodable {
        let sync: SyncReceipt
    }

    struct HealthSyncWorkoutImportState: Decodable {
        let alreadyUploadedWorkoutExternalUids: [String]
        let incompleteWorkoutExternalUids: [String]?
        let alreadyUploadedWorkoutCount: Int
        let existingWorkoutCount: Int?
        let incompleteWorkoutCount: Int?
        let staleEvidenceVersionWorkoutCount: Int?
        let heartRateSampleCount: Int?
        let timeSeriesSampleCount: Int?
        let routePointCount: Int?
        let capturedAt: String?

        enum CodingKeys: String, CodingKey {
            case alreadyUploadedWorkoutExternalUids
            case incompleteWorkoutExternalUids
            case alreadyUploadedWorkoutCount
            case existingWorkoutCount
            case incompleteWorkoutCount
            case staleEvidenceVersionWorkoutCount
            case heartRateSampleCount
            case timeSeriesSampleCount
            case routePointCount
            case capturedAt
        }

        init(
            alreadyUploadedWorkoutExternalUids: [String],
            incompleteWorkoutExternalUids: [String]?,
            alreadyUploadedWorkoutCount: Int,
            existingWorkoutCount: Int?,
            incompleteWorkoutCount: Int?,
            staleEvidenceVersionWorkoutCount: Int?,
            heartRateSampleCount: Int?,
            timeSeriesSampleCount: Int?,
            routePointCount: Int?,
            capturedAt: String?
        ) {
            self.alreadyUploadedWorkoutExternalUids = alreadyUploadedWorkoutExternalUids
            self.incompleteWorkoutExternalUids = incompleteWorkoutExternalUids
            self.alreadyUploadedWorkoutCount = alreadyUploadedWorkoutCount
            self.existingWorkoutCount = existingWorkoutCount
            self.incompleteWorkoutCount = incompleteWorkoutCount
            self.staleEvidenceVersionWorkoutCount = staleEvidenceVersionWorkoutCount
            self.heartRateSampleCount = heartRateSampleCount
            self.timeSeriesSampleCount = timeSeriesSampleCount
            self.routePointCount = routePointCount
            self.capturedAt = capturedAt
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.init(
                alreadyUploadedWorkoutExternalUids: try container.decodeIfPresent(
                    [String].self,
                    forKey: .alreadyUploadedWorkoutExternalUids
                ) ?? [],
                incompleteWorkoutExternalUids: try container.decodeIfPresent(
                    [String].self,
                    forKey: .incompleteWorkoutExternalUids
                ),
                alreadyUploadedWorkoutCount: try container.decode(
                    Int.self,
                    forKey: .alreadyUploadedWorkoutCount
                ),
                existingWorkoutCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .existingWorkoutCount
                ),
                incompleteWorkoutCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .incompleteWorkoutCount
                ),
                staleEvidenceVersionWorkoutCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .staleEvidenceVersionWorkoutCount
                ),
                heartRateSampleCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .heartRateSampleCount
                ),
                timeSeriesSampleCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .timeSeriesSampleCount
                ),
                routePointCount: try container.decodeIfPresent(
                    Int.self,
                    forKey: .routePointCount
                ),
                capturedAt: try container.decodeIfPresent(
                    String.self,
                    forKey: .capturedAt
                )
            )
        }

        func preservingExternalUids(from previous: HealthSyncWorkoutImportState?) -> HealthSyncWorkoutImportState {
            guard let previous else {
                return self
            }
            let nextUploadedExternalUids = alreadyUploadedWorkoutExternalUids.isEmpty
                ? previous.alreadyUploadedWorkoutExternalUids
                : alreadyUploadedWorkoutExternalUids
            let nextIncompleteExternalUids = (incompleteWorkoutExternalUids?.isEmpty ?? true)
                ? previous.incompleteWorkoutExternalUids
                : incompleteWorkoutExternalUids
            return HealthSyncWorkoutImportState(
                alreadyUploadedWorkoutExternalUids: nextUploadedExternalUids,
                incompleteWorkoutExternalUids: nextIncompleteExternalUids,
                alreadyUploadedWorkoutCount: alreadyUploadedWorkoutCount,
                existingWorkoutCount: existingWorkoutCount,
                incompleteWorkoutCount: incompleteWorkoutCount,
                staleEvidenceVersionWorkoutCount: staleEvidenceVersionWorkoutCount,
                heartRateSampleCount: heartRateSampleCount,
                timeSeriesSampleCount: timeSeriesSampleCount,
                routePointCount: routePointCount,
                capturedAt: capturedAt
            )
        }
    }

    struct HealthSyncUploadSession: Decodable {
        let syncSessionId: String
        let schemaVersion: String
        let status: String?
        let chunkTargetBytes: Int
        let chunkMaxBytes: Int
        let chunkPayloadEncoding: String?
        let acceptedPayloadEncodings: [String]?
        let supportsCompression: Bool
        let acceptedFamilies: [String]
        let acceptedFamilySet: Set<String>
        let receivedChunkIds: [String]
        let receivedChunkIdSet: Set<String>
        let workoutImportState: HealthSyncWorkoutImportState?
        let progress: HealthSyncChunkProgress?

        enum CodingKeys: String, CodingKey {
            case syncSessionId
            case schemaVersion
            case status
            case chunkTargetBytes
            case chunkMaxBytes
            case chunkPayloadEncoding
            case acceptedPayloadEncodings
            case supportsCompression
            case acceptedFamilies
            case receivedChunkIds
            case workoutImportState
            case progress
        }

        init(
            syncSessionId: String,
            schemaVersion: String,
            status: String? = nil,
            chunkTargetBytes: Int,
            chunkMaxBytes: Int,
            chunkPayloadEncoding: String?,
            acceptedPayloadEncodings: [String]?,
            supportsCompression: Bool,
            acceptedFamilies: [String],
            receivedChunkIds: [String],
            workoutImportState: HealthSyncWorkoutImportState? = nil,
            progress: HealthSyncChunkProgress? = nil
        ) {
            self.syncSessionId = syncSessionId
            self.schemaVersion = schemaVersion
            self.status = status
            self.chunkTargetBytes = chunkTargetBytes
            self.chunkMaxBytes = chunkMaxBytes
            self.chunkPayloadEncoding = chunkPayloadEncoding
            self.acceptedPayloadEncodings = acceptedPayloadEncodings
            self.supportsCompression = supportsCompression
            self.acceptedFamilies = acceptedFamilies
            self.acceptedFamilySet = Set(acceptedFamilies)
            self.receivedChunkIds = receivedChunkIds
            self.receivedChunkIdSet = Set(receivedChunkIds)
            self.workoutImportState = workoutImportState
            self.progress = progress
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let receivedChunkIds = try container.decodeIfPresent(
                [String].self,
                forKey: .receivedChunkIds
            ) ?? []
            self.init(
                syncSessionId: try container.decode(String.self, forKey: .syncSessionId),
                schemaVersion: try container.decode(String.self, forKey: .schemaVersion),
                status: try container.decodeIfPresent(String.self, forKey: .status),
                chunkTargetBytes: try container.decode(Int.self, forKey: .chunkTargetBytes),
                chunkMaxBytes: try container.decode(Int.self, forKey: .chunkMaxBytes),
                chunkPayloadEncoding: try container.decodeIfPresent(String.self, forKey: .chunkPayloadEncoding),
                acceptedPayloadEncodings: try container.decodeIfPresent([String].self, forKey: .acceptedPayloadEncodings),
                supportsCompression: try container.decode(Bool.self, forKey: .supportsCompression),
                acceptedFamilies: try container.decode([String].self, forKey: .acceptedFamilies),
                receivedChunkIds: receivedChunkIds,
                workoutImportState: try container.decodeIfPresent(
                    HealthSyncWorkoutImportState.self,
                    forKey: .workoutImportState
                ),
                progress: try container.decodeIfPresent(HealthSyncChunkProgress.self, forKey: .progress)
            )
        }

        var supportsByteStablePayloadEncoding: Bool {
            chunkPayloadEncoding == "payload_json_base64" ||
                (acceptedPayloadEncodings ?? []).contains("payload_json_base64")
        }

        var acceptedChunkCount: Int {
            max(progress?.chunkCount ?? 0, receivedChunkIds.count)
        }

        func preservingReceivedChunkIds(from previous: HealthSyncUploadSession) -> HealthSyncUploadSession {
            guard receivedChunkIds.isEmpty, previous.receivedChunkIds.isEmpty == false else {
                return self
            }
            return HealthSyncUploadSession(
                syncSessionId: syncSessionId,
                schemaVersion: schemaVersion,
                status: status,
                chunkTargetBytes: chunkTargetBytes,
                chunkMaxBytes: chunkMaxBytes,
                chunkPayloadEncoding: chunkPayloadEncoding,
                acceptedPayloadEncodings: acceptedPayloadEncodings,
                supportsCompression: supportsCompression,
                acceptedFamilies: acceptedFamilies,
                receivedChunkIds: previous.receivedChunkIds,
                workoutImportState: workoutImportState,
                progress: progress
            )
        }

        func preservingWorkoutImportExternalUids(from previous: HealthSyncUploadSession) -> HealthSyncUploadSession {
            guard let workoutImportState else {
                return self
            }
            let preservedWorkoutImportState = workoutImportState.preservingExternalUids(
                from: previous.workoutImportState
            )
            return HealthSyncUploadSession(
                syncSessionId: syncSessionId,
                schemaVersion: schemaVersion,
                status: status,
                chunkTargetBytes: chunkTargetBytes,
                chunkMaxBytes: chunkMaxBytes,
                chunkPayloadEncoding: chunkPayloadEncoding,
                acceptedPayloadEncodings: acceptedPayloadEncodings,
                supportsCompression: supportsCompression,
                acceptedFamilies: acceptedFamilies,
                receivedChunkIds: receivedChunkIds,
                workoutImportState: preservedWorkoutImportState,
                progress: progress
            )
        }

        func preservingWorkoutImportState(from previous: HealthSyncUploadSession) -> HealthSyncUploadSession {
            guard workoutImportState == nil, let previousWorkoutImportState = previous.workoutImportState else {
                return self
            }
            return HealthSyncUploadSession(
                syncSessionId: syncSessionId,
                schemaVersion: schemaVersion,
                status: status,
                chunkTargetBytes: chunkTargetBytes,
                chunkMaxBytes: chunkMaxBytes,
                chunkPayloadEncoding: chunkPayloadEncoding,
                acceptedPayloadEncodings: acceptedPayloadEncodings,
                supportsCompression: supportsCompression,
                acceptedFamilies: acceptedFamilies,
                receivedChunkIds: receivedChunkIds,
                workoutImportState: previousWorkoutImportState,
                progress: progress
            )
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

    enum HealthSyncChunkUploadPhase {
        case scheduled
        case accepted
        case skipped
        case failed
    }

    struct HealthSyncChunkUploadEvent {
        let phase: HealthSyncChunkUploadPhase
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
        let uploadWindow: Int

        init(
            phase: HealthSyncChunkUploadPhase = .accepted,
            chunkId: String,
            family: String,
            sequence: Int,
            recordCount: Int,
            byteCount: Int,
            compressedByteCount: Int?,
            duplicate: Bool,
            skipped: Bool,
            receivedCount: Int?,
            receivedBytes: Int?,
            uploadWindow: Int = 1
        ) {
            self.phase = phase
            self.chunkId = chunkId
            self.family = family
            self.sequence = sequence
            self.recordCount = recordCount
            self.byteCount = byteCount
            self.compressedByteCount = compressedByteCount
            self.duplicate = duplicate
            self.skipped = skipped
            self.receivedCount = receivedCount
            self.receivedBytes = receivedBytes
            self.uploadWindow = uploadWindow
        }

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
        let payloadJsonBase64: String?
        let payloadJsonDeflateBase64: String?
        let checksumSha256: String
        let byteCount: Int
        let compressedByteCount: Int?
    }

    private struct HealthSyncPreparedChunkRange {
        let range: Range<Int>
        let payloadData: Data
    }

    private struct PreparedHealthSyncChunkUpload {
        let sequence: Int
        let family: String
        let recordCount: Int
        let payloadData: Data
        let chunkId: String?
    }

    struct HealthSyncPreparedChunkPlan: Equatable {
        let sequence: Int
        let family: String
        let recordCount: Int
        let byteCount: Int
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
        let measurement: WatchRouteMeasurement?
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
        let measurement: WatchRouteMeasurement?
    }

    private struct WatchCommandBatchRequest: Encodable {
        struct Command: Encodable {
            let id: String
            let kind: String
            let createdAt: String
            let payload: [String: String]
        }

        let sessionId: String
        let pairingToken: String
        let device: ForgeWatchDeviceDescriptor
        let commands: [Command]
    }

    private struct WatchCommandBatchEnvelope: Decodable {
        let receipt: ForgeWatchCommandBatchReceipt
        let watch: ForgeWatchBootstrap
        let measurement: WatchRouteMeasurement?
    }

    struct WatchCommandBatchResult {
        let receipt: ForgeWatchCommandBatchReceipt
        let watch: ForgeWatchBootstrap
    }

    private struct WatchRouteMeasurement: Decodable {
        let operation: String?
        let backendDurationMs: Double?
        let requestBytes: Int?
        let responseBytes: Int?
        let eventCount: Int?
        let commandCount: Int?
        let processedCount: Int?
        let replayedCount: Int?
        let failedCount: Int?
        let storedCount: Int?
        let duplicateCount: Int?
        let projectedCount: Int?
        let projectionFailedCount: Int?
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
        capabilities: [String],
        transport: PairingTransport? = nil
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
            session: session,
            transport: transport
        ) as OperatorSessionEnvelope

        let envelope: PairingSessionEnvelope = try await sendRequest(
            path: "/health/pairing-sessions",
            apiBaseUrl: normalizedApiBaseUrl(from: baseUrl),
            method: "POST",
            body: PairingSessionRequest(label: label, capabilities: capabilities),
            session: session,
            transport: transport
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
        workoutImportStartedAfter: Date? = nil,
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
        var metadata = [
            "clientMode": "chunked",
            "clientPlatform": "ios",
            "clientChunkingVersion": Self.healthSyncChunkingVersion(for: pairing),
            "resumeSyncSessionId": resumeSyncSessionId ?? ""
        ]
        if let workoutImportStartedAfter {
            metadata["workoutImportStartedAfter"] = Self.healthSyncMetadataDateString(
                workoutImportStartedAfter
            )
        }
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
                metadata: metadata
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
                    workoutImportStartedAfter: workoutImportStartedAfter,
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
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        let chunks = try prepareBaseHealthSyncChunks(
            payload: payload,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence
        )
        return try await uploadPreparedHealthSyncChunks(
            chunks,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    func uploadWorkoutHealthSyncChunks(
        workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        try Task.checkCancellation()
        var sequence = startingSequence
        if uploadSession.acceptedFamilySet.contains("workout_summaries") {
            let summaries = workouts.map(summaryOnlyWorkout)
            sequence = try await uploadChunkedWorkoutSummaries(
                summaries,
                uploadSession: uploadSession,
                pairing: pairing,
                startingSequence: sequence,
                useBackgroundUpload: useBackgroundUpload,
                onChunkUploaded: onChunkUploaded
            )
        }
        sequence = try await uploadChunkedWorkoutTimeSeries(
            workouts,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
        sequence = try await uploadChunkedWorkoutRoutes(
            workouts,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: sequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
        return sequence
    }

    func refreshHealthSyncSessionStatus(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        includeReceivedChunkIds: Bool = true,
        includeWorkoutImportExternalUids: Bool = true,
        includeWorkoutImportState: Bool = true
    ) async throws -> HealthSyncUploadSession {
        let sessionId = Self.queryComponent(pairing.sessionId)
        let pairingToken = Self.queryComponent(pairing.pairingToken)
        let includeReceivedChunkIdsQuery = includeReceivedChunkIds ? "true" : "false"
        let includeWorkoutImportExternalUidsQuery = includeWorkoutImportExternalUids ? "true" : "false"
        let includeWorkoutImportStateQuery = includeWorkoutImportState ? "true" : "false"
        companionDebugLog(
            "ForgeSyncClient",
            "refreshHealthSyncSessionStatus start uploadSession=\(uploadSession.syncSessionId) includeReceivedChunkIds=\(includeReceivedChunkIds) includeWorkoutImportExternalUids=\(includeWorkoutImportExternalUids) includeWorkoutImportState=\(includeWorkoutImportState)"
        )
        let envelope: HealthSyncSessionStartEnvelope = try await sendRequest(
            path: "/mobile/healthkit/sync-sessions/\(uploadSession.syncSessionId)?sessionId=\(sessionId)&pairingToken=\(pairingToken)&includeReceivedChunkIds=\(includeReceivedChunkIdsQuery)&includeWorkoutImportExternalUids=\(includeWorkoutImportExternalUidsQuery)&includeWorkoutImportState=\(includeWorkoutImportStateQuery)",
            apiBaseUrl: pairing.apiBaseUrl,
            method: "GET",
            body: Optional<String>.none as String?,
            transport: pairing.transport
        )
        var refreshedUpload = includeReceivedChunkIds
            ? envelope.upload
            : envelope.upload.preservingReceivedChunkIds(from: uploadSession)
        if includeWorkoutImportExternalUids == false {
            refreshedUpload = refreshedUpload.preservingWorkoutImportExternalUids(
                from: uploadSession
            )
        }
        if includeWorkoutImportState == false {
            refreshedUpload = refreshedUpload.preservingWorkoutImportState(
                from: uploadSession
            )
        }
        companionDebugLog(
            "ForgeSyncClient",
            "refreshHealthSyncSessionStatus success uploadSession=\(refreshedUpload.syncSessionId) acceptedChunks=\(refreshedUpload.receivedChunkIds.count) includeReceivedChunkIds=\(includeReceivedChunkIds) includeWorkoutImportExternalUids=\(includeWorkoutImportExternalUids) includeWorkoutImportState=\(includeWorkoutImportState)"
        )
        return refreshedUpload
    }

    func uploadWorkoutArchiveHealthSyncChunks(
        workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool = true,
        onChunkUploaded: HealthSyncChunkUploadHandler? = nil
    ) async throws -> Int {
        guard workouts.isEmpty == false else {
            return startingSequence
        }
        guard uploadSession.acceptedFamilySet.contains("workout_archive") else {
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
            useBackgroundUpload: useBackgroundUpload,
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
            transport: pairing.transport,
            timeoutInterval: 60
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

    private func prepareBaseHealthSyncChunks(
        payload: CompanionSyncPayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int
    ) throws -> [PreparedHealthSyncChunkUpload] {
        var sequence = startingSequence
        var chunks: [PreparedHealthSyncChunkUpload] = []

        func appendChunks<Record, Payload: Encodable>(
            records: [Record],
            family: String,
            makePayload: ([Record]) -> Payload
        ) throws {
            let prepared = try prepareArrayHealthSyncChunks(
                records: records,
                uploadSession: uploadSession,
                pairing: pairing,
                family: family,
                startingSequence: sequence,
                makePayload: makePayload
            )
            chunks.append(contentsOf: prepared)
            sequence += prepared.count
        }

        try appendChunks(
            records: payload.sleepNights,
            family: "sleep_nights"
        ) { SleepNightsChunkPayload(sleepNights: $0) }
        try appendChunks(
            records: payload.sleepSegments,
            family: "sleep_segments"
        ) { SleepSegmentsChunkPayload(sleepSegments: $0) }
        try appendChunks(
            records: payload.sleepRawRecords,
            family: "sleep_raw_records"
        ) { SleepRawRecordsChunkPayload(sleepRawRecords: $0) }
        try appendChunks(
            records: payload.vitals.daySummaries,
            family: "vitals"
        ) { VitalsChunkPayload(vitals: .init(daySummaries: $0)) }
        try appendChunks(
            records: payload.movement.knownPlaces,
            family: "movement"
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: payload.movement.settings,
                    knownPlaces: records,
                    stays: [],
                    trips: []
                )
            )
        }
        try appendChunks(
            records: payload.movement.stays,
            family: "movement"
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: payload.movement.settings,
                    knownPlaces: [],
                    stays: records,
                    trips: []
                )
            )
        }
        try appendChunks(
            records: payload.movement.trips,
            family: "movement"
        ) { records in
            MovementChunkPayload(
                movement: .init(
                    settings: payload.movement.settings,
                    knownPlaces: [],
                    stays: [],
                    trips: records
                )
            )
        }
        try appendChunks(
            records: payload.screenTime.daySummaries,
            family: "screen_time"
        ) { records in
            ScreenTimeChunkPayload(
                screenTime: .init(
                    settings: payload.screenTime.settings,
                    daySummaries: records,
                    hourlySegments: []
                )
            )
        }
        try appendChunks(
            records: payload.screenTime.hourlySegments,
            family: "screen_time"
        ) { records in
            ScreenTimeChunkPayload(
                screenTime: .init(
                    settings: payload.screenTime.settings,
                    daySummaries: [],
                    hourlySegments: records
                )
            )
        }
        return chunks
    }

    private func prepareArrayHealthSyncChunks<Record, Payload: Encodable>(
        records: [Record],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        family: String,
        startingSequence: Int,
        makePayload: ([Record]) -> Payload
    ) throws -> [PreparedHealthSyncChunkUpload] {
        guard records.isEmpty == false else {
            return []
        }
        guard uploadSession.acceptedFamilySet.contains(family) else {
            companionDebugLog(
                "ForgeSyncClient",
                "prepareArrayHealthSyncChunks skipped unsupported family=\(family) uploadSession=\(uploadSession.syncSessionId)"
            )
            return []
        }
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        let preparedRanges = try Self.healthSyncPreparedChunkRanges(
            recordCount: records.count,
            targetBytes: targetBytes
        ) { range in
            try Self.healthSyncChunkPayloadData(makePayload(Array(records[range])))
        }
        return preparedRanges.enumerated().map { offset, preparedRange in
            PreparedHealthSyncChunkUpload(
                sequence: startingSequence + offset,
                family: family,
                recordCount: preparedRange.range.count,
                payloadData: preparedRange.payloadData,
                chunkId: nil
            )
        }
    }

    private func uploadArrayHealthSyncChunks<Record, Payload: Encodable>(
        records: [Record],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        family: String,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?,
        makePayload: ([Record]) -> Payload
    ) async throws -> Int {
        let chunks = try prepareArrayHealthSyncChunks(
            records: records,
            uploadSession: uploadSession,
            pairing: pairing,
            family: family,
            startingSequence: startingSequence,
            makePayload: makePayload
        )
        return try await uploadPreparedHealthSyncChunks(
            chunks,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    private func uploadPreparedHealthSyncChunks(
        _ chunks: [PreparedHealthSyncChunkUpload],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard chunks.isEmpty == false else {
            return startingSequence
        }
        let concurrency = Self.healthSyncChunkUploadConcurrency(
            pairing: pairing,
            useBackgroundUpload: useBackgroundUpload
        )
        guard concurrency > 1, chunks.count > 1 else {
            var sequence = startingSequence
            for chunk in chunks {
                sequence = try await uploadHealthSyncChunk(
                    uploadSession: uploadSession,
                    pairing: pairing,
                    sequence: chunk.sequence,
                    family: chunk.family,
                    recordCount: chunk.recordCount,
                    payloadData: chunk.payloadData,
                    chunkId: chunk.chunkId,
                    useBackgroundUpload: useBackgroundUpload,
                    onChunkUploaded: onChunkUploaded
                )
            }
            return sequence
        }

        companionDebugLog(
            "ForgeSyncClient",
            "uploadHealthSyncChunks concurrent start count=\(chunks.count) window=\(concurrency) firstSequence=\(startingSequence) transport=\(pairing.transport?.protocolName ?? "urlsession")"
        )
        var iterator = chunks.makeIterator()
        var scheduledCount = 0
        try await withThrowingTaskGroup(of: Void.self) { group in
            func scheduleNext() {
                guard let chunk = iterator.next() else {
                    return
                }
                scheduledCount += 1
                group.addTask { [self] in
                    _ = try await uploadHealthSyncChunk(
                        uploadSession: uploadSession,
                        pairing: pairing,
                        sequence: chunk.sequence,
                        family: chunk.family,
                        recordCount: chunk.recordCount,
                        payloadData: chunk.payloadData,
                        chunkId: chunk.chunkId,
                        useBackgroundUpload: useBackgroundUpload,
                        onChunkUploaded: onChunkUploaded
                    )
                }
            }

            let initialWindow = min(concurrency, chunks.count)
            for _ in 0..<initialWindow {
                scheduleNext()
            }
            while try await group.next() != nil {
                scheduleNext()
            }
        }
        companionDebugLog(
            "ForgeSyncClient",
            "uploadHealthSyncChunks concurrent complete count=\(chunks.count) scheduled=\(scheduledCount) nextSequence=\(startingSequence + chunks.count)"
        )
        return startingSequence + chunks.count
    }

    private func uploadMovementHealthSyncChunks(
        _ movement: CompanionSyncPayload.MovementPayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        sequence = try await uploadArrayHealthSyncChunks(
            records: movement.knownPlaces,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "movement",
            startingSequence: sequence,
            useBackgroundUpload: useBackgroundUpload,
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
            useBackgroundUpload: useBackgroundUpload,
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
            useBackgroundUpload: useBackgroundUpload,
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
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        var sequence = startingSequence
        sequence = try await uploadArrayHealthSyncChunks(
            records: screenTime.daySummaries,
            uploadSession: uploadSession,
            pairing: pairing,
            family: "screen_time",
            startingSequence: sequence,
            useBackgroundUpload: useBackgroundUpload,
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
            useBackgroundUpload: useBackgroundUpload,
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
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard workouts.isEmpty == false else {
            return startingSequence
        }
        var sequence = startingSequence
        var chunks: [PreparedHealthSyncChunkUpload] = []
        let recordLimit = workoutSummaryChunkRecordLimit(uploadSession: uploadSession, pairing: pairing)
        var lowerBound = 0
        while lowerBound < workouts.count {
            try Task.checkCancellation()
            let upperBound = min(workouts.count, lowerBound + recordLimit)
            let records = Array(workouts[lowerBound..<upperBound])
            let payloadData = try Self.healthSyncChunkPayloadData(
                WorkoutSummariesChunkPayload(workouts: records)
            )
            chunks.append(
                PreparedHealthSyncChunkUpload(
                    sequence: sequence,
                    family: "workout_summaries",
                    recordCount: records.count,
                    payloadData: payloadData,
                    chunkId: nil
                )
            )
            sequence += 1
            lowerBound = upperBound
        }
        return try await uploadPreparedHealthSyncChunks(
            chunks,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    private func uploadChunkedWorkoutTimeSeries(
        _ workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard uploadSession.acceptedFamilySet.contains("workout_time_series") else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadChunkedWorkoutTimeSeries skipped unsupported family=workout_time_series uploadSession=\(uploadSession.syncSessionId)"
            )
            return startingSequence
        }
        var sequence = startingSequence
        let recordLimit = workoutTimeSeriesChunkRecordLimit(uploadSession: uploadSession, pairing: pairing)
        var currentEntries: [WorkoutTimeSeriesChunkPayload.Workout] = []
        var currentRecordCount = 0
        var chunks: [PreparedHealthSyncChunkUpload] = []

        func flushCurrent() throws {
            guard currentEntries.isEmpty == false else { return }
            try Task.checkCancellation()
            let entries = currentEntries
            let recordCount = currentRecordCount
            let payloadData = try Self.healthSyncChunkPayloadData(
                WorkoutTimeSeriesChunkPayload(workoutTimeSeries: entries)
            )
            chunks.append(
                PreparedHealthSyncChunkUpload(
                    sequence: sequence,
                    family: "workout_time_series",
                    recordCount: recordCount,
                    payloadData: payloadData,
                    chunkId: nil
                )
            )
            sequence += 1
            currentEntries = []
            currentRecordCount = 0
        }

        for workout in workouts {
            var lowerBound = 0
            while lowerBound < workout.timeSeriesSamples.count {
                try Task.checkCancellation()
                if currentRecordCount >= recordLimit {
                    try flushCurrent()
                }
                let remainingCapacity = max(1, recordLimit - currentRecordCount)
                let upperBound = min(workout.timeSeriesSamples.count, lowerBound + remainingCapacity)
                let samples = Array(workout.timeSeriesSamples[lowerBound..<upperBound])
                let entry = WorkoutTimeSeriesChunkPayload.Workout(
                    externalUid: workout.externalUid,
                    samples: samples
                )
                currentEntries.append(entry)
                currentRecordCount += entry.samples.count
                lowerBound = upperBound
            }
        }
        try flushCurrent()
        return try await uploadPreparedHealthSyncChunks(
            chunks,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    private func uploadChunkedWorkoutRoutes(
        _ workouts: [CompanionSyncPayload.WorkoutSession],
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard uploadSession.acceptedFamilySet.contains("workout_routes") else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadChunkedWorkoutRoutes skipped unsupported family=workout_routes uploadSession=\(uploadSession.syncSessionId)"
            )
            return startingSequence
        }
        var sequence = startingSequence
        let recordLimit = workoutRouteChunkRecordLimit(uploadSession: uploadSession, pairing: pairing)
        var currentEntries: [WorkoutRoutesChunkPayload.Workout] = []
        var currentRecordCount = 0
        var chunks: [PreparedHealthSyncChunkUpload] = []

        func flushCurrent() throws {
            guard currentEntries.isEmpty == false else { return }
            try Task.checkCancellation()
            let entries = currentEntries
            let recordCount = currentRecordCount
            let payloadData = try Self.healthSyncChunkPayloadData(
                WorkoutRoutesChunkPayload(workoutRoutes: entries)
            )
            chunks.append(
                PreparedHealthSyncChunkUpload(
                    sequence: sequence,
                    family: "workout_routes",
                    recordCount: recordCount,
                    payloadData: payloadData,
                    chunkId: nil
                )
            )
            sequence += 1
            currentEntries = []
            currentRecordCount = 0
        }

        for workout in workouts {
            var lowerBound = 0
            while lowerBound < workout.routePoints.count {
                try Task.checkCancellation()
                if currentRecordCount >= recordLimit {
                    try flushCurrent()
                }
                let remainingCapacity = max(1, recordLimit - currentRecordCount)
                let upperBound = min(workout.routePoints.count, lowerBound + remainingCapacity)
                let routePoints = Array(workout.routePoints[lowerBound..<upperBound])
                let entry = WorkoutRoutesChunkPayload.Workout(
                    externalUid: workout.externalUid,
                    routePoints: routePoints
                )
                currentEntries.append(entry)
                currentRecordCount += entry.routePoints.count
                lowerBound = upperBound
            }
        }
        try flushCurrent()
        return try await uploadPreparedHealthSyncChunks(
            chunks,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    private func workoutSummaryChunkRecordLimit(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        Self.healthSyncChunkRecordLimit(
            uploadSession: uploadSession,
            pairing: pairing,
            estimatedBytesPerRecord: 4_000,
            minimum: 20,
            maximum: 250
        )
    }

    private func workoutTimeSeriesChunkRecordLimit(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        Self.healthSyncChunkRecordLimit(
            uploadSession: uploadSession,
            pairing: pairing,
            estimatedBytesPerRecord: Self.workoutTimeSeriesEstimatedBytesPerRecord,
            minimum: 500,
            maximum: 12_000
        )
    }

    private func workoutRouteChunkRecordLimit(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        Self.healthSyncChunkRecordLimit(
            uploadSession: uploadSession,
            pairing: pairing,
            estimatedBytesPerRecord: Self.workoutRouteEstimatedBytesPerRecord,
            minimum: 500,
            maximum: 15_000
        )
    }

    static func healthSyncChunkRecordLimitForTesting(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        estimatedBytesPerRecord: Int,
        minimum: Int,
        maximum: Int
    ) -> Int {
        healthSyncChunkRecordLimit(
            uploadSession: uploadSession,
            pairing: pairing,
            estimatedBytesPerRecord: estimatedBytesPerRecord,
            minimum: minimum,
            maximum: maximum
        )
    }

    static func healthSyncChunkRangesForTesting(
        recordCount: Int,
        targetBytes: Int,
        encodedByteCount: (Range<Int>) -> Int
    ) -> [Range<Int>] {
        healthSyncChunkRanges(
            recordCount: recordCount,
            targetBytes: targetBytes,
            encodedByteCount: encodedByteCount
        )
    }

    static func healthSyncPreparedChunkRangesForTesting(
        recordCount: Int,
        targetBytes: Int,
        encodedPayloadData: (Range<Int>) throws -> Data
    ) throws -> [(range: Range<Int>, byteCount: Int)] {
        try healthSyncPreparedChunkRanges(
            recordCount: recordCount,
            targetBytes: targetBytes,
            encodedPayloadData: encodedPayloadData
        ).map { (range: $0.range, byteCount: $0.payloadData.count) }
    }

    func baseHealthSyncPreparedChunkPlanForTesting(
        payload: CompanionSyncPayload,
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        startingSequence: Int
    ) throws -> [HealthSyncPreparedChunkPlan] {
        try prepareBaseHealthSyncChunks(
            payload: payload,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: startingSequence
        ).map {
            HealthSyncPreparedChunkPlan(
                sequence: $0.sequence,
                family: $0.family,
                recordCount: $0.recordCount,
                byteCount: $0.payloadData.count
            )
        }
    }

    private static func healthSyncChunkRanges(
        recordCount: Int,
        targetBytes: Int,
        encodedByteCount: (Range<Int>) -> Int
    ) -> [Range<Int>] {
        guard recordCount > 0 else {
            return []
        }
        let boundedTargetBytes = max(1, targetBytes)
        var ranges: [Range<Int>] = []
        var lowerBound = 0
        while lowerBound < recordCount {
            var bestUpperBound = lowerBound + 1
            var candidateUpperBound = min(recordCount, lowerBound + 2)

            while candidateUpperBound <= recordCount {
                if encodedByteCount(lowerBound..<candidateUpperBound) > boundedTargetBytes {
                    break
                }
                bestUpperBound = candidateUpperBound
                if candidateUpperBound == recordCount {
                    break
                }
                let currentWidth = max(1, candidateUpperBound - lowerBound)
                candidateUpperBound = min(recordCount, lowerBound + currentWidth * 2)
            }

            var binaryLowerBound = bestUpperBound + 1
            var binaryUpperBound = candidateUpperBound - 1
            while binaryLowerBound <= binaryUpperBound {
                let midpoint = binaryLowerBound + (binaryUpperBound - binaryLowerBound) / 2
                if encodedByteCount(lowerBound..<midpoint) <= boundedTargetBytes {
                    bestUpperBound = midpoint
                    binaryLowerBound = midpoint + 1
                } else {
                    binaryUpperBound = midpoint - 1
                }
            }

            ranges.append(lowerBound..<bestUpperBound)
            lowerBound = bestUpperBound
        }
        return ranges
    }

    private static func healthSyncPreparedChunkRanges(
        recordCount: Int,
        targetBytes: Int,
        encodedPayloadData: (Range<Int>) throws -> Data
    ) throws -> [HealthSyncPreparedChunkRange] {
        guard recordCount > 0 else {
            return []
        }
        let boundedTargetBytes = max(1, targetBytes)
        var ranges: [HealthSyncPreparedChunkRange] = []
        var lowerBound = 0
        while lowerBound < recordCount {
            var bestUpperBound = lowerBound + 1
            var bestPayloadData: Data?
            var candidateUpperBound = min(recordCount, lowerBound + 2)

            while candidateUpperBound <= recordCount {
                let candidatePayloadData = try encodedPayloadData(lowerBound..<candidateUpperBound)
                if candidatePayloadData.count > boundedTargetBytes {
                    break
                }
                bestUpperBound = candidateUpperBound
                bestPayloadData = candidatePayloadData
                if candidateUpperBound == recordCount {
                    break
                }
                let currentWidth = max(1, candidateUpperBound - lowerBound)
                candidateUpperBound = min(recordCount, lowerBound + currentWidth * 2)
            }

            var binaryLowerBound = bestUpperBound + 1
            var binaryUpperBound = candidateUpperBound - 1
            while binaryLowerBound <= binaryUpperBound {
                let midpoint = binaryLowerBound + (binaryUpperBound - binaryLowerBound) / 2
                let midpointPayloadData = try encodedPayloadData(lowerBound..<midpoint)
                if midpointPayloadData.count <= boundedTargetBytes {
                    bestUpperBound = midpoint
                    bestPayloadData = midpointPayloadData
                    binaryLowerBound = midpoint + 1
                } else {
                    binaryUpperBound = midpoint - 1
                }
            }

            let selectedRange = lowerBound..<bestUpperBound
            let selectedPayloadData = try bestPayloadData ?? encodedPayloadData(selectedRange)
            ranges.append(
                HealthSyncPreparedChunkRange(
                    range: selectedRange,
                    payloadData: selectedPayloadData
                )
            )
            lowerBound = bestUpperBound
        }
        return ranges
    }

    private static func healthSyncChunkRecordLimit(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        estimatedBytesPerRecord: Int,
        minimum: Int,
        maximum: Int
    ) -> Int {
        let targetBytes = effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
        let estimatedLimit = targetBytes / max(1, estimatedBytesPerRecord)
        if targetBytes < minimum * estimatedBytesPerRecord {
            return min(maximum, max(1, estimatedLimit))
        }
        return min(maximum, max(minimum, estimatedLimit))
    }

    static func healthSyncContentAddressedChunkId(
        uploadSession: HealthSyncUploadSession,
        sequence: Int,
        family: String,
        checksumSha256: String
    ) -> String {
        "\(uploadSession.syncSessionId)-\(String(format: "%06d", sequence))-\(family)-\(String(checksumSha256.prefix(20)))"
    }

    private static func queryComponent(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func healthSyncMetadataDateString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func uploadHealthSyncChunk<Payload: Encodable>(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        sequence: Int,
        family: String,
        recordCount: Int,
        payload: Payload,
        precomputedPayloadData: Data? = nil,
        chunkId: String? = nil,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        guard uploadSession.acceptedFamilySet.contains(family) else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk skipped unsupported family=\(family) uploadSession=\(uploadSession.syncSessionId)"
            )
            return sequence
        }
        let payloadData = try precomputedPayloadData ?? Self.healthSyncChunkPayloadData(payload)
        return try await uploadHealthSyncChunk(
            uploadSession: uploadSession,
            pairing: pairing,
            sequence: sequence,
            family: family,
            recordCount: recordCount,
            payloadData: payloadData,
            chunkId: chunkId,
            useBackgroundUpload: useBackgroundUpload,
            onChunkUploaded: onChunkUploaded
        )
    }

    private func uploadHealthSyncChunk(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload,
        sequence: Int,
        family: String,
        recordCount: Int,
        payloadData: Data,
        chunkId: String? = nil,
        useBackgroundUpload: Bool,
        onChunkUploaded: HealthSyncChunkUploadHandler?
    ) async throws -> Int {
        try Task.checkCancellation()
        guard uploadSession.acceptedFamilySet.contains(family) else {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk skipped unsupported family=\(family) uploadSession=\(uploadSession.syncSessionId)"
            )
            return sequence
        }
        let checksumSha256 = Self.sha256Hex(payloadData)
        let effectiveChunkId = chunkId ?? Self.healthSyncContentAddressedChunkId(
            uploadSession: uploadSession,
            sequence: sequence,
            family: family,
            checksumSha256: checksumSha256
        )
        if uploadSession.receivedChunkIdSet.contains(effectiveChunkId) {
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk skipped backend-accepted family=\(family) sequence=\(sequence) chunkId=\(effectiveChunkId)"
            )
            await onChunkUploaded?(
                HealthSyncChunkUploadEvent(
                    phase: .skipped,
                    chunkId: effectiveChunkId,
                    family: family,
                    sequence: sequence,
                    recordCount: recordCount,
                    byteCount: 0,
                    compressedByteCount: nil,
                    duplicate: true,
                    skipped: true,
                    receivedCount: nil,
                    receivedBytes: nil,
                    uploadWindow: Self.healthSyncChunkUploadConcurrency(
                        pairing: pairing,
                        useBackgroundUpload: useBackgroundUpload
                    )
                )
            )
            return sequence + 1
        }
        let wirePayload = try Self.healthSyncChunkWirePayload(
            payloadData: payloadData,
            compress: uploadSession.supportsCompression,
            checksumSha256: checksumSha256
        )
        companionDebugLog(
            "ForgeSyncClient",
            "uploadHealthSyncChunk prepared family=\(family) sequence=\(sequence) chunkId=\(effectiveChunkId) records=\(recordCount) bytes=\(wirePayload.byteCount) compressedBytes=\(wirePayload.compressedByteCount ?? 0) checksumPrefix=\(String(wirePayload.checksumSha256.prefix(12))) transport=\(pairing.transport?.protocolName ?? "urlsession") uploadTransport=\(useBackgroundUpload ? "urlsession-background" : "urlsession-foreground")"
        )
        let uploadWindow = Self.healthSyncChunkUploadConcurrency(
            pairing: pairing,
            useBackgroundUpload: useBackgroundUpload
        )
        await onChunkUploaded?(
            HealthSyncChunkUploadEvent(
                phase: .scheduled,
                chunkId: effectiveChunkId,
                family: family,
                sequence: sequence,
                recordCount: recordCount,
                byteCount: wirePayload.byteCount,
                compressedByteCount: wirePayload.compressedByteCount,
                duplicate: false,
                skipped: false,
                receivedCount: nil,
                receivedBytes: nil,
                uploadWindow: uploadWindow
            )
        )
        let envelope: HealthSyncChunkEnvelope
        do {
            envelope = try await sendRequest(
                path: "/mobile/healthkit/sync-sessions/\(uploadSession.syncSessionId)/chunks",
                apiBaseUrl: pairing.apiBaseUrl,
                body: HealthSyncChunkRequest(
                    chunkId: effectiveChunkId,
                    sequence: sequence,
                    family: family,
                    recordCount: recordCount,
                    byteCount: wirePayload.byteCount,
                    compressedByteCount: wirePayload.compressedByteCount,
                    checksumSha256: wirePayload.checksumSha256,
                    payloadJsonDeflateBase64: wirePayload.payloadJsonDeflateBase64,
                    payloadJsonBase64: wirePayload.payloadJsonBase64
                ),
                transport: pairing.transport,
                timeoutInterval: 120,
                useBackgroundUpload: useBackgroundUpload
            )
        } catch {
            let nsError = error as NSError
            companionDebugLog(
                "ForgeSyncClient",
                "uploadHealthSyncChunk failed family=\(family) sequence=\(sequence) chunkId=\(effectiveChunkId) records=\(recordCount) bytes=\(wirePayload.byteCount) checksumPrefix=\(String(wirePayload.checksumSha256.prefix(12))) domain=\(nsError.domain) code=\(nsError.code) description=\(nsError.localizedDescription) reason=\((nsError.userInfo[NSLocalizedFailureReasonErrorKey] as? String) ?? "nil")"
            )
            await onChunkUploaded?(
                HealthSyncChunkUploadEvent(
                    phase: .failed,
                    chunkId: effectiveChunkId,
                    family: family,
                    sequence: sequence,
                    recordCount: recordCount,
                    byteCount: wirePayload.byteCount,
                    compressedByteCount: wirePayload.compressedByteCount,
                    duplicate: false,
                    skipped: false,
                    receivedCount: nil,
                    receivedBytes: nil,
                    uploadWindow: uploadWindow
                )
            )
            throw Self.healthSyncChunkUploadError(
                wrapping: error,
                chunkId: effectiveChunkId,
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
                phase: .accepted,
                chunkId: effectiveChunkId,
                family: family,
                sequence: sequence,
                recordCount: recordCount,
                byteCount: wirePayload.byteCount,
                compressedByteCount: wirePayload.compressedByteCount,
                duplicate: envelope.chunk.duplicate,
                skipped: false,
                receivedCount: envelope.chunk.receivedCount,
                receivedBytes: envelope.chunk.receivedBytes,
                uploadWindow: uploadWindow
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
        Self.effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
    }

    static func effectiveHealthSyncChunkTargetForTesting(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        effectiveHealthSyncChunkTarget(uploadSession: uploadSession, pairing: pairing)
    }

    static func pairingHeartbeatSessionStateForTesting(from data: Data) throws -> CompanionPairingSessionState {
        try JSONDecoder().decode(PairingHeartbeatEnvelope.self, from: data).pairingSession
    }

    private static func effectiveHealthSyncChunkTarget(
        uploadSession: HealthSyncUploadSession,
        pairing: PairingPayload
    ) -> Int {
        let protocolTarget = min(uploadSession.chunkTargetBytes, max(64_000, uploadSession.chunkMaxBytes - 32_000))
        if pairing.transport?.isIrohTransport == true {
            return max(64_000, min(protocolTarget, irohHealthSyncChunkTargetBytes))
        }
        // Tailscale/HTTP intermediaries have shown 502s on large route chunks well
        // below the advertised server body limit. The HTTP request body carries a
        // base64 JSON envelope, so keep raw chunks comfortably under proxy limits.
        return max(128_000, min(protocolTarget, 500_000))
    }

    private func encodedByteCount(_ value: some Encodable) -> Int {
        do {
            return try Self.healthSyncChunkPayloadData(value).count
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

    static func healthSyncAcceptedChunkIdForTesting(
        syncSessionId: String,
        sequence: Int,
        family: String,
        payload: some Encodable
    ) throws -> String {
        let payloadData = try healthSyncChunkPayloadData(payload)
        return "\(syncSessionId)-\(String(format: "%06d", sequence))-\(family)-\(String(sha256Hex(payloadData).prefix(20)))"
    }

    private static func healthSyncChunkWirePayload(
        _ payload: some Encodable,
        precomputedPayloadData: Data? = nil,
        compress: Bool = false
    ) throws -> HealthSyncChunkWirePayload {
        let payloadData = try precomputedPayloadData ?? healthSyncChunkPayloadData(payload)
        return try healthSyncChunkWirePayload(payloadData: payloadData, compress: compress)
    }

    private static func healthSyncChunkWirePayload(
        payloadData: Data,
        compress: Bool = false,
        checksumSha256: String? = nil
    ) throws -> HealthSyncChunkWirePayload {
        let shouldTryCompression = compress && payloadData.count >= healthSyncMinimumCompressionBytes
        let candidateCompressedData = shouldTryCompression ? try? (payloadData as NSData).compressed(using: .zlib) as Data : nil
        let compressedData = candidateCompressedData.flatMap { compressed in
            compressed.count < payloadData.count ? compressed : nil
        }
        return HealthSyncChunkWirePayload(
            payloadData: payloadData,
            compressedPayloadData: compressedData,
            payloadJsonBase64: compressedData == nil ? payloadData.base64EncodedString() : nil,
            payloadJsonDeflateBase64: compressedData?.base64EncodedString(),
            checksumSha256: checksumSha256 ?? sha256Hex(payloadData),
            byteCount: payloadData.count,
            compressedByteCount: compressedData?.count
        )
    }

    private static func healthSyncChunkPayloadData(_ payload: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(payload)
    }

    private static func sha256Hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        var hex = [UInt8]()
        hex.reserveCapacity(SHA256.byteCount * 2)
        for byte in digest {
            hex.append(lowercaseHexDigits[Int(byte >> 4)])
            hex.append(lowercaseHexDigits[Int(byte & 0x0f)])
        }
        return String(decoding: hex, as: UTF8.self)
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
        let startedAt = Date()
        let request = WatchBootstrapRequest(
            sessionId: payload.sessionId,
            pairingToken: payload.pairingToken
        )
        let requestBytes = (try? JSONEncoder().encode(request).count) ?? 0
        companionDebugLog(
            "ForgeSyncClient",
            "fetchWatchBootstrap start session=\(payload.sessionId) requestBytes=\(requestBytes)"
        )
        let envelope: WatchBootstrapEnvelope = try await sendRequest(
            path: "/mobile/watch/bootstrap",
            apiBaseUrl: payload.apiBaseUrl,
            body: request,
            transport: payload.transport
        )
        let responseBytes = (try? JSONEncoder().encode(envelope.watch).count) ?? 0
        let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        let serverMeasurement = envelope.measurement.map {
            " backendDurationMs=\($0.backendDurationMs ?? -1) backendRequestBytes=\($0.requestBytes ?? -1) backendResponseBytes=\($0.responseBytes ?? -1)"
        } ?? ""
        companionDebugLog(
            "ForgeSyncClient",
            "fetchWatchBootstrap success habits=\(envelope.watch.habits.count) prompts=\(envelope.watch.pendingPrompts.count) responseBytes=\(responseBytes) durationMs=\(durationMs)\(serverMeasurement)"
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
        let startedAt = Date()
        let request = WatchCaptureBatchRequest(
            sessionId: pairing.sessionId,
            pairingToken: pairing.pairingToken,
            device: device,
            events: actions.enumerated().map { index, action in
                WatchCaptureBatchRequest.Event(
                    dedupeKey: actions.count == 1 ? envelopeId : "\(envelopeId)-\(index)",
                    eventType: action.eventType,
                    recordedAt: action.recordedAt,
                    promptId: action.promptId,
                    linkedContext: action.linkedContext,
                    payload: action.payload
                )
            }
        )
        let requestBytes = (try? JSONEncoder().encode(request).count) ?? 0
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCaptureBatch start action=\(envelopeId) events=\(actions.count) requestBytes=\(requestBytes)"
        )
        let envelope: WatchCaptureBatchEnvelope = try await sendRequest(
            path: "/mobile/watch/capture-events:batch",
            apiBaseUrl: pairing.apiBaseUrl,
            body: request,
            transport: pairing.transport
        )
        let responseBytes = (try? JSONEncoder().encode(envelope.watch).count) ?? 0
        let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        let serverMeasurement = envelope.measurement.map {
            " backendDurationMs=\($0.backendDurationMs ?? -1) backendRequestBytes=\($0.requestBytes ?? -1) backendResponseBytes=\($0.responseBytes ?? -1) stored=\($0.storedCount ?? -1) duplicate=\($0.duplicateCount ?? -1) projected=\($0.projectedCount ?? -1) projectionFailed=\($0.projectionFailedCount ?? -1)"
        } ?? ""
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCaptureBatch success action=\(envelopeId) responseBytes=\(responseBytes) durationMs=\(durationMs)\(serverMeasurement)"
        )
        return envelope.watch
    }

    func submitWatchCommandBatch(
        device: ForgeWatchDeviceDescriptor,
        envelopes: [ForgeWatchOutboundEnvelope],
        pairing: PairingPayload
    ) async throws -> WatchCommandBatchResult {
        let startedAt = Date()
        let commands = envelopes.compactMap { envelope -> WatchCommandBatchRequest.Command? in
            if let habit = envelope.habitCheckIn {
                return WatchCommandBatchRequest.Command(
                    id: envelope.id,
                    kind: envelope.kind.rawValue,
                    createdAt: envelope.createdAt,
                    payload: [
                        "habitId": habit.habitId,
                        "dateKey": habit.dateKey,
                        "status": habit.status,
                        "note": habit.note
                    ]
                )
            }
            if let capture = envelope.captureEvent {
                var payload = capture.payload
                payload["eventType"] = capture.eventType
                payload["recordedAt"] = capture.recordedAt
                if let promptId = capture.promptId {
                    payload["promptId"] = promptId
                }
                if let placeId = capture.linkedContext.placeId {
                    payload["placeId"] = placeId
                }
                if let stayId = capture.linkedContext.stayId {
                    payload["stayId"] = stayId
                }
                if let tripId = capture.linkedContext.tripId {
                    payload["tripId"] = tripId
                }
                if let workoutId = capture.linkedContext.workoutId {
                    payload["workoutId"] = workoutId
                }
                return WatchCommandBatchRequest.Command(
                    id: envelope.id,
                    kind: envelope.kind.rawValue,
                    createdAt: envelope.createdAt,
                    payload: payload
                )
            }
            if let command = envelope.command {
                return WatchCommandBatchRequest.Command(
                    id: envelope.id,
                    kind: envelope.kind.rawValue,
                    createdAt: envelope.createdAt,
                    payload: command.payload
                )
            }
            return nil
        }
        let duplicateCount = max(0, envelopes.count - Set(envelopes.map(\.id)).count)
        let request = WatchCommandBatchRequest(
            sessionId: pairing.sessionId,
            pairingToken: pairing.pairingToken,
            device: device,
            commands: commands
        )
        let requestBytes = (try? JSONEncoder().encode(request).count) ?? 0
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCommandBatch start envelopes=\(envelopes.count) commands=\(commands.count) duplicateIds=\(duplicateCount) requestBytes=\(requestBytes)"
        )
        let envelope: WatchCommandBatchEnvelope = try await sendRequest(
            path: "/mobile/watch/actions:batch",
            apiBaseUrl: pairing.apiBaseUrl,
            body: request,
            transport: pairing.transport
        )
        let responseBytes = ((try? JSONEncoder().encode(envelope.watch).count) ?? 0)
            + ((try? JSONEncoder().encode(envelope.receipt).count) ?? 0)
        let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        let serverMeasurement = envelope.measurement.map {
            " backendDurationMs=\($0.backendDurationMs ?? -1) backendRequestBytes=\($0.requestBytes ?? -1) backendResponseBytes=\($0.responseBytes ?? -1)"
        } ?? ""
        companionDebugLog(
            "ForgeSyncClient",
            "submitWatchCommandBatch success commands=\(commands.count) processed=\(envelope.receipt.processedCount) replayed=\(envelope.receipt.replayedCount) failed=\(envelope.receipt.failedCount) responseBytes=\(responseBytes) durationMs=\(durationMs)\(serverMeasurement)"
        )
        return WatchCommandBatchResult(receipt: envelope.receipt, watch: envelope.watch)
    }

    private func sendRequest<Body: Encodable, Response: Decodable>(
        path: String,
        apiBaseUrl: String,
        method: String = "POST",
        body: Body,
        session: URLSession? = nil,
        transport: PairingTransport? = nil,
        timeoutInterval: TimeInterval = 20,
        useBackgroundUpload: Bool = false
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
            "sendRequest start method=\(method) url=\(url.absoluteString) bodyBytes=\(requestBody?.count ?? 0) transport=\(useBackgroundUpload && transport?.isIrohTransport != true ? "urlsession-background" : transport?.protocolName ?? "urlsession")"
        )
        var data: Data
        var httpResponse: HTTPURLResponse
        if let transport, transport.isIrohTransport {
            do {
                let irohResult = try await ForgeIrohTransportClient.send(
                    method: method,
                    path: apiRequestPath(apiBaseUrl: apiBaseUrl, endpointPath: path),
                    headers: requestHeaders,
                    body: requestBody,
                    transport: transport,
                    timeoutInterval: timeoutInterval
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
            } catch {
                guard Self.shouldFallbackFromIrohToUrlSession(apiBaseUrl: apiBaseUrl, error: error) else {
                    throw error
                }
                companionDebugLog(
                    "ForgeSyncClient",
                    "sendRequest irohFallback method=\(method) url=\(url.absoluteString) error=\(error.localizedDescription)"
                )
                let fallback = try await urlSessionResponse(
                    url: url,
                    method: method,
                    headers: requestHeaders,
                    body: requestBody,
                    session: session,
                    timeoutInterval: timeoutInterval,
                    useBackgroundUpload: useBackgroundUpload
                )
                data = fallback.data
                httpResponse = fallback.response
            }
        } else {
            let result = try await urlSessionResponse(
                url: url,
                method: method,
                headers: requestHeaders,
                body: requestBody,
                session: session,
                timeoutInterval: timeoutInterval,
                useBackgroundUpload: useBackgroundUpload
            )
            data = result.data
            httpResponse = result.response
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

    private func urlSessionResponse(
        url: URL,
        method: String,
        headers: [String: String],
        body: Data?,
        session: URLSession?,
        timeoutInterval: TimeInterval,
        useBackgroundUpload: Bool
    ) async throws -> (data: Data, response: HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.httpBody = body
        request.timeoutInterval = timeoutInterval
        let (data, response): (Data, URLResponse)
        if useBackgroundUpload, method == "POST", let body {
            (data, response) = try await ForgeBackgroundUploadCoordinator.shared.upload(
                request: request,
                body: body
            )
        } else {
            (data, response) = try await (session ?? Self.bootstrapSession).data(for: request)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            companionDebugLog("ForgeSyncClient", "sendRequest badServerResponse url=\(url.absoluteString)")
            throw URLError(.badServerResponse)
        }
        return (data, httpResponse)
    }

    private static func shouldFallbackFromIrohToUrlSession(apiBaseUrl: String, error: Error) -> Bool {
        guard
            let url = URL(string: apiBaseUrl),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https"
        else {
            return false
        }
        let nsError = error as NSError
        guard nsError.domain == "ForgeIrohTransport" else {
            return false
        }
        if nsError.code == URLError.timedOut.rawValue ||
            nsError.code == URLError.cannotConnectToHost.rawValue ||
            nsError.code == URLError.networkConnectionLost.rawValue {
            return true
        }
        if nsError.code >= 400 && nsError.code < 600 {
            return false
        }
        let message = "\(nsError.localizedDescription) \(nsError.localizedFailureReason ?? "")"
            .lowercased()
        return message.contains("timed out") ||
            message.contains("timeout") ||
            message.contains("connect") ||
            message.contains("no response") ||
            message.contains("unreachable")
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
