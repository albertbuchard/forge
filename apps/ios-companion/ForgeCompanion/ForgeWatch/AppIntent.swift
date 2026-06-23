import AppIntents
import Foundation

private func storeLaunchDestination(_ destination: String) {
    let defaults = widgetSharedDefaults()
    defaults.set(destination, forKey: "forge_watch_pending_launch_destination")
}

private func widgetSharedDefaults() -> UserDefaults {
    guard
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.albertbuchard.ForgeCompanion"
        ) != nil
    else {
        return .standard
    }
    return UserDefaults(suiteName: "group.albertbuchard.ForgeCompanion") ?? .standard
}

struct OpenHabitsIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Habits"
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        storeLaunchDestination("habits")
        return .result()
    }
}

struct OpenCheckInIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Check In"
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        storeLaunchDestination("check_in")
        return .result()
    }
}

struct OpenMarkMomentIntent: AppIntent {
    static let title: LocalizedStringResource = "Mark Moment"
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        storeLaunchDestination("mark_moment")
        return .result()
    }
}

struct OpenEmotionIntent: AppIntent {
    static let title: LocalizedStringResource = "Log Emotion"
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        storeLaunchDestination("emotion")
        return .result()
    }
}
