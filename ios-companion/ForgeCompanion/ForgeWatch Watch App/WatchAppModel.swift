import Combine
import Foundation
import SwiftUI
import WatchConnectivity
import WatchKit

struct ForgeWatchDirectSyncMetric: Hashable {
    let operation: String
    let transportLabel: String
    let requestBytes: Int
    let responseBytes: Int
    let durationMs: Int
    let itemCount: Int
    let succeeded: Bool
    let fallbackUsed: Bool
    let errorDescription: String?

    var summary: String {
        var parts = [
            "\(transportLabel)",
            "\(operation) \(durationMs) ms",
            "\(Self.formatBytes(requestBytes)) up",
            "\(Self.formatBytes(responseBytes)) down"
        ]
        if itemCount > 0 {
            parts.append("\(itemCount) item\(itemCount == 1 ? "" : "s")")
        }
        if fallbackUsed {
            parts.append("iPhone fallback")
        }
        if succeeded == false {
            parts.append("failed")
        }
        return parts.joined(separator: " • ")
    }

    func withFallbackUsed(_ value: Bool) -> ForgeWatchDirectSyncMetric {
        ForgeWatchDirectSyncMetric(
            operation: operation,
            transportLabel: transportLabel,
            requestBytes: requestBytes,
            responseBytes: responseBytes,
            durationMs: durationMs,
            itemCount: itemCount,
            succeeded: succeeded,
            fallbackUsed: value,
            errorDescription: errorDescription
        )
    }

    private static func formatBytes(_ value: Int) -> String {
        guard value >= 1024 else {
            return "\(value) B"
        }
        let kilobytes = Double(value) / 1024
        guard kilobytes >= 1024 else {
            return String(format: "%.1f KB", kilobytes)
        }
        return String(format: "%.1f MB", kilobytes / 1024)
    }
}

@MainActor
final class WatchAppModel: NSObject, ObservableObject {
    @Published var bootstrap: ForgeWatchBootstrap
    @Published var selectedSurface: WatchSurface = .now
    @Published var lastStatusMessage = "Waiting for Forge"
    @Published var lastDirectSyncMetric: ForgeWatchDirectSyncMetric?
    @Published private(set) var pendingActionCount = 0

    private let defaults = ForgeWatchStorage.sharedDefaults()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let previewMode: Bool
    private let refreshRequestCooldown: TimeInterval = 8
    private let directRequestTimeout = ForgeWatchDirectRoutePolicy.directRequestTimeoutSeconds
    private var lastRefreshRequestAt: Date?
    private var directFlushTask: Task<Void, Never>?
    private var directRouteCoolingDownUntil: Date?
    private var directRouteLastFailureDescription: String?

    init(preview: Bool = false) {
        self.previewMode = preview
        if preview {
            self.bootstrap = Self.previewBootstrap()
        } else {
            self.bootstrap = ForgeWatchBootstrap.empty
        }
        super.init()
        if preview == false {
            bootstrap = loadBootstrap()
            pendingActionCount = loadQueue().count
            activateSession()
        }
    }

    func activateSession() {
        guard previewMode == false, WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        flushPendingActions()
        refreshFromForge(reason: "watch_launch", fallbackToPhone: true)
    }

    func consumePendingLaunchDestination() {
        guard
            let rawValue = defaults.string(forKey: ForgeWatchStorage.pendingLaunchDestinationKey)
        else { return }
        defaults.removeObject(forKey: ForgeWatchStorage.pendingLaunchDestinationKey)
        switch rawValue {
        case "check_in", "emotion":
            selectedSurface = .psyche
        case "mark_moment":
            selectedSurface = .now
        case "prompt_inbox":
            selectedSurface = .inbox
        default:
            selectedSurface = WatchSurface(rawValue: rawValue) ?? .now
        }
    }

    func flushPendingActions() {
        guard previewMode == false else { return }
        let queue = loadQueue()
        guard queue.isEmpty == false else { return }
        if directConnection() != nil {
            directFlushTask?.cancel()
            directFlushTask = Task { @MainActor [weak self] in
                await self?.flushPendingActionsDirectThenPhone()
            }
            return
        }
        flushPendingActionsThroughPhone(queue)
    }

    private func flushPendingActionsThroughPhone(_ queue: [ForgeWatchOutboundEnvelope]) {
        if WCSession.default.isReachable {
            if let data = try? encoder.encode(ForgeWatchOutboundBatchEnvelope(envelopes: queue)) {
                WCSession.default.sendMessageData(data) { [weak self] replyData in
                    Task { @MainActor in
                        guard let self else { return }
                        if let ackBatch = try? self.decoder.decode(ForgeWatchAckBatchEnvelope.self, from: replyData) {
                            self.applyAckBatch(ackBatch)
                        } else if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: replyData) {
                            self.applyAck(ack)
                        }
                    }
                } errorHandler: { [weak self] error in
                    Task { @MainActor in
                        self?.lastStatusMessage = "iPhone relay failed: \(error.localizedDescription)"
                        self?.transferActionsThroughPhone(queue)
                    }
                }
            }
        } else {
            transferActionsThroughPhone(queue)
        }
        if let cooldownMessage = directCooldownRelayMessage() {
            lastStatusMessage = cooldownMessage
            return
        }
        lastStatusMessage = WCSession.default.isReachable
            ? "Sending through iPhone relay"
            : "Waiting for iPhone relay"
    }

    private func transferActionsThroughPhone(_ queue: [ForgeWatchOutboundEnvelope]) {
        for item in queue {
            if let data = try? encoder.encode(item) {
                WCSession.default.transferUserInfo([
                    ForgeWatchStorage.actionMessageKey: data
                ])
            }
        }
    }

    func requestForgeRefresh(reason: String = "manual", force: Bool = false) {
        guard previewMode == false else { return }
        let now = Date()
        if force == false, let lastRefreshRequestAt, now.timeIntervalSince(lastRefreshRequestAt) < refreshRequestCooldown {
            lastStatusMessage = directConnection() == nil
                ? "Refresh already pending"
                : "Direct refresh already running"
            return
        }
        lastRefreshRequestAt = now
        if directConnection() != nil {
            refreshFromForge(reason: reason, fallbackToPhone: true)
            return
        }
        if let cooldownMessage = directCooldownRelayMessage() {
            lastStatusMessage = "\(cooldownMessage) refresh"
        }
        requestPhoneRelayRefresh(reason: reason)
    }

    private func requestPhoneRelayRefresh(reason: String) {
        guard WCSession.isSupported() else {
            lastStatusMessage = "Forge direct unavailable"
            return
        }
        let request = ForgeWatchControlRequest(
            id: UUID().uuidString,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            reason: reason
        )
        guard let data = try? encoder.encode(request) else { return }
        lastStatusMessage = "Requesting iPhone relay refresh"
        if WCSession.default.isReachable {
            WCSession.default.sendMessageData(data, replyHandler: nil) { [weak self] error in
                Task { @MainActor in
                    self?.lastStatusMessage = "iPhone relay failed: \(error.localizedDescription)"
                }
            }
        } else {
            WCSession.default.transferUserInfo([
                ForgeWatchStorage.syncRequestMessageKey: data
            ])
        }
    }

    func refreshFromForge(reason: String = "manual", fallbackToPhone: Bool = true) {
        guard previewMode == false else { return }
        guard directConnection() != nil else {
            if fallbackToPhone {
                requestPhoneRelayRefresh(reason: reason)
            }
            return
        }
        Task { @MainActor [weak self] in
            await self?.refreshFromForgeDirect(reason: reason, fallbackToPhone: fallbackToPhone)
        }
    }

    private static func previewBootstrap() -> ForgeWatchBootstrap {
        let now = ISO8601DateFormatter().string(from: Date())
        let task = ForgeWatchTaskSummary(
            id: "task_watch_quality",
            title: "Improve watch navigation and fast logging",
            status: "focus",
            level: "task",
            priority: "high",
            dueDate: String(now.prefix(10)),
            projectId: "project_forge_watch",
            goalId: "goal_forge_quality",
            parentWorkItemId: nil,
            points: 5,
            effort: "medium",
            energy: "focus",
            updatedAt: now
        )
        let secondTask = ForgeWatchTaskSummary(
            id: "task_sync_metrics",
            title: "Check sync timing and duplicate requests",
            status: "in_progress",
            level: "task",
            priority: "medium",
            dueDate: String(now.prefix(10)),
            projectId: "project_forge_watch",
            goalId: "goal_forge_quality",
            parentWorkItemId: nil,
            points: 3,
            effort: "low",
            energy: "calm",
            updatedAt: now
        )
        let run = ForgeWatchTaskRunSummary(
            id: "run_watch_quality",
            taskId: task.id,
            taskTitle: task.title,
            actor: "albert",
            status: "active",
            isCurrent: true,
            timerMode: "focus",
            plannedDurationSeconds: 1800,
            creditedSeconds: 742,
            claimedAt: now,
            heartbeatAt: now,
            leaseExpiresAt: now
        )
        let habits = [
            previewHabit(
                id: "habit_morning_plan",
                title: "Morning planning",
                polarity: "positive",
                streak: 4,
                due: true,
                aligned: "Done",
                unaligned: "Missed"
            ),
            previewHabit(
                id: "habit_scroll_break",
                title: "Avoid late screen spiral",
                polarity: "negative",
                streak: 2,
                due: true,
                aligned: "Resisted",
                unaligned: "Indulged"
            )
        ]

        let prompts = [
            ForgeWatchPrompt(
                id: "prompt_place",
                kind: "new_place",
                title: "New place detected",
                message: "Label the stay without opening the phone.",
                createdAt: now,
                linkedContext: ForgeWatchLinkedContext(placeId: "place_preview", stayId: "stay_preview", tripId: nil, workoutId: nil),
                choices: ["Home", "Work", "Gym"]
            ),
            ForgeWatchPrompt(
                id: "prompt_social",
                kind: "social_follow_up",
                title: "Social context",
                message: "Capture who was involved while it is fresh.",
                createdAt: now,
                linkedContext: .empty,
                choices: ["Friend", "Work", "Family"]
            )
        ]

        return ForgeWatchBootstrap(
            schemaVersion: 2,
            generatedAt: now,
            connection: ForgeWatchConnection(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
                sessionId: "pair_preview",
                pairingToken: "preview-token",
                transportLabel: "Tailscale",
                directNetworkingEnabled: true
            ),
            surfaces: [
                .init(id: "now", title: "Now", icon: "sparkle"),
                .init(id: "work", title: "Work", icon: "kanban"),
                .init(id: "habits", title: "Habits", icon: "habit"),
                .init(id: "goals", title: "Goals", icon: "scope"),
                .init(id: "today", title: "Today", icon: "calendar"),
                .init(id: "health", title: "Health", icon: "heart"),
                .init(id: "movement", title: "Move", icon: "location"),
                .init(id: "psyche", title: "Psyche", icon: "mind"),
                .init(id: "inbox", title: "Inbox", icon: "tray"),
                .init(id: "sync", title: "Sync", icon: "antenna")
            ],
            now: ForgeWatchNowSnapshot(
                currentRun: run,
                nextTask: task,
                dueHabitCount: habits.filter(\.dueToday).count,
                pendingPromptCount: prompts.count,
                generatedAt: now
            ),
            work: ForgeWatchWorkSnapshot(
                actor: "albert",
                activeRuns: [run],
                currentRun: run,
                nextTask: task,
                lanes: [
                    ForgeWatchWorkLane(id: "focus", title: "Focus", count: 1, tasks: [task]),
                    ForgeWatchWorkLane(id: "progress", title: "In progress", count: 1, tasks: [secondTask])
                ],
                visibleCount: 2,
                doneCount: 1
            ),
            goals: [
                ForgeWatchGoalSummary(
                    id: "goal_forge_quality",
                    title: "Make Forge faster and easier to command",
                    horizon: "quarter",
                    status: "active",
                    targetPoints: 120
                )
            ],
            projects: [
                ForgeWatchProjectSummary(
                    id: "project_forge_watch",
                    title: "Forge watchOS companion",
                    status: "active",
                    workflowStatus: "building",
                    goalId: "goal_forge_quality",
                    goalTitle: "Make Forge faster and easier to command",
                    activeRunCount: 1,
                    openTaskCount: 2
                )
            ],
            today: ForgeWatchTodaySnapshot(
                dateKey: String(now.prefix(10)),
                dueTasks: [task, secondTask],
                dueCount: 2,
                recentDone: []
            ),
            health: ForgeWatchHealthSnapshot(
                lastWorkout: ForgeWatchHealthSnapshot.Workout(
                    id: "workout_preview",
                    workoutType: "Kickboxing",
                    startedAt: now,
                    endedAt: now,
                    durationSeconds: 5400,
                    averageHeartRate: 148,
                    maxHeartRate: 181,
                    trainingLoad: 72,
                    heartRateSampleCount: 1240
                ),
                latestVitals: ForgeWatchHealthSnapshot.Vitals(dayKey: String(now.prefix(10)), metricCount: 8)
            ),
            movement: ForgeWatchMovementSnapshot(
                latestStay: ForgeWatchMovementSnapshot.Segment(id: "stay_preview", label: "Office", startedAt: now, endedAt: nil),
                latestTrip: ForgeWatchMovementSnapshot.Segment(id: "trip_preview", label: "Bike commute", startedAt: now, endedAt: nil),
                unlabeledPlaceCount: 1
            ),
            psyche: ForgeWatchPsycheSnapshot(
                emotionOptions: ["Focused", "Calm", "Tired"],
                triggerOptions: ["Conflict", "Rumination", "Pleasant moment"],
                routinePromptOptions: ["Medication taken?", "Meal?", "Recovery break?"],
                questions: [
                    ForgeWatchPsycheSnapshot.Question(
                        id: "question_emotion",
                        title: "Mood check",
                        prompt: "What is dominant right now?",
                        eventType: "emotion_check_in",
                        options: [
                            .init(id: "focused", label: "Focused", subtitle: "Good direction", payload: ["emotion": "focused"]),
                            .init(id: "tense", label: "Tense", subtitle: "Needs regulation", payload: ["emotion": "tense"]),
                            .init(id: "tired", label: "Tired", subtitle: "Low energy", payload: ["emotion": "tired"])
                        ]
                    ),
                    ForgeWatchPsycheSnapshot.Question(
                        id: "question_trigger",
                        title: "Trigger",
                        prompt: "Did anything pull attention?",
                        eventType: "trigger_capture",
                        options: [
                            .init(id: "none", label: "No trigger", subtitle: "Stable", payload: ["trigger": "none"]),
                            .init(id: "conflict", label: "Conflict", subtitle: "Interpersonal", payload: ["trigger": "conflict"]),
                            .init(id: "rumination", label: "Rumination", subtitle: "Thought loop", payload: ["trigger": "rumination"])
                        ]
                    )
                ],
                recentReports: [
                    ForgeWatchPsycheSnapshot.RecentReport(id: "report_preview", title: "Evening reflection", occurredAt: now, status: "open")
                ]
            ),
            inbox: ForgeWatchInboxSnapshot(prompts: prompts),
            sync: ForgeWatchSyncSnapshot(
                pairingSessionId: "pair_preview",
                generatedAt: now,
                storedCaptureCount: 3,
                actionReceiptCount: 7
            ),
            habits: habits,
            checkInOptions: ForgeWatchQuickOptions(
                activities: ["Working", "Walking", "Resting"],
                emotions: ["Focused", "Calm", "Tired"],
                triggers: ["Conflict", "Pleasant moment", "Rumination"],
                placeCategories: ["Home", "Work", "Gym"],
                routinePrompts: ["Medication taken?", "Meal?", "Recovery break?"],
                recentPeople: ["Julien", "Family", "Coach"]
            ),
            pendingPrompts: prompts
        )
    }

    private static func previewHabit(
        id: String,
        title: String,
        polarity: String,
        streak: Int,
        due: Bool,
        aligned: String,
        unaligned: String
    ) -> ForgeWatchHabitSummary {
        ForgeWatchHabitSummary(
            id: id,
            title: title,
            polarity: polarity,
            frequency: "daily",
            targetCount: 1,
            weekDays: [],
            streakCount: streak,
            dueToday: due,
            cadenceLabel: "1x daily",
            alignedActionLabel: aligned,
            unalignedActionLabel: unaligned,
            currentPeriodStatus: .unknown,
            last7History: [
                .init(id: "\(id)-1", label: "S", periodKey: "1", current: false, state: .aligned),
                .init(id: "\(id)-2", label: "M", periodKey: "2", current: false, state: .aligned),
                .init(id: "\(id)-3", label: "T", periodKey: "3", current: false, state: .unaligned),
                .init(id: "\(id)-4", label: "W", periodKey: "4", current: false, state: .aligned),
                .init(id: "\(id)-5", label: "T", periodKey: "5", current: false, state: .aligned),
                .init(id: "\(id)-6", label: "F", periodKey: "6", current: false, state: .unknown),
                .init(id: "\(id)-7", label: "S", periodKey: "7", current: true, state: .unknown)
            ]
        )
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
                captureEvent: nil,
                command: nil
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
                ),
                command: nil
            )
        )
        WKInterfaceDevice.current().play(.success)
    }

    func queueCommand(kind: ForgeWatchActionKind, payload: [String: String]) {
        enqueue(
            ForgeWatchOutboundEnvelope(
                id: UUID().uuidString,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                device: currentDeviceDescriptor(),
                kind: kind,
                habitCheckIn: nil,
                captureEvent: nil,
                command: ForgeWatchCommandAction(payload: payload)
            )
        )
        WKInterfaceDevice.current().play(.click)
    }

    private func enqueue(_ envelope: ForgeWatchOutboundEnvelope) {
        var queue = loadQueue()
        queue.append(envelope)
        saveQueue(queue)
        if let connection = directConnection() {
            lastStatusMessage = "Sending to Forge through \(connection.transportLabel)"
        } else {
            lastStatusMessage = directCooldownRelayMessage() ?? "Waiting for iPhone relay"
        }
        flushPendingActions()
    }

    private struct WatchBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
    }

    private struct WatchBootstrapEnvelope: Decodable {
        let watch: ForgeWatchBootstrap
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
    }

    private struct DirectPostResult<Response> {
        let response: Response
        let metric: ForgeWatchDirectSyncMetric
    }

    private func directConnection(respectingCooldown: Bool = true) -> ForgeWatchConnection? {
        guard let connection = bootstrap.connection, Self.canUseDirectNetworking(connection) else {
            return nil
        }
        if respectingCooldown, isDirectRouteCoolingDown(now: Date()) {
            return nil
        }
        return connection
    }

    static func canUseDirectNetworking(_ connection: ForgeWatchConnection) -> Bool {
        ForgeWatchDirectRoutePolicy.canUseDirectNetworking(
            apiBaseUrl: connection.apiBaseUrl,
            directNetworkingEnabled: connection.directNetworkingEnabled
        )
    }

    private func directURL(path: String, connection: ForgeWatchConnection) throws -> URL {
        guard let url = URL(string: "\(connection.apiBaseUrl)\(path)") else {
            throw URLError(.badURL)
        }
        return url
    }

    private func postDirect<Request: Encodable, Response: Decodable>(
        path: String,
        body: Request,
        connection: ForgeWatchConnection,
        operation: String,
        itemCount: Int
    ) async throws -> DirectPostResult<Response> {
        let url = try directURL(path: path, connection: connection)
        let bodyData = try encoder.encode(body)
        let startedAt = Date()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = directRequestTimeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            let durationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
            lastDirectSyncMetric = ForgeWatchDirectSyncMetric(
                operation: operation,
                transportLabel: connection.transportLabel,
                requestBytes: bodyData.count,
                responseBytes: 0,
                durationMs: durationMs,
                itemCount: itemCount,
                succeeded: false,
                fallbackUsed: false,
                errorDescription: error.localizedDescription
            )
            throw error
        }
        let durationMs = max(0, Int(Date().timeIntervalSince(startedAt) * 1000))
        guard let httpResponse = response as? HTTPURLResponse else {
            lastDirectSyncMetric = ForgeWatchDirectSyncMetric(
                operation: operation,
                transportLabel: connection.transportLabel,
                requestBytes: bodyData.count,
                responseBytes: data.count,
                durationMs: durationMs,
                itemCount: itemCount,
                succeeded: false,
                fallbackUsed: false,
                errorDescription: URLError(.badServerResponse).localizedDescription
            )
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            lastDirectSyncMetric = ForgeWatchDirectSyncMetric(
                operation: operation,
                transportLabel: connection.transportLabel,
                requestBytes: bodyData.count,
                responseBytes: data.count,
                durationMs: durationMs,
                itemCount: itemCount,
                succeeded: false,
                fallbackUsed: false,
                errorDescription: "Forge returned HTTP \(httpResponse.statusCode)."
            )
            throw NSError(
                domain: "ForgeWatchDirect",
                code: httpResponse.statusCode,
                userInfo: [
                    NSLocalizedDescriptionKey: "Forge returned HTTP \(httpResponse.statusCode)."
                ]
            )
        }
        let metric = ForgeWatchDirectSyncMetric(
            operation: operation,
            transportLabel: connection.transportLabel,
            requestBytes: bodyData.count,
            responseBytes: data.count,
            durationMs: durationMs,
            itemCount: itemCount,
            succeeded: true,
            fallbackUsed: false,
            errorDescription: nil
        )
        lastDirectSyncMetric = metric
        return DirectPostResult(response: try decoder.decode(Response.self, from: data), metric: metric)
    }

    private func refreshFromForgeDirect(reason: String, fallbackToPhone: Bool) async {
        guard let connection = directConnection() else {
            if fallbackToPhone {
                requestPhoneRelayRefresh(reason: reason)
            }
            return
        }
        do {
            lastStatusMessage = "Refreshing through \(connection.transportLabel)"
            let result: DirectPostResult<WatchBootstrapEnvelope> = try await postDirect(
                path: "/mobile/watch/bootstrap",
                body: WatchBootstrapRequest(
                    sessionId: connection.sessionId,
                    pairingToken: connection.pairingToken
                ),
                connection: connection,
                operation: "bootstrap",
                itemCount: 0
            )
            let envelope = result.response
            clearDirectRouteCooldown()
            saveBootstrap(envelope.watch.withConnection(connection))
            lastStatusMessage = "Synced: \(result.metric.summary)"
            flushPendingActions()
        } catch {
            lastStatusMessage = "Direct sync failed: \(error.localizedDescription)"
            markDirectRouteFailureIfNeeded(error)
            if fallbackToPhone {
                requestPhoneRelayRefresh(reason: reason)
            }
        }
    }

    private func flushPendingActionsDirectThenPhone() async {
        guard let connection = directConnection() else {
            flushPendingActionsThroughPhone(loadQueue())
            return
        }
        let queue = loadQueue()
        guard queue.isEmpty == false else { return }
        do {
            lastStatusMessage = "Syncing with Forge through \(connection.transportLabel)"
            let commands = Self.commands(from: queue)
            let result: DirectPostResult<WatchCommandBatchEnvelope> = try await postDirect(
                path: "/mobile/watch/actions:batch",
                body: WatchCommandBatchRequest(
                    sessionId: connection.sessionId,
                    pairingToken: connection.pairingToken,
                    device: queue.first?.device ?? currentDeviceDescriptor(),
                    commands: commands
                ),
                connection: connection,
                operation: "actions",
                itemCount: commands.count
            )
            let envelope = result.response
            clearDirectRouteCooldown()
            saveBootstrap(envelope.watch.withConnection(connection))
            let acknowledgedIds = Set(envelope.receipt.receipts.map(\.actionId))
            saveQueue(queue.filter { acknowledgedIds.contains($0.id) == false })
            let remaining = loadQueue()
            lastStatusMessage = remaining.isEmpty
                ? "Synced: \(result.metric.summary)"
                : "Still sending \(remaining.count) • \(result.metric.summary)"
            if envelope.receipt.failedCount > 0 {
                WKInterfaceDevice.current().play(.failure)
            } else {
                WKInterfaceDevice.current().play(.success)
            }
        } catch {
            if let metric = lastDirectSyncMetric {
                lastDirectSyncMetric = metric.withFallbackUsed(true)
            }
            markDirectRouteFailureIfNeeded(error)
            lastStatusMessage = "Direct sync unavailable; using iPhone relay"
            flushPendingActionsThroughPhone(queue)
        }
    }

    private func isDirectRouteCoolingDown(now: Date) -> Bool {
        guard let directRouteCoolingDownUntil else {
            return false
        }
        if now < directRouteCoolingDownUntil {
            return true
        }
        self.directRouteCoolingDownUntil = nil
        directRouteLastFailureDescription = nil
        return false
    }

    private func directCooldownRelayMessage() -> String? {
        guard
            let connection = directConnection(respectingCooldown: false),
            isDirectRouteCoolingDown(now: Date())
        else {
            return nil
        }
        return "\(connection.transportLabel) not reachable on watch; using iPhone relay"
    }

    private func markDirectRouteFailureIfNeeded(_ error: Error) {
        guard Self.isRecoverableDirectNetworkError(error) else {
            return
        }
        directRouteCoolingDownUntil = Date()
            .addingTimeInterval(ForgeWatchDirectRoutePolicy.failureRelayCooldownSeconds)
        directRouteLastFailureDescription = error.localizedDescription
    }

    private func clearDirectRouteCooldown() {
        directRouteCoolingDownUntil = nil
        directRouteLastFailureDescription = nil
    }

    static func isRecoverableDirectNetworkError(_ error: Error) -> Bool {
        ForgeWatchDirectRoutePolicy.isRecoverableNetworkError(error)
    }

    private static func commands(
        from envelopes: [ForgeWatchOutboundEnvelope]
    ) -> [WatchCommandBatchRequest.Command] {
        envelopes.compactMap { envelope in
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
        let merged = bootstrap.withConnection(bootstrap.connection ?? self.bootstrap.connection)
        self.bootstrap = merged
        if let data = try? encoder.encode(merged) {
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
        pendingActionCount = queue.count
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
        lastStatusMessage = queue.isEmpty ? "Synced with Forge" : "Still sending \(queue.count)"
    }

    private func applyAck(_ ack: ForgeWatchAckEnvelope) {
        if ack.status == "deferred" {
            let message = ack.error?["message"] ?? "iPhone relay deferred"
            lastStatusMessage = "Still to send: \(message)"
            return
        }
        removeQueuedAction(id: ack.actionId)
        if let bootstrap = ack.bootstrap {
            saveBootstrap(bootstrap)
        }
        if ack.status == "failed" {
            lastStatusMessage = "Forge rejected one action"
            WKInterfaceDevice.current().play(.failure)
        } else {
            WKInterfaceDevice.current().play(.success)
        }
    }

    private func applyAckBatch(_ batch: ForgeWatchAckBatchEnvelope) {
        for ack in batch.acks {
            applyAck(ack)
        }
    }

    func applyAckForTesting(_ ack: ForgeWatchAckEnvelope) {
        applyAck(ack)
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
                if activationState == .activated, let connection = self.directConnection() {
                    self.lastStatusMessage = "Direct \(connection.transportLabel) ready"
                } else {
                    self.lastStatusMessage = activationState == .activated ? "iPhone relay ready" : "Waiting for Forge"
                }
                self.flushPendingActions()
                self.refreshFromForge(reason: "activation", fallbackToPhone: true)
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        Task { @MainActor in
            if isReachable {
                self.flushPendingActions()
                self.refreshFromForge(reason: "reachable", fallbackToPhone: true)
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
                self.applyAck(ack)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in
            if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: messageData) {
                self.applyAck(ack)
            }
        }
    }
}
