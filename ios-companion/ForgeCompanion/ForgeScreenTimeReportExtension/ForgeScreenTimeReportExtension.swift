import DeviceActivity
import ExtensionKit
import ManagedSettings
import SwiftUI
import _DeviceActivity_SwiftUI

@main
struct ForgeScreenTimeReportExtension: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        ForgeHourlyScreenTimeReport { snapshot in
            ForgeScreenTimeReportView(snapshot: snapshot)
        }
        ForgeDailyScreenTimeReport { snapshot in
            ForgeScreenTimeReportView(snapshot: snapshot)
        }
    }
}

private struct ForgeHourlyScreenTimeReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .forgeHourlyScreenTime
    let content: (ForgeScreenTimeSnapshotEnvelope) -> ForgeScreenTimeReportView

    func makeConfiguration(
        representing data: DeviceActivityResults<DeviceActivityData>
    ) async -> ForgeScreenTimeSnapshotEnvelope {
        debugLog("makeConfiguration start context=hourly")
        let snapshot = await buildSnapshotEnvelope(
            from: data,
            segmentKind: "hourly"
        )
        debugLog("makeConfiguration complete context=hourly days=\(snapshot.daySummaries.count) hours=\(snapshot.hourlySegments.count)")
        persistMergedSnapshot(snapshot, replacesHourly: true, replacesDaily: false)
        return snapshot
    }
}

private struct ForgeDailyScreenTimeReport: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .forgeDailyScreenTime
    let content: (ForgeScreenTimeSnapshotEnvelope) -> ForgeScreenTimeReportView

    func makeConfiguration(
        representing data: DeviceActivityResults<DeviceActivityData>
    ) async -> ForgeScreenTimeSnapshotEnvelope {
        debugLog("makeConfiguration start context=daily")
        let snapshot = await buildSnapshotEnvelope(
            from: data,
            segmentKind: "daily"
        )
        debugLog("makeConfiguration complete context=daily days=\(snapshot.daySummaries.count) hours=\(snapshot.hourlySegments.count)")
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

private struct ForgeScreenTimeReportView: View {
    let snapshot: ForgeScreenTimeSnapshotEnvelope

    private var totalActivitySeconds: Int {
        if snapshot.daySummaries.isEmpty == false {
            return snapshot.daySummaries.reduce(0) { $0 + $1.totalActivitySeconds }
        }
        return snapshot.hourlySegments.reduce(0) { $0 + $1.totalActivitySeconds }
    }

    private var topApps: [(name: String, seconds: Int)] {
        let aggregates = Dictionary(grouping: snapshot.hourlySegments.flatMap(\.apps)) { usage in
            usage.displayName.isEmpty ? usage.bundleIdentifier : usage.displayName
        }
            .map { key, values in
                (
                    name: key,
                    seconds: values.reduce(0) { $0 + $1.totalActivitySeconds }
                )
            }
            .sorted { lhs, rhs in
                if lhs.seconds == rhs.seconds {
                    return lhs.name < rhs.name
                }
                return lhs.seconds > rhs.seconds
            }
        return Array(aggregates.prefix(4))
    }

    private var syncExportLines: [String] {
        var lines = [
            "FORGESYNCV1",
            "GENERATED \(snapshot.generatedAt)",
            "TOTAL \(totalActivitySeconds)",
            "DAYS \(snapshot.daySummaries.count)",
            "SLICES \(snapshot.hourlySegments.count)"
        ]
        for day in snapshot.daySummaries.prefix(7) {
            lines.append(
                "DAY \(day.dateKey) \(day.totalActivitySeconds) \(day.pickupCount) \(day.notificationCount) \(day.longestActivitySeconds)"
            )
        }
        lines.append("FORGESYNCEND")
        return lines
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Screen Time")
                .font(.headline.weight(.bold))
                .foregroundStyle(.primary)

            if snapshot.daySummaries.isEmpty && snapshot.hourlySegments.isEmpty {
                Text("No Screen Time activity is available for this filter yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text(formattedDuration(totalActivitySeconds))
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)

                if snapshot.daySummaries.isEmpty == false {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(snapshot.daySummaries.prefix(5)), id: \.id) { day in
                            HStack {
                                Text(shortDayLabel(day.dateKey))
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text(formattedDuration(day.totalActivitySeconds))
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline.weight(.medium))
                        }
                    }
                }

                if topApps.isEmpty == false {
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Top apps")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(Array(topApps.enumerated()), id: \.offset) { _, app in
                            HStack {
                                Text(app.name)
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Spacer()
                                Text(formattedDuration(app.seconds))
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                        }
                    }
                }

                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Forge sync export")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(syncExportLines.joined(separator: "\n"))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.black)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color.white)
                        )
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(uiColor: .secondarySystemBackground))
        )
    }
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
    debugLog("persistMergedSnapshot saved generatedAt=\(snapshot.generatedAt) days=\(merged.daySummaries.count) hours=\(merged.hourlySegments.count)")
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

private func formattedDuration(_ seconds: Int) -> String {
    let hours = seconds / 3600
    let minutes = (seconds % 3600) / 60
    if hours > 0 {
        return "\(hours)h \(minutes)m"
    }
    return "\(minutes)m"
}

private func shortDayLabel(_ dateKey: String) -> String {
    let parser = DateFormatter()
    parser.calendar = Calendar(identifier: .gregorian)
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.timeZone = TimeZone(secondsFromGMT: 0)
    parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: dateKey) else {
        return dateKey
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE d MMM"
    return formatter.string(from: date)
}

private func debugLog(_ message: String) {
    print("[ForgeScreenTimeReportExtension] \(message)")
}
