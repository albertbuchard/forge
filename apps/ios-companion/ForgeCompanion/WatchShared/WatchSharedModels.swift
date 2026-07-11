import Foundation

enum ForgeWatchStorage {
    nonisolated static let appGroupId = "group.albertbuchard.ForgeCompanion"
    nonisolated static let bootstrapKey = "forge_watch_bootstrap"
    nonisolated static let outgoingQueueKey = "forge_watch_outgoing_queue"
    nonisolated static let incomingQueueKey = "forge_watch_incoming_queue"
    nonisolated static let receiptHistoryKey = "forge_watch_receipt_history"
    nonisolated static let pendingLaunchDestinationKey = "forge_watch_pending_launch_destination"
    nonisolated static let actionMessageKey = "forge_watch_action_message"
    nonisolated static let ackMessageKey = "forge_watch_ack_message"
    nonisolated static let syncRequestMessageKey = "forge_watch_sync_request_message"
    nonisolated static let bootstrapContextKey = "forge_watch_bootstrap_context"

    nonisolated static func sharedDefaults() -> UserDefaults {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) != nil else {
            return .standard
        }
        return UserDefaults(suiteName: appGroupId) ?? .standard
    }
}

enum ForgeWatchSnapshotSource: String, Codable, Hashable {
    case unavailable
    case cache
    case direct
    case phone
    case preview

    var label: String {
        switch self {
        case .unavailable:
            return "No snapshot"
        case .cache:
            return "On-device cache"
        case .direct:
            return "Direct Forge"
        case .phone:
            return "Paired iPhone"
        case .preview:
            return "Preview"
        }
    }
}

struct ForgeWatchSnapshotFreshness: Hashable {
    enum State: Hashable {
        case fresh
        case stale
        case clockSkew
        case unavailable
    }

    nonisolated static let freshInterval: TimeInterval = 15 * 60
    nonisolated static let futureClockSkewTolerance: TimeInterval = 5 * 60

    let state: State
    let ageSeconds: TimeInterval?

    var shortLabel: String {
        switch state {
        case .fresh:
            guard let ageSeconds else { return "Fresh" }
            return ageSeconds < 60 ? "Fresh now" : "Fresh \(Int(ageSeconds / 60))m"
        case .stale:
            guard let ageSeconds else { return "Stale" }
            if ageSeconds < 60 * 60 {
                return "Stale \(Int(ageSeconds / 60))m"
            }
            return "Stale \(Int(ageSeconds / 3_600))h"
        case .clockSkew:
            return "Clock mismatch"
        case .unavailable:
            return "Waiting for snapshot"
        }
    }

    nonisolated static func evaluate(
        generatedAt: String,
        hasSnapshot: Bool,
        now: Date
    ) -> ForgeWatchSnapshotFreshness {
        guard hasSnapshot, let generatedDate = ISO8601DateFormatter().date(from: generatedAt) else {
            return ForgeWatchSnapshotFreshness(state: .unavailable, ageSeconds: nil)
        }
        let age = now.timeIntervalSince(generatedDate)
        if age < -futureClockSkewTolerance {
            return ForgeWatchSnapshotFreshness(state: .clockSkew, ageSeconds: age)
        }
        let normalizedAge = max(0, age)
        return ForgeWatchSnapshotFreshness(
            state: normalizedAge <= freshInterval ? .fresh : .stale,
            ageSeconds: normalizedAge
        )
    }
}

struct ForgeWatchSnapshotNotice: Hashable {
    let title: String
    let message: String

    nonisolated static func make(
        freshness: ForgeWatchSnapshotFreshness,
        source: ForgeWatchSnapshotSource
    ) -> ForgeWatchSnapshotNotice? {
        switch freshness.state {
        case .fresh:
            return nil
        case .stale:
            return ForgeWatchSnapshotNotice(
                title: "Refresh current context",
                message: "\(freshness.shortLabel) from \(source.label). Refresh before acting on cached counts or task status."
            )
        case .clockSkew:
            return ForgeWatchSnapshotNotice(
                title: "Snapshot time mismatch",
                message: "The snapshot timestamp is ahead of this watch. Refresh before using current task or habit context."
            )
        case .unavailable:
            return ForgeWatchSnapshotNotice(
                title: "Current context unavailable",
                message: "Forge has not delivered a usable snapshot yet. Refresh directly or through the paired iPhone."
            )
        }
    }
}

enum ForgeWatchDirectRoutePolicy {
    nonisolated static let failureFallbackCooldownSeconds: TimeInterval = 3
    nonisolated static let directRetryAfterFailureDelaySeconds: TimeInterval = 3.25
    nonisolated static let directRequestTimeoutSeconds: TimeInterval = 3

    nonisolated static func shouldRespectFailureCooldown(forceUserRetry: Bool) -> Bool {
        forceUserRetry == false
    }

    nonisolated static func directRouteTestingStatus(transportLabel: String) -> String {
        "Testing \(transportLabel) direct route"
    }

    nonisolated static func canUseDirectNetworking(
        apiBaseUrl: String,
        directNetworkingEnabled: Bool
    ) -> Bool {
        guard
            directNetworkingEnabled,
            let url = URL(string: apiBaseUrl),
            url.scheme?.lowercased() == "https",
            let host = url.host?.lowercased()
        else {
            return false
        }
        return host != "127.0.0.1" && host != "localhost" && host != "::1"
    }

    nonisolated static func isRecoverableNetworkError(_ error: Error) -> Bool {
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else {
            return false
        }
        switch nsError.code {
        case URLError.timedOut.rawValue,
            URLError.cannotFindHost.rawValue,
            URLError.cannotConnectToHost.rawValue,
            URLError.networkConnectionLost.rawValue,
            URLError.notConnectedToInternet.rawValue,
            URLError.dnsLookupFailed.rawValue,
            URLError.internationalRoamingOff.rawValue,
            URLError.dataNotAllowed.rawValue,
            URLError.secureConnectionFailed.rawValue,
            URLError.serverCertificateHasBadDate.rawValue,
            URLError.serverCertificateUntrusted.rawValue,
            URLError.serverCertificateHasUnknownRoot.rawValue,
            URLError.serverCertificateNotYetValid.rawValue:
            return true
        default:
            return false
        }
    }
}

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
            parts.append("paired iPhone backup")
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

enum WatchSurface: String, CaseIterable, Codable {
    case now
    case work
    case habits
    case goals
    case today
    case health
    case movement
    case psyche
    case inbox
    case sync
}

enum ForgeWatchHistoryState: String, Codable, Hashable {
    case aligned
    case unaligned
    case unknown
}

struct ForgeWatchHistorySegment: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let periodKey: String
    let current: Bool
    let state: ForgeWatchHistoryState
}

struct ForgeWatchHabitSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let polarity: String
    let frequency: String
    let targetCount: Int
    let weekDays: [Int]
    var timezone: String? = nil
    var dayBoundaryMode: String? = nil
    var effectiveTimezone: String? = nil
    var currentDateKey: String? = nil
    var streakCount: Int
    var dueToday: Bool
    let cadenceLabel: String
    let alignedActionLabel: String
    let unalignedActionLabel: String
    var currentPeriodStatus: ForgeWatchHistoryState
    var last7History: [ForgeWatchHistorySegment]
}

struct ForgeWatchQuickOptions: Codable, Hashable {
    let activities: [String]
    let emotions: [String]
    let triggers: [String]
    let placeCategories: [String]
    let routinePrompts: [String]
    let recentPeople: [String]
}

struct ForgeWatchLinkedContext: Codable, Hashable {
    var placeId: String?
    var stayId: String?
    var tripId: String?
    var workoutId: String?

    static let empty = ForgeWatchLinkedContext()
}

struct ForgeWatchPrompt: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let title: String
    let message: String
    let createdAt: String
    let linkedContext: ForgeWatchLinkedContext
    let choices: [String]
}

struct ForgeWatchSurfaceSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
}

struct ForgeWatchTaskSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let status: String
    let level: String
    let priority: String
    let dueDate: String?
    let projectId: String?
    let goalId: String?
    let parentWorkItemId: String?
    let points: Int
    let effort: String
    let energy: String
    let updatedAt: String
}

struct ForgeWatchTaskRunSummary: Codable, Identifiable, Hashable {
    let id: String
    let taskId: String
    let taskTitle: String
    let actor: String
    let status: String
    let isCurrent: Bool
    let timerMode: String
    let plannedDurationSeconds: Int?
    let creditedSeconds: Double
    let claimedAt: String
    let heartbeatAt: String
    let leaseExpiresAt: String
}

struct ForgeWatchWorkLane: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let count: Int
    let tasks: [ForgeWatchTaskSummary]
}

struct ForgeWatchWorkSnapshot: Codable, Hashable {
    let actor: String
    let activeRuns: [ForgeWatchTaskRunSummary]
    let currentRun: ForgeWatchTaskRunSummary?
    let nextTask: ForgeWatchTaskSummary?
    let lanes: [ForgeWatchWorkLane]
    let visibleCount: Int
    let doneCount: Int
}

struct ForgeWatchNowSnapshot: Codable, Hashable {
    let currentRun: ForgeWatchTaskRunSummary?
    let nextTask: ForgeWatchTaskSummary?
    let dueHabitCount: Int
    let pendingPromptCount: Int
    let generatedAt: String
}

struct ForgeWatchGoalSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let horizon: String
    let status: String
    let targetPoints: Int
}

struct ForgeWatchProjectSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let status: String
    let workflowStatus: String
    let goalId: String
    let goalTitle: String
    let activeRunCount: Int
    let openTaskCount: Int
}

struct ForgeWatchTodaySnapshot: Codable, Hashable {
    let dateKey: String
    let dueTasks: [ForgeWatchTaskSummary]
    let dueCount: Int
    let recentDone: [ForgeWatchTaskSummary]
}

struct ForgeWatchHealthSnapshot: Codable, Hashable {
    struct Workout: Codable, Identifiable, Hashable {
        let id: String
        let workoutType: String
        let startedAt: String
        let endedAt: String
        let durationSeconds: Int
        let averageHeartRate: Double?
        let maxHeartRate: Double?
        let trainingLoad: Double?
        let heartRateSampleCount: Int
    }

    struct Vitals: Codable, Hashable {
        let dayKey: String
        let metricCount: Int
    }

    let lastWorkout: Workout?
    let latestVitals: Vitals?
}

struct ForgeWatchMovementSnapshot: Codable, Hashable {
    struct Segment: Codable, Identifiable, Hashable {
        let id: String
        let label: String
        let startedAt: String
        let endedAt: String?
    }

    let latestStay: Segment?
    let latestTrip: Segment?
    let unlabeledPlaceCount: Int
}

struct ForgeWatchPsycheSnapshot: Codable, Hashable {
    struct Option: Codable, Identifiable, Hashable {
        let id: String
        let label: String
        let subtitle: String
        let payload: [String: String]
    }

    struct Question: Codable, Identifiable, Hashable {
        let id: String
        let title: String
        let prompt: String
        let eventType: String
        let options: [Option]
    }

    struct RecentReport: Codable, Identifiable, Hashable {
        let id: String
        let title: String
        let occurredAt: String?
        let status: String
    }

    let emotionOptions: [String]
    let triggerOptions: [String]
    let routinePromptOptions: [String]
    let questions: [Question]?
    let recentReports: [RecentReport]?
}

struct ForgeWatchInboxSnapshot: Codable, Hashable {
    let prompts: [ForgeWatchPrompt]
    let attention: ForgeWatchAttentionSnapshot?
    let pins: ForgeWatchPinsSnapshot?

    init(
        prompts: [ForgeWatchPrompt],
        attention: ForgeWatchAttentionSnapshot?,
        pins: ForgeWatchPinsSnapshot? = nil
    ) {
        self.prompts = prompts
        self.attention = attention
        self.pins = pins
    }
}

struct ForgeWatchPinsSnapshot: Codable, Hashable {
    struct Item: Codable, Identifiable, Hashable {
        let id: String
        let entityType: String
        let entityId: String
        let title: String
        let detail: String
        let category: String
        let targetPath: String
        let availability: String
    }

    let total: Int
    let items: [Item]
}

struct ForgeWatchAttentionSnapshot: Codable, Hashable {
    struct Item: Codable, Identifiable, Hashable {
        let id: String
        let title: String
        let reason: String
        let source: String
        let severity: String
        let targetLabel: String
        let targetPath: String
        let updatedAt: String
    }

    let activeCount: Int
    let blockingCount: Int
    let importantCount: Int
    let items: [Item]
}

struct ForgeWatchSyncSnapshot: Codable, Hashable {
    let pairingSessionId: String
    let generatedAt: String
    let storedCaptureCount: Int
    let actionReceiptCount: Int
}

struct ForgeWatchConnection: Codable, Hashable {
    let apiBaseUrl: String
    let uiBaseUrl: String
    let sessionId: String
    let pairingToken: String
    let transportLabel: String
    let directNetworkingEnabled: Bool
}

struct ForgeWatchBootstrap: Codable, Hashable {
    let schemaVersion: Int?
    let generatedAt: String
    let connection: ForgeWatchConnection?
    let surfaces: [ForgeWatchSurfaceSummary]?
    let now: ForgeWatchNowSnapshot?
    let work: ForgeWatchWorkSnapshot?
    let goals: [ForgeWatchGoalSummary]?
    let projects: [ForgeWatchProjectSummary]?
    let today: ForgeWatchTodaySnapshot?
    let health: ForgeWatchHealthSnapshot?
    let movement: ForgeWatchMovementSnapshot?
    let psyche: ForgeWatchPsycheSnapshot?
    let inbox: ForgeWatchInboxSnapshot?
    let sync: ForgeWatchSyncSnapshot?
    var habits: [ForgeWatchHabitSummary]
    let checkInOptions: ForgeWatchQuickOptions
    var pendingPrompts: [ForgeWatchPrompt]

    static let empty = ForgeWatchBootstrap(
        schemaVersion: 2,
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        connection: nil,
        surfaces: nil,
        now: nil,
        work: nil,
        goals: nil,
        projects: nil,
        today: nil,
        health: nil,
        movement: nil,
        psyche: nil,
        inbox: nil,
        sync: nil,
        habits: [],
        checkInOptions: ForgeWatchQuickOptions(
            activities: [],
            emotions: [],
            triggers: [],
            placeCategories: [],
            routinePrompts: [],
            recentPeople: []
        ),
        pendingPrompts: []
    )

    var hasSnapshotContent: Bool {
        connection != nil
            || now != nil
            || work != nil
            || sync != nil
            || habits.isEmpty == false
            || pendingPrompts.isEmpty == false
    }

    func withConnection(_ connection: ForgeWatchConnection?) -> ForgeWatchBootstrap {
        ForgeWatchBootstrap(
            schemaVersion: schemaVersion,
            generatedAt: generatedAt,
            connection: connection ?? self.connection,
            surfaces: surfaces,
            now: now,
            work: work,
            goals: goals,
            projects: projects,
            today: today,
            health: health,
            movement: movement,
            psyche: psyche,
            inbox: inbox,
            sync: sync,
            habits: habits,
            checkInOptions: checkInOptions,
            pendingPrompts: pendingPrompts
        )
    }
}

struct ForgeWatchDeviceDescriptor: Codable, Hashable {
    let name: String
    let platform: String
    let appVersion: String
    let sourceDevice: String
}

enum ForgeWatchActionKind: String, Codable, Hashable {
    case habitCheckIn = "habit_check_in"
    case captureEvent = "capture_event"
    case taskRunStart = "task_run_start"
    case taskRunHeartbeat = "task_run_heartbeat"
    case taskRunFocus = "task_run_focus"
    case taskRunComplete = "task_run_complete"
    case taskRunRelease = "task_run_release"
    case taskStatusUpdate = "task_status_update"
}

struct ForgeWatchHabitCheckInAction: Codable, Hashable {
    let habitId: String
    let dateKey: String
    let status: String
    let note: String
    var timezone: String? = nil
}

struct ForgeWatchCaptureEventAction: Codable, Hashable {
    let eventType: String
    let recordedAt: String
    let promptId: String?
    let linkedContext: ForgeWatchLinkedContext
    let payload: [String: String]
}

struct ForgeWatchCommandAction: Codable, Hashable {
    let payload: [String: String]
}

struct ForgeWatchOutboundEnvelope: Codable, Identifiable, Hashable {
    let id: String
    let createdAt: String
    let device: ForgeWatchDeviceDescriptor
    let kind: ForgeWatchActionKind
    let habitCheckIn: ForgeWatchHabitCheckInAction?
    let captureEvent: ForgeWatchCaptureEventAction?
    let command: ForgeWatchCommandAction?
}

struct ForgeWatchOutboundBatchEnvelope: Codable, Hashable {
    let envelopes: [ForgeWatchOutboundEnvelope]
}

struct ForgeWatchAckEnvelope: Codable, Hashable {
    let actionId: String
    let kind: String?
    let processedAt: String
    let status: String?
    let error: [String: String]?
    let bootstrap: ForgeWatchBootstrap?

    init(
        actionId: String,
        kind: String? = nil,
        processedAt: String,
        status: String?,
        error: [String: String]?,
        bootstrap: ForgeWatchBootstrap?
    ) {
        self.actionId = actionId
        self.kind = kind
        self.processedAt = processedAt
        self.status = status
        self.error = error
        self.bootstrap = bootstrap
    }
}

struct ForgeWatchAckBatchEnvelope: Codable, Hashable {
    let acks: [ForgeWatchAckEnvelope]
}

enum ForgeWatchActionQueueReconciliation {
    nonisolated static func remainingEnvelopes(
        afterAcknowledging acknowledgedIds: Set<String>,
        in latestQueue: [ForgeWatchOutboundEnvelope]
    ) -> [ForgeWatchOutboundEnvelope] {
        latestQueue.filter { acknowledgedIds.contains($0.id) == false }
    }
}

enum ForgeWatchDurableQueueBackpressure: Hashable {
    case actionCount(maximum: Int)
    case encodedBytes(maximum: Int)
    case encodingFailed

    nonisolated func message(storageName: String) -> String {
        switch self {
        case .actionCount(let maximum):
            return "\(storageName) action storage is full at \(maximum) pending actions. Sync pending actions before trying again."
        case .encodedBytes(let maximum):
            let kibibytes = max(1, maximum / 1_024)
            return "\(storageName) action storage is full at \(kibibytes) KB. Sync pending actions before trying again."
        case .encodingFailed:
            return "\(storageName) could not save this action. The existing pending actions were preserved."
        }
    }
}

struct ForgeWatchDurableQueueAdmission {
    let queue: [ForgeWatchOutboundEnvelope]
    let encodedData: Data?
    let backpressure: ForgeWatchDurableQueueBackpressure?
    let inserted: Bool
}

enum ForgeWatchDurableQueuePolicy {
    nonisolated static let maximumActionCount = 250
    nonisolated static let maximumEncodedBytes = 512 * 1_024

    nonisolated static func appending(
        _ envelope: ForgeWatchOutboundEnvelope,
        to queue: [ForgeWatchOutboundEnvelope],
        maximumActionCount: Int = maximumActionCount,
        maximumEncodedBytes: Int = maximumEncodedBytes
    ) -> ForgeWatchDurableQueueAdmission {
        if queue.contains(where: { $0.id == envelope.id }) {
            return ForgeWatchDurableQueueAdmission(
                queue: queue,
                encodedData: nil,
                backpressure: nil,
                inserted: false
            )
        }

        guard queue.count < maximumActionCount else {
            return ForgeWatchDurableQueueAdmission(
                queue: queue,
                encodedData: nil,
                backpressure: .actionCount(maximum: maximumActionCount),
                inserted: false
            )
        }

        let candidate = queue + [envelope]
        guard let encodedData = try? JSONEncoder().encode(candidate) else {
            return ForgeWatchDurableQueueAdmission(
                queue: queue,
                encodedData: nil,
                backpressure: .encodingFailed,
                inserted: false
            )
        }
        guard encodedData.count <= maximumEncodedBytes else {
            return ForgeWatchDurableQueueAdmission(
                queue: queue,
                encodedData: nil,
                backpressure: .encodedBytes(maximum: maximumEncodedBytes),
                inserted: false
            )
        }
        return ForgeWatchDurableQueueAdmission(
            queue: candidate,
            encodedData: encodedData,
            backpressure: nil,
            inserted: true
        )
    }
}

enum ForgeWatchActionBatchPolicy {
    nonisolated static let maximumActionCount = 20

    nonisolated static func nextBatch(
        from envelopes: [ForgeWatchOutboundEnvelope]
    ) -> [ForgeWatchOutboundEnvelope] {
        Array(envelopes.prefix(maximumActionCount))
    }
}

enum ForgeWatchPhoneFallbackBatchPolicy {
    nonisolated static func reachablePhoneExchangeCount(forActionCount actionCount: Int) -> Int {
        actionCount > 0 ? 1 : 0
    }
}

struct ForgeWatchCommandReceipt: Codable, Hashable {
    let actionId: String
    let kind: String
    let status: String
    let processedAt: String
}

struct ForgeWatchStoredReceipt: Codable, Identifiable, Hashable {
    var id: String { actionId }

    let actionId: String
    let kind: String
    let status: String
    let processedAt: String
    let errorMessage: String?
}

enum ForgeWatchReceiptHistoryPolicy {
    nonisolated static let maximumReceiptCount = 25

    nonisolated static func merging(
        _ incoming: [ForgeWatchStoredReceipt],
        into existing: [ForgeWatchStoredReceipt]
    ) -> [ForgeWatchStoredReceipt] {
        var merged = existing
        for receipt in incoming {
            merged.removeAll { $0.actionId == receipt.actionId }
            merged.insert(receipt, at: 0)
        }
        return Array(merged.prefix(maximumReceiptCount))
    }
}

struct ForgeWatchReceiptLifecycleUpdate: Hashable {
    let remainingQueue: [ForgeWatchOutboundEnvelope]
    let receiptHistory: [ForgeWatchStoredReceipt]
    let completedReceipt: ForgeWatchStoredReceipt?
    let shouldContinueFlushing: Bool
}

enum ForgeWatchReceiptLifecycle {
    nonisolated static func applying(
        _ ack: ForgeWatchAckEnvelope,
        to queue: [ForgeWatchOutboundEnvelope],
        receiptHistory: [ForgeWatchStoredReceipt]
    ) -> ForgeWatchReceiptLifecycleUpdate {
        guard ack.status != "deferred" else {
            return ForgeWatchReceiptLifecycleUpdate(
                remainingQueue: queue,
                receiptHistory: receiptHistory,
                completedReceipt: nil,
                shouldContinueFlushing: false
            )
        }

        let queuedEnvelope = queue.first { $0.id == ack.actionId }
        let receipt = (ack.kind ?? queuedEnvelope?.kind.rawValue).map {
            ForgeWatchStoredReceipt(
                actionId: ack.actionId,
                kind: $0,
                status: ack.status ?? "processed",
                processedAt: ack.processedAt,
                errorMessage: ack.error?["message"]
                    ?? (ack.status == "failed" ? "Forge rejected this action" : nil)
            )
        }
        let remainingQueue = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
            afterAcknowledging: [ack.actionId],
            in: queue
        )
        let updatedReceiptHistory = receipt.map {
            ForgeWatchReceiptHistoryPolicy.merging([$0], into: receiptHistory)
        } ?? receiptHistory
        return ForgeWatchReceiptLifecycleUpdate(
            remainingQueue: remainingQueue,
            receiptHistory: updatedReceiptHistory,
            completedReceipt: receipt,
            shouldContinueFlushing: remainingQueue.isEmpty == false
        )
    }
}

struct ForgeWatchCommandBatchReceipt: Codable, Hashable {
    let receivedCount: Int
    let processedCount: Int
    let replayedCount: Int
    let failedCount: Int
    let receipts: [ForgeWatchCommandReceipt]
}

struct ForgeWatchControlRequest: Codable, Hashable {
    let id: String
    let createdAt: String
    let reason: String
}

enum ForgeWatchLaunchDestination: String, Codable, CaseIterable {
    case habits
    case checkIn = "check_in"
    case markMoment = "mark_moment"
    case promptInbox = "prompt_inbox"
    case emotion
}
