import Combine
import CryptoKit
import Foundation
import Security
import SwiftUI
import WatchConnectivity
import WatchKit

enum ForgeWatchPreviewScenario: String, CaseIterable {
    case standard
    case empty
    case loading
    case stale
    case error
    case longContent = "long"
}

@MainActor
final class ForgeWatchPeoplePrivacyMonitor: ObservableObject {
    @Published private(set) var isUnlocked = false

    func refresh() {
        isUnlocked = Self.protectedDataIsAvailable()
    }

    private static func protectedDataIsAvailable() -> Bool {
        let service = "com.albertbuchard.forge.watch.people-unlock-probe"
        let account = "device"
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }

        var attributes = query
        attributes.removeValue(forKey: kSecReturnData)
        attributes.removeValue(forKey: kSecMatchLimit)
        attributes[kSecValueData] = Data([0x01])
        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        return addStatus == errSecSuccess || addStatus == errSecDuplicateItem
    }
}

@MainActor
final class WatchAppModel: NSObject, ObservableObject {
    @Published var bootstrap: ForgeWatchBootstrap
    @Published var selectedSurface: WatchSurface = .now
    @Published var lastStatusMessage = "Waiting for Forge"
    @Published var lastDirectSyncMetric: ForgeWatchDirectSyncMetric?
    @Published private(set) var pendingActionCount = 0
    @Published private(set) var snapshotSource: ForgeWatchSnapshotSource = .unavailable
    @Published private(set) var recentReceipts: [ForgeWatchStoredReceipt] = []
    @Published private(set) var refreshState: ForgeWatchRefreshState = .idle

    var latestReceipt: ForgeWatchStoredReceipt? {
        recentReceipts.first
    }

    private let defaults = ForgeWatchStorage.sharedDefaults()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let previewMode: Bool
    private let refreshRequestCooldown: TimeInterval = 8
    private let directRequestTimeout = ForgeWatchDirectRoutePolicy.directRequestTimeoutSeconds
    private var lastRefreshRequestAt: Date?
    private var directFlushTask: Task<Void, Never>?
    private var directRetryTask: Task<Void, Never>?
    private var directRouteCoolingDownUntil: Date?
    private var directRouteLastFailureDescription: String?
    private var activeHandoffActivity: NSUserActivity?
    private var activeRefreshRequestId: String?
    private var refreshDeadlineTask: Task<Void, Never>?

    init(
        preview: Bool = false,
        previewScenario: ForgeWatchPreviewScenario = .standard
    ) {
        self.previewMode = preview
        if preview {
            self.bootstrap = Self.previewBootstrap(scenario: previewScenario)
        } else {
            self.bootstrap = ForgeWatchBootstrap.empty
        }
        super.init()
        if preview {
            switch previewScenario {
            case .loading:
                snapshotSource = .unavailable
                refreshState = .refreshing
                lastStatusMessage = "Refreshing Forge preview"
            case .error:
                snapshotSource = .unavailable
                refreshState = .failed
                lastStatusMessage = "Forge refresh failed"
            case .stale:
                snapshotSource = .cache
                lastStatusMessage = "Showing cached Forge preview"
            case .empty:
                snapshotSource = .preview
                lastStatusMessage = "No active planning items"
            case .standard, .longContent:
                snapshotSource = .preview
                lastStatusMessage = "Forge preview ready"
            }
        } else {
            bootstrap = loadBootstrap()
            snapshotSource = bootstrap.hasSnapshotContent ? .cache : .unavailable
            recentReceipts = loadReceiptHistory()
            pendingActionCount = loadQueue().count
            activateSession()
        }
    }

    func snapshotFreshness(now: Date = Date()) -> ForgeWatchSnapshotFreshness {
        ForgeWatchSnapshotFreshness.evaluate(
            generatedAt: bootstrap.generatedAt,
            hasSnapshot: bootstrap.hasSnapshotContent,
            now: now
        )
    }

    func continueOnPhone(_ destination: ForgeWatchPhoneDestination) {
        if let url = ForgeWatchPhoneHandoff.url(
            uiBaseUrl: bootstrap.connection?.uiBaseUrl,
            destination: destination
        ) {
            activeHandoffActivity?.invalidate()
            let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
            activity.title = "Continue in Forge"
            activity.webpageURL = url
            activity.isEligibleForHandoff = true
            activity.isEligibleForSearch = false
            activity.isEligibleForPublicIndexing = false
            activity.becomeCurrent()
            activeHandoffActivity = activity
            lastStatusMessage = "Ready to continue on iPhone"
            WKInterfaceDevice.current().play(.click)
            return
        }

        guard
            previewMode == false,
            WCSession.isSupported(),
            let request = ForgeWatchPhoneHandoffRequest(destination: destination),
            let data = try? encoder.encode(request)
        else {
            lastStatusMessage = "Open Forge on iPhone to continue"
            WKInterfaceDevice.current().play(.directionDown)
            return
        }
        let session = WCSession.default
        if session.isReachable {
            session.sendMessageData(data) { [weak self] replyData in
                Task { @MainActor in
                    guard
                        let self,
                        let response = try? self.decoder.decode(
                            ForgeWatchPhoneHandoffResponse.self,
                            from: replyData
                        )
                    else { return }
                    self.applyPhoneHandoffResponse(response)
                }
            } errorHandler: { [weak self] error in
                Task { @MainActor in
                    self?.lastStatusMessage = "iPhone handoff failed: \(error.localizedDescription)"
                    WKInterfaceDevice.current().play(.failure)
                }
            }
        } else {
            session.transferUserInfo([
                ForgeWatchStorage.phoneHandoffRequestMessageKey: data
            ])
        }
        lastStatusMessage = session.isReachable
            ? "Opening Forge on iPhone"
            : "Handoff waiting for paired iPhone"
        WKInterfaceDevice.current().play(.click)
    }

    private func applyPhoneHandoffResponse(_ response: ForgeWatchPhoneHandoffResponse) {
        lastStatusMessage = response.message
        WKInterfaceDevice.current().play(response.status == .ready ? .click : .failure)
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

    func flushPendingActions(forceDirect: Bool = false) {
        guard previewMode == false else { return }
        let queue = loadQueue()
        guard queue.isEmpty == false else { return }
        let respectCooldown = ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(
            forceUserRetry: forceDirect
        )
        if directConnection(respectingCooldown: respectCooldown) != nil {
            startDirectFlushIfNeeded(forceDirect: forceDirect)
            return
        }
        flushPendingActionsThroughPhone(queue)
    }

    private func startDirectFlushIfNeeded(forceDirect: Bool) {
        guard directFlushTask == nil else {
            lastStatusMessage = "Direct send already running"
            return
        }
        directFlushTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.flushPendingActionsDirectThenPhone(forceDirect: forceDirect)
            self.directFlushTask = nil
            if self.loadQueue().isEmpty == false, self.directConnection() != nil {
                self.flushPendingActions(forceDirect: forceDirect)
            }
        }
    }

    private func flushPendingActionsThroughPhone(_ queue: [ForgeWatchOutboundEnvelope]) {
        let batch = ForgeWatchActionBatchPolicy.nextBatch(from: queue)
        guard batch.isEmpty == false else { return }
        if WCSession.default.isReachable {
            if let data = try? encoder.encode(ForgeWatchOutboundBatchEnvelope(envelopes: batch)) {
                WCSession.default.sendMessageData(data) { [weak self] replyData in
                    Task { @MainActor in
                        guard let self else { return }
                        if let ackBatch = try? self.decoder.decode(ForgeWatchAckBatchEnvelope.self, from: replyData) {
                            self.applyAckBatch(ackBatch)
                        } else if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: replyData) {
                            self.applyAsyncAck(ack)
                        }
                    }
                } errorHandler: { [weak self] error in
                    Task { @MainActor in
                        self?.lastStatusMessage = "Paired iPhone backup failed: \(error.localizedDescription)"
                        self?.transferActionsThroughPhone(batch)
                    }
                }
            }
        } else {
            transferActionsThroughPhone(batch)
        }
        if let cooldownMessage = directCooldownFallbackMessage() {
            lastStatusMessage = cooldownMessage
            return
        }
        lastStatusMessage = WCSession.default.isReachable
            ? "Paired iPhone backup sending to Forge"
            : "Waiting for paired iPhone backup"
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
        refreshState = .refreshing
        let respectCooldown = ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(
            forceUserRetry: force
        )
        if directConnection(respectingCooldown: respectCooldown) != nil {
            refreshFromForge(reason: reason, fallbackToPhone: true, forceDirect: force)
            return
        }
        if let cooldownMessage = directCooldownFallbackMessage() {
            lastStatusMessage = "\(cooldownMessage) refresh"
        }
        requestPhoneFallbackRefresh(reason: reason)
    }

    private func requestPhoneFallbackRefresh(reason: String) {
        guard WCSession.isSupported() else {
            lastStatusMessage = "Forge direct unavailable"
            refreshState = .failed
            return
        }
        refreshState = .refreshing
        let createdAt = Date()
        let deadline = ForgeWatchRefreshRequestPolicy.deadline(for: createdAt)
        let request = ForgeWatchControlRequest(
            id: UUID().uuidString,
            createdAt: ISO8601DateFormatter().string(from: createdAt),
            reason: reason,
            deadlineAt: ISO8601DateFormatter().string(from: deadline)
        )
        guard let data = try? encoder.encode(request) else {
            refreshState = .failed
            lastStatusMessage = "Could not request a Forge refresh"
            return
        }
        beginRefreshDeadline(for: request)
        lastStatusMessage = "Paired iPhone backup refreshing Forge"
        if WCSession.default.isReachable {
            WCSession.default.sendMessageData(data) { [weak self] replyData in
                Task { @MainActor in
                    guard
                        let self,
                        let response = try? self.decoder.decode(
                            ForgeWatchRefreshResponse.self,
                            from: replyData
                        )
                    else { return }
                    self.applyRefreshResponse(response)
                }
            } errorHandler: { [weak self] error in
                Task { @MainActor in
                    self?.lastStatusMessage = "Paired iPhone backup failed: \(error.localizedDescription)"
                    self?.refreshState = .failed
                    self?.finishRefreshRequest()
                }
            }
        } else {
            WCSession.default.transferUserInfo([
                ForgeWatchStorage.syncRequestMessageKey: data
            ])
        }
    }

    private func beginRefreshDeadline(for request: ForgeWatchControlRequest) {
        refreshDeadlineTask?.cancel()
        activeRefreshRequestId = request.id
        let requestId = request.id
        refreshDeadlineTask = Task { @MainActor [weak self] in
            let nanoseconds = UInt64(ForgeWatchRefreshRequestPolicy.timeoutSeconds * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard Task.isCancelled == false, self?.activeRefreshRequestId == requestId else {
                return
            }
            self?.refreshState = .failed
            self?.lastStatusMessage = "Refresh timed out. Cached Forge summaries remain available."
            self?.finishRefreshRequest()
        }
    }

    private func finishRefreshRequest() {
        refreshDeadlineTask?.cancel()
        refreshDeadlineTask = nil
        activeRefreshRequestId = nil
    }

    private func applyRefreshResponse(_ response: ForgeWatchRefreshResponse) {
        guard ForgeWatchRefreshRequestPolicy.accepts(
            response,
            activeRequestId: activeRefreshRequestId
        ) else { return }
        finishRefreshRequest()
        switch response.status {
        case .refreshed:
            refreshState = .idle
        case .failed, .expired:
            refreshState = .failed
        }
        lastStatusMessage = response.message
    }

    func refreshFromForge(
        reason: String = "manual",
        fallbackToPhone: Bool = true,
        forceDirect: Bool = false
    ) {
        guard previewMode == false else { return }
        let respectCooldown = ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(
            forceUserRetry: forceDirect
        )
        guard directConnection(respectingCooldown: respectCooldown) != nil else {
            if fallbackToPhone {
                requestPhoneFallbackRefresh(reason: reason)
            }
            return
        }
        Task { @MainActor [weak self] in
            await self?.refreshFromForgeDirect(
                reason: reason,
                fallbackToPhone: fallbackToPhone,
                forceDirect: forceDirect
            )
        }
    }

    static func previewBootstrap(
        scenario: ForgeWatchPreviewScenario = .standard
    ) -> ForgeWatchBootstrap {
        if scenario == .loading || scenario == .error {
            return .empty
        }
        let generatedDate = scenario == .stale
            ? Date().addingTimeInterval(-(ForgeWatchSnapshotFreshness.freshInterval + 60))
            : Date()
        let now = ISO8601DateFormatter().string(from: generatedDate)
        let isLongContent = scenario == .longContent
        let task = ForgeWatchTaskSummary(
            id: "task_watch_quality",
            title: isLongContent
                ? "Review the complete watch planning summary without losing the exact strategic context or the next safe handoff"
                : "Improve watch navigation and fast logging",
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
            title: isLongContent
                ? "Check sync timing, duplicate requests, retry boundaries, and the full receipt trail before changing any canonical work"
                : "Check sync timing and duplicate requests",
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
                unaligned: "Performed"
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
        let pins = ForgeWatchPinsSnapshot(
            total: 2,
            items: [
                .init(
                    id: "pin_task_watch_quality",
                    entityType: "task",
                    entityId: task.id,
                    title: task.title,
                    detail: "High priority / Focus",
                    category: "Task",
                    targetPath: "/tasks/\(task.id)",
                    availability: "available"
                ),
                .init(
                    id: "pin_goal_forge_quality",
                    entityType: "goal",
                    entityId: "goal_forge_quality",
                    title: "Make Forge faster and easier to command",
                    detail: "Active / Quarter",
                    category: "Goal",
                    targetPath: "/goals/goal_forge_quality",
                    availability: "available"
                )
            ]
        )
        let extraTodayTasks = isLongContent
            ? (0..<6).map { index in
                previewTask(
                    id: "task_watch_long_\(index)",
                    title: "Long watch task \(index + 1) with enough detail to verify compact truncation, vertical scrolling, and a stable handoff target",
                    status: ["backlog", "blocked", "in_progress"][index % 3],
                    priority: ["low", "high", "medium"][index % 3],
                    points: index + 1,
                    now: now
                )
            }
            : []
        let previewGoals: [ForgeWatchGoalSummary] = scenario == .empty
            ? []
            : [
                ForgeWatchGoalSummary(
                    id: "goal_forge_quality",
                    title: isLongContent
                        ? "Make Forge faster, calmer, and easier to command across every planning surface without losing strategic depth"
                        : "Make Forge faster and easier to command",
                    horizon: "quarter",
                    status: "active",
                    targetPoints: 120
                )
            ] + (isLongContent
                ? (0..<5).map { index in
                    ForgeWatchGoalSummary(
                        id: "goal_watch_long_\(index)",
                        title: "Strategic direction \(index + 1) with a deliberately extended title for compact watch verification",
                        horizon: ["lifetime", "year", "quarter"][index % 3],
                        status: "active",
                        targetPoints: 80 - index
                    )
                }
                : [])
        let previewProjects: [ForgeWatchProjectSummary] = scenario == .empty
            ? []
            : [
                ForgeWatchProjectSummary(
                    id: "project_forge_watch",
                    title: isLongContent
                        ? "Forge watchOS companion planning summaries and safe cross-device continuation"
                        : "Forge watchOS companion",
                    status: "active",
                    workflowStatus: "in_progress",
                    goalId: "goal_forge_quality",
                    goalTitle: "Make Forge faster and easier to command",
                    activeRunCount: 1,
                    openTaskCount: 2
                )
            ] + (isLongContent
                ? (0..<5).map { index in
                    ForgeWatchProjectSummary(
                        id: "project_watch_long_\(index)",
                        title: "Watch project \(index + 1) with extended operational context for layout verification",
                        status: "active",
                        workflowStatus: ["backlog", "blocked", "focus", "in_progress"][index % 4],
                        goalId: "goal_forge_quality",
                        goalTitle: "Make Forge faster and easier to command",
                        activeRunCount: index % 2,
                        openTaskCount: 6 - index
                    )
                }
                : [])
        let previewTodayTasks = scenario == .empty
            ? []
            : [task, secondTask] + extraTodayTasks

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
                .init(id: "people", title: "Forge People", icon: "person.2"),
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
            goals: previewGoals,
            goalCount: previewGoals.count,
            projects: previewProjects,
            projectCount: previewProjects.count,
            today: ForgeWatchTodaySnapshot(
                dateKey: String(now.prefix(10)),
                dueTasks: previewTodayTasks,
                dueCount: previewTodayTasks.count,
                recentDone: scenario == .empty ? [] : [secondTask]
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
            inbox: ForgeWatchInboxSnapshot(prompts: prompts, attention: nil, pins: pins),
            sync: ForgeWatchSyncSnapshot(
                pairingSessionId: "pair_preview",
                generatedAt: now,
                storedCaptureCount: 3,
                actionReceiptCount: 7
            ),
            people: scenario == .empty
                ? .chooseOnIPhone(generatedAt: now)
                : ForgeWatchPeopleGlanceSnapshot(
                    selection: .selected,
                    generatedAt: now,
                    personName: "Ada Example",
                    lastConnectedAt: now,
                    nextSharedEvent: ForgeWatchPeopleGlanceSnapshot.SharedEvent(
                        title: "Project check-in",
                        startsAt: ISO8601DateFormatter().string(
                            from: generatedDate.addingTimeInterval(3_600)
                        ),
                        sharedAt: now,
                        validUntil: ISO8601DateFormatter().string(
                            from: generatedDate.addingTimeInterval(7_200)
                        )
                    )
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

    private static func previewTask(
        id: String,
        title: String,
        status: String,
        priority: String,
        points: Int,
        now: String
    ) -> ForgeWatchTaskSummary {
        ForgeWatchTaskSummary(
            id: id,
            title: title,
            status: status,
            level: "task",
            priority: priority,
            dueDate: String(now.prefix(10)),
            projectId: "project_forge_watch",
            goalId: "goal_forge_quality",
            parentWorkItemId: nil,
            points: points,
            effort: "medium",
            energy: "focus",
            updatedAt: now
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
        let deviceTimezone = TimeZone.current.identifier
        let envelope = ForgeWatchOutboundEnvelope(
            id: UUID().uuidString,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            device: currentDeviceDescriptor(),
            kind: .habitCheckIn,
            habitCheckIn: ForgeWatchHabitCheckInAction(
                habitId: habit.id,
                dateKey: habit.currentDateKey ?? Self.localDateKey(),
                status: status,
                note: note,
                timezone: deviceTimezone
            ),
            captureEvent: nil,
            command: nil
        )
        guard enqueue(envelope) else {
            WKInterfaceDevice.current().play(.failure)
            return
        }
        optimisticUpdate(habitId: habit.id, status: status)
        WKInterfaceDevice.current().play(.success)
    }

    func queueCaptureEvent(
        eventType: String,
        promptId: String? = nil,
        linkedContext: ForgeWatchLinkedContext = .empty,
        payload: [String: String] = [:]
    ) {
        let envelope = ForgeWatchOutboundEnvelope(
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
        guard enqueue(envelope) else {
            WKInterfaceDevice.current().play(.failure)
            return
        }
        WKInterfaceDevice.current().play(.success)
    }

    func queueCommand(kind: ForgeWatchActionKind, payload: [String: String]) {
        let envelope = ForgeWatchOutboundEnvelope(
            id: UUID().uuidString,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            device: currentDeviceDescriptor(),
            kind: kind,
            habitCheckIn: nil,
            captureEvent: nil,
            command: ForgeWatchCommandAction(payload: payload)
        )
        guard enqueue(envelope) else {
            WKInterfaceDevice.current().play(.failure)
            return
        }
        WKInterfaceDevice.current().play(.click)
    }

    @discardableResult
    private func enqueue(_ envelope: ForgeWatchOutboundEnvelope) -> Bool {
        let admission = ForgeWatchDurableQueuePolicy.appending(envelope, to: loadQueue())
        if let backpressure = admission.backpressure {
            lastStatusMessage = backpressure.message(storageName: "Watch")
            return false
        }
        if admission.inserted {
            guard let encodedData = admission.encodedData else {
                lastStatusMessage = ForgeWatchDurableQueueBackpressure.encodingFailed.message(
                    storageName: "Watch"
                )
                return false
            }
            defaults.set(encodedData, forKey: ForgeWatchStorage.outgoingQueueKey)
            pendingActionCount = admission.queue.count
        }
        if let connection = directConnection() {
            lastStatusMessage = "Sending to Forge through \(connection.transportLabel)"
        } else {
            lastStatusMessage = directCooldownFallbackMessage() ?? "Waiting for paired iPhone backup"
        }
        flushPendingActions()
        return true
    }

    private struct WatchBootstrapRequest: Encodable {
        let sessionId: String
        let pairingToken: String
        let timezone: String
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
        let timezone: String
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

    static func directRouteTestingStatus(for connection: ForgeWatchConnection) -> String {
        ForgeWatchDirectRoutePolicy.directRouteTestingStatus(
            transportLabel: connection.transportLabel
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
        var bodyObject = try JSONSerialization.jsonObject(
            with: encoder.encode(body)
        ) as? [String: Any] ?? [:]
        bodyObject.removeValue(forKey: "pairingToken")
        let bodyData = try JSONSerialization.data(
            withJSONObject: bodyObject,
            options: [.sortedKeys]
        )
        let startedAt = Date()
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = directRequestTimeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let issuedAt = ISO8601DateFormatter().string(from: Date())
        let nonce = UUID().uuidString
            .replacingOccurrences(of: "-", with: "")
            .lowercased()
        let bodySha256 = SHA256.hash(data: bodyData)
            .map { String(format: "%02x", $0) }
            .joined()
        let requestTarget = url.path + (url.query.map { "?\($0)" } ?? "")
        let canonical = [
            "FORGE-MOBILE-REQUEST/1",
            "POST",
            requestTarget,
            connection.sessionId,
            issuedAt,
            nonce,
            bodySha256
        ].joined(separator: "\n")
        let signature = HMAC<SHA256>.authenticationCode(
            for: Data(canonical.utf8),
            using: SymmetricKey(data: Data(connection.pairingToken.utf8))
        )
            .map { String(format: "%02x", $0) }
            .joined()
        request.setValue(
            "forge-mobile-request/v1",
            forHTTPHeaderField: "X-Forge-Mobile-Request-Protocol"
        )
        request.setValue(
            connection.sessionId,
            forHTTPHeaderField: "X-Forge-Mobile-Session-Id"
        )
        request.setValue(
            issuedAt,
            forHTTPHeaderField: "X-Forge-Mobile-Request-Issued-At"
        )
        request.setValue(
            nonce,
            forHTTPHeaderField: "X-Forge-Mobile-Request-Nonce"
        )
        request.setValue(
            bodySha256,
            forHTTPHeaderField: "X-Forge-Mobile-Body-SHA256"
        )
        request.setValue(
            signature,
            forHTTPHeaderField: "X-Forge-Mobile-Request-Signature"
        )
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

    private func refreshFromForgeDirect(
        reason: String,
        fallbackToPhone: Bool,
        forceDirect: Bool
    ) async {
        let respectCooldown = ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(
            forceUserRetry: forceDirect
        )
        guard let connection = directConnection(respectingCooldown: respectCooldown) else {
            if fallbackToPhone {
                requestPhoneFallbackRefresh(reason: reason)
            }
            return
        }
        do {
            refreshState = .refreshing
            lastStatusMessage = "Refreshing through \(connection.transportLabel)"
            let result: DirectPostResult<WatchBootstrapEnvelope> = try await postDirect(
                path: "/mobile/watch/bootstrap",
                body: WatchBootstrapRequest(
                    sessionId: connection.sessionId,
                    pairingToken: connection.pairingToken,
                    timezone: TimeZone.current.identifier
                ),
                connection: connection,
                operation: "bootstrap",
                itemCount: 0
            )
            let envelope = result.response
            clearDirectRouteCooldown()
            saveBootstrap(envelope.watch.withConnection(connection), source: .direct)
            lastStatusMessage = "Synced: \(result.metric.summary)"
            flushPendingActions()
        } catch {
            lastStatusMessage = "Direct sync failed: \(error.localizedDescription)"
            markDirectRouteFailureIfNeeded(error)
            if fallbackToPhone {
                requestPhoneFallbackRefresh(reason: reason)
            } else {
                refreshState = .failed
            }
        }
    }

    private func flushPendingActionsDirectThenPhone(forceDirect: Bool = false) async {
        let respectCooldown = ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(
            forceUserRetry: forceDirect
        )
        guard let connection = directConnection(respectingCooldown: respectCooldown) else {
            flushPendingActionsThroughPhone(loadQueue())
            return
        }
        let queue = ForgeWatchActionBatchPolicy.nextBatch(from: loadQueue())
        guard queue.isEmpty == false else { return }
        do {
            lastStatusMessage = "Syncing with Forge through \(connection.transportLabel)"
            let commands = Self.commands(from: queue)
            let result: DirectPostResult<WatchCommandBatchEnvelope> = try await postDirect(
                path: "/mobile/watch/actions:batch",
                body: WatchCommandBatchRequest(
                    sessionId: connection.sessionId,
                    pairingToken: connection.pairingToken,
                    timezone: TimeZone.current.identifier,
                    device: queue.first?.device ?? currentDeviceDescriptor(),
                    commands: commands
                ),
                connection: connection,
                operation: "actions",
                itemCount: commands.count
            )
            let envelope = result.response
            clearDirectRouteCooldown()
            saveBootstrap(envelope.watch.withConnection(connection), source: .direct)
            storeReceipts(
                envelope.receipt.receipts.map {
                    ForgeWatchStoredReceipt(
                        actionId: $0.actionId,
                        kind: $0.kind,
                        status: $0.status,
                        processedAt: $0.processedAt,
                        errorMessage: nil
                    )
                }
            )
            let acknowledgedIds = Set(envelope.receipt.receipts.map(\.actionId))
            let latestQueue = loadQueue()
            saveQueue(
                ForgeWatchActionQueueReconciliation.remainingEnvelopes(
                    afterAcknowledging: acknowledgedIds,
                    in: latestQueue
                )
            )
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
            scheduleDirectRetryAfterCooldown()
            let label = connection.transportLabel
            lastStatusMessage = "Direct \(label) unavailable; paired iPhone backup is sending"
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

    private func directCooldownFallbackMessage() -> String? {
        guard
            let connection = directConnection(respectingCooldown: false),
            isDirectRouteCoolingDown(now: Date())
        else {
            return nil
        }
        return "\(connection.transportLabel) not reachable on watch; paired iPhone backup is sending"
    }

    private func markDirectRouteFailureIfNeeded(_ error: Error) {
        guard Self.isRecoverableDirectNetworkError(error) else {
            return
        }
        directRouteCoolingDownUntil = Date()
            .addingTimeInterval(ForgeWatchDirectRoutePolicy.failureFallbackCooldownSeconds)
        directRouteLastFailureDescription = error.localizedDescription
    }

    private func clearDirectRouteCooldown() {
        directRouteCoolingDownUntil = nil
        directRouteLastFailureDescription = nil
        directRetryTask?.cancel()
        directRetryTask = nil
    }

    private func scheduleDirectRetryAfterCooldown() {
        guard directConnection(respectingCooldown: false) != nil else {
            return
        }
        guard loadQueue().isEmpty == false else {
            return
        }
        directRetryTask?.cancel()
        let delay = ForgeWatchDirectRoutePolicy.directRetryAfterFailureDelaySeconds
        directRetryTask = Task { @MainActor [weak self] in
            let nanoseconds = UInt64(max(0, delay) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard let self, Task.isCancelled == false else {
                return
            }
            guard self.loadQueue().isEmpty == false else {
                return
            }
            self.flushPendingActions(forceDirect: true)
        }
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
                        "note": habit.note,
                        "timezone": habit.timezone ?? TimeZone.current.identifier
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

    static func localDateKey(
        at date: Date = Date(),
        timeZone: TimeZone = .current
    ) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
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

    private func saveBootstrap(
        _ bootstrap: ForgeWatchBootstrap,
        source: ForgeWatchSnapshotSource? = nil
    ) {
        let connected = bootstrap.withConnection(bootstrap.connection ?? self.bootstrap.connection)
        let merged = connected.preservingPeople(from: self.bootstrap)
        self.bootstrap = merged
        if let source {
            snapshotSource = source
            refreshState = .idle
            finishRefreshRequest()
        }
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

    @discardableResult
    private func saveQueue(_ queue: [ForgeWatchOutboundEnvelope]) -> Bool {
        guard let data = try? encoder.encode(queue) else {
            lastStatusMessage = ForgeWatchDurableQueueBackpressure.encodingFailed.message(
                storageName: "Watch"
            )
            return false
        }
        defaults.set(data, forKey: ForgeWatchStorage.outgoingQueueKey)
        pendingActionCount = queue.count
        return true
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

    private func saveReceiptHistory(_ receipts: [ForgeWatchStoredReceipt]) {
        recentReceipts = receipts
        if let data = try? encoder.encode(receipts) {
            defaults.set(data, forKey: ForgeWatchStorage.receiptHistoryKey)
        }
    }

    private func loadReceiptHistory() -> [ForgeWatchStoredReceipt] {
        guard
            let data = defaults.data(forKey: ForgeWatchStorage.receiptHistoryKey),
            let receipts = try? decoder.decode([ForgeWatchStoredReceipt].self, from: data)
        else {
            return []
        }
        return Array(receipts.prefix(ForgeWatchReceiptHistoryPolicy.maximumReceiptCount))
    }

    private func storeReceipts(_ receipts: [ForgeWatchStoredReceipt]) {
        guard receipts.isEmpty == false else { return }
        saveReceiptHistory(
            ForgeWatchReceiptHistoryPolicy.merging(receipts, into: recentReceipts)
        )
    }

    @discardableResult
    private func applyAck(_ ack: ForgeWatchAckEnvelope) -> Bool {
        if ack.status == "deferred" {
            let message = ack.error?["message"] ?? "paired iPhone backup deferred"
            lastStatusMessage = "Still sending: \(message)"
            return false
        }
        let update = ForgeWatchReceiptLifecycle.applying(
            ack,
            to: loadQueue(),
            receiptHistory: recentReceipts
        )
        if update.receiptHistory != recentReceipts {
            saveReceiptHistory(update.receiptHistory)
        }
        saveQueue(update.remainingQueue)
        if let bootstrap = ack.bootstrap {
            saveBootstrap(bootstrap, source: .phone)
        }
        if ack.status == "failed" {
            lastStatusMessage = "Forge rejected one action"
            WKInterfaceDevice.current().play(.failure)
        } else {
            WKInterfaceDevice.current().play(.success)
        }
        return update.shouldContinueFlushing
    }

    private func applyAsyncAck(_ ack: ForgeWatchAckEnvelope) {
        if applyAck(ack), loadQueue().isEmpty == false {
            flushPendingActions()
        }
    }

    private func applyAckBatch(_ batch: ForgeWatchAckBatchEnvelope) {
        var shouldContinueFlushing = false
        for ack in batch.acks {
            shouldContinueFlushing = applyAck(ack) || shouldContinueFlushing
        }
        if shouldContinueFlushing, loadQueue().isEmpty == false {
            flushPendingActions()
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
                self.refreshState = .failed
            } else {
                if activationState == .activated, let connection = self.directConnection() {
                    self.lastStatusMessage = Self.directRouteTestingStatus(for: connection)
                } else {
                    self.lastStatusMessage = activationState == .activated ? "Paired iPhone backup ready" : "Waiting for Forge"
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
                self.saveBootstrap(bootstrap, source: .phone)
                self.lastStatusMessage = "Received watch refresh"
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String : Any] = [:]
    ) {
        if let data = userInfo[ForgeWatchStorage.syncResponseMessageKey] as? Data {
            Task { @MainActor in
                if let response = try? self.decoder.decode(ForgeWatchRefreshResponse.self, from: data) {
                    self.applyRefreshResponse(response)
                }
            }
            return
        }
        if let data = userInfo[ForgeWatchStorage.phoneHandoffResponseMessageKey] as? Data {
            Task { @MainActor in
                if let response = try? self.decoder.decode(ForgeWatchPhoneHandoffResponse.self, from: data) {
                    self.applyPhoneHandoffResponse(response)
                }
            }
            return
        }
        guard let data = userInfo[ForgeWatchStorage.ackMessageKey] as? Data else { return }
        Task { @MainActor in
            if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: data) {
                self.applyAsyncAck(ack)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        Task { @MainActor in
            if let response = try? self.decoder.decode(ForgeWatchRefreshResponse.self, from: messageData) {
                self.applyRefreshResponse(response)
                return
            }
            if let response = try? self.decoder.decode(ForgeWatchPhoneHandoffResponse.self, from: messageData) {
                self.applyPhoneHandoffResponse(response)
                return
            }
            if let ack = try? self.decoder.decode(ForgeWatchAckEnvelope.self, from: messageData) {
                self.applyAsyncAck(ack)
            }
        }
    }
}
