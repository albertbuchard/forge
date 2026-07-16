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
    nonisolated static let syncResponseMessageKey = "forge_watch_sync_response_message"
    nonisolated static let phoneHandoffRequestMessageKey = "forge_watch_phone_handoff_request"
    nonisolated static let phoneHandoffResponseMessageKey = "forge_watch_phone_handoff_response"
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
    case people
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
    var closeoutState: String? = nil
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

enum ForgeWatchRefreshState: String, Hashable {
    case idle
    case refreshing
    case failed
}

enum ForgeWatchCompactNotice: Hashable {
    case none
    case loading
    case stale
    case clockSkew
    case unavailable
    case failed
}

enum ForgeWatchCompactSurfacePolicy {
    nonisolated static func notice(
        hasPayload: Bool,
        freshness: ForgeWatchSnapshotFreshness,
        refreshState: ForgeWatchRefreshState
    ) -> ForgeWatchCompactNotice {
        if refreshState == .failed {
            return .failed
        }
        if hasPayload == false {
            return refreshState == .refreshing ? .loading : .unavailable
        }
        switch freshness.state {
        case .fresh:
            return .none
        case .stale:
            return .stale
        case .clockSkew:
            return .clockSkew
        case .unavailable:
            return .stale
        }
    }
}

struct ForgeWatchGoalsPresentation: Hashable {
    nonisolated static let maximumGoalCount = 3
    nonisolated static let maximumProjectCount = 3

    let goals: [ForgeWatchGoalSummary]
    let projects: [ForgeWatchProjectSummary]
    let totalGoalCount: Int
    let totalProjectCount: Int

    nonisolated init(
        goals: [ForgeWatchGoalSummary],
        projects: [ForgeWatchProjectSummary],
        totalGoalCount: Int? = nil,
        totalProjectCount: Int? = nil
    ) {
        self.totalGoalCount = max(totalGoalCount ?? goals.count, goals.count)
        self.totalProjectCount = max(totalProjectCount ?? projects.count, projects.count)
        self.goals = Array(
            goals.sorted(by: Self.goalPrecedes).prefix(Self.maximumGoalCount)
        )
        self.projects = Array(
            projects.sorted(by: Self.projectPrecedes).prefix(Self.maximumProjectCount)
        )
    }

    var hiddenGoalCount: Int {
        max(0, totalGoalCount - goals.count)
    }

    var hiddenProjectCount: Int {
        max(0, totalProjectCount - projects.count)
    }

    var cardCount: Int {
        1 + goals.count + projects.count
    }

    private nonisolated static func goalPrecedes(
        _ left: ForgeWatchGoalSummary,
        _ right: ForgeWatchGoalSummary
    ) -> Bool {
        let horizonRank = ["quarter": 0, "year": 1, "lifetime": 2]
        let leftRank = horizonRank[left.horizon.lowercased()] ?? Int.max
        let rightRank = horizonRank[right.horizon.lowercased()] ?? Int.max
        if leftRank != rightRank {
            return leftRank < rightRank
        }
        if left.targetPoints != right.targetPoints {
            return left.targetPoints > right.targetPoints
        }
        return stableTitlePrecedes(left.title, right.title, leftId: left.id, rightId: right.id)
    }

    private nonisolated static func projectPrecedes(
        _ left: ForgeWatchProjectSummary,
        _ right: ForgeWatchProjectSummary
    ) -> Bool {
        let workflowRank = [
            "focus": 0,
            "in_progress": 1,
            "building": 1,
            "blocked": 2,
            "backlog": 3,
            "done": 4
        ]
        let leftRank = workflowRank[left.workflowStatus.lowercased()] ?? Int.max
        let rightRank = workflowRank[right.workflowStatus.lowercased()] ?? Int.max
        if leftRank != rightRank {
            return leftRank < rightRank
        }
        if left.activeRunCount != right.activeRunCount {
            return left.activeRunCount > right.activeRunCount
        }
        if left.openTaskCount != right.openTaskCount {
            return left.openTaskCount > right.openTaskCount
        }
        return stableTitlePrecedes(left.title, right.title, leftId: left.id, rightId: right.id)
    }
}

struct ForgeWatchTodayPresentation: Hashable {
    nonisolated static let maximumDueTaskCount = 4

    let dueTasks: [ForgeWatchTaskSummary]
    let snapshotDueCount: Int
    let recentDoneCount: Int

    nonisolated init(today: ForgeWatchTodaySnapshot) {
        let orderedTasks = today.dueTasks.sorted(by: Self.taskPrecedes)
        dueTasks = Array(orderedTasks.prefix(Self.maximumDueTaskCount))
        snapshotDueCount = max(today.dueCount, today.dueTasks.count)
        recentDoneCount = today.recentDone.count
    }

    var hiddenDueTaskCount: Int {
        max(0, snapshotDueCount - dueTasks.count)
    }

    var cardCount: Int {
        1 + dueTasks.count
    }

    private nonisolated static func taskPrecedes(
        _ left: ForgeWatchTaskSummary,
        _ right: ForgeWatchTaskSummary
    ) -> Bool {
        let statusRank = [
            "focus": 0,
            "in_progress": 1,
            "blocked": 2,
            "backlog": 3,
            "done": 4
        ]
        let priorityRank = ["critical": 0, "high": 1, "medium": 2, "low": 3]
        let leftStatus = statusRank[left.status.lowercased()] ?? Int.max
        let rightStatus = statusRank[right.status.lowercased()] ?? Int.max
        if leftStatus != rightStatus {
            return leftStatus < rightStatus
        }
        let leftPriority = priorityRank[left.priority.lowercased()] ?? Int.max
        let rightPriority = priorityRank[right.priority.lowercased()] ?? Int.max
        if leftPriority != rightPriority {
            return leftPriority < rightPriority
        }
        if left.points != right.points {
            return left.points > right.points
        }
        return stableTitlePrecedes(left.title, right.title, leftId: left.id, rightId: right.id)
    }
}

enum ForgeWatchPhoneDestination: Hashable, Codable {
    case goals
    case goal(String)
    case project(String)
    case today
    case task(String)

    private enum Kind: String, Codable {
        case goals
        case goal
        case project
        case today
        case task
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case entityId
    }

    nonisolated init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        let entityId = try container.decodeIfPresent(String.self, forKey: .entityId)
        switch (kind, entityId) {
        case (.goals, nil):
            self = .goals
        case (.goal, .some(let id)) where Self.validatedPath(id: id) != nil:
            self = .goal(id)
        case (.project, .some(let id)) where Self.validatedPath(id: id) != nil:
            self = .project(id)
        case (.today, nil):
            self = .today
        case (.task, .some(let id)) where Self.validatedPath(id: id) != nil:
            self = .task(id)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .entityId,
                in: container,
                debugDescription: "Invalid Forge phone destination"
            )
        }
    }

    nonisolated func encode(to encoder: Encoder) throws {
        guard pathComponents != nil else {
            throw EncodingError.invalidValue(
                self,
                EncodingError.Context(
                    codingPath: encoder.codingPath,
                    debugDescription: "Invalid Forge phone destination"
                )
            )
        }
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .goals:
            try container.encode(Kind.goals, forKey: .kind)
        case .goal(let id):
            try container.encode(Kind.goal, forKey: .kind)
            try container.encode(id, forKey: .entityId)
        case .project(let id):
            try container.encode(Kind.project, forKey: .kind)
            try container.encode(id, forKey: .entityId)
        case .today:
            try container.encode(Kind.today, forKey: .kind)
        case .task(let id):
            try container.encode(Kind.task, forKey: .kind)
            try container.encode(id, forKey: .entityId)
        }
    }

    fileprivate var pathComponents: [String]? {
        switch self {
        case .goals:
            return ["goals"]
        case .goal(let id):
            return Self.validatedPath(id: id).map { ["goals", $0] }
        case .project(let id):
            return Self.validatedPath(id: id).map { ["projects", $0] }
        case .today:
            return ["today"]
        case .task(let id):
            return Self.validatedPath(id: id).map { ["tasks", $0] }
        }
    }

    private nonisolated static func validatedPath(id: String) -> String? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard
            id.isEmpty == false,
            id.rangeOfCharacter(from: allowed.inverted) == nil
        else {
            return nil
        }
        return id
    }
}

enum ForgeWatchPhoneHandoff {
    nonisolated static func url(
        uiBaseUrl: String?,
        destination: ForgeWatchPhoneDestination
    ) -> URL? {
        resolvedURL(
            uiBaseUrl: uiBaseUrl,
            destination: destination,
            allowedSchemes: ["https", "http"]
        )
    }

    nonisolated static func iPhoneURL(
        uiBaseUrl: String?,
        destination: ForgeWatchPhoneDestination
    ) -> URL? {
        resolvedURL(
            uiBaseUrl: uiBaseUrl,
            destination: destination,
            allowedSchemes: ["https", "http", "forge-iroh"]
        )
    }

    private nonisolated static func resolvedURL(
        uiBaseUrl: String?,
        destination: ForgeWatchPhoneDestination,
        allowedSchemes: Set<String>
    ) -> URL? {
        guard
            let uiBaseUrl,
            var components = URLComponents(string: uiBaseUrl),
            let scheme = components.scheme?.lowercased(),
            allowedSchemes.contains(scheme),
            components.host?.isEmpty == false,
            let pathComponents = destination.pathComponents
        else {
            return nil
        }

        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        guard var url = components.url else {
            return nil
        }
        for component in pathComponents {
            url.appendPathComponent(component)
        }
        return url
    }
}

struct ForgeWatchPhoneHandoffRequest: Codable, Hashable {
    let id: String
    let createdAt: String
    let destination: ForgeWatchPhoneDestination

    nonisolated init?(
        id: String = UUID().uuidString,
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        destination: ForgeWatchPhoneDestination
    ) {
        guard destination.pathComponents != nil else { return nil }
        self.id = id
        self.createdAt = createdAt
        self.destination = destination
    }
}

enum ForgeWatchPhoneHandoffStatus: String, Codable, Hashable {
    case ready
    case unavailable
}

struct ForgeWatchPhoneHandoffResponse: Codable, Hashable {
    let requestId: String
    let completedAt: String
    let status: ForgeWatchPhoneHandoffStatus
    let message: String
}

nonisolated private func stableTitlePrecedes(
    _ leftTitle: String,
    _ rightTitle: String,
    leftId: String,
    rightId: String
) -> Bool {
    let titleComparison = leftTitle.localizedCaseInsensitiveCompare(rightTitle)
    if titleComparison != .orderedSame {
        return titleComparison == .orderedAscending
    }
    return leftId < rightId
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

struct ForgeWatchPeopleGlanceSnapshot: Codable, Hashable {
    enum Selection: String, Codable, Hashable {
        case selected
        case chooseOnIPhone = "choose_on_iphone"
    }

    struct SharedEvent: Codable, Hashable {
        let title: String?
        let startsAt: String
        let sharedAt: String
        let validUntil: String?
    }

    let selection: Selection
    let generatedAt: String
    let personName: String?
    let lastConnectedAt: String?
    let nextSharedEvent: SharedEvent?

    static func chooseOnIPhone(generatedAt: String) -> ForgeWatchPeopleGlanceSnapshot {
        ForgeWatchPeopleGlanceSnapshot(
            selection: .chooseOnIPhone,
            generatedAt: generatedAt,
            personName: nil,
            lastConnectedAt: nil,
            nextSharedEvent: nil
        )
    }
}

enum ForgeWatchPeoplePrivacyContext: String, CaseIterable, Codable, Hashable {
    case unlockedActive = "unlocked_active"
    case locked
    case wristDown = "wrist_down"
    case alwaysOn = "always_on"
    case notification
    case screenshotFixture = "screenshot_fixture"
    case inactive
}

struct ForgeWatchPeoplePresentation: Hashable {
    let title: String
    let indicator: String
    let personName: String?
    let connectivity: String?
    let eventTitle: String?
    let eventTiming: String?
    let eventStatus: String?

    var isDetailed: Bool { personName != nil }
}

enum ForgeWatchPeopleDisplayPolicy {
    static let staleSnapshotAge: TimeInterval = 15 * 60
    static let staleEventAgeWithoutExpiry: TimeInterval = 30 * 60

    static func presentation(
        snapshot: ForgeWatchPeopleGlanceSnapshot?,
        context: ForgeWatchPeoplePrivacyContext,
        now: Date = Date()
    ) -> ForgeWatchPeoplePresentation {
        guard context == .unlockedActive else {
            return redactedPresentation
        }
        guard let snapshot else {
            return ForgeWatchPeoplePresentation(
                title: "Forge People",
                indicator: "iPhone snapshot unavailable",
                personName: nil,
                connectivity: nil,
                eventTitle: nil,
                eventTiming: nil,
                eventStatus: nil
            )
        }
        guard snapshot.selection == .selected,
              let personName = nonEmpty(snapshot.personName)
        else {
            return ForgeWatchPeoplePresentation(
                title: "Forge People",
                indicator: "Choose a Person on iPhone",
                personName: nil,
                connectivity: nil,
                eventTitle: nil,
                eventTiming: nil,
                eventStatus: nil
            )
        }

        let generatedAt = date(from: snapshot.generatedAt)
        let snapshotIsStale = generatedAt.map {
            now.timeIntervalSince($0) > staleSnapshotAge || now.timeIntervalSince($0) < -300
        } ?? true
        let connectivity = snapshot.lastConnectedAt
            .flatMap(date(from:))
            .map { "Last connected \(relativePastLabel(from: $0, now: now))" }
            ?? "Connectivity unavailable"

        let eventPresentation = sharedEventPresentation(
            snapshot.nextSharedEvent,
            now: now
        )
        return ForgeWatchPeoplePresentation(
            title: "Forge People",
            indicator: snapshotIsStale ? "iPhone snapshot stale" : "iPhone snapshot fresh",
            personName: personName,
            connectivity: connectivity,
            eventTitle: eventPresentation.title,
            eventTiming: eventPresentation.timing,
            eventStatus: eventPresentation.status
        )
    }

    private static let redactedPresentation = ForgeWatchPeoplePresentation(
        title: "Forge People",
        indicator: "Private",
        personName: nil,
        connectivity: nil,
        eventTitle: nil,
        eventTiming: nil,
        eventStatus: nil
    )

    private static func sharedEventPresentation(
        _ event: ForgeWatchPeopleGlanceSnapshot.SharedEvent?,
        now: Date
    ) -> (title: String?, timing: String?, status: String) {
        guard let event,
              let startsAt = date(from: event.startsAt),
              let sharedAt = date(from: event.sharedAt)
        else {
            return (nil, nil, "Next shared event unavailable")
        }
        let expiry = event.validUntil.flatMap(date(from:))
        let expired = expiry.map { $0 <= now } ??
            (now.timeIntervalSince(sharedAt) > staleEventAgeWithoutExpiry)
        guard expired == false, startsAt >= now.addingTimeInterval(-300) else {
            return (nil, nil, "Shared event stale")
        }
        return (
            nonEmpty(event.title) ?? "Shared event",
            relativeFutureLabel(from: startsAt, now: now),
            "Explicitly shared"
        )
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.isEmpty == false
        else { return nil }
        return value
    }

    private static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private static func relativePastLabel(from date: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "now" }
        if seconds < 3_600 { return "\(seconds / 60)m ago" }
        if seconds < 86_400 { return "\(seconds / 3_600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    private static func relativeFutureLabel(from date: Date, now: Date) -> String {
        let seconds = max(0, Int(date.timeIntervalSince(now)))
        if seconds < 60 { return "Starts now" }
        if seconds < 3_600 { return "Starts in \(max(1, seconds / 60))m" }
        if seconds < 86_400 { return "Starts in \(max(1, seconds / 3_600))h" }
        return "Starts in \(max(1, seconds / 86_400))d"
    }
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
    let goalCount: Int?
    let projects: [ForgeWatchProjectSummary]?
    let projectCount: Int?
    let today: ForgeWatchTodaySnapshot?
    let health: ForgeWatchHealthSnapshot?
    let movement: ForgeWatchMovementSnapshot?
    let psyche: ForgeWatchPsycheSnapshot?
    let inbox: ForgeWatchInboxSnapshot?
    let sync: ForgeWatchSyncSnapshot?
    let people: ForgeWatchPeopleGlanceSnapshot?
    var habits: [ForgeWatchHabitSummary]
    let checkInOptions: ForgeWatchQuickOptions
    var pendingPrompts: [ForgeWatchPrompt]

    init(
        schemaVersion: Int?,
        generatedAt: String,
        connection: ForgeWatchConnection?,
        surfaces: [ForgeWatchSurfaceSummary]?,
        now: ForgeWatchNowSnapshot?,
        work: ForgeWatchWorkSnapshot?,
        goals: [ForgeWatchGoalSummary]?,
        goalCount: Int?,
        projects: [ForgeWatchProjectSummary]?,
        projectCount: Int?,
        today: ForgeWatchTodaySnapshot?,
        health: ForgeWatchHealthSnapshot?,
        movement: ForgeWatchMovementSnapshot?,
        psyche: ForgeWatchPsycheSnapshot?,
        inbox: ForgeWatchInboxSnapshot?,
        sync: ForgeWatchSyncSnapshot?,
        people: ForgeWatchPeopleGlanceSnapshot? = nil,
        habits: [ForgeWatchHabitSummary],
        checkInOptions: ForgeWatchQuickOptions,
        pendingPrompts: [ForgeWatchPrompt]
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.connection = connection
        self.surfaces = surfaces
        self.now = now
        self.work = work
        self.goals = goals
        self.goalCount = goalCount
        self.projects = projects
        self.projectCount = projectCount
        self.today = today
        self.health = health
        self.movement = movement
        self.psyche = psyche
        self.inbox = inbox
        self.sync = sync
        self.people = people
        self.habits = habits
        self.checkInOptions = checkInOptions
        self.pendingPrompts = pendingPrompts
    }

    static let empty = ForgeWatchBootstrap(
        schemaVersion: 2,
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        connection: nil,
        surfaces: nil,
        now: nil,
        work: nil,
        goals: nil,
        goalCount: nil,
        projects: nil,
        projectCount: nil,
        today: nil,
        health: nil,
        movement: nil,
        psyche: nil,
        inbox: nil,
        sync: nil,
        people: nil,
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
            || goals != nil
            || projects != nil
            || today != nil
            || health != nil
            || movement != nil
            || psyche != nil
            || inbox != nil
            || sync != nil
            || people != nil
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
            goalCount: goalCount,
            projects: projects,
            projectCount: projectCount,
            today: today,
            health: health,
            movement: movement,
            psyche: psyche,
            inbox: inbox,
            sync: sync,
            people: people,
            habits: habits,
            checkInOptions: checkInOptions,
            pendingPrompts: pendingPrompts
        )
    }

    func withPeople(_ people: ForgeWatchPeopleGlanceSnapshot?) -> ForgeWatchBootstrap {
        ForgeWatchBootstrap(
            schemaVersion: schemaVersion,
            generatedAt: generatedAt,
            connection: connection,
            surfaces: surfaces,
            now: now,
            work: work,
            goals: goals,
            goalCount: goalCount,
            projects: projects,
            projectCount: projectCount,
            today: today,
            health: health,
            movement: movement,
            psyche: psyche,
            inbox: inbox,
            sync: sync,
            people: people,
            habits: habits,
            checkInOptions: checkInOptions,
            pendingPrompts: pendingPrompts
        )
    }

    func preservingPeople(from cached: ForgeWatchBootstrap) -> ForgeWatchBootstrap {
        guard people == nil,
              connection?.sessionId != nil,
              connection?.sessionId == cached.connection?.sessionId
        else { return self }
        return withPeople(cached.people)
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
    let error: [String: ForgeWatchJSONValue]?
    let bootstrap: ForgeWatchBootstrap?

    init(
        actionId: String,
        kind: String? = nil,
        processedAt: String,
        status: String?,
        error: [String: ForgeWatchJSONValue]?,
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

enum ForgeWatchJSONValue: Codable, Hashable,
    ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, CustomStringConvertible
{
    case string(String)
    case number(Double)
    case boolean(Bool)
    case object([String: ForgeWatchJSONValue])
    case array([ForgeWatchJSONValue])
    case null

    init(stringLiteral value: String) { self = .string(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(floatLiteral value: Double) { self = .number(value) }
    init(booleanLiteral value: Bool) { self = .boolean(value) }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: ForgeWatchJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([ForgeWatchJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported Forge Watch JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var integerValue: Int? {
        guard case .number(let value) = self, value.rounded() == value else { return nil }
        return Int(value)
    }

    var description: String {
        switch self {
        case .string(let value): value
        case .number(let value): value.rounded() == value ? String(Int(value)) : String(value)
        case .boolean(let value): String(value)
        case .object, .array:
            (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? "Invalid value"
        case .null: "null"
        }
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
    var error: [String: ForgeWatchJSONValue]? = nil
}

struct ForgeWatchStoredReceipt: Codable, Identifiable, Hashable {
    var id: String { actionId }

    let actionId: String
    let kind: String
    let status: String
    let processedAt: String
    let errorMessage: String?
    var structuredError: [String: ForgeWatchJSONValue]? = nil
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
                errorMessage: ack.error?["message"]?.stringValue
                    ?? (ack.status == "failed" ? "Forge rejected this action" : nil),
                structuredError: ack.error
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
    let deadlineAt: String?

    nonisolated init(
        id: String,
        createdAt: String,
        reason: String,
        deadlineAt: String? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.reason = reason
        self.deadlineAt = deadlineAt
    }
}

enum ForgeWatchRefreshResponseStatus: String, Codable, Hashable {
    case refreshed
    case failed
    case expired
}

struct ForgeWatchRefreshResponse: Codable, Hashable {
    let requestId: String
    let completedAt: String
    let status: ForgeWatchRefreshResponseStatus
    let message: String
}

enum ForgeWatchRefreshRequestPolicy {
    nonisolated static let timeoutSeconds: TimeInterval = 12

    nonisolated static func deadline(for createdAt: Date) -> Date {
        createdAt.addingTimeInterval(timeoutSeconds)
    }

    nonisolated static func isExpired(
        _ request: ForgeWatchControlRequest,
        now: Date = Date()
    ) -> Bool {
        guard
            let deadlineAt = request.deadlineAt,
            let deadline = ISO8601DateFormatter().date(from: deadlineAt)
        else {
            return false
        }
        return now >= deadline
    }

    nonisolated static func accepts(
        _ response: ForgeWatchRefreshResponse,
        activeRequestId: String?
    ) -> Bool {
        activeRequestId == response.requestId
    }
}

enum ForgeWatchLaunchDestination: String, Codable, CaseIterable {
    case habits
    case checkIn = "check_in"
    case markMoment = "mark_moment"
    case promptInbox = "prompt_inbox"
    case emotion
}
