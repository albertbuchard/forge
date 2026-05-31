import SwiftUI

struct CompanionSyncActivityIndicator: View {
    let size: CGFloat
    let color: Color

    @State private var isRotating = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.18), lineWidth: 2)
            Circle()
                .trim(from: 0.08, to: 0.76)
                .stroke(
                    color,
                    style: StrokeStyle(lineWidth: 2.4, lineCap: .round)
                )
                .rotationEffect(.degrees(isRotating ? 360 : 0))
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) {
                isRotating = true
            }
        }
    }
}

struct CompanionHistoricalWorkoutImportPresentation {
    let status: CompanionSyncUploadStatus

    private var progress: HistoricalWorkoutImportStatus? {
        status.historicalWorkoutImport
    }

    var title: String {
        "Workout history import"
    }

    var subtitle: String {
        status.message ?? "Historical heart-rate and route evidence"
    }

    var stateLabel: String {
        if status.isSyncing {
            return "Syncing"
        }
        if status.isHistoricalWorkoutImport {
            return "Ready"
        }
        return "Paused"
    }

    var progressFraction: Double {
        progress?.progressFraction ?? 0
    }

    var progressLabel: String {
        guard let progress else {
            return "Indexing the full workout library"
        }
        if let total = progress.totalWorkouts {
            let completed = progress.completedWorkoutSummaries
            return "\(formatCount(completed))/\(formatCount(total)) workouts accounted for - \(formatCount(progress.remainingWorkouts ?? 0)) left"
        }
        return "\(formatCount(progress.indexedWorkouts)) workouts indexed"
    }

    var compactProgressLabel: String {
        guard let progress else {
            return "Indexing the full workout library"
        }
        let workouts = progress.totalWorkouts.map {
            "\(formatCount(progress.completedWorkoutSummaries))/\(formatCount($0)) workouts"
        } ?? "\(formatCount(progress.indexedWorkouts)) workouts indexed"
        return "\(workouts) - \(formatCount(progress.uploadedTimeSeriesSamples)) time-series - \(formatCount(progress.uploadedRoutePoints)) routes"
    }

    var foundLabel: String {
        guard let progress else {
            return "Counting workouts"
        }
        if let total = progress.totalWorkouts {
            return "\(formatCount(total)) total workouts"
        }
        return "\(formatCount(progress.indexedWorkouts)) found so far"
    }

    var uploadedLabel: String {
        guard let progress else {
            return "Waiting for first workout chunk"
        }
        var parts = ["\(formatCount(progress.completedWorkoutSummaries)) workouts"]
        if progress.uploadedChunks > 0 {
            parts.append("\(formatCount(progress.uploadedChunks)) chunks")
        }
        if progress.resumedChunks > 0 {
            parts.append("\(formatCount(progress.resumedChunks)) resumed")
        }
        return parts.joined(separator: " - ")
    }

    var evidenceLabel: String {
        guard let progress else {
            return "Waiting for HR and metric evidence"
        }
        let target = progress.targetTimeSeriesSamples > 0
            ? " / \(formatCount(progress.targetTimeSeriesSamples))"
            : ""
        return "\(formatCount(progress.uploadedTimeSeriesSamples))\(target) time-series - \(formatCount(progress.targetHeartRateSamples)) HR"
    }

    var routeLabel: String {
        guard let progress else {
            return "Waiting for route evidence"
        }
        let target = progress.targetRoutePoints > 0
            ? " / \(formatCount(progress.targetRoutePoints))"
            : ""
        return "\(formatCount(progress.uploadedRoutePoints))\(target) route points"
    }

    var heartRateMetricLabel: String {
        formatCount(progress?.targetHeartRateSamples ?? 0)
    }

    var seriesMetricLabel: String {
        formatCount(progress?.uploadedTimeSeriesSamples ?? 0)
    }

    var routeMetricLabel: String {
        formatCount(progress?.uploadedRoutePoints ?? 0)
    }

    private func formatCount(_ value: Int) -> String {
        let sign = value < 0 ? "-" : ""
        let digits = String(abs(value))
        let groupedReversed = digits.reversed().enumerated().flatMap { index, character -> [Character] in
            if index > 0, index % 3 == 0 {
                return [",", character]
            }
            return [character]
        }
        return sign + String(groupedReversed.reversed())
    }
}

enum CompanionHistoricalWorkoutImportPanelStyle {
    case compact
    case settings
}

struct CompanionHistoricalWorkoutImportPanel: View {
    let status: CompanionSyncUploadStatus
    var style: CompanionHistoricalWorkoutImportPanelStyle = .settings
    var syncInFlight: Bool

    private var presentation: CompanionHistoricalWorkoutImportPresentation {
        CompanionHistoricalWorkoutImportPresentation(status: status)
    }

    var body: some View {
        switch style {
        case .compact:
            compactPanel
        case .settings:
            settingsPanel
        }
    }

    private var compactPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            header(iconSize: 30, titleSize: 12, subtitleSize: 10, showsBadge: false)

            progressBar(height: 7)

            Text(presentation.compactProgressLabel)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(CompanionStyle.accent.opacity(0.14))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(CompanionStyle.accentStrong.opacity(0.18), lineWidth: 1)
                )
        )
        .historicalImportProgressAnimations(status.historicalWorkoutImport)
    }

    private var settingsPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            header(iconSize: 30, titleSize: 14, subtitleSize: 11, showsBadge: true)

            VStack(alignment: .leading, spacing: 6) {
                progressBar(height: 8)

                Text(presentation.progressLabel)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                metricRow("Found", value: presentation.foundLabel, systemName: "figure.run")
                metricRow("Uploaded", value: presentation.uploadedLabel, systemName: "arrow.up.circle")
                metricRow("Evidence", value: presentation.evidenceLabel, systemName: "waveform.path.ecg")
                metricRow("Routes", value: presentation.routeLabel, systemName: "map")
                if let speedSummary = status.speedSummary {
                    metricRow("Speed", value: speedSummary, systemName: "speedometer")
                }
                metricRow("Transfer", value: status.transferSummary, systemName: "externaldrive")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            CompanionStyle.accent.opacity(0.18),
                            Color.white.opacity(0.045)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(CompanionStyle.accentStrong.opacity(0.18), lineWidth: 1)
                )
        )
        .historicalImportProgressAnimations(status.historicalWorkoutImport)
    }

    private func header(
        iconSize: CGFloat,
        titleSize: CGFloat,
        subtitleSize: CGFloat,
        showsBadge: Bool
    ) -> some View {
        HStack(alignment: .center, spacing: 10) {
            ZStack {
                Circle()
                    .fill(CompanionStyle.accentStrong.opacity(0.18))
                if syncInFlight {
                    CompanionSyncActivityIndicator(size: iconSize * 0.68, color: CompanionStyle.accentStrong)
                } else {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: iconSize * 0.46, weight: .bold))
                        .foregroundStyle(CompanionStyle.accentStrong)
                }
            }
            .frame(width: iconSize, height: iconSize)

            VStack(alignment: .leading, spacing: 2) {
                Text(presentation.title)
                    .font(.system(size: titleSize, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                Text(presentation.subtitle)
                    .font(.system(size: subtitleSize, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            if showsBadge {
                Text(presentation.stateLabel)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(CompanionStyle.accentStrong, in: Capsule())
            }
        }
    }

    private func progressBar(height: CGFloat) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.10))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [
                                CompanionStyle.accentStrong,
                                Color(red: 0.39, green: 0.84, blue: 0.66)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(8, proxy.size.width * presentation.progressFraction))
            }
        }
        .frame(height: height)
    }

    private func metricRow(
        _ label: String,
        value: String,
        systemName: String
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(CompanionStyle.accentStrong)
                .frame(width: 15)

            Text(label)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)

            Spacer(minLength: 8)

            Text(value)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private extension View {
    func historicalImportProgressAnimations(_ progress: HistoricalWorkoutImportStatus?) -> some View {
        animation(.easeInOut(duration: 0.22), value: progress?.completedWorkoutSummaries ?? 0)
            .animation(.easeInOut(duration: 0.22), value: progress?.uploadedTimeSeriesSamples ?? 0)
            .animation(.easeInOut(duration: 0.22), value: progress?.uploadedRoutePoints ?? 0)
    }
}
