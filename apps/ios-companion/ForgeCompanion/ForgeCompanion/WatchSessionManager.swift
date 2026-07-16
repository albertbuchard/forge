import Combine
import Foundation
import WatchConnectivity

@MainActor
final class WatchSessionManager: NSObject, ObservableObject {
    @Published private(set) var lastStatusMessage = "Watch bridge idle"
    @Published private(set) var latestBootstrap: ForgeWatchBootstrap = .empty
    @Published private(set) var pendingPhoneHandoffURL: URL?

    private let syncClient: ForgeSyncClient
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let defaults: UserDefaults
    private let phoneHandoffTransportAvailable: () -> Bool

    private var pairingProvider: (() -> PairingPayload?)?
    private var processingTask: Task<Void, Never>?
    private var relayedPeopleGlance: ForgeWatchPeopleGlanceSnapshot?
    private var relayedPeopleSessionId: String?
#if DEBUG
    private var didInjectPhoneHandoffForUITesting = false
#endif

    init(
        syncClient: ForgeSyncClient,
        defaults: UserDefaults = ForgeWatchStorage.sharedDefaults(),
        phoneHandoffTransportAvailable: @escaping () -> Bool = {
            guard WCSession.isSupported() else { return false }
            let session = WCSession.default
            return session.isPaired && session.isWatchAppInstalled
        }
    ) {
        self.syncClient = syncClient
        self.defaults = defaults
        self.phoneHandoffTransportAvailable = phoneHandoffTransportAvailable
        super.init()
        latestBootstrap = loadBootstrap()
        relayedPeopleGlance = latestBootstrap.people
        relayedPeopleSessionId = latestBootstrap.connection?.sessionId
        pendingPhoneHandoffURL = loadPendingPhoneHandoffURL()
    }

    func configure(pairingProvider: @escaping () -> PairingPayload?) {
        self.pairingProvider = pairingProvider
    }

    func activate() {
        guard WCSession.isSupported() else {
            lastStatusMessage = "WatchConnectivity unavailable"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        lastStatusMessage = watchTransportAvailable(for: session)
            ? "Watch bridge active"
            : "Watch app not installed"
    }

    @discardableResult
    func refreshBootstrapIfPossible(reason: String) async -> Bool {
        guard let pairing = pairingProvider?() else {
            lastStatusMessage = "Watch bridge waiting for pairing"
            return false
        }
        guard watchTransportAvailable(for: WCSession.default) else {
            lastStatusMessage = "Watch app not installed"
            return false
        }

        do {
            let bootstrap = try await syncClient.fetchWatchBootstrap(payload: pairing)
            let enrichedBootstrap = enrichBootstrap(bootstrap, pairing: pairing)
            saveBootstrap(enrichedBootstrap)
            publishBootstrap(enrichedBootstrap)
            lastStatusMessage = "Watch bootstrap refreshed via \(reason)"
            await processPendingQueue()
            return true
        } catch {
            lastStatusMessage = "Watch bootstrap failed: \(error.localizedDescription)"
            return false
        }
    }

    func consumePendingPhoneHandoffURL() -> URL? {
        defer {
            pendingPhoneHandoffURL = nil
            defaults.removeObject(forKey: ForgeWatchPhoneHandoffDeliveryPolicy.pendingStorageKey)
        }
        return pendingPhoneHandoffURL
    }

    func updatePeopleGlance(
        _ glance: ForgeWatchPeopleGlanceSnapshot,
        pairingSessionId: String?
    ) {
        relayedPeopleGlance = glance
        relayedPeopleSessionId = pairingSessionId
        guard glance.selection == .chooseOnIPhone || pairingSessionId == nil ||
                latestBootstrap.connection?.sessionId == pairingSessionId
        else { return }
        let bootstrap = latestBootstrap.withPeople(glance)
        saveBootstrap(bootstrap)
        publishBootstrap(bootstrap)
    }

#if DEBUG
    func injectPendingPhoneHandoffURLForUITestingIfConfigured() {
        guard didInjectPhoneHandoffForUITesting == false else { return }
        didInjectPhoneHandoffForUITesting = true
        guard
            ProcessInfo.processInfo.arguments.contains("--forge-ui-test-watch-handoff"),
            let value = ProcessInfo.processInfo.environment["FORGE_UI_TEST_WATCH_HANDOFF_URL"],
            let url = URL(string: value)
        else {
            return
        }
        pendingPhoneHandoffURL = url
    }
#endif

    private func saveBootstrap(_ bootstrap: ForgeWatchBootstrap) {
        latestBootstrap = bootstrap
        if let data = try? encoder.encode(bootstrap) {
            defaults.set(data, forKey: ForgeWatchStorage.bootstrapKey)
        }
    }

    private func loadBootstrap() -> ForgeWatchBootstrap {
        guard
            let data = defaults.data(forKey: ForgeWatchStorage.bootstrapKey),
            let bootstrap = try? decoder.decode(ForgeWatchBootstrap.self, from: data)
        else {
            return .empty
        }
        return bootstrap
    }

    private func enrichBootstrap(
        _ bootstrap: ForgeWatchBootstrap,
        pairing: PairingPayload
    ) -> ForgeWatchBootstrap {
        let connected = bootstrap.withConnection(Self.directWatchConnection(for: pairing))
        guard connected.people == nil else { return connected }
        if relayedPeopleSessionId == pairing.sessionId {
            return connected.withPeople(relayedPeopleGlance)
        }
        guard latestBootstrap.connection?.sessionId == pairing.sessionId else {
            return connected
        }
        return connected.withPeople(latestBootstrap.people)
    }

    private func loadQueue() -> [ForgeWatchOutboundEnvelope] {
        guard
            let data = defaults.data(forKey: ForgeWatchStorage.incomingQueueKey),
            let queue = try? decoder.decode([ForgeWatchOutboundEnvelope].self, from: data)
        else {
            return []
        }
        return queue
    }

    @discardableResult
    private func saveQueue(_ queue: [ForgeWatchOutboundEnvelope]) -> Bool {
        guard let data = try? encoder.encode(queue) else {
            lastStatusMessage = ForgeWatchDurableQueueBackpressure.encodingFailed.message(
                storageName: "iPhone"
            )
            return false
        }
        defaults.set(data, forKey: ForgeWatchStorage.incomingQueueKey)
        return true
    }

    @discardableResult
    private func appendToQueue(
        _ envelope: ForgeWatchOutboundEnvelope
    ) -> ForgeWatchDurableQueueBackpressure? {
        let admission = ForgeWatchDurableQueuePolicy.appending(envelope, to: loadQueue())
        if let backpressure = admission.backpressure {
            lastStatusMessage = backpressure.message(storageName: "iPhone")
            return backpressure
        }
        guard admission.inserted else {
            return nil
        }
        guard let encodedData = admission.encodedData else {
            let backpressure = ForgeWatchDurableQueueBackpressure.encodingFailed
            lastStatusMessage = backpressure.message(storageName: "iPhone")
            return backpressure
        }
        defaults.set(encodedData, forKey: ForgeWatchStorage.incomingQueueKey)
        return nil
    }

    private func publishBootstrap(_ bootstrap: ForgeWatchBootstrap) {
        guard WCSession.isSupported(), watchTransportAvailable(for: WCSession.default) else { return }
        if let data = try? encoder.encode(bootstrap) {
            do {
                try WCSession.default.updateApplicationContext([
                    ForgeWatchStorage.bootstrapContextKey: data
                ])
            } catch {
                lastStatusMessage = "Watch publish failed: \(error.localizedDescription)"
            }
        }
    }

    private func sendAck(_ envelope: ForgeWatchAckEnvelope) {
        guard
            WCSession.isSupported(),
            watchTransportAvailable(for: WCSession.default),
            let data = try? encoder.encode(envelope)
        else { return }

        if WCSession.default.isReachable {
            WCSession.default.sendMessageData(data, replyHandler: nil, errorHandler: nil)
        } else {
            WCSession.default.transferUserInfo([
                ForgeWatchStorage.ackMessageKey: data
            ])
        }
    }

    private func deferredAck(
        for envelope: ForgeWatchOutboundEnvelope,
        message: String
    ) -> ForgeWatchAckEnvelope {
        ForgeWatchAckEnvelope(
            actionId: envelope.id,
            kind: envelope.kind.rawValue,
            processedAt: ISO8601DateFormatter().string(from: Date()),
            status: "deferred",
            error: ["message": .string(message)],
            bootstrap: nil
        )
    }

    private func processEnvelopeForReply(_ envelope: ForgeWatchOutboundEnvelope) async -> ForgeWatchAckEnvelope {
        let batch = await processBatchForReply([envelope])
        guard let ack = batch.acks.first else {
            return deferredAck(for: envelope, message: "Forge did not acknowledge the watch action")
        }
        return ack
    }

    private func processBatchForReply(_ envelopes: [ForgeWatchOutboundEnvelope]) async -> ForgeWatchAckBatchEnvelope {
        guard envelopes.isEmpty == false else {
            return ForgeWatchAckBatchEnvelope(acks: [])
        }
        guard let pairing = pairingProvider?() else {
            var backpressureByActionId: [String: ForgeWatchDurableQueueBackpressure] = [:]
            for envelope in envelopes {
                backpressureByActionId[envelope.id] = appendToQueue(envelope)
            }
            return ForgeWatchAckBatchEnvelope(
                acks: envelopes.map {
                    deferredAck(
                        for: $0,
                        message: backpressureByActionId[$0.id]?.message(storageName: "iPhone")
                            ?? "Forge pairing is not ready"
                    )
                }
            )
        }
        do {
            let result = try await syncClient.submitWatchCommandBatch(
                device: envelopes.first?.device ?? ForgeWatchDeviceDescriptor(
                    name: "Apple Watch",
                    platform: "watchos",
                    appVersion: "",
                    sourceDevice: "Apple Watch"
                ),
                envelopes: envelopes,
                pairing: pairing
            )
            let bootstrap = enrichBootstrap(result.watch, pairing: pairing)
            saveBootstrap(bootstrap)
            publishBootstrap(bootstrap)
            var receiptsByActionId: [String: ForgeWatchCommandReceipt] = [:]
            for receipt in result.receipt.receipts {
                receiptsByActionId[receipt.actionId] = receipt
            }
            let acknowledgedIds = Set(result.receipt.receipts.map(\.actionId))
            if acknowledgedIds.isEmpty == false {
                let latestQueue = loadQueue()
                let stillPending = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
                    afterAcknowledging: acknowledgedIds,
                    in: latestQueue
                )
                if stillPending.count != latestQueue.count {
                    saveQueue(stillPending)
                }
            }
            let acks = envelopes.map { envelope in
                guard let receipt = receiptsByActionId[envelope.id] else {
                    let backpressure = appendToQueue(envelope)
                    return deferredAck(
                        for: envelope,
                        message: backpressure?.message(storageName: "iPhone")
                            ?? "Forge did not acknowledge the watch action"
                    )
                }
                return Self.ackEnvelope(for: receipt, bootstrap: bootstrap)
            }
            lastStatusMessage = "Watch actions processed"
            return ForgeWatchAckBatchEnvelope(acks: acks)
        } catch {
            var backpressureByActionId: [String: ForgeWatchDurableQueueBackpressure] = [:]
            for envelope in envelopes {
                backpressureByActionId[envelope.id] = appendToQueue(envelope)
            }
            return ForgeWatchAckBatchEnvelope(
                acks: envelopes.map {
                    deferredAck(
                        for: $0,
                        message: backpressureByActionId[$0.id]?.message(storageName: "iPhone")
                            ?? error.localizedDescription
                    )
                }
            )
        }
    }

    private func handleControlRequestData(_ data: Data) async -> ForgeWatchRefreshResponse? {
        guard let request = try? decoder.decode(ForgeWatchControlRequest.self, from: data) else {
            return nil
        }
        if ForgeWatchRefreshRequestPolicy.isExpired(request) {
            return ForgeWatchRefreshResponse(
                requestId: request.id,
                completedAt: ISO8601DateFormatter().string(from: Date()),
                status: .expired,
                message: "Refresh request expired. Retry from Apple Watch."
            )
        }
        let refreshed = await refreshBootstrapIfPossible(reason: "watch-\(request.reason)")
        return ForgeWatchRefreshResponse(
            requestId: request.id,
            completedAt: ISO8601DateFormatter().string(from: Date()),
            status: refreshed ? .refreshed : .failed,
            message: refreshed
                ? "Forge summaries refreshed"
                : "Forge refresh failed. Cached summaries remain available."
        )
    }

    private func handlePhoneHandoffRequestData(
        _ data: Data,
        now: Date = Date()
    ) -> ForgeWatchPhoneHandoffResponse? {
        guard let request = try? decoder.decode(ForgeWatchPhoneHandoffRequest.self, from: data) else {
            return nil
        }
        guard
            phoneHandoffTransportAvailable(),
            let pairing = pairingProvider?(),
            let url = Self.phoneHandoffURL(for: pairing, destination: request.destination)
        else {
            return ForgeWatchPhoneHandoffResponse(
                requestId: request.id,
                completedAt: ISO8601DateFormatter().string(from: now),
                status: .unavailable,
                message: "Open Forge on iPhone to continue"
            )
        }

        switch ForgeWatchPhoneHandoffDeliveryPolicy.admission(
            for: request,
            deliveredRecords: loadPhoneHandoffDeliveryRecords(),
            now: now
        ) {
        case .invalid, .stale:
            return ForgeWatchPhoneHandoffResponse(
                requestId: request.id,
                completedAt: ISO8601DateFormatter().string(from: now),
                status: .unavailable,
                message: "Handoff expired. Retry from Apple Watch."
            )
        case .duplicate:
            return ForgeWatchPhoneHandoffResponse(
                requestId: request.id,
                completedAt: ISO8601DateFormatter().string(from: now),
                status: .ready,
                message: "Forge already received this handoff"
            )
        case .deliver:
            break
        }

        let pending = ForgeWatchPendingPhoneHandoff(
            requestId: request.id,
            createdAt: request.createdAt,
            url: url.absoluteString
        )
        guard let pendingData = try? encoder.encode(pending) else {
            return ForgeWatchPhoneHandoffResponse(
                requestId: request.id,
                completedAt: ISO8601DateFormatter().string(from: now),
                status: .unavailable,
                message: "Open Forge on iPhone to continue"
            )
        }
        defaults.set(pendingData, forKey: ForgeWatchPhoneHandoffDeliveryPolicy.pendingStorageKey)
        savePhoneHandoffDeliveryRecord(requestId: request.id, now: now)
        pendingPhoneHandoffURL = url
        lastStatusMessage = "Watch handoff ready on iPhone"
        return ForgeWatchPhoneHandoffResponse(
            requestId: request.id,
            completedAt: ISO8601DateFormatter().string(from: now),
            status: .ready,
            message: "Forge is ready on iPhone"
        )
    }

    func handlePhoneHandoffRequestForTesting(
        _ request: ForgeWatchPhoneHandoffRequest,
        now: Date
    ) -> ForgeWatchPhoneHandoffResponse? {
        guard let data = try? encoder.encode(request) else { return nil }
        return handlePhoneHandoffRequestData(data, now: now)
    }

    private func loadPendingPhoneHandoffURL(now: Date = Date()) -> URL? {
        guard
            let data = defaults.data(forKey: ForgeWatchPhoneHandoffDeliveryPolicy.pendingStorageKey),
            let pending = try? decoder.decode(ForgeWatchPendingPhoneHandoff.self, from: data),
            ForgeWatchPhoneHandoffDeliveryPolicy.isFresh(createdAt: pending.createdAt, now: now),
            let url = URL(string: pending.url)
        else {
            defaults.removeObject(forKey: ForgeWatchPhoneHandoffDeliveryPolicy.pendingStorageKey)
            return nil
        }
        return url
    }

    private func loadPhoneHandoffDeliveryRecords() -> [ForgeWatchPhoneHandoffDeliveryRecord] {
        guard
            let data = defaults.data(forKey: ForgeWatchPhoneHandoffDeliveryPolicy.historyStorageKey),
            let records = try? decoder.decode([ForgeWatchPhoneHandoffDeliveryRecord].self, from: data)
        else {
            return []
        }
        return records
    }

    private func savePhoneHandoffDeliveryRecord(requestId: String, now: Date) {
        let records = ForgeWatchPhoneHandoffDeliveryPolicy.recording(
            requestId: requestId,
            in: loadPhoneHandoffDeliveryRecords(),
            now: now
        )
        guard let data = try? encoder.encode(records) else { return }
        defaults.set(data, forKey: ForgeWatchPhoneHandoffDeliveryPolicy.historyStorageKey)
    }

    private func transferRefreshResponse(_ response: ForgeWatchRefreshResponse) {
        guard let data = try? encoder.encode(response) else { return }
        WCSession.default.transferUserInfo([
            ForgeWatchStorage.syncResponseMessageKey: data
        ])
    }

    private func transferPhoneHandoffResponse(_ response: ForgeWatchPhoneHandoffResponse) {
        guard let data = try? encoder.encode(response) else { return }
        WCSession.default.transferUserInfo([
            ForgeWatchStorage.phoneHandoffResponseMessageKey: data
        ])
    }

    func processPendingQueue() async {
        if let processingTask {
            await processingTask.value
            return
        }

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.drainPendingQueue()
            self.processingTask = nil
        }
        processingTask = task
        await task.value
    }

    private func drainPendingQueue() async {
        guard let pairing = pairingProvider?() else { return }
        guard watchTransportAvailable(for: WCSession.default) else {
            lastStatusMessage = "Watch app not installed"
            return
        }

        while Task.isCancelled == false {
            let remaining = loadQueue()
            guard remaining.isEmpty == false else {
                lastStatusMessage = "Watch bridge caught up"
                return
            }
            let batch = ForgeWatchActionBatchPolicy.nextBatch(from: remaining)

            do {
                let result = try await syncClient.submitWatchCommandBatch(
                    device: batch.first?.device ?? ForgeWatchDeviceDescriptor(
                        name: "Apple Watch",
                        platform: "watchos",
                        appVersion: "",
                        sourceDevice: "Apple Watch"
                    ),
                    envelopes: batch,
                    pairing: pairing
                )
                let bootstrap = enrichBootstrap(result.watch, pairing: pairing)
                saveBootstrap(bootstrap)
                publishBootstrap(bootstrap)
                let acknowledgedIds = Set(result.receipt.receipts.map(\.actionId))
                for receipt in result.receipt.receipts {
                    sendAck(Self.ackEnvelope(for: receipt, bootstrap: bootstrap))
                }
                let latestQueue = loadQueue()
                let stillPending = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
                    afterAcknowledging: acknowledgedIds,
                    in: latestQueue
                )
                guard saveQueue(stillPending) else {
                    return
                }
                if stillPending.isEmpty {
                    lastStatusMessage = "Watch bridge caught up"
                    return
                }
                lastStatusMessage = "Watch bridge sending \(stillPending.count) remaining action\(stillPending.count == 1 ? "" : "s")"
                if acknowledgedIds.isEmpty, stillPending.count == remaining.count {
                    return
                }
            } catch {
                lastStatusMessage = "Watch sync deferred: \(error.localizedDescription)"
                return
            }
        }
    }

    private func watchTransportAvailable(for session: WCSession) -> Bool {
        session.isPaired && session.isWatchAppInstalled
    }

    static func directWatchConnectionForTesting(for pairing: PairingPayload) -> ForgeWatchConnection? {
        directWatchConnection(for: pairing)
    }

    static func ackEnvelope(
        for receipt: ForgeWatchCommandReceipt,
        bootstrap: ForgeWatchBootstrap?
    ) -> ForgeWatchAckEnvelope {
        ForgeWatchAckEnvelope(
            actionId: receipt.actionId,
            kind: receipt.kind,
            processedAt: receipt.processedAt,
            status: receipt.status,
            error: receipt.error,
            bootstrap: bootstrap
        )
    }

    static func phoneHandoffURLForTesting(
        for pairing: PairingPayload,
        destination: ForgeWatchPhoneDestination
    ) -> URL? {
        phoneHandoffURL(for: pairing, destination: destination)
    }

    private static func phoneHandoffURL(
        for pairing: PairingPayload,
        destination: ForgeWatchPhoneDestination
    ) -> URL? {
        let normalizedPairing = CompanionPairingURLResolver.normalizedPayload(pairing)
        let uiBaseUrl = normalizedPairing.uiBaseUrl
            ?? CompanionPairingURLResolver.deriveUiBaseUrl(from: normalizedPairing.apiBaseUrl)
        return ForgeWatchPhoneHandoff.iPhoneURL(
            uiBaseUrl: uiBaseUrl,
            destination: destination
        )
    }

    private static func directWatchConnection(for pairing: PairingPayload) -> ForgeWatchConnection? {
        let normalizedPairing = CompanionPairingURLResolver.normalizedPayload(pairing)
        guard let apiBaseUrl = directApiBaseUrl(for: normalizedPairing) else {
            return nil
        }
        return ForgeWatchConnection(
            apiBaseUrl: apiBaseUrl,
            uiBaseUrl: CompanionPairingURLResolver.deriveUiBaseUrl(from: apiBaseUrl),
            sessionId: normalizedPairing.sessionId,
            pairingToken: normalizedPairing.pairingToken,
            transportLabel: transportLabel(for: apiBaseUrl),
            directNetworkingEnabled: true
        )
    }

    private static func directApiBaseUrl(for pairing: PairingPayload) -> String? {
        let normalized = CompanionPairingURLResolver.normalizeApiBaseUrl(pairing.apiBaseUrl)
        guard
            let url = URL(string: normalized),
            url.scheme?.lowercased() == "https",
            CompanionPairingURLResolver.isLoopbackUrl(normalized) == false
        else {
            return nil
        }
        return normalized
    }

    private static func transportLabel(for apiBaseUrl: String) -> String {
        guard let host = URL(string: apiBaseUrl)?.host?.lowercased() else {
            return "HTTPS"
        }
        if host.hasSuffix(".ts.net") || host.contains(".tailscale.") {
            return "Tailscale"
        }
        return "HTTPS"
    }

}

private struct ForgeWatchPendingPhoneHandoff: Codable {
    let requestId: String
    let createdAt: String
    let url: String
}

struct ForgeWatchPhoneHandoffDeliveryRecord: Codable, Equatable {
    let requestId: String
    let deliveredAt: Date
}

enum ForgeWatchPhoneHandoffDeliveryAdmission: Equatable {
    case deliver
    case duplicate
    case stale
    case invalid
}

enum ForgeWatchPhoneHandoffDeliveryPolicy {
    static let pendingStorageKey = "forge_watch_pending_phone_handoff"
    static let historyStorageKey = "forge_watch_phone_handoff_history"
    static let maximumRequestAge: TimeInterval = 5 * 60
    static let futureClockTolerance: TimeInterval = 60
    static let historyRetention: TimeInterval = 24 * 60 * 60
    static let maximumHistoryCount = 32

    static func admission(
        for request: ForgeWatchPhoneHandoffRequest,
        deliveredRecords: [ForgeWatchPhoneHandoffDeliveryRecord],
        now: Date
    ) -> ForgeWatchPhoneHandoffDeliveryAdmission {
        guard request.id.isEmpty == false, request.id.count <= 128 else {
            return .invalid
        }
        guard let createdAt = ISO8601DateFormatter().date(from: request.createdAt) else {
            return .invalid
        }
        let age = now.timeIntervalSince(createdAt)
        guard age >= -futureClockTolerance else {
            return .invalid
        }
        guard age <= maximumRequestAge else {
            return .stale
        }
        let historyCutoff = now.addingTimeInterval(-historyRetention)
        return deliveredRecords.contains {
            $0.requestId == request.id && $0.deliveredAt >= historyCutoff
        }
            ? .duplicate
            : .deliver
    }

    static func isFresh(createdAt: String, now: Date) -> Bool {
        guard let createdAt = ISO8601DateFormatter().date(from: createdAt) else {
            return false
        }
        let age = now.timeIntervalSince(createdAt)
        return age >= -futureClockTolerance && age <= maximumRequestAge
    }

    static func recording(
        requestId: String,
        in records: [ForgeWatchPhoneHandoffDeliveryRecord],
        now: Date
    ) -> [ForgeWatchPhoneHandoffDeliveryRecord] {
        let cutoff = now.addingTimeInterval(-historyRetention)
        var retained = records.filter {
            $0.deliveredAt >= cutoff && $0.requestId != requestId
        }
        retained.append(
            ForgeWatchPhoneHandoffDeliveryRecord(
                requestId: requestId,
                deliveredAt: now
            )
        )
        if retained.count > maximumHistoryCount {
            retained.removeFirst(retained.count - maximumHistoryCount)
        }
        return retained
    }
}

extension WatchSessionManager: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let watchAvailable = session.isPaired && session.isWatchAppInstalled
        Task { @MainActor in
            if let error {
                self.lastStatusMessage = "Watch activation failed: \(error.localizedDescription)"
                return
            }
            guard watchAvailable else {
                self.lastStatusMessage = "Watch app not installed"
                return
            }
            self.lastStatusMessage = activationState == .activated
                ? "Watch activated"
                : "Watch activation pending"
            await self.refreshBootstrapIfPossible(reason: "watch-activation")
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) {}

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        let watchAvailable = session.isPaired && session.isWatchAppInstalled
        Task { @MainActor in
            if isReachable, watchAvailable {
                await self.refreshBootstrapIfPossible(reason: "watch-reachable")
                await self.processPendingQueue()
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String : Any] = [:]
    ) {
        if let data = userInfo[ForgeWatchStorage.phoneHandoffRequestMessageKey] as? Data {
            Task { @MainActor in
                if let response = self.handlePhoneHandoffRequestData(data) {
                    self.transferPhoneHandoffResponse(response)
                }
            }
            return
        }
        if let data = userInfo[ForgeWatchStorage.syncRequestMessageKey] as? Data {
            Task { @MainActor in
                if let response = await self.handleControlRequestData(data) {
                    self.transferRefreshResponse(response)
                }
            }
            return
        }
        if let data = userInfo[ForgeWatchStorage.actionMessageKey] as? Data {
            Task { @MainActor in
                guard let envelope = try? self.decoder.decode(ForgeWatchOutboundEnvelope.self, from: data) else {
                    self.lastStatusMessage = "Ignored invalid watch payload"
                    return
                }
                if let backpressure = self.appendToQueue(envelope) {
                    self.sendAck(
                        self.deferredAck(
                            for: envelope,
                            message: backpressure.message(storageName: "iPhone")
                        )
                    )
                    return
                }
                await self.processPendingQueue()
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in
            if let response = self.handlePhoneHandoffRequestData(messageData) {
                if let data = try? self.encoder.encode(response) {
                    WCSession.default.sendMessageData(data, replyHandler: nil, errorHandler: nil)
                }
                return
            }
            if let response = await self.handleControlRequestData(messageData) {
                if let data = try? self.encoder.encode(response) {
                    WCSession.default.sendMessageData(data, replyHandler: nil, errorHandler: nil)
                }
                return
            }
            if let batch = try? self.decoder.decode(ForgeWatchOutboundBatchEnvelope.self, from: messageData) {
                for envelope in batch.envelopes {
                    if let backpressure = self.appendToQueue(envelope) {
                        self.sendAck(
                            self.deferredAck(
                                for: envelope,
                                message: backpressure.message(storageName: "iPhone")
                            )
                        )
                    }
                }
                await self.processPendingQueue()
                return
            }
            guard let envelope = try? self.decoder.decode(ForgeWatchOutboundEnvelope.self, from: messageData) else {
                self.lastStatusMessage = "Ignored invalid watch payload"
                return
            }
            if let backpressure = self.appendToQueue(envelope) {
                self.sendAck(
                    self.deferredAck(
                        for: envelope,
                        message: backpressure.message(storageName: "iPhone")
                    )
                )
                return
            }
            await self.processPendingQueue()
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessageData messageData: Data,
        replyHandler: @escaping (Data) -> Void
    ) {
        Task { @MainActor in
            if let response = self.handlePhoneHandoffRequestData(messageData) {
                if let data = try? self.encoder.encode(response) {
                    replyHandler(data)
                }
                return
            }
            if let response = await self.handleControlRequestData(messageData) {
                if let data = try? self.encoder.encode(response) {
                    replyHandler(data)
                }
                return
            }
            if let batch = try? self.decoder.decode(ForgeWatchOutboundBatchEnvelope.self, from: messageData) {
                let ackBatch = await self.processBatchForReply(batch.envelopes)
                if let data = try? self.encoder.encode(ackBatch) {
                    replyHandler(data)
                }
                return
            }
            guard let envelope = try? self.decoder.decode(ForgeWatchOutboundEnvelope.self, from: messageData) else {
                if let data = try? self.encoder.encode(ForgeWatchAckBatchEnvelope(acks: [])) {
                    replyHandler(data)
                }
                return
            }
            let ack = await self.processEnvelopeForReply(envelope)
            if let data = try? self.encoder.encode(ack) {
                replyHandler(data)
            }
        }
    }
}
