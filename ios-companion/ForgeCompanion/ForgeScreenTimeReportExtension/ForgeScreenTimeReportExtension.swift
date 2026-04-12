import DeviceActivity
import ExtensionKit
import ManagedSettings
import SwiftUI
import _DeviceActivity_SwiftUI

@main
struct ForgeScreenTimeReportExtension: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        ForgeHourlyScreenTimeReport { _ in
            EmptyView()
        }
        ForgeDailyScreenTimeReport { _ in
            EmptyView()
        }
    }
}

private struct ForgeHourlyScreenTimeReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .forgeHourlyScreenTime
    let content: (ForgeScreenTimeSnapshotEnvelope) -> EmptyView

    func makeConfiguration(
        representing data: DeviceActivityResults<DeviceActivityData>
    ) async -> ForgeScreenTimeSnapshotEnvelope {
        let snapshot = await buildSnapshotEnvelope(
            from: data,
            segmentKind: "hourly"
        )
        persistMergedSnapshot(snapshot, replacesHourly: true, replacesDaily: false)
        return snapshot
    }
}

private struct ForgeDailyScreenTimeReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .forgeDailyScreenTime
    let content: (ForgeScreenTimeSnapshotEnvelope) -> EmptyView

    func makeConfiguration(
        representing data: DeviceActivityResults<DeviceActivityData>
    ) async -> ForgeScreenTimeSnapshotEnvelope {
        let snapshot = await buildSnapshotEnvelope(
            from: data,
            segmentKind: "daily"
        )
        persistMergedSnapshot(snapshot, replacesHourly: false, replacesDaily: true)
        return snapshot
    }
}

private func buildSnapshotEnvelope(
    from data: DeviceActivityResults<DeviceActivityData>,
    segmentKind: String
) async -> ForgeScreenTimeSnapshotEnvelope {
    var hourlySegments: [ForgeScreenTimeHourlySegmentSnapshot] = []
    var dailySummaries: [ForgeScreenTimeDaySummarySnapshot] = []
    let isoFormatter = ISO8601DateFormatter()
    isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    for await deviceData in data {
        var localDaily: [String: ForgeScreenTimeDaySummarySnapshot] = [:]

        for await segment in deviceData.activitySegments {
            let apps = await collectApps(from: segment)
            let categories = await collectCategories(from: segment)
            let dateKey = dayKey(segment.dateInterval.start)
            let hourIndex = Calendar.current.component(.hour, from: segment.dateInterval.start)
            let longestInterval = segment.longestActivity
            let segmentSnapshot = ForgeScreenTimeHourlySegmentSnapshot(
                id: "\(dateKey)-\(hourIndex)",
                dateKey: dateKey,
                hourIndex: hourIndex,
                startedAt: isoFormatter.string(from: segment.dateInterval.start),
                endedAt: isoFormatter.string(from: segment.dateInterval.end),
                totalActivitySeconds: max(0, Int(segment.totalActivityDuration.rounded())),
                pickupCount: apps.reduce(0) { $0 + $1.pickupCount },
                notificationCount: apps.reduce(0) { $0 + $1.notificationCount },
                firstPickupAt: segment.firstPickup.map { isoFormatter.string(from: $0) },
                longestActivityStartedAt: longestInterval.map { isoFormatter.string(from: $0.start) },
                longestActivityEndedAt: longestInterval.map { isoFormatter.string(from: $0.end) },
                metadata: [
                    "deviceName": deviceData.device.name ?? "",
                    "segmentInterval": segmentKind
                ],
                apps: apps,
                categories: categories
            )
            if segmentKind == "hourly" {
                hourlySegments.append(segmentSnapshot)
            }

            let existing = localDaily[dateKey]
            let mergedApps = (existing?.topAppBundleIdentifiers ?? []) + apps
                .sorted { $0.totalActivitySeconds > $1.totalActivitySeconds }
                .map(\.bundleIdentifier)
            let mergedCategories = (existing?.topCategoryLabels ?? []) + categories
                .sorted { $0.totalActivitySeconds > $1.totalActivitySeconds }
                .map(\.categoryLabel)
            localDaily[dateKey] = ForgeScreenTimeDaySummarySnapshot(
                id: dateKey,
                dateKey: dateKey,
                totalActivitySeconds: (existing?.totalActivitySeconds ?? 0) + max(0, Int(segment.totalActivityDuration.rounded())),
                pickupCount: (existing?.pickupCount ?? 0) + apps.reduce(0) { $0 + $1.pickupCount },
                notificationCount: (existing?.notificationCount ?? 0) + apps.reduce(0) { $0 + $1.notificationCount },
                firstPickupAt: minIso(existing?.firstPickupAt, segment.firstPickup.map { isoFormatter.string(from: $0) }),
                longestActivitySeconds: max(
                    existing?.longestActivitySeconds ?? 0,
                    longestInterval.map { max(0, Int($0.duration.rounded())) } ?? 0
                ),
                topAppBundleIdentifiers: Array(NSOrderedSet(array: mergedApps).array as? [String] ?? []).prefix(8).map { $0 },
                topCategoryLabels: Array(NSOrderedSet(array: mergedCategories).array as? [String] ?? []).prefix(8).map { $0 },
                metadata: [
                    "deviceName": deviceData.device.name ?? "",
                    "segmentInterval": segmentKind
                ]
            )
        }

        dailySummaries.append(contentsOf: localDaily.values.sorted { $0.dateKey > $1.dateKey })
    }

    return ForgeScreenTimeSnapshotEnvelope(
        generatedAt: isoFormatter.string(from: Date()),
        source: "device_activity_report_extension",
        segmentKind: segmentKind,
        daySummaries: Array(
            Dictionary(grouping: dailySummaries, by: \.dateKey)
                .values
                .compactMap { summaries in
                    summaries.sorted { $0.totalActivitySeconds > $1.totalActivitySeconds }.first
                }
                .sorted { $0.dateKey > $1.dateKey }
        ),
        hourlySegments: hourlySegments.sorted { $0.startedAt < $1.startedAt }
    )
}

private func collectApps(
    from segment: DeviceActivityData.ActivitySegment
) async -> [ForgeScreenTimeAppUsageSnapshot] {
    var appMap: [String: ForgeScreenTimeAppUsageSnapshot] = [:]

    for await category in segment.categories {
        let categoryLabel = category.category.localizedDisplayName ?? "Category"
        for await app in category.applications {
            let bundleIdentifier = app.application.bundleIdentifier
                ?? app.application.token.map { "\($0)" }
                ?? UUID().uuidString
            let existing = appMap[bundleIdentifier]
            appMap[bundleIdentifier] = ForgeScreenTimeAppUsageSnapshot(
                id: bundleIdentifier,
                bundleIdentifier: bundleIdentifier,
                displayName: app.application.localizedDisplayName ?? existing?.displayName ?? "",
                categoryLabel: categoryLabel,
                totalActivitySeconds: (existing?.totalActivitySeconds ?? 0) + max(0, Int(app.totalActivityDuration.rounded())),
                pickupCount: (existing?.pickupCount ?? 0) + app.numberOfPickups,
                notificationCount: (existing?.notificationCount ?? 0) + app.numberOfNotifications
            )
        }
    }

    return appMap.values.sorted { lhs, rhs in
        if lhs.totalActivitySeconds == rhs.totalActivitySeconds {
            return lhs.displayName < rhs.displayName
        }
        return lhs.totalActivitySeconds > rhs.totalActivitySeconds
    }
}

private func collectCategories(
    from segment: DeviceActivityData.ActivitySegment
) async -> [ForgeScreenTimeCategoryUsageSnapshot] {
    var categories: [ForgeScreenTimeCategoryUsageSnapshot] = []
    for await category in segment.categories {
        let label = category.category.localizedDisplayName ?? "Category"
        categories.append(
            ForgeScreenTimeCategoryUsageSnapshot(
                id: label,
                categoryLabel: label,
                totalActivitySeconds: max(0, Int(category.totalActivityDuration.rounded()))
            )
        )
    }
    return categories
}

private func persistMergedSnapshot(
    _ snapshot: ForgeScreenTimeSnapshotEnvelope,
    replacesHourly: Bool,
    replacesDaily: Bool
) {
    let existing = ForgeScreenTimeSnapshotStore.load()
    let merged = ForgeScreenTimeSnapshotEnvelope(
        generatedAt: snapshot.generatedAt,
        source: snapshot.source,
        segmentKind: snapshot.segmentKind,
        daySummaries: replacesDaily ? snapshot.daySummaries : existing.daySummaries,
        hourlySegments: replacesHourly ? snapshot.hourlySegments : existing.hourlySegments
    )
    ForgeScreenTimeSnapshotStore.save(merged)
}

private func dayKey(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

private func minIso(_ left: String?, _ right: String?) -> String? {
    switch (left, right) {
    case let (left?, right?):
        return left < right ? left : right
    case let (left?, nil):
        return left
    case let (nil, right?):
        return right
    default:
        return nil
    }
}
