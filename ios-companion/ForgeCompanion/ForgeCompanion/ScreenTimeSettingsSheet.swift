import SwiftUI

struct ScreenTimeSettingsSheet: View {
    @ObservedObject var screenTimeStore: ScreenTimeStore
    let close: () -> Void

    @State private var enabling = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    statusCard
                    previewCard
                    historyCard
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
                statusRow("Source", screenTimeStore.enabled ? "Enabled" : "Disabled")
                statusRow("Latest", screenTimeStore.latestCaptureSummary)
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
                Button(screenTimeStore.readyForSync ? "Refresh Screen Time" : "Fetch First Snapshot") {
                    enabling = true
                    Task {
                        await screenTimeStore.refreshCaptureNow()
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

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Preview")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            statusRow("Days", "\(screenTimeStore.capturedDayCount)")
            statusRow("Hourly slices", "\(screenTimeStore.capturedHourCount)")
            statusRow("Freshness", screenTimeStore.freshnessSummary)

            if screenTimeStore.topAppsPreview.isEmpty == false {
                chipWrap(title: "Apps", items: screenTimeStore.topAppsPreview)
            }
            if screenTimeStore.topCategoriesPreview.isEmpty == false {
                chipWrap(title: "Categories", items: screenTimeStore.topCategoriesPreview)
            }
        }
        .padding(18)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
    }

    private var historyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("History")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            if screenTimeStore.recentDayHistory.isEmpty {
                Text("No captured days yet.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            } else {
                ForEach(screenTimeStore.recentDayHistory) { day in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(shortDayLabel(day.dateKey))
                                .font(.system(size: 15, weight: .semibold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)
                            Spacer()
                            Text(formatDuration(day.totalActivitySeconds))
                                .font(.system(size: 13, weight: .semibold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                        }

                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: 999, style: .continuous)
                                .fill(Color.white.opacity(0.06))
                                .overlay(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 999, style: .continuous)
                                        .fill(CompanionStyle.accent.opacity(0.85))
                                        .frame(width: max(10, proxy.size.width * barFraction(for: day)))
                                }
                        }
                        .frame(height: 8)

                        HStack(spacing: 10) {
                            miniMeta("\(day.pickupCount)", "pickups")
                            miniMeta("\(day.notificationCount)", "alerts")
                            if let firstApp = day.topAppBundleIdentifiers.first {
                                miniMeta(prettyBundleName(firstApp), "top app")
                            }
                        }
                    }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(Color.white.opacity(0.05))
                            .overlay(
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                }
            }
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

    private func miniMeta(_ value: String, _ label: String) -> some View {
        HStack(spacing: 4) {
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
            Text(label)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }

    private func barFraction(for day: ForgeScreenTimeDaySummarySnapshot) -> CGFloat {
        guard let peak = screenTimeStore.recentDayHistory.map(\.totalActivitySeconds).max(), peak > 0 else {
            return 0.2
        }
        return CGFloat(Double(day.totalActivitySeconds) / Double(peak))
    }

    private func shortDayLabel(_ dateKey: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateKey) else {
            return dateKey
        }
        formatter.dateFormat = "EEE d MMM"
        return formatter.string(from: date)
    }

    private func prettyBundleName(_ bundle: String) -> String {
        bundle.split(separator: ".").last.map(String.init)?.capitalized ?? bundle
    }
}
