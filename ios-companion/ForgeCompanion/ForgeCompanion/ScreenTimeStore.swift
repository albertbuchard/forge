import Foundation

@MainActor
final class ScreenTimeStore: ObservableObject {
    struct PersistedState: Codable {
        var trackingEnabled: Bool
        var syncEnabled: Bool
        var metadata: [String: String]
    }

    @Published private(set) var trackingEnabled = false
    @Published private(set) var syncEnabled = false
    @Published private(set) var authorizationStatus = "archived"
    @Published private(set) var captureState = "archived"
    @Published private(set) var lastCapturedDayKey: String?
    @Published private(set) var lastCaptureStartedAt: String?
    @Published private(set) var lastCaptureEndedAt: String?
    @Published private(set) var daySummaries: [ForgeScreenTimeDaySummarySnapshot] = []
    @Published private(set) var hourlySegments: [ForgeScreenTimeHourlySegmentSnapshot] = []
    @Published private(set) var metadata: [String: String] = [
        "deliveryMode": "archived_ios_backup",
        "snapshot_source": "archived"
    ]
    @Published private(set) var captureRefreshToken = UUID()

    init() {}

    var enabled: Bool {
        false
    }

    func requestAuthorization() async {}

    func enableAndAuthorize() async {}

    func setEnabled(_ enabled: Bool) {}

    func setTrackingEnabled(_ enabled: Bool) {}

    func setSyncEnabled(_ enabled: Bool) {}

    func handleAppDidBecomeActive() {}

    func setCaptureSurfaceVisible(_ visible: Bool) {}

    func ingestSharedSnapshots() {}

    func refreshCaptureNow() async {}

    func reloadVisibleReport() {}

    func prepareSnapshotForSync(reason: String) async {}

    func buildScreenTimePayload() -> CompanionSyncPayload.ScreenTimePayload {
        CompanionSyncPayload.ScreenTimePayload(
            settings: .init(
                trackingEnabled: false,
                syncEnabled: false,
                authorizationStatus: "archived",
                captureState: "archived",
                lastCapturedDayKey: nil,
                lastCaptureStartedAt: nil,
                lastCaptureEndedAt: nil,
                metadata: metadata
            ),
            daySummaries: [],
            hourlySegments: []
        )
    }

    var readyForSync: Bool {
        false
    }

    var capturedDayCount: Int {
        0
    }

    var capturedHourCount: Int {
        0
    }

    var lastGeneratedAt: String? {
        nil
    }

    var captureAgeHours: Double? {
        nil
    }

    var hasCapturedData: Bool {
        false
    }

    var captureFreshness: String {
        "archived"
    }

    var captureWindowDays: Int {
        0
    }

    var totalCapturedActivitySeconds: Int {
        0
    }

    var totalCapturedActivityHours: Double {
        0
    }

    var totalCapturedHoursLabel: String {
        "0"
    }

    var trackedRangeSummary: String {
        "Archived"
    }

    var freshnessSummary: String {
        "Archived for future Android companion work"
    }

    var latestCaptureSummary: String {
        "Removed from the iOS companion app"
    }

    var topAppsPreview: [String] {
        []
    }

    var topCategoriesPreview: [String] {
        []
    }

    var recentDayHistory: [ForgeScreenTimeDaySummarySnapshot] {
        []
    }
}
