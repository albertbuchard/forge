import SwiftUI
import DeviceActivity

struct ScreenTimeSettingsSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @ObservedObject var screenTimeStore: ScreenTimeStore
    let close: () -> Void

    @State private var enabling = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    statusCard
                    liveReportCard
                    privacyCard
                }
                .padding(18)
            }
            .background(CompanionStyle.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("Screen Time")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: close)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
            }
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(screenTimeStore.enabled ? "Screen Time on" : "Screen Time off")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Spacer(minLength: 12)
                badge(screenTimeStore.captureFreshness.capitalized)
            }

            VStack(alignment: .leading, spacing: 10) {
                statusRow("Access", accessLabel)
                statusRow("Source", sourceLabel)
                statusRow("Latest", screenTimeStore.latestCaptureSummary)
                statusRow("Last sync", lastScreenTimeSyncLabel)
                statusRow("Last synced", lastScreenTimeSyncCountsLabel)
                statusRow("Hours synced", lastScreenTimeHoursLabel)
            }

            if screenTimeStore.enabled && screenTimeStore.authorizationStatus != "approved" {
                Button("Enable Screen Time") {
                    enabling = true
                    Task {
                        await screenTimeStore.enableAndAuthorize()
                        enabling = false
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(enabling || screenTimeStore.authorizationStatus == "unavailable")
            } else if screenTimeStore.enabled && screenTimeStore.authorizationStatus == "approved" {
                Button("Reload Report + Sync to Forge") {
                    enabling = true
                    Task {
                        await screenTimeStore.refreshCaptureNow()
                        await appModel.runManualSync()
                        enabling = false
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(enabling)
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    @ViewBuilder
    private var liveReportCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Live Report")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            if screenTimeStore.enabled == false {
                Text("Enable Screen Time to load the on-device report.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            } else if screenTimeStore.authorizationStatus != "approved" {
                Text("Authorize Screen Time access to render the report.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            } else if #available(iOS 16.0, *) {
                DeviceActivityReport(
                    .forgeHourlyScreenTime,
                    filter: DeviceActivityFilter(
                        segment: .hourly(during: rollingWeek),
                        users: .all,
                        devices: .all
                    )
                )
                .id(screenTimeStore.captureRefreshToken)
                .frame(minHeight: 320)
                .clipShape(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                )
            } else {
                Text("Live Screen Time reports require iOS 16 or later.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var privacyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Status")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            statusRow("Access", accessLabel)
            statusRow("Source", sourceLabel)
            statusRow("Availability", screenTimeStore.latestCaptureSummary)
            Text("Apple renders detailed Screen Time usage inside the Device Activity report extension. Forge extracts summarized day and hour data from that report and syncs it to the server once the snapshot is captured.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var accessLabel: String {
        if screenTimeStore.enabled == false {
            return "Off"
        }
        switch screenTimeStore.authorizationStatus {
        case "approved":
            return "Authorized"
        case "denied":
            return "Denied"
        case "unavailable":
            return "Unavailable"
        default:
            return "Not authorized"
        }
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private var lastScreenTimeSyncLabel: String {
        guard appModel.lastSuccessfulSyncAt != nil else {
            return "Never"
        }
        return appModel.lastSuccessfulSyncLabel
    }

    private var lastScreenTimeSyncCountsLabel: String {
        let report = appModel.latestSyncReport
        return "\(report?.screenTimeDaySummaries ?? 0) days · \(report?.screenTimeHourlySegments ?? 0) hourly slices"
    }

    private var lastScreenTimeHoursLabel: String {
        guard let report = appModel.latestSyncReport else {
            return "0 h"
        }
        let hours = Double(report.screenTimeTotalActivitySeconds) / 3600
        return "\(hours.formatted(.number.precision(.fractionLength(0...1)))) h"
    }

    private var sourceLabel: String {
        guard screenTimeStore.enabled else {
            return "Disabled"
        }
        return screenTimeStore.metadata["snapshot_source"] == "visible_report_ocr"
            ? "Visible report text extraction"
            : "On-device report extension"
    }

    private func chipWrap(title: String, items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
            HStack(spacing: 8) {
                ForEach(items, id: \.self) { item in
                    badge(item)
                }
            }
        }
    }

    private func badge(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(CompanionStyle.textPrimary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
    }

    private var rollingWeek: DateInterval {
        let end = Date()
        let start = Calendar.current.date(
            byAdding: .day,
            value: -6,
            to: Calendar.current.startOfDay(for: end)
        ) ?? end.addingTimeInterval(-6 * 24 * 60 * 60)
        return DateInterval(start: start, end: end)
    }
}
