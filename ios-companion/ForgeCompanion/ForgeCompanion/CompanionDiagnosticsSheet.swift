import SwiftUI
import UIKit

struct CompanionDiagnosticsSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @ObservedObject private var logStore = CompanionDebugLogStore.shared

    let close: () -> Void

    @State private var selectedTab: DiagnosticsTab = .overview
    @State private var copyStatusMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Picker("Diagnostics", selection: $selectedTab) {
                    ForEach(DiagnosticsTab.allCases) { tab in
                        Text(tab.title).tag(tab)
                    }
                }
                .pickerStyle(.segmented)

                ScrollView {
                    VStack(spacing: 14) {
                        switch selectedTab {
                        case .overview:
                            overviewContent
                        case .movement:
                            movementContent
                        case .logs:
                            logsContent
                        }
                    }
                    .padding(.bottom, 28)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .background(CompanionStyle.background)
            .navigationTitle("Diagnostics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close", action: close)
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
                if selectedTab == .logs {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button("Copy") {
                            copyLogsToPasteboard()
                        }
                        .foregroundStyle(CompanionStyle.accentStrong)

                        Button("Clear") {
                            logStore.clear()
                            copyStatusMessage = "Cleared local diagnostic logs."
                            companionDebugLog("CompanionDiagnostics", "cleared diagnostic logs")
                        }
                        .foregroundStyle(CompanionStyle.accentStrong)
                    }
                }
            }
        }
    }

    private var overviewContent: some View {
        VStack(spacing: 14) {
            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Sync state")
                    overviewMetricRow("Connection", appModel.syncStateLabel)
                    overviewMetricRow("Health", appModel.healthAccessLabel)
                    overviewMetricRow("Movement", appModel.movementAccessLabel)
                    overviewMetricRow("Watch", appModel.watchSyncLabel)
                    overviewMetricRow("Last sync", appModel.latestImportSummary)
                    overviewMetricRow("Last message", appModel.lastSyncMessage)
                }
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Latest payload")
                    if let summary = appModel.latestSyncPayloadSummary {
                        overviewMetricRow("Built", summary.builtAt.formatted(date: .omitted, time: .shortened))
                        overviewMetricRow("Raw sleep records", "\(summary.sleepRawRecords)")
                        overviewMetricRow("Sleep segments", "\(summary.sleepSegments)")
                        overviewMetricRow("Sleep nights", "\(summary.sleepNights)")
                        overviewMetricRow("Sleep stage entries", "\(summary.sleepStageEntries)")
                        overviewMetricRow("Workouts", "\(summary.workouts)")
                        overviewMetricRow("Vital days", "\(summary.vitalsDaySummaries)")
                        overviewMetricRow("Vital metric entries", "\(summary.vitalsMetricEntries)")
                        overviewMetricRow("Workout avg HR", "\(summary.workoutsWithAverageHeartRate)")
                        overviewMetricRow("Workout max HR", "\(summary.workoutsWithMaxHeartRate)")
                        overviewMetricRow("Workout step counts", "\(summary.workoutsWithStepCount)")
                        overviewMetricRow("Known places", "\(summary.movementKnownPlaces)")
                        overviewMetricRow("Stays", "\(summary.movementStays)")
                        overviewMetricRow("Trips", "\(summary.movementTrips)")
                        overviewMetricRow("Trip points", "\(summary.movementTripPoints)")
                        overviewMetricRow("Trip stops", "\(summary.movementTripStops)")
                    } else {
                        mutedBody("No sync payload has been built yet.")
                    }
                }
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("What synced and what did not")
                    ForEach(appModel.syncCoverageRows) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(row.title)
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textPrimary)
                                Spacer(minLength: 8)
                                Text(row.value)
                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                    .foregroundStyle(row.isMissing ? CompanionStyle.destructive : CompanionStyle.accentStrong)
                            }
                            Text(row.detail)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Source states")
                    ForEach(appModel.sourceDiagnosticsRows) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text(row.title)
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textPrimary)
                                Spacer(minLength: 8)
                                Text(row.desiredEnabled ? "Enabled" : "Off")
                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                    .foregroundStyle(row.syncEligible ? CompanionStyle.accentStrong : CompanionStyle.textSecondary)
                            }
                            overviewMetricRow("Desired", row.desiredEnabled ? "On" : "Off")
                            overviewMetricRow("Applied", row.appliedEnabled ? "On" : "Off")
                            overviewMetricRow("Authorization", row.authorizationStatus.replacingOccurrences(of: "_", with: " "))
                            overviewMetricRow("Sync eligible", row.syncEligible ? "Yes" : "No")
                            overviewMetricRow("Observed", row.lastObservedAt ?? "Waiting for device update")
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Latest receipt")
                    if let report = appModel.latestSyncReport {
                        overviewMetricRow("Synced at", report.syncedAt.formatted(date: .omitted, time: .shortened))
                        overviewMetricRow("Raw sleep records", "\(report.sleepRawRecords)")
                        overviewMetricRow("Sleep segments", "\(report.sleepSegments)")
                        overviewMetricRow("Sleep nights", "\(report.sleepNights)")
                        overviewMetricRow("Vital days", "\(report.vitalsDaySummaries)")
                        overviewMetricRow("Vital metric entries", "\(report.vitalsMetricEntries)")
                        overviewMetricRow("Created", "\(report.createdCount)")
                        overviewMetricRow("Updated", "\(report.updatedCount)")
                        overviewMetricRow("Merged", "\(report.mergedCount)")
                        overviewMetricRow("Movement stays", "\(report.movementStays)")
                        overviewMetricRow("Movement trips", "\(report.movementTrips)")
                        overviewMetricRow("Movement places", "\(report.movementKnownPlaces)")
                    } else {
                        mutedBody("No successful sync receipt yet.")
                    }
                }
            }

            if let latestError = appModel.latestError {
                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("Latest error")
                        Text(latestError)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.destructive)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    private var movementContent: some View {
        VStack(spacing: 14) {
            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Movement capture")
                    overviewMetricRow("Tracking", appModel.movementStore.trackingEnabled ? "On" : "Off")
                    overviewMetricRow("Publish mode", appModel.movementStore.publishMode.replacingOccurrences(of: "_", with: " "))
                    overviewMetricRow("Retention", appModel.movementStore.retentionMode.replacingOccurrences(of: "_", with: " "))
                    overviewMetricRow("Known places", "\(appModel.movementStore.knownPlaces.count)")
                    overviewMetricRow("Stays", "\(appModel.movementStore.storedStays.count)")
                    overviewMetricRow("Trips", "\(appModel.movementStore.storedTrips.count)")
                    overviewMetricRow("Latest location", appModel.movementStore.latestLocationSummary)
                }
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    sectionTitle("Gap repair")
                    let repairDiagnostics = appModel.movementStore.recentRepairDiagnostics
                    if repairDiagnostics.isEmpty {
                        mutedBody("No repaired or missing movement spans have been synthesized recently.")
                    } else {
                        ForEach(repairDiagnostics, id: \.self) { entry in
                            Text(entry)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 2)
                        }
                    }
                }
            }

            let entities = movementEntities
            if entities.isEmpty {
                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("Movement timeline")
                        mutedBody("No stays or trips captured yet.")
                    }
                }
            } else {
                ForEach(entities) { entity in
                    CompanionSectionCard {
                        switch entity {
                        case .stay(let stay):
                            stayCard(stay)
                        case .trip(let trip):
                            tripCard(trip)
                        }
                    }
                }
            }
        }
    }

    private var logsContent: some View {
        VStack(spacing: 14) {
            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 10) {
                    sectionTitle("General logs")
                    overviewMetricRow("Entries", "\(logStore.entries.count)")
                    mutedBody("These logs are now persisted on-device for release and TestFlight builds, so you can copy them out of Settings without Xcode.")
                    Button {
                        copyLogsToPasteboard()
                    } label: {
                        Label("Copy diagnostic logs", systemImage: "doc.on.doc")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.accentStrong)
                    }
                    if let copyStatusMessage {
                        Text(copyStatusMessage)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .textSelection(.enabled)
                    }
                }
            }

            if logStore.entries.isEmpty {
                CompanionSectionCard {
                    mutedBody("No debug logs captured yet.")
                }
            } else {
                ForEach(logStore.entries) { entry in
                    CompanionSectionCard {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top, spacing: 10) {
                                Text(entry.scope)
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.accentStrong)
                                Spacer(minLength: 8)
                                Text(entry.formattedTimestamp)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textMuted)
                            }

                            Text(entry.message)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
        }
    }

    private var movementEntities: [MovementEntity] {
        let stays = appModel.movementStore.storedStays.map(MovementEntity.stay)
        let trips = appModel.movementStore.storedTrips.map(MovementEntity.trip)
        return (stays + trips).sorted { lhs, rhs in
            lhs.startedAt > rhs.startedAt
        }
    }

    private func stayCard(_ stay: MovementSyncStore.StoredStay) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(stay.placeLabel.isEmpty ? stay.label : stay.placeLabel, systemImage: "pause.circle.fill")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Spacer(minLength: 8)
                statusBadge(stay.status)
            }

            Text("\(timeRange(start: stay.startedAt, end: stay.endedAt)) · \(stay.classification)")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)

            overviewMetricRow("Samples", "\(stay.sampleCount)")
            overviewMetricRow("Radius", "\(Int(stay.radiusMeters.rounded())) m")
            overviewMetricRow(
                "Center",
                "\(stay.centerLatitude.formatted(.number.precision(.fractionLength(4)))), \(stay.centerLongitude.formatted(.number.precision(.fractionLength(4))))"
            )
        }
    }

    private func tripCard(_ trip: MovementSyncStore.StoredTrip) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(trip.label, systemImage: "figure.walk.motion")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Spacer(minLength: 8)
                statusBadge(trip.status)
            }

            Text("\(timeRange(start: trip.startedAt, end: trip.endedAt)) · \(trip.activityType.isEmpty ? trip.travelMode : trip.activityType)")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)

            overviewMetricRow("Distance", distanceLabel(trip.distanceMeters))
            overviewMetricRow("Moving time", durationLabel(seconds: trip.movingSeconds))
            overviewMetricRow("Stops", "\(trip.stops.count)")
            overviewMetricRow("Points", "\(trip.points.count)")
            overviewMetricRow(
                "Route",
                "\(trip.startPlaceExternalUid.isEmpty ? "Unknown start" : trip.startPlaceExternalUid) -> \(trip.endPlaceExternalUid.isEmpty ? "Unknown end" : trip.endPlaceExternalUid)"
            )
        }
    }

    private func overviewMetricRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 15, weight: .bold, design: .rounded))
            .foregroundStyle(CompanionStyle.textPrimary)
    }

    private func mutedBody(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(CompanionStyle.textSecondary)
    }

    private func statusBadge(_ value: String) -> some View {
        Text(value.replacingOccurrences(of: "_", with: " "))
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(CompanionStyle.accentStrong)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.white.opacity(0.08), in: Capsule())
    }

    private func timeRange(start: Date, end: Date) -> String {
        let formatter = DateIntervalFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: start, to: end)
    }

    private func durationLabel(seconds: Int) -> String {
        let minutes = max(0, seconds / 60)
        if minutes >= 60 {
            return "\(minutes / 60)h \(minutes % 60)m"
        }
        return "\(minutes)m"
    }

    private func distanceLabel(_ meters: Double) -> String {
        if meters >= 1000 {
            return "\(String(format: "%.1f", meters / 1000)) km"
        }
        return "\(Int(meters.rounded())) m"
    }

    private func copyLogsToPasteboard() {
        let renderedLogs = logStore.renderPlainText()
        UIPasteboard.general.string = renderedLogs
        copyStatusMessage = "Copied \(logStore.entries.count) diagnostic log entr\(logStore.entries.count == 1 ? "y" : "ies")."
        companionDebugLog(
            "CompanionDiagnostics",
            "copied diagnostic logs entries=\(logStore.entries.count)"
        )
    }
}

private enum DiagnosticsTab: String, CaseIterable, Identifiable {
    case overview
    case movement
    case logs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview:
            return "Overview"
        case .movement:
            return "Movement"
        case .logs:
            return "Logs"
        }
    }
}

private enum MovementEntity: Identifiable {
    case stay(MovementSyncStore.StoredStay)
    case trip(MovementSyncStore.StoredTrip)

    var id: String {
        switch self {
        case .stay(let stay):
            return "stay-\(stay.id)"
        case .trip(let trip):
            return "trip-\(trip.id)"
        }
    }

    var startedAt: Date {
        switch self {
        case .stay(let stay):
            return stay.startedAt
        case .trip(let trip):
            return trip.startedAt
        }
    }
}
