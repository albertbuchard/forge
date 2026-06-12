import Foundation

enum ForgeWatchStorage {
    nonisolated static let appGroupId = "group.albertbuchard.ForgeCompanion"
    nonisolated static let bootstrapKey = "forge_watch_bootstrap"
    nonisolated static let outgoingQueueKey = "forge_watch_outgoing_queue"
    nonisolated static let incomingQueueKey = "forge_watch_incoming_queue"
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
    let processedAt: String
    let status: String?
    let error: [String: String]?
    let bootstrap: ForgeWatchBootstrap?
}

struct ForgeWatchAckBatchEnvelope: Codable, Hashable {
    let acks: [ForgeWatchAckEnvelope]
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
