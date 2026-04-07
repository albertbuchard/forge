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
        guard let pairing = pairingProvider?(), pairing.capabilities.contains("watch-ready") else {
            lastStatusMessage = "Watch bridge waiting for pairing"
            saveBootstrap(.empty)
            return
        }
        guard watchTransportAvailable(for: WCSession.default) else {
            lastStatusMessage = "Watch app not installed"
            return
        }

        do {
            let bootstrap = try await syncClient.fetchWatchBootstrap(payload: pairing)
            saveBootstrap(bootstrap)
            publishBootstrap(bootstrap)
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

    private func saveQueue(_ queue: [ForgeWatchOutboundEnvelope]) {
        if let data = try? encoder.encode(queue) {
            defaults.set(data, forKey: ForgeWatchStorage.incomingQueueKey)
        }
    }

    private func appendToQueue(_ envelope: ForgeWatchOutboundEnvelope) {
        var queue = loadQueue()
        guard queue.contains(where: { $0.id == envelope.id }) == false else {
            return
        }
        queue.append(envelope)
        saveQueue(queue)
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

    func processPendingQueue() async {
        processingTask?.cancel()
        processingTask = Task { [weak self] in
            guard let self else { return }
            guard let pairing = self.pairingProvider?() else { return }
            guard self.watchTransportAvailable(for: WCSession.default) else {
                self.lastStatusMessage = "Watch app not installed"
                return
            }

            let remaining = self.loadQueue()
            var nextQueue: [ForgeWatchOutboundEnvelope] = []

            for envelope in remaining {
                do {
                    switch envelope.kind {
                    case .habitCheckIn:
                        guard let action = envelope.habitCheckIn else { continue }
                        let bootstrap = try await self.syncClient.submitWatchHabitCheckIn(
                            envelopeId: envelope.id,
                            action: action,
                            pairing: pairing
                        )
                        self.saveBootstrap(bootstrap)
                        self.publishBootstrap(bootstrap)
                        self.sendAck(
                            ForgeWatchAckEnvelope(
                                actionId: envelope.id,
                                processedAt: Date().formatted(.iso8601),
                                bootstrap: bootstrap
                            )
                        )
                    case .captureEvent:
                        guard let action = envelope.captureEvent else { continue }
                        let bootstrap = try await self.syncClient.submitWatchCaptureBatch(
                            envelopeId: envelope.id,
                            device: envelope.device,
                            actions: [action],
                            pairing: pairing
                        )
                        self.saveBootstrap(bootstrap)
                        self.publishBootstrap(bootstrap)
                        self.sendAck(
                            ForgeWatchAckEnvelope(
                                actionId: envelope.id,
                                processedAt: Date().formatted(.iso8601),
                                bootstrap: bootstrap
                            )
                        )
                    }
                } catch {
                    nextQueue.append(envelope)
                    self.lastStatusMessage = "Watch sync deferred: \(error.localizedDescription)"
                }
            }

            self.saveQueue(nextQueue)
            if nextQueue.isEmpty {
                self.lastStatusMessage = "Watch bridge caught up"
            }
        }

        await processingTask?.value
    }

    private func watchTransportAvailable(for session: WCSession) -> Bool {
        session.isPaired && session.isWatchAppInstalled
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
            await self.processPendingQueue()
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) {}

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        let watchAvailable = session.isPaired && session.isWatchAppInstalled
        Task { @MainActor in
            if isReachable, watchAvailable {
                await self.processPendingQueue()
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String : Any] = [:]
    ) {
        if let data = userInfo[ForgeWatchStorage.actionMessageKey] as? Data {
            Task { @MainActor in
                guard let envelope = try? self.decoder.decode(ForgeWatchOutboundEnvelope.self, from: data) else {
                    self.lastStatusMessage = "Ignored invalid watch payload"
                    return
                }
                self.appendToQueue(envelope)
                await self.processPendingQueue()
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in
            guard let envelope = try? self.decoder.decode(ForgeWatchOutboundEnvelope.self, from: messageData) else {
                self.lastStatusMessage = "Ignored invalid watch payload"
                return
            }
                self.appendToQueue(envelope)
                await self.processPendingQueue()
        }
    }
}
