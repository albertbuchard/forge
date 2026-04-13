import CoreFoundation
import Foundation
import _DeviceActivity_SwiftUI

enum ForgeScreenTimeStorage {
    nonisolated static let appGroupId = "group.albertbuchard.ForgeCompanion"
    nonisolated static let snapshotKey = "forge_screen_time_snapshot_envelope"
    nonisolated static let snapshotDidChangeNotificationName =
        "group.albertbuchard.ForgeCompanion.forge_screen_time_snapshot_changed"
    nonisolated static let snapshotDidChangeDarwinName = CFNotificationName(
        rawValue: snapshotDidChangeNotificationName as CFString
    )

    nonisolated static func sharedDefaults() -> UserDefaults {
        let containerUrl = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        )
        let suiteDefaults = UserDefaults(suiteName: appGroupId)
        debugLog(
            "sharedDefaults containerAvailable=\(containerUrl != nil) suiteAvailable=\(suiteDefaults != nil)"
        )
        return suiteDefaults ?? .standard
    }
}

extension DeviceActivityReport.Context {
    static let forgeHourlyScreenTime = Self("ForgeHourlyScreenTime")
    static let forgeDailyScreenTime = Self("ForgeDailyScreenTime")
    static let forgeCaptureHourlyScreenTime = Self("ForgeCaptureHourlyScreenTime")
    static let forgeCaptureDailyScreenTime = Self("ForgeCaptureDailyScreenTime")
}

struct ForgeScreenTimeAppUsageSnapshot: Codable, Hashable, Identifiable {
    let id: String
    let bundleIdentifier: String
    let displayName: String
    let categoryLabel: String?
    let totalActivitySeconds: Int
    let pickupCount: Int
    let notificationCount: Int
}

struct ForgeScreenTimeCategoryUsageSnapshot: Codable, Hashable, Identifiable {
    let id: String
    let categoryLabel: String
    let totalActivitySeconds: Int
}

struct ForgeScreenTimeHourlySegmentSnapshot: Codable, Hashable, Identifiable {
    let id: String
    let dateKey: String
    let hourIndex: Int
    let startedAt: String
    let endedAt: String
    let totalActivitySeconds: Int
    let pickupCount: Int
    let notificationCount: Int
    let firstPickupAt: String?
    let longestActivityStartedAt: String?
    let longestActivityEndedAt: String?
    let metadata: [String: String]
    let apps: [ForgeScreenTimeAppUsageSnapshot]
    let categories: [ForgeScreenTimeCategoryUsageSnapshot]
}

struct ForgeScreenTimeDaySummarySnapshot: Codable, Hashable, Identifiable {
    let id: String
    let dateKey: String
    let totalActivitySeconds: Int
    let pickupCount: Int
    let notificationCount: Int
    let firstPickupAt: String?
    let longestActivitySeconds: Int
    let topAppBundleIdentifiers: [String]
    let topCategoryLabels: [String]
    let metadata: [String: String]
}

struct ForgeScreenTimeSnapshotEnvelope: Codable, Hashable {
    let generatedAt: String
    let source: String
    let segmentKind: String
    let daySummaries: [ForgeScreenTimeDaySummarySnapshot]
    let hourlySegments: [ForgeScreenTimeHourlySegmentSnapshot]

    static let empty = ForgeScreenTimeSnapshotEnvelope(
        generatedAt: Date().formatted(.iso8601),
        source: "device_activity_report",
        segmentKind: "empty",
        daySummaries: [],
        hourlySegments: []
    )
}

enum ForgeScreenTimeSnapshotStore {
    static func load() -> ForgeScreenTimeSnapshotEnvelope {
        let defaults = ForgeScreenTimeStorage.sharedDefaults()
        guard
            let data = defaults.data(forKey: ForgeScreenTimeStorage.snapshotKey),
            let snapshot = try? JSONDecoder().decode(
                ForgeScreenTimeSnapshotEnvelope.self,
                from: data
            )
        else {
            debugLog("load missingOrInvalidSnapshot")
            return .empty
        }
        debugLog(
            "load success days=\(snapshot.daySummaries.count) hours=\(snapshot.hourlySegments.count) source=\(snapshot.source)"
        )
        return snapshot
    }

    static func save(_ snapshot: ForgeScreenTimeSnapshotEnvelope) {
        let defaults = ForgeScreenTimeStorage.sharedDefaults()
        guard let data = try? JSONEncoder().encode(snapshot) else {
            debugLog("save encodeFailed")
            return
        }
        defaults.set(data, forKey: ForgeScreenTimeStorage.snapshotKey)
        defaults.synchronize()
        debugLog(
            "save success days=\(snapshot.daySummaries.count) hours=\(snapshot.hourlySegments.count) source=\(snapshot.source)"
        )
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            ForgeScreenTimeStorage.snapshotDidChangeDarwinName,
            nil,
            nil,
            true
        )
    }
}

private func debugLog(_ message: String) {
    print("[ForgeScreenTimeShared] \(message)")
}
