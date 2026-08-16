import AVFAudio
@preconcurrency import BackgroundTasks
import CryptoKit
import Foundation
import Network
import SwiftUI
import UserNotifications

let agentMessageVoiceMaximumBytes = 25 * 1024 * 1024
let agentMessageVoiceMaximumDuration: TimeInterval = 10 * 60
let agentMessageCellularConfirmationBytes = 5 * 1024 * 1024

enum AgentMessageDeliveryState: String, Codable {
    case queued
    case waitingForConnectivity
    case waitingForWiFi
    case waitingForBackgroundTime
    case sending
    case failed

    var label: String {
        switch self {
        case .queued: return "Queued securely"
        case .waitingForConnectivity: return "Waiting for connectivity"
        case .waitingForWiFi: return "Waiting for Wi-Fi approval"
        case .waitingForBackgroundTime: return "Waiting for iOS background time"
        case .sending: return "Uploading"
        case .failed: return "Needs retry"
        }
    }
}

struct QueuedAgentMessage: Codable, Identifiable {
    let id: UUID
    let messageIdempotencyKey: String
    let reservationIdempotencyKey: String
    let recipientAgentId: String
    let bodyText: String
    let voiceData: Data?
    let voiceMimeType: String?
    let voiceDurationMilliseconds: Int?
    let originalFileName: String?
    let allowCellular: Bool
    let createdAt: Date
    var voiceReservationId: String?
    var state: AgentMessageDeliveryState
    var attemptCount: Int
    var lastError: String?

    var containsVoice: Bool { voiceData?.isEmpty == false }
}

func agentMessageNetworkWaitingState(
    for item: QueuedAgentMessage,
    pathSatisfied: Bool,
    pathExpensive: Bool
) -> AgentMessageDeliveryState? {
    guard pathSatisfied else { return .waitingForConnectivity }
    if item.containsVoice,
       item.voiceData?.count ?? 0 > agentMessageCellularConfirmationBytes,
       pathExpensive,
       item.allowCellular == false
    {
        return .waitingForWiFi
    }
    return nil
}

struct AgentMessageAgent: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let provider: String?
    let agentType: String
    let connected: Bool
    let lastSeenAt: String?
}

struct AgentMessageVoiceArtifact: Codable, Hashable {
    let id: String
    let mimeType: String
    let byteSize: Int
    let declaredDurationMs: Int?
    let verifiedDurationMs: Int?
    let sensitivity: String
}

struct AgentMessageParty: Codable, Hashable {
    let kind: String?
    let userId: String?
    let agentId: String?
    let label: String
}

struct AgentMessageRecipient: Codable, Hashable {
    let agentId: String
    let label: String
}

struct AgentMessageFailure: Codable, Hashable {
    let code: String
    let message: String
}

struct AgentMessageTranscript: Codable, Hashable {
    let text: String
    let provider: String
    let disclosure: String
}

struct AgentMessageRecord: Codable, Identifiable, Hashable {
    let id: String
    let sender: AgentMessageParty
    let initialRecipient: AgentMessageRecipient
    let recipient: AgentMessageRecipient
    let forwardedFromMessageId: String?
    let retriedFromMessageId: String?
    let bodyText: String
    let voiceArtifact: AgentMessageVoiceArtifact?
    let status: String
    let revision: Int
    let progressSummary: String
    let resultMarkdown: String
    let transcript: AgentMessageTranscript?
    let failure: AgentMessageFailure?
    let unreadInboxEventSequence: Int?
    let retentionUntil: String
    let deliveredAt: String
    let acknowledgedAt: String?
    let handledAt: String?
    let failedAt: String?
    let forwardedAt: String?
    let createdAt: String
    let updatedAt: String
}

struct AgentMessageEvent: Codable, Identifiable, Hashable {
    let id: String
    let sequence: Int
    let eventKind: String
    let actorKind: String
    let actorId: String?
    let actorLabel: String
    let priorStatus: String?
    let nextStatus: String?
    let occurredAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case sequence
        case eventKind = "event_kind"
        case actorKind = "actor_kind"
        case actorId = "actor_id"
        case actorLabel = "actor_label"
        case priorStatus = "prior_status"
        case nextStatus = "next_status"
        case occurredAt = "occurred_at"
    }
}

struct AgentMessageDetail: Codable {
    let message: AgentMessageRecord
    let events: [AgentMessageEvent]
    let relatedMessages: [AgentMessageRecord]
}

struct AgentMessageMailboxSettings: Codable {
    struct DefaultAgent: Codable {
        let id: String
        let label: String
    }

    let defaultAgent: DefaultAgent?
    let retentionDays: Int
    let backgroundDelivery: String
}

private struct AgentMessageListEnvelope: Decodable {
    let items: [AgentMessageRecord]
    let unreadThreadCount: Int
}

private struct AgentMessageAgentsEnvelope: Decodable {
    let agents: [AgentMessageAgent]
}

private struct AgentMessageReservationEnvelope: Decodable {
    struct Reservation: Decodable { let id: String }
    let reservation: Reservation
}

private struct AgentMessageCreateEnvelope: Decodable {
    let message: AgentMessageRecord
}

private struct AgentMessageServerError: Decodable {
    let code: String?
    let error: String?
    let message: String?
}

private enum AgentMessageClientError: LocalizedError {
    case invalidConfiguration
    case invalidResponse
    case server(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "The paired Forge host is not ready for Agent Messages."
        case .invalidResponse:
            return "Forge returned an unreadable Agent Messages response."
        case .server(_, let message):
            return message
        }
    }
}

private final class AgentMessageClient {
    private let decoder = JSONDecoder()
    private let encoder: JSONEncoder = {
        let value = JSONEncoder()
        value.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return value
    }()
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 90
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    func agents(pairing: PairingPayload) async throws -> [AgentMessageAgent] {
        let response: AgentMessageAgentsEnvelope = try await request(
            pairing: pairing,
            method: "GET",
            endpoint: "/mobile/agent-messages/agents"
        )
        return response.agents
    }

    func settings(pairing: PairingPayload) async throws -> AgentMessageMailboxSettings {
        try await request(
            pairing: pairing,
            method: "GET",
            endpoint: "/mobile/agent-messages/settings"
        )
    }

    func updateDefaultAgent(
        _ agentId: String,
        pairing: PairingPayload
    ) async throws -> AgentMessageMailboxSettings {
        try await request(
            pairing: pairing,
            method: "PATCH",
            endpoint: "/mobile/agent-messages/settings",
            body: ["defaultAgentId": agentId]
        )
    }

    func list(
        box: String,
        pairing: PairingPayload
    ) async throws -> AgentMessageListEnvelope {
        try await request(
            pairing: pairing,
            method: "GET",
            endpoint: "/mobile/agent-messages?box=\(box)&limit=50&offset=0"
        )
    }

    func detail(
        messageId: String,
        pairing: PairingPayload
    ) async throws -> AgentMessageDetail {
        try await request(
            pairing: pairing,
            method: "GET",
            endpoint: "/mobile/agent-messages/\(try pathSegment(messageId))"
        )
    }

    func markRead(
        message: AgentMessageRecord,
        operationKey: String,
        pairing: PairingPayload
    ) async throws {
        guard let sequence = message.unreadInboxEventSequence, sequence > 0 else { return }
        let _: EmptyResponse = try await request(
            pairing: pairing,
            method: "POST",
            endpoint: "/mobile/agent-messages/\(try pathSegment(message.id))/read",
            body: MarkReadRequest(
                operationKey: operationKey,
                expectedInboxEventSequence: sequence
            )
        )
    }

    func createReservation(
        item: QueuedAgentMessage,
        pairing: PairingPayload
    ) async throws -> String {
        let body = VoiceReservationRequest(
            idempotencyKey: item.reservationIdempotencyKey,
            originalFileName: item.originalFileName ?? "agent-message.m4a",
            declaredMimeType: item.voiceMimeType ?? "audio/mp4",
            declaredDurationMs: item.voiceDurationMilliseconds ?? 0
        )
        let response: AgentMessageReservationEnvelope = try await request(
            pairing: pairing,
            method: "POST",
            endpoint: "/mobile/agent-messages/voice-reservations",
            body: body
        )
        return response.reservation.id
    }

    func activateReservation(
        reservationId: String,
        item: QueuedAgentMessage,
        pairing: PairingPayload
    ) async throws {
        guard let voiceData = item.voiceData else { return }
        let body = VoiceActivationRequest(
            idempotencyKey: item.reservationIdempotencyKey,
            contentBase64: voiceData.base64EncodedString(),
            declaredMimeType: item.voiceMimeType ?? "audio/mp4",
            declaredDurationMs: item.voiceDurationMilliseconds ?? 0
        )
        let _: AgentMessageReservationEnvelope = try await request(
            pairing: pairing,
            method: "PUT",
            endpoint: "/mobile/agent-messages/voice-reservations/\(try pathSegment(reservationId))",
            body: body
        )
    }

    func createMessage(
        item: QueuedAgentMessage,
        pairing: PairingPayload
    ) async throws -> AgentMessageRecord {
        let body = MessageCreateRequest(
            idempotencyKey: item.messageIdempotencyKey,
            recipientAgentId: item.recipientAgentId,
            bodyText: item.bodyText,
            voiceReservationId: item.voiceReservationId
        )
        let response: AgentMessageCreateEnvelope = try await request(
            pairing: pairing,
            method: "POST",
            endpoint: "/mobile/agent-messages",
            body: body
        )
        return response.message
    }

    private struct EmptyResponse: Decodable {}
    private struct MarkReadRequest: Encodable {
        let operationKey: String
        let expectedInboxEventSequence: Int
    }
    private struct VoiceReservationRequest: Encodable {
        let idempotencyKey: String
        let originalFileName: String
        let declaredMimeType: String
        let declaredDurationMs: Int
    }
    private struct VoiceActivationRequest: Encodable {
        let idempotencyKey: String
        let contentBase64: String
        let declaredMimeType: String
        let declaredDurationMs: Int
    }
    private struct MessageCreateRequest: Encodable {
        let idempotencyKey: String
        let recipientAgentId: String
        let bodyText: String
        let voiceReservationId: String?
    }

    private func request<Response: Decodable>(
        pairing: PairingPayload,
        method: String,
        endpoint: String
    ) async throws -> Response {
        try await request(
            pairing: pairing,
            method: method,
            endpoint: endpoint,
            bodyData: nil
        )
    }

    private func request<Body: Encodable, Response: Decodable>(
        pairing: PairingPayload,
        method: String,
        endpoint: String,
        body: Body
    ) async throws -> Response {
        try await request(
            pairing: pairing,
            method: method,
            endpoint: endpoint,
            bodyData: try encoder.encode(body)
        )
    }

    private func request<Response: Decodable>(
        pairing: PairingPayload,
        method: String,
        endpoint: String,
        bodyData: Data?
    ) async throws -> Response {
        guard var components = URLComponents(string: pairing.apiBaseUrl) else {
            throw AgentMessageClientError.invalidConfiguration
        }
        let endpointComponents = URLComponents(string: endpoint)
        components.user = nil
        components.password = nil
        components.fragment = nil
        components.percentEncodedPath = components.percentEncodedPath.replacingOccurrences(
            of: "/+$", with: "", options: .regularExpression
        ) + (endpointComponents?.percentEncodedPath ?? endpoint)
        components.percentEncodedQuery = endpointComponents?.percentEncodedQuery
        let requestTarget = components.percentEncodedPath
            + (components.percentEncodedQuery.map { "?\($0)" } ?? "")
        let headers = mobileHeaders(
            pairing: pairing,
            method: method,
            requestTarget: requestTarget,
            body: bodyData
        )

        let responseData: Data
        let statusCode: Int
        if pairing.usesIrohTransportForActiveApiUrl, let transport = pairing.transport {
            let result = try await ForgeIrohTransportClient.send(
                method: method,
                path: requestTarget,
                headers: headers,
                body: bodyData,
                transport: transport,
                timeoutInterval: 90
            )
            responseData = result.data
            statusCode = result.statusCode
        } else {
            guard let url = components.url else {
                throw AgentMessageClientError.invalidConfiguration
            }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.httpBody = bodyData
            request.timeoutInterval = 90
            for (name, value) in headers {
                request.setValue(value, forHTTPHeaderField: name)
            }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw AgentMessageClientError.invalidResponse
            }
            responseData = data
            statusCode = http.statusCode
        }
        guard (200..<300).contains(statusCode) else {
            let error = try? decoder.decode(AgentMessageServerError.self, from: responseData)
            throw AgentMessageClientError.server(
                status: statusCode,
                message: error?.message ?? error?.error ?? "Forge rejected this Agent Message."
            )
        }
        do {
            return try decoder.decode(Response.self, from: responseData)
        } catch {
            throw AgentMessageClientError.invalidResponse
        }
    }

    private func mobileHeaders(
        pairing: PairingPayload,
        method: String,
        requestTarget: String,
        body: Data?
    ) -> [String: String] {
        let issuedAt = ISO8601DateFormatter().string(from: Date())
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let bodyDigest = SHA256.hash(data: body ?? Data()).map { String(format: "%02x", $0) }.joined()
        let canonical = [
            "FORGE-MOBILE-REQUEST/1",
            method.uppercased(),
            requestTarget,
            pairing.sessionId,
            issuedAt,
            nonce,
            bodyDigest
        ].joined(separator: "\n")
        let signature = HMAC<SHA256>.authenticationCode(
            for: Data(canonical.utf8),
            using: SymmetricKey(data: Data(pairing.pairingToken.utf8))
        ).map { String(format: "%02x", $0) }.joined()
        var headers = [
            "Accept": "application/json",
            "X-Forge-Mobile-Request-Protocol": "forge-mobile-request/v1",
            "X-Forge-Mobile-Session-Id": pairing.sessionId,
            "X-Forge-Mobile-Request-Issued-At": issuedAt,
            "X-Forge-Mobile-Request-Nonce": nonce,
            "X-Forge-Mobile-Body-SHA256": bodyDigest,
            "X-Forge-Mobile-Request-Signature": signature
        ]
        if body != nil { headers["Content-Type"] = "application/json" }
        return headers
    }

    private func pathSegment(_ value: String) throws -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#%")
        guard value.isEmpty == false,
              let result = value.addingPercentEncoding(withAllowedCharacters: allowed)
        else { throw AgentMessageClientError.invalidConfiguration }
        return result
    }
}

protocol AgentMessageQueueKeyStoring: AnyObject {
    @discardableResult
    func save(_ data: Data, forKey key: String) -> Bool
    func load(forKey key: String) -> Data?
}

extension KeychainStore: AgentMessageQueueKeyStoring {}

actor AgentMessageEncryptedQueue {
    private struct Envelope: Codable {
        let version: Int
        var items: [QueuedAgentMessage]
    }

    private let keychain: AgentMessageQueueKeyStoring
    private let keyName = "queue-aes-gcm-v1"
    private let fileURL: URL
    private var loaded = false
    private var items: [QueuedAgentMessage] = []

    init(
        fileURL: URL? = nil,
        keychain: AgentMessageQueueKeyStoring = KeychainStore(
            service: "com.albertbuchard.ForgeCompanion.agent-messages"
        )
    ) {
        self.keychain = keychain
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let support = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first!
            self.fileURL = support
                .appendingPathComponent("ForgeAgentMessages", isDirectory: true)
                .appendingPathComponent("outbox-v1.aesgcm", isDirectory: false)
        }
    }

    func snapshot() throws -> [QueuedAgentMessage] {
        try ensureLoaded()
        return items
    }

    func enqueue(_ item: QueuedAgentMessage) throws -> [QueuedAgentMessage] {
        try ensureLoaded()
        items.append(item)
        try persist()
        return items
    }

    func update(_ item: QueuedAgentMessage) throws -> [QueuedAgentMessage] {
        try ensureLoaded()
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return items }
        items[index] = item
        try persist()
        return items
    }

    func remove(id: UUID) throws -> [QueuedAgentMessage] {
        try ensureLoaded()
        items.removeAll { $0.id == id }
        try persist()
        return items
    }

    private func ensureLoaded() throws {
        guard loaded == false else { return }
        loaded = true
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            items = []
            return
        }
        guard let keyData = keychain.load(forKey: keyName), keyData.count == 32 else {
            loaded = false
            throw NSError(
                domain: "ForgeAgentMessages.Queue",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "The encrypted Agent Messages queue key is unavailable. The queue was preserved and was not replaced."]
            )
        }
        let encrypted = try Data(contentsOf: fileURL)
        let sealed = try AES.GCM.SealedBox(combined: encrypted)
        let clear = try AES.GCM.open(sealed, using: SymmetricKey(data: keyData))
        items = try JSONDecoder().decode(Envelope.self, from: clear).items
    }

    private func queueKey() throws -> SymmetricKey {
        if let data = keychain.load(forKey: keyName), data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard FileManager.default.fileExists(atPath: fileURL.path) == false else {
            throw NSError(
                domain: "ForgeAgentMessages.Queue",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "The queue encryption key is unavailable. Existing encrypted data was preserved."]
            )
        }
        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        guard keychain.save(keyData, forKey: keyName) else {
            throw NSError(
                domain: "ForgeAgentMessages.Queue",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "The device could not secure the Agent Messages queue key."]
            )
        }
        return key
    }

    private func persist() throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let clear = try JSONEncoder().encode(Envelope(version: 1, items: items))
        let encrypted = try AES.GCM.seal(clear, using: queueKey()).combined!
        try encrypted.write(
            to: fileURL,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }
}

@MainActor
final class AgentMessageStore: ObservableObject {
    @Published private(set) var queued: [QueuedAgentMessage] = []
    @Published private(set) var agents: [AgentMessageAgent] = []
    @Published private(set) var outbox: [AgentMessageRecord] = []
    @Published private(set) var inbox: [AgentMessageRecord] = []
    @Published private(set) var settings: AgentMessageMailboxSettings?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isSending = false
    @Published var latestError: String?
    @Published var pathSatisfied = false
    @Published var pathExpensive = false

    private let vault = AgentMessageEncryptedQueue()
    private let client = AgentMessageClient()
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "forge.agent-messages.network")
    private var pairing: PairingPayload?
    private var sendingTask: Task<Bool, Never>?
    var requestBackgroundDelivery: (() -> Void)?

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                pathSatisfied = path.status == .satisfied
                pathExpensive = path.isExpensive
                if pathSatisfied { _ = await flush(reason: "connectivity returned") }
            }
        }
        monitor.start(queue: monitorQueue)
        Task { await restoreQueue() }
    }

    deinit { monitor.cancel() }

    func configure(pairing: PairingPayload?) {
        self.pairing = pairing
        guard pairing != nil else {
            agents = []
            outbox = []
            inbox = []
            settings = nil
            return
        }
        Task {
            await refresh()
            _ = await flush(reason: "paired or foregrounded")
        }
    }

    func enqueue(
        recipientAgentId: String,
        bodyText: String,
        voiceData: Data?,
        voiceDuration: TimeInterval?,
        allowCellular: Bool
    ) async throws {
        guard bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                || voiceData?.isEmpty == false
        else {
            throw NSError(
                domain: "ForgeAgentMessages",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "Add text, a voice note, or both."]
            )
        }
        if let voiceData, voiceData.count > agentMessageVoiceMaximumBytes {
            throw NSError(
                domain: "ForgeAgentMessages",
                code: 11,
                userInfo: [NSLocalizedDescriptionKey: "Voice notes may not exceed 25 MB."]
            )
        }
        let id = UUID()
        let keyStem = id.uuidString.lowercased()
        let item = QueuedAgentMessage(
            id: id,
            messageIdempotencyKey: "ios-message-\(keyStem)",
            reservationIdempotencyKey: "ios-reserve-\(keyStem)",
            recipientAgentId: recipientAgentId,
            bodyText: bodyText.trimmingCharacters(in: .whitespacesAndNewlines),
            voiceData: voiceData,
            voiceMimeType: voiceData == nil ? nil : "audio/mp4",
            voiceDurationMilliseconds: voiceDuration.map {
                min(Int(agentMessageVoiceMaximumDuration * 1_000), Int($0 * 1_000))
            },
            originalFileName: voiceData == nil ? nil : "agent-message-\(keyStem).m4a",
            allowCellular: allowCellular,
            createdAt: Date(),
            voiceReservationId: nil,
            state: pathSatisfied ? .queued : .waitingForConnectivity,
            attemptCount: 0,
            lastError: nil
        )
        queued = try await vault.enqueue(item)
        requestBackgroundDelivery?()
        _ = await flush(reason: "new encrypted message")
    }

    func flush(reason: String) async -> Bool {
        if queued.isEmpty { return true }
        if let sendingTask { return await sendingTask.value }
        let task = Task { [weak self] in
            guard let self else { return false }
            return await sendQueued(reason: reason)
        }
        sendingTask = task
        let result = await task.value
        sendingTask = nil
        return result
    }

    func retry(_ id: UUID) async {
        guard var item = queued.first(where: { $0.id == id }) else { return }
        item.state = pathSatisfied ? .queued : .waitingForConnectivity
        item.lastError = nil
        do { queued = try await vault.update(item) } catch { latestError = error.localizedDescription }
        requestBackgroundDelivery?()
        _ = await flush(reason: "manual retry")
    }

    func prepareForBackground() async {
        for var item in queued where item.state != .failed && item.state != .waitingForWiFi {
            item.state = pathSatisfied ? .waitingForBackgroundTime : .waitingForConnectivity
            do { queued = try await vault.update(item) }
            catch { latestError = error.localizedDescription }
        }
        if queued.isEmpty == false { requestBackgroundDelivery?() }
    }

    func refresh() async {
        guard let pairing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            async let fetchedAgents = client.agents(pairing: pairing)
            async let fetchedSettings = client.settings(pairing: pairing)
            async let fetchedOutbox = client.list(box: "outbox", pairing: pairing)
            async let fetchedInbox = client.list(box: "inbox", pairing: pairing)
            let values = try await (fetchedAgents, fetchedSettings, fetchedOutbox, fetchedInbox)
            agents = values.0
            settings = values.1
            outbox = values.2.items
            let previousUnread = Set(inbox.map(\.id))
            inbox = values.3.items
            latestError = nil
            await notifyForNewInboxActivity(excluding: previousUnread)
        } catch {
            latestError = userMessage(error)
        }
    }

    func detail(_ messageId: String) async throws -> AgentMessageDetail {
        guard let pairing else { throw AgentMessageClientError.invalidConfiguration }
        return try await client.detail(messageId: messageId, pairing: pairing)
    }

    func markRead(_ message: AgentMessageRecord) async {
        guard let pairing else { return }
        do {
            try await client.markRead(
                message: message,
                operationKey: "ios-read-\(UUID().uuidString.lowercased())",
                pairing: pairing
            )
            await refresh()
        } catch { latestError = userMessage(error) }
    }

    func updateDefaultAgent(_ id: String) async {
        guard let pairing else { return }
        do { settings = try await client.updateDefaultAgent(id, pairing: pairing) }
        catch { latestError = userMessage(error) }
    }

    func requestNotificationPermission() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .badge, .sound]
            )
        } catch { latestError = "iOS did not enable Agent Message notifications." }
    }

    private func restoreQueue() async {
        do { queued = try await vault.snapshot() }
        catch { latestError = error.localizedDescription }
    }

    private func sendQueued(reason: String) async -> Bool {
        guard let pairing else { return false }
        guard pathSatisfied else {
            await setWaitingState(.waitingForConnectivity)
            return false
        }
        isSending = true
        defer { isSending = false }
        companionDebugLog("AgentMessages", "flush start reason=\(reason) queued=\(queued.count)")
        var allSucceeded = true
        let snapshot: [QueuedAgentMessage]
        do { snapshot = try await vault.snapshot() }
        catch {
            latestError = error.localizedDescription
            return false
        }
        for original in snapshot {
            var item = original
            if let waitingState = agentMessageNetworkWaitingState(
                for: item,
                pathSatisfied: pathSatisfied,
                pathExpensive: pathExpensive
            ) {
                item.state = waitingState
                do { queued = try await vault.update(item) } catch { latestError = error.localizedDescription }
                allSucceeded = false
                continue
            }
            item.state = .sending
            item.attemptCount += 1
            item.lastError = nil
            do { queued = try await vault.update(item) }
            catch {
                latestError = error.localizedDescription
                return false
            }
            do {
                if item.containsVoice {
                    if item.voiceReservationId == nil {
                        item.voiceReservationId = try await client.createReservation(
                            item: item,
                            pairing: pairing
                        )
                        queued = try await vault.update(item)
                    }
                    try await client.activateReservation(
                        reservationId: item.voiceReservationId!,
                        item: item,
                        pairing: pairing
                    )
                }
                _ = try await client.createMessage(item: item, pairing: pairing)
                queued = try await vault.remove(id: item.id)
            } catch {
                item.state = isConnectivityError(error) ? .waitingForConnectivity : .failed
                item.lastError = userMessage(error)
                do { queued = try await vault.update(item) }
                catch { latestError = error.localizedDescription }
                allSucceeded = false
            }
        }
        await refresh()
        return allSucceeded
    }

    private func setWaitingState(_ state: AgentMessageDeliveryState) async {
        for var item in queued where item.state != .failed {
            item.state = state
            do { queued = try await vault.update(item) }
            catch { latestError = error.localizedDescription }
        }
    }

    private func isConnectivityError(_ error: Error) -> Bool {
        guard let value = error as? URLError else { return false }
        return [.notConnectedToInternet, .cannotConnectToHost, .cannotFindHost,
                .dnsLookupFailed, .networkConnectionLost, .timedOut].contains(value.code)
    }

    private func userMessage(_ error: Error) -> String {
        if isConnectivityError(error) {
            return "Forge is unreachable. The encrypted message remains queued on this iPhone."
        }
        return error.localizedDescription
    }

    private func notifyForNewInboxActivity(excluding previous: Set<String>) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized else { return }
        for message in inbox where previous.contains(message.id) == false {
            let content = UNMutableNotificationContent()
            content.title = "Agent update from \(message.recipient.label)"
            content.body = agentMessageNotificationBody(for: message)
            content.sound = .default
            try? await UNUserNotificationCenter.current().add(
                UNNotificationRequest(
                    identifier: "forge-agent-message-\(message.id)-\(message.updatedAt)",
                    content: content,
                    trigger: nil
                )
            )
        }
    }
}

func agentMessageNotificationBody(for message: AgentMessageRecord) -> String {
    "Agent Message status: "
        + message.status.replacingOccurrences(of: "_", with: " ").capitalized
}

private final class AgentVoiceRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var recordingURL: URL?
    @Published var errorMessage: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt: Date?

    func start() async {
        errorMessage = nil
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            errorMessage = "Microphone access was not allowed. You can still send text."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("ForgeAgentMessages", isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
            let url = directory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let recorder = try AVAudioRecorder(
                url: url,
                settings: [
                    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                    AVEncoderBitRateKey: 96_000
                ]
            )
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: agentMessageVoiceMaximumDuration) else {
                throw NSError(domain: "ForgeAgentMessages.Recorder", code: 1)
            }
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: url.path
            )
            self.recorder = recorder
            recordingURL = nil
            duration = 0
            startedAt = Date()
            isRecording = true
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, let startedAt else { return }
                    duration = min(agentMessageVoiceMaximumDuration, Date().timeIntervalSince(startedAt))
                }
            }
        } catch {
            errorMessage = "Forge could not start a protected voice recording."
            cleanupAudioSession()
        }
    }

    func stop() {
        recorder?.stop()
    }

    func discard() {
        recorder?.delegate = nil
        let activeURL = recorder?.url
        recorder?.stop()
        if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
        if let activeURL { try? FileManager.default.removeItem(at: activeURL) }
        recorder = nil
        recordingURL = nil
        duration = 0
        finishRecording(successfully: false)
    }

    func consumeRecording() throws -> (Data, TimeInterval)? {
        guard let recordingURL else { return nil }
        defer {
            try? FileManager.default.removeItem(at: recordingURL)
            self.recordingURL = nil
            duration = 0
        }
        let data = try Data(contentsOf: recordingURL, options: [.mappedIfSafe])
        guard data.count <= agentMessageVoiceMaximumBytes else {
            throw NSError(
                domain: "ForgeAgentMessages.Recorder",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "This voice note exceeds the 25 MB limit."]
            )
        }
        return (data, duration)
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        finishRecording(successfully: flag)
    }

    private func finishRecording(successfully: Bool) {
        timer?.invalidate()
        timer = nil
        if let startedAt {
            duration = min(agentMessageVoiceMaximumDuration, Date().timeIntervalSince(startedAt))
        }
        let url = recorder?.url
        recorder = nil
        startedAt = nil
        isRecording = false
        recordingURL = successfully ? url : nil
        if successfully == false, let url { try? FileManager.default.removeItem(at: url) }
        cleanupAudioSession()
    }

    private func cleanupAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}

struct AgentMessageComposerView: View {
    @EnvironmentObject private var store: AgentMessageStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = AgentVoiceRecorder()
    @State private var bodyText = ""
    @State private var recipientId = ""
    @State private var allowCellular = false
    @State private var sendInFlight = false
    @State private var statusMessage = ""

    let startsRecordingImmediately: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Talk to agent")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)
                        Text("Send slow asynchronous mail. This is not live chat.")
                            .font(.subheadline)
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Recipient").font(.caption.weight(.semibold)).foregroundStyle(CompanionStyle.textMuted)
                        Picker("Recipient", selection: $recipientId) {
                            Text("Choose an agent").tag("")
                            ForEach(store.agents) { agent in
                                Text(agent.connected ? agent.label : "\(agent.label) · offline").tag(agent.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(CompanionStyle.accentStrong)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(CompanionStyle.surface, in: RoundedRectangle(cornerRadius: 14))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Message (optional with voice)").font(.caption.weight(.semibold)).foregroundStyle(CompanionStyle.textMuted)
                        TextEditor(text: $bodyText)
                            .scrollContentBackground(.hidden)
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .frame(minHeight: 130)
                            .padding(8)
                            .background(CompanionStyle.surface, in: RoundedRectangle(cornerRadius: 14))
                            .accessibilityLabel("Agent message text")
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Button {
                            if recorder.isRecording { recorder.stop() }
                            else { Task { await recorder.start() } }
                        } label: {
                            Label(
                                recorder.isRecording ? "Stop recording" : "Record voice",
                                systemImage: recorder.isRecording ? "stop.circle.fill" : "mic.fill"
                            )
                            .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(recorder.isRecording ? .red : CompanionStyle.accentStrong)

                        if recorder.isRecording {
                            HStack {
                                Circle().fill(.red).frame(width: 8, height: 8)
                                Text("Recording \(durationLabel(recorder.duration)) · stops at 10:00")
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .accessibilityLabel("Recording in progress, \(durationLabel(recorder.duration))")
                        } else if recorder.recordingURL != nil {
                            HStack {
                                Image(systemName: "waveform")
                                Text("Voice note ready · \(durationLabel(recorder.duration))")
                                Spacer()
                                Button("Remove") { recorder.discard() }
                            }
                            .font(.footnote)
                            .foregroundStyle(CompanionStyle.textSecondary)
                        }

                        if recorder.recordingURL != nil,
                           estimatedVoiceBytes > agentMessageCellularConfirmationBytes
                        {
                            Toggle("Allow this upload over cellular or a metered connection", isOn: $allowCellular)
                                .font(.footnote)
                                .tint(CompanionStyle.accentStrong)
                        }

                        if let error = recorder.errorMessage {
                            Text(error).font(.footnote).foregroundStyle(CompanionStyle.destructive)
                        }
                    }
                    .padding(14)
                    .background(CompanionStyle.surface.opacity(0.8), in: RoundedRectangle(cornerRadius: 18))

                    VStack(alignment: .leading, spacing: 7) {
                        Label("Queued content is encrypted with AES-GCM before Forge attempts any upload.", systemImage: "lock.shield.fill")
                        Label("The temporary recording uses complete iOS file protection and is removed after queueing.", systemImage: "iphone.gen3")
                        Label("iOS decides when background work runs; Forge does not promise an exact delivery time.", systemImage: "clock.badge.questionmark")
                    }
                    .font(.caption)
                    .foregroundStyle(CompanionStyle.textMuted)

                    if statusMessage.isEmpty == false {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .accessibilityLabel("Delivery status: \(statusMessage)")
                    }

                    Button {
                        Task { await queueMessage() }
                    } label: {
                        if sendInFlight {
                            ProgressView().tint(.white).frame(maxWidth: .infinity, minHeight: 52)
                        } else {
                            Label("Queue and send", systemImage: "paperplane.fill")
                                .frame(maxWidth: .infinity, minHeight: 52)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(CompanionStyle.accentStrong)
                    .disabled(
                        sendInFlight || recorder.isRecording || recipientId.isEmpty
                            || (bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                && recorder.recordingURL == nil)
                    )
                }
                .padding(20)
            }
            .background(CompanionStyle.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { recorder.discard(); dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            recipientId = store.settings?.defaultAgent?.id ?? store.agents.first?.id ?? ""
            if startsRecordingImmediately { Task { await recorder.start() } }
        }
    }

    private var estimatedVoiceBytes: Int {
        guard let url = recorder.recordingURL,
              let values = try? url.resourceValues(forKeys: [.fileSizeKey])
        else { return 0 }
        return values.fileSize ?? 0
    }

    private func queueMessage() async {
        sendInFlight = true
        defer { sendInFlight = false }
        do {
            let voice = try recorder.consumeRecording()
            try await store.enqueue(
                recipientAgentId: recipientId,
                bodyText: bodyText,
                voiceData: voice?.0,
                voiceDuration: voice?.1,
                allowCellular: allowCellular
            )
            statusMessage = store.pathSatisfied
                ? "Encrypted locally; Forge is attempting delivery now."
                : "Encrypted locally and queued until connectivity returns."
            try? await Task.sleep(for: .milliseconds(450))
            dismiss()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func durationLabel(_ value: TimeInterval) -> String {
        let seconds = max(0, Int(value.rounded()))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}

struct AgentMessagesMailboxView: View {
    @EnvironmentObject private var store: AgentMessageStore
    @Environment(\.dismiss) private var dismiss
    @State private var box = "outbox"
    @State private var composerVisible = false
    @State private var selectedMessage: AgentMessageRecord?

    var body: some View {
        NavigationStack {
            List {
                if store.queued.isEmpty == false {
                    Section("Encrypted on this iPhone") {
                        ForEach(store.queued) { item in
                            queuedRow(item)
                        }
                    }
                }

                Section {
                    Picker("Mailbox", selection: $box) {
                        Text("Outbox").tag("outbox")
                        Text("Inbox \(store.inbox.isEmpty ? "" : "(\(store.inbox.count))")").tag("inbox")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }

                Section(box == "inbox" ? "Unread agent activity" : "Sent messages") {
                    let messages = box == "inbox" ? store.inbox : store.outbox
                    if messages.isEmpty {
                        ContentUnavailableView(
                            box == "inbox" ? "No unread agent activity" : "No sent messages",
                            systemImage: box == "inbox" ? "tray" : "paperplane",
                            description: Text(box == "inbox"
                                ? "Progress, acknowledgements, results, failures, and forwards appear here."
                                : "Tap Talk to agent to record immediately or send text.")
                        )
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(messages) { message in
                            Button { selectedMessage = message } label: {
                                messageRow(message)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section("Delivery truth") {
                    Label("Queued sends are AES-GCM encrypted on-device.", systemImage: "lock.shield")
                    Label("Background delivery runs only when iOS grants execution time.", systemImage: "clock")
                    Label("Voice is preserved as a sensitive Forge Artifact and is never silently sent to a transcription provider.", systemImage: "waveform.badge.shield")
                }
                .font(.footnote)
                .foregroundStyle(CompanionStyle.textSecondary)
            }
            .scrollContentBackground(.hidden)
            .background(CompanionStyle.background)
            .navigationTitle("Agent Messages")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { Task { await store.refresh() } } label: {
                        if store.isRefreshing { ProgressView() }
                        else { Image(systemName: "arrow.clockwise") }
                    }
                    Button { composerVisible = true } label: {
                        Label("Talk to agent", systemImage: "mic.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(CompanionStyle.accentStrong)
                }
            }
            .sheet(isPresented: $composerVisible) {
                AgentMessageComposerView(startsRecordingImmediately: true)
                    .environmentObject(store)
            }
            .navigationDestination(item: $selectedMessage) { message in
                AgentMessageNativeDetailView(message: message)
                    .environmentObject(store)
            }
            .refreshable { await store.refresh() }
            .task { await store.refresh() }
            .safeAreaInset(edge: .bottom) {
                if let error = store.latestError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(CompanionStyle.textPrimary)
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .background(CompanionStyle.destructive.opacity(0.9))
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func queuedRow(_ item: QueuedAgentMessage) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.containsVoice ? "waveform.circle.fill" : "text.bubble.fill")
                .foregroundStyle(CompanionStyle.accentStrong)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                Text(item.bodyText.isEmpty ? "Voice message" : item.bodyText)
                    .lineLimit(2)
                    .foregroundStyle(CompanionStyle.textPrimary)
                Text(item.state.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(item.state == .failed ? CompanionStyle.destructive : CompanionStyle.textSecondary)
                if let error = item.lastError {
                    Text(error).font(.caption2).foregroundStyle(CompanionStyle.textMuted).lineLimit(3)
                }
            }
            Spacer()
            if item.state == .failed || item.state == .waitingForWiFi {
                Button("Retry") { Task { await store.retry(item.id) } }
                    .font(.caption.weight(.semibold))
            }
        }
    }

    private func messageRow(_ message: AgentMessageRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: message.voiceArtifact == nil ? "bubble.left.fill" : "waveform.circle.fill")
                .foregroundStyle(CompanionStyle.accentStrong)
                .font(.title3)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(message.recipient.label).font(.headline).foregroundStyle(CompanionStyle.textPrimary)
                    Spacer()
                    Text(message.status.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(CompanionStyle.textSecondary)
                }
                Text(message.bodyText.isEmpty ? "Voice message" : message.bodyText)
                    .lineLimit(2)
                    .font(.subheadline)
                    .foregroundStyle(CompanionStyle.textSecondary)
                if message.progressSummary.isEmpty == false {
                    Text(message.progressSummary).lineLimit(1).font(.caption).foregroundStyle(CompanionStyle.textMuted)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

private struct AgentMessageNativeDetailView: View {
    @EnvironmentObject private var store: AgentMessageStore
    let message: AgentMessageRecord
    @State private var detail: AgentMessageDetail?
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section("Message") {
                LabeledContent("Recipient", value: message.recipient.label)
                LabeledContent("Status", value: message.status.replacingOccurrences(of: "_", with: " ").capitalized)
                if message.bodyText.isEmpty == false { Text(message.bodyText).textSelection(.enabled) }
                if let voice = message.voiceArtifact {
                    Label(
                        "Original voice Artifact · \(ByteCountFormatter.string(fromByteCount: Int64(voice.byteSize), countStyle: .file))",
                        systemImage: "waveform.badge.shield"
                    )
                }
            }
            if message.progressSummary.isEmpty == false {
                Section("Latest progress") { Text(message.progressSummary).textSelection(.enabled) }
            }
            if message.resultMarkdown.isEmpty == false {
                Section("Agent result") { Text(message.resultMarkdown).textSelection(.enabled) }
            }
            if let transcript = message.transcript {
                Section("Transcript") {
                    Text(transcript.text).textSelection(.enabled)
                    Text("\(transcript.provider): \(transcript.disclosure)")
                        .font(.caption).foregroundStyle(CompanionStyle.textMuted)
                }
            }
            if let failure = message.failure {
                Section("Failure") {
                    Text(failure.code).font(.headline)
                    Text(failure.message)
                }
            }
            Section("Immutable audit history") {
                if let detail {
                    ForEach(detail.events) { event in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(event.eventKind.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.subheadline.weight(.semibold))
                            Text("\(event.actorLabel) · \(event.occurredAt)")
                                .font(.caption).foregroundStyle(CompanionStyle.textMuted)
                        }
                    }
                } else if let errorMessage {
                    Text(errorMessage).foregroundStyle(CompanionStyle.destructive)
                } else {
                    ProgressView()
                }
            }
            if message.unreadInboxEventSequence != nil {
                Section {
                    Button("Mark agent activity read") { Task { await store.markRead(message) } }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(CompanionStyle.background)
        .navigationTitle("Agent Message")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { detail = try await store.detail(message.id) }
            catch { errorMessage = error.localizedDescription }
        }
    }
}
