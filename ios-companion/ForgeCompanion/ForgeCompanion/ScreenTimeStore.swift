import Foundation
import Combine
import FamilyControls

@MainActor
final class ScreenTimeStore: ObservableObject {
    struct PersistedState: Codable {
        var trackingEnabled: Bool
        var syncEnabled: Bool
        var metadata: [String: String]
    }

    private enum StorageKeys {
        static let screenTimeState = "forge_companion_screen_time_state"
    }

    @Published private(set) var trackingEnabled = false
    @Published private(set) var syncEnabled = true
    @Published private(set) var authorizationStatus = "not_determined"
    @Published private(set) var captureState = "disabled"
    @Published private(set) var lastCapturedDayKey: String?
    @Published private(set) var lastCaptureStartedAt: String?
    @Published private(set) var lastCaptureEndedAt: String?
    @Published private(set) var daySummaries: [ForgeScreenTimeDaySummarySnapshot] = []
    @Published private(set) var hourlySegments: [ForgeScreenTimeHourlySegmentSnapshot] = []
    @Published private(set) var metadata: [String: String] = [:]
    @Published private(set) var captureRefreshToken = UUID()

    private var cancellables: Set<AnyCancellable> = []
    private let snapshotLoader: () -> ForgeScreenTimeSnapshotEnvelope
    private let nowProvider: () -> Date
    private let storedStateOverride: PersistedState?
    private let authorizationStatusOverride: String?
    private let bindAuthorizationUpdates: Bool

    init(
        snapshotLoader: @escaping () -> ForgeScreenTimeSnapshotEnvelope = ForgeScreenTimeSnapshotStore.load,
        nowProvider: @escaping () -> Date = Date.init,
        storedStateOverride: PersistedState? = nil,
        authorizationStatusOverride: String? = nil,
        bindAuthorizationUpdates: Bool = true
    ) {
        self.snapshotLoader = snapshotLoader
        self.nowProvider = nowProvider
        self.storedStateOverride = storedStateOverride
        self.authorizationStatusOverride = authorizationStatusOverride
        self.bindAuthorizationUpdates = bindAuthorizationUpdates
        loadState()
        if bindAuthorizationUpdates {
            bindAuthorizationCenter()
        }
        refreshAuthorizationStatus()
        ingestSharedSnapshots()
        refreshCaptureState()
    }

    private func bindAuthorizationCenter() {
        AuthorizationCenter.shared.$authorizationStatus
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshAuthorizationStatus()
            }
            .store(in: &cancellables)
    }

    func requestAuthorization() async {
        companionDebugLog("ScreenTimeStore", "requestAuthorization start")
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            refreshAuthorizationStatus()
            refreshCaptureState()
            triggerCaptureRefresh(reason: "authorization granted")
            companionDebugLog("ScreenTimeStore", "requestAuthorization success")
        } catch {
            companionDebugLog(
                "ScreenTimeStore",
                "requestAuthorization failed error=\(error.localizedDescription)"
            )
            refreshAuthorizationStatus()
            refreshCaptureState()
        }
    }

    func enableAndAuthorize() async {
        if enabled == false {
            setEnabled(true)
        }
        await requestAuthorization()
    }

    var enabled: Bool {
        trackingEnabled && syncEnabled
    }

    func setEnabled(_ enabled: Bool) {
        trackingEnabled = enabled
        syncEnabled = enabled
        refreshCaptureState()
        persistState()
        if enabled {
            triggerCaptureRefresh(reason: "screen time enabled")
        }
    }

    func setTrackingEnabled(_ enabled: Bool) {
        setEnabled(enabled)
    }

    func setSyncEnabled(_ enabled: Bool) {
        setEnabled(enabled)
    }

    func handleAppDidBecomeActive() {
        companionDebugLog("ScreenTimeStore", "handleAppDidBecomeActive")
        refreshAuthorizationStatus()
        ingestSharedSnapshots()
        refreshCaptureState()
        if trackingEnabled && authorizationStatus == "approved" {
            triggerCaptureRefresh(reason: "app active")
        }
    }

    func ingestSharedSnapshots() {
        let snapshot = snapshotLoader()
        daySummaries = snapshot.daySummaries.sorted { $0.dateKey > $1.dateKey }
        hourlySegments = snapshot.hourlySegments.sorted { lhs, rhs in
            if lhs.startedAt == rhs.startedAt {
                return lhs.hourIndex < rhs.hourIndex
            }
            return lhs.startedAt < rhs.startedAt
        }
        lastCapturedDayKey = daySummaries.first?.dateKey
        lastCaptureStartedAt = hourlySegments.first?.startedAt
        lastCaptureEndedAt = hourlySegments.last?.endedAt
        metadata["snapshot_source"] = snapshot.source
        metadata["snapshot_kind"] = snapshot.segmentKind
        metadata["generated_at"] = snapshot.generatedAt
        refreshCaptureState()
    }

    func buildScreenTimePayload() -> CompanionSyncPayload.ScreenTimePayload {
        CompanionSyncPayload.ScreenTimePayload(
            settings: .init(
                trackingEnabled: trackingEnabled,
                syncEnabled: syncEnabled,
                authorizationStatus: authorizationStatus,
                captureState: captureState,
                lastCapturedDayKey: lastCapturedDayKey,
                lastCaptureStartedAt: lastCaptureStartedAt,
                lastCaptureEndedAt: lastCaptureEndedAt,
                metadata: metadata.merging([
                    "captureFreshness": captureFreshness,
                    "capturedDayCount": "\(capturedDayCount)",
                    "capturedHourCount": "\(capturedHourCount)",
                    "captureWindowDays": "\(captureWindowDays)"
                ]) { _, new in new }
            ),
            daySummaries: daySummaries.map { summary in
                .init(
                    dateKey: summary.dateKey,
                    totalActivitySeconds: summary.totalActivitySeconds,
                    pickupCount: summary.pickupCount,
                    notificationCount: summary.notificationCount,
                    firstPickupAt: summary.firstPickupAt,
                    longestActivitySeconds: summary.longestActivitySeconds,
                    topAppBundleIdentifiers: summary.topAppBundleIdentifiers,
                    topCategoryLabels: summary.topCategoryLabels,
                    metadata: summary.metadata
                )
            },
            hourlySegments: hourlySegments.map { segment in
                .init(
                    dateKey: segment.dateKey,
                    hourIndex: segment.hourIndex,
                    startedAt: segment.startedAt,
                    endedAt: segment.endedAt,
                    totalActivitySeconds: segment.totalActivitySeconds,
                    pickupCount: segment.pickupCount,
                    notificationCount: segment.notificationCount,
                    firstPickupAt: segment.firstPickupAt,
                    longestActivityStartedAt: segment.longestActivityStartedAt,
                    longestActivityEndedAt: segment.longestActivityEndedAt,
                    metadata: segment.metadata,
                    apps: segment.apps.map { app in
                        .init(
                            bundleIdentifier: app.bundleIdentifier,
                            displayName: app.displayName,
                            categoryLabel: app.categoryLabel,
                            totalActivitySeconds: app.totalActivitySeconds,
                            pickupCount: app.pickupCount,
                            notificationCount: app.notificationCount
                        )
                    },
                    categories: segment.categories.map { category in
                        .init(
                            categoryLabel: category.categoryLabel,
                            totalActivitySeconds: category.totalActivitySeconds
                        )
                    }
                )
            }
        )
    }

    var readyForSync: Bool {
        enabled && authorizationStatus == "approved"
    }

    var capturedDayCount: Int {
        daySummaries.count
    }

    var capturedHourCount: Int {
        hourlySegments.count
    }

    var lastGeneratedAt: String? {
        metadata["generated_at"]
    }

    var captureAgeHours: Double? {
        guard let lastGeneratedAt, let generatedAt = Self.parseIso(lastGeneratedAt) else {
            return nil
        }
        let delta = max(0, nowProvider().timeIntervalSince(generatedAt) / 3600)
        return (delta * 10).rounded() / 10
    }

    var captureFreshness: String {
        if authorizationStatus == "unavailable" {
            return "unavailable"
        }
        if hourlySegments.isEmpty {
            return "empty"
        }
        if let captureAgeHours, captureAgeHours <= 36 {
            return "fresh"
        }
        return "stale"
    }

    var captureWindowDays: Int {
        guard
            let startedAt = lastCaptureStartedAt.flatMap(Self.parseIso),
            let endedAt = lastCaptureEndedAt.flatMap(Self.parseIso)
        else {
            return hourlySegments.isEmpty ? 0 : 1
        }
        let delta = max(0, endedAt.timeIntervalSince(startedAt))
        return max(1, Int((delta / 86_400).rounded()))
    }

    var trackedRangeSummary: String {
        guard
            let startedAt = lastCaptureStartedAt.flatMap(Self.parseIso),
            let endedAt = lastCaptureEndedAt.flatMap(Self.parseIso)
        else {
            return "No captured range yet"
        }
        return "\(Self.shortDateTime(startedAt)) → \(Self.shortDateTime(endedAt))"
    }

    var freshnessSummary: String {
        switch captureFreshness {
        case "fresh":
            return captureAgeHours.map { "Fresh · updated \($0.formatted(.number.precision(.fractionLength(0...1))))h ago" }
                ?? "Fresh"
        case "stale":
            return captureAgeHours.map { "Stale · last update \($0.formatted(.number.precision(.fractionLength(0...1))))h ago" }
                ?? "Stale"
        case "unavailable":
            return "Unavailable on this build"
        default:
            return "Waiting for first capture"
        }
    }

    var latestCaptureSummary: String {
        if authorizationStatus == "denied" {
            return "Screen Time denied"
        }
        if authorizationStatus == "unavailable" {
            return "Entitlement unavailable"
        }
        if hourlySegments.isEmpty {
            return enabled ? "Waiting for first Screen Time snapshot" : "Screen Time off"
        }
        return "\(capturedDayCount) days · \(capturedHourCount) hourly slices · \(captureFreshness)"
    }

    var topAppsPreview: [String] {
        Array(
            hourlySegments
                .flatMap(\.apps)
                .sorted {
                    $0.totalActivitySeconds > $1.totalActivitySeconds
                }
                .prefix(3)
                .map { $0.displayName.isEmpty ? $0.bundleIdentifier : $0.displayName }
        )
    }

    var topCategoriesPreview: [String] {
        let totals = Dictionary(grouping: hourlySegments.flatMap(\.categories), by: \.categoryLabel)
            .map { key, categories in
                (
                    key,
                    categories.reduce(0) { $0 + $1.totalActivitySeconds }
                )
            }
            .sorted { lhs, rhs in
                if lhs.1 == rhs.1 {
                    return lhs.0 < rhs.0
                }
                return lhs.1 > rhs.1
            }
        return Array(totals.prefix(3).map(\.0))
    }

    var recentDayHistory: [ForgeScreenTimeDaySummarySnapshot] {
        Array(daySummaries.prefix(7))
    }

    static func normalizeAuthorizationStatus(
        description: String,
        fallbackRawValue: Int? = nil
    ) -> String {
        let normalizedDescription = description
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: " ", with: "")

        if normalizedDescription.contains("approved") {
            return "approved"
        }
        if normalizedDescription.contains("denied") {
            return "denied"
        }
        if normalizedDescription.contains("notdetermined") {
            return "not_determined"
        }
        if normalizedDescription.contains("unavailable") {
            return "unavailable"
        }

        switch fallbackRawValue {
        case 0:
            return "not_determined"
        case 1:
            return "denied"
        case 2:
            return "approved"
        default:
            return "unavailable"
        }
    }

    private func refreshAuthorizationStatus() {
        if let authorizationStatusOverride {
            authorizationStatus = authorizationStatusOverride
            return
        }
        if #available(iOS 16.0, *) {
            let status = AuthorizationCenter.shared.authorizationStatus
            authorizationStatus = Self.normalizeAuthorizationStatus(
                description: status.description,
                fallbackRawValue: status.rawValue
            )
            metadata["authorizationStatusDescription"] = status.description
            metadata["authorizationStatusRawValue"] = "\(status.rawValue)"
        } else {
            authorizationStatus = "unavailable"
        }
    }

    private func refreshCaptureState() {
        if trackingEnabled == false {
            syncEnabled = false
            captureState = "disabled"
            return
        }
        if syncEnabled == false {
            captureState = "sync_paused"
            return
        }
        switch authorizationStatus {
        case "approved":
            captureState = "ready"
        case "denied", "not_determined":
            captureState = "needs_authorization"
        default:
            captureState = "unavailable"
        }
    }

    private func triggerCaptureRefresh(reason: String) {
        companionDebugLog("ScreenTimeStore", "triggerCaptureRefresh reason=\(reason)")
        captureRefreshToken = UUID()
    }

    private func loadState() {
        if let storedStateOverride {
            trackingEnabled = storedStateOverride.trackingEnabled
            syncEnabled = storedStateOverride.trackingEnabled
            metadata = storedStateOverride.metadata
            return
        }
        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.screenTimeState),
            let state = try? JSONDecoder().decode(PersistedState.self, from: data)
        {
            trackingEnabled = state.trackingEnabled
            syncEnabled = state.trackingEnabled
            metadata = state.metadata
            return
        }
        trackingEnabled = false
        syncEnabled = true
        metadata = [:]
    }

    private func persistState() {
        let state = PersistedState(
            trackingEnabled: trackingEnabled,
            syncEnabled: syncEnabled,
            metadata: metadata
        )
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: StorageKeys.screenTimeState)
        }
    }

    private static func parseIso(_ value: String) -> Date? {
        if let date = isoFormatterWithFractional.date(from: value) {
            return date
        }
        return isoFormatterBasic.date(from: value)
    }

    private static func shortDateTime(_ date: Date) -> String {
        shortDateFormatter.string(from: date)
    }

    private static let isoFormatterWithFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoFormatterBasic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let shortDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
