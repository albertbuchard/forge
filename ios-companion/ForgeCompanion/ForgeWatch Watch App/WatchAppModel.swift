import Combine
import Foundation
import SwiftUI
import WatchConnectivity
import WatchKit

@MainActor
final class WatchAppModel: NSObject, ObservableObject {
    @Published var bootstrap: ForgeWatchBootstrap
    @Published var selectedSurface: WatchSurface = .habits
    @Published var lastStatusMessage = "Waiting for iPhone"

    private let defaults = ForgeWatchStorage.sharedDefaults()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let previewMode: Bool

    init(preview: Bool = false) {
        self.previewMode = preview
        if preview {
            self.bootstrap = ForgeWatchBootstrap(
                generatedAt: ISO8601DateFormatter().string(from: Date()),
                habits: [
                    ForgeWatchHabitSummary(
                        id: "habit_preview",
                        title: "Morning planning",
                        polarity: "positive",
                        frequency: "daily",
                        targetCount: 1,
                        weekDays: [],
                        streakCount: 4,
                        dueToday: true,
                        cadenceLabel: "1x daily",
                        alignedActionLabel: "Done",
                        unalignedActionLabel: "Missed",
                        currentPeriodStatus: .unknown,
                        last7History: [
                            .init(id: "1", label: "S", periodKey: "1", current: false, state: .aligned),
                            .init(id: "2", label: "M", periodKey: "2", current: false, state: .aligned),
                            .init(id: "3", label: "T", periodKey: "3", current: false, state: .unaligned),
                            .init(id: "4", label: "W", periodKey: "4", current: false, state: .aligned),
                            .init(id: "5", label: "T", periodKey: "5", current: false, state: .aligned),
                            .init(id: "6", label: "F", periodKey: "6", current: false, state: .unknown),
                            .init(id: "7", label: "S", periodKey: "7", current: true, state: .unknown)
                        ]
                    )
                ],
                checkInOptions: ForgeWatchQuickOptions(
                    activities: ["Working", "Walking", "Resting"],
                    emotions: ["Focused", "Calm", "Tired"],
                    triggers: ["Conflict", "Pleasant moment", "Rumination"],
                    placeCategories: ["Home", "Work", "Nature"],
                    routinePrompts: ["Medication taken?", "Meal?"],
                    recentPeople: ["Julien", "Family"]
                ),
                pendingPrompts: [
                    ForgeWatchPrompt(
                        id: "prompt_preview",
                        kind: "new_place",
                        title: "New place detected",
                        message: "What is this place?",
                        createdAt: ISO8601DateFormatter().string(from: Date()),
                        linkedContext: .empty,
                        choices: ["Home", "Work", "Nature"]
                    )
                ]
            )
        } else {
            self.bootstrap = ForgeWatchBootstrap.empty
        }
        super.init()
        if preview == false {
            bootstrap = loadBootstrap()
            activateSession()
        }
    }

    func activateSession() {
        guard previewMode == false, WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        flushPendingActions()
    }

    func consumePendingLaunchDestination() {
        guard
            let rawValue = defaults.string(forKey: ForgeWatchStorage.pendingLaunchDestinationKey)
        else { return }
        defaults.removeObject(forKey: ForgeWatchStorage.pendingLaunchDestinationKey)
        switch rawValue {
        case "check_in", "emotion":
            selectedSurface = .checkIn
        case "mark_moment":
            selectedSurface = .markMoment
        case "prompt_inbox":
            selectedSurface = .promptInbox
        default:
            selectedSurface = .habits
        }
    }

    func flushPendingActions() {
        guard previewMode == false else { return }
        let queue = loadQueue()
        guard queue.isEmpty == false else { return }
        if WCSession.default.isReachable {
            for item in queue {
                if let data = try? encoder.encode(item) {
                    WCSession.default.sendMessageData(data, replyHandler: nil, errorHandler: nil)
                }
            }
        } else {
            for item in queue {
                if let data = try? encoder.encode(item) {
                    WCSession.default.transferUserInfo([
                        ForgeWatchStorage.actionMessageKey: data
                    ])
                }
            }
        }
    }

    func queueHabitCheckIn(for habit: ForgeWatchHabitSummary, status: String, note: String = "") {
        optimisticUpdate(habitId: habit.id, status: status)
        enqueue(
            ForgeWatchOutboundEnvelope(
                id: UUID().uuidString,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                device: currentDeviceDescriptor(),
                kind: .habitCheckIn,
                habitCheckIn: ForgeWatchHabitCheckInAction(
                    habitId: habit.id,
                    dateKey: Date().ISO8601Format().prefix(10).description,
                    status: status,
                    note: note
                ),
                captureEvent: nil
            )
        )
        WKInterfaceDevice.current().play(.success)
    }

    func queueCaptureEvent(
        eventType: String,
        promptId: String? = nil,
        linkedContext: ForgeWatchLinkedContext = .empty,
        payload: [String: String] = [:]
    ) {
        enqueue(
            ForgeWatchOutboundEnvelope(
                id: UUID().uuidString,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                device: currentDeviceDescriptor(),
                kind: .captureEvent,
                habitCheckIn: nil,
                captureEvent: ForgeWatchCaptureEventAction(
                    eventType: eventType,
                    recordedAt: ISO8601DateFormatter().string(from: Date()),
                    promptId: promptId,
                    linkedContext: linkedContext,
                    payload: payload
                )
            )
        )
        WKInterfaceDevice.current().play(.success)
    }

    private func enqueue(_ envelope: ForgeWatchOutboundEnvelope) {
        var queue = loadQueue()
        queue.append(envelope)
        saveQueue(queue)
        lastStatusMessage = "Queued \(queue.count) action\(queue.count == 1 ? "" : "s")"
        flushPendingActions()
    }

    private func currentDeviceDescriptor() -> ForgeWatchDeviceDescriptor {
        let device = WKInterfaceDevice.current()
        return ForgeWatchDeviceDescriptor(
            name: device.name,
            platform: "watchos",
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0",
            sourceDevice: device.model
        )
    }

    private func optimisticUpdate(habitId: String, status: String) {
        guard let index = bootstrap.habits.firstIndex(where: { $0.id == habitId }) else { return }
        var habit = bootstrap.habits[index]
        guard let currentIndex = habit.last7History.firstIndex(where: { $0.current }) else { return }
        let wasAligned = habit.last7History[currentIndex].state == .aligned
        let nextState: ForgeWatchHistoryState
        if (habit.polarity == "positive" && status == "done") ||
            (habit.polarity == "negative" && status == "missed") {
            nextState = .aligned
        } else {
            nextState = .unaligned
        }

        habit.last7History[currentIndex] = ForgeWatchHistorySegment(
            id: habit.last7History[currentIndex].id,
            label: habit.last7History[currentIndex].label,
            periodKey: habit.last7History[currentIndex].periodKey,
            current: true,
            state: nextState
        )
        habit.currentPeriodStatus = nextState
        habit.dueToday = false
        if nextState == .aligned && wasAligned == false {
            habit.streakCount += 1
        } else if nextState != .aligned && wasAligned {
            habit.streakCount = max(0, habit.streakCount - 1)
        }
        bootstrap.habits[index] = habit
        saveBootstrap(bootstrap)
    }

    private func saveBootstrap(_ bootstrap: ForgeWatchBootstrap) {
        self.bootstrap = bootstrap
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

    private func saveQueue(_ queue: [ForgeWatchOutboundEnvelope]) {
        if let data = try? encoder.encode(queue) {
            defaults.set(data, forKey: ForgeWatchStorage.outgoingQueueKey)
        }
    }

    private func loadQueue() -> [ForgeWatchOutboundEnvelope] {
        guard
            let data = defaults.data(forKey: ForgeWatchStorage.outgoingQueueKey),
            let queue = try? decoder.decode([ForgeWatchOutboundEnvelope].self, from: data)
        else {
            return []
        }
        return queue
    }

    private func removeQueuedAction(id: String) {
        let queue = loadQueue().filter { $0.id != id }
        saveQueue(queue)
        lastStatusMessage = queue.isEmpty ? "Synced to iPhone" : "Still sending \(queue.count)"
    }
}

extension WatchAppModel: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                self.lastStatusMessage = "iPhone link failed: \(error.localizedDescription)"
            } else {
                self.lastStatusMessage = activationState == .activated ? "Connected to iPhone" : "Waiting for iPhone"
                self.flushPendingActions()
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        Task { @MainActor in
            if isReachable {
                self.flushPendingActions()
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String : Any]
    ) {
        guard
            let data = applicationContext[ForgeWatchStorage.bootstrapContextKey] as? Data
        else { return }
        Task { @MainActor in
            if let bootstrap = try? self.decoder.decode(ForgeWatchBootstrap.self, from: data) {
                self.saveBootstrap(bootstrap)
                self.lastStatusMessage = "Received watch refresh"
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String : Any] = [:]
    ) {
        guard let data = userInfo[ForgeWatchStorage.ackMessageKey] as? Data else { return }
        Task { @MainActor in
            if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: data) {
                self.removeQueuedAction(id: ack.actionId)
                if let bootstrap = ack.bootstrap {
                    self.saveBootstrap(bootstrap)
                }
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in
            if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: messageData) {
                self.removeQueuedAction(id: ack.actionId)
                if let bootstrap = ack.bootstrap {
                    self.saveBootstrap(bootstrap)
                }
            }
        }
    }
}
