import Foundation

enum ForgeWatchStorage {
    nonisolated static let appGroupId = "group.albertbuchard.ForgeCompanion"
    nonisolated static let bootstrapKey = "forge_watch_bootstrap"
    nonisolated static let outgoingQueueKey = "forge_watch_outgoing_queue"
    nonisolated static let pendingLaunchDestinationKey = "forge_watch_pending_launch_destination"
    nonisolated static let actionMessageKey = "forge_watch_action_message"
    nonisolated static let ackMessageKey = "forge_watch_ack_message"
    nonisolated static let bootstrapContextKey = "forge_watch_bootstrap_context"

    nonisolated static func sharedDefaults() -> UserDefaults {
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) != nil else {
            return .standard
        }
        return UserDefaults(suiteName: appGroupId) ?? .standard
    }
}

enum WatchSurface: String, CaseIterable, Codable {
    case habits
    case checkIn = "check_in"
    case markMoment = "mark_moment"
    case promptInbox = "prompt_inbox"
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

struct ForgeWatchBootstrap: Codable, Hashable {
    let generatedAt: String
    var habits: [ForgeWatchHabitSummary]
    let checkInOptions: ForgeWatchQuickOptions
    var pendingPrompts: [ForgeWatchPrompt]

    static let empty = ForgeWatchBootstrap(
        generatedAt: ISO8601DateFormatter().string(from: Date()),
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

struct ForgeWatchOutboundEnvelope: Codable, Identifiable, Hashable {
    let id: String
    let createdAt: String
    let device: ForgeWatchDeviceDescriptor
    let kind: ForgeWatchActionKind
    let habitCheckIn: ForgeWatchHabitCheckInAction?
    let captureEvent: ForgeWatchCaptureEventAction?
}

struct ForgeWatchAckEnvelope: Codable, Hashable {
    let actionId: String
    let processedAt: String
    let bootstrap: ForgeWatchBootstrap?
}
