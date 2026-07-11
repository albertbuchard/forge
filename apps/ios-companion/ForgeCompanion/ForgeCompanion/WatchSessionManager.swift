import Combine
import Foundation
import WatchConnectivity

@MainActor
final class WatchSessionManager: NSObject, ObservableObject {
    @Published private(set) var lastStatusMessage = "Watch bridge idle"
    @Published private(set) var latestBootstrap: ForgeWatchBootstrap = .empty

    private let syncClient: ForgeSyncClient
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let defaults = ForgeWatchStorage.sharedDefaults()

    private var pairingProvider: (() -> PairingPayload?)?
    private var processingTask: Task<Void, Never>?

    init(syncClient: ForgeSyncClient) {
        self.syncClient = syncClient
        super.init()
        latestBootstrap = loadBootstrap()
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

    func refreshBootstrapIfPossible(reason: String) async {
        guard let pairing = pairingProvider?() else {
            lastStatusMessage = "Watch bridge waiting for pairing"
            return
        }
        guard watchTransportAvailable(for: WCSession.default) else {
            lastStatusMessage = "Watch app not installed"
            return
        }

        do {
            let bootstrap = try await syncClient.fetchWatchBootstrap(payload: pairing)
            let enrichedBootstrap = bootstrap.withConnection(Self.directWatchConnection(for: pairing))
            saveBootstrap(enrichedBootstrap)
            publishBootstrap(enrichedBootstrap)
            lastStatusMessage = "Watch bootstrap refreshed via \(reason)"
            await processPendingQueue()
        } catch {
            lastStatusMessage = "Watch bootstrap failed: \(error.localizedDescription)"
        }
    }

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
            error: ["message": message],
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
            let bootstrap = result.watch.withConnection(Self.directWatchConnection(for: pairing))
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
                return ForgeWatchAckEnvelope(
                    actionId: receipt.actionId,
                    kind: receipt.kind,
                    processedAt: receipt.processedAt,
                    status: receipt.status,
                    error: nil,
                    bootstrap: bootstrap
                )
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

    private func handleControlRequestData(_ data: Data) async -> Bool {
        guard let request = try? decoder.decode(ForgeWatchControlRequest.self, from: data) else {
            return false
        }
        await refreshBootstrapIfPossible(reason: "watch-\(request.reason)")
        return true
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
                let bootstrap = result.watch.withConnection(Self.directWatchConnection(for: pairing))
                saveBootstrap(bootstrap)
                publishBootstrap(bootstrap)
                let acknowledgedIds = Set(result.receipt.receipts.map(\.actionId))
                for receipt in result.receipt.receipts {
                    sendAck(
                        ForgeWatchAckEnvelope(
                            actionId: receipt.actionId,
                            kind: receipt.kind,
                            processedAt: receipt.processedAt,
                            status: receipt.status,
                            error: nil,
                            bootstrap: bootstrap
                        )
                    )
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
        if let data = userInfo[ForgeWatchStorage.syncRequestMessageKey] as? Data {
            Task { @MainActor in
                _ = await self.handleControlRequestData(data)
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
            if await self.handleControlRequestData(messageData) {
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
            if await self.handleControlRequestData(messageData) {
                if let data = try? self.encoder.encode(ForgeWatchAckBatchEnvelope(acks: [])) {
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
