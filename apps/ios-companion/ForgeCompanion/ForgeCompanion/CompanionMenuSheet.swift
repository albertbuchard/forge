import SwiftUI
import UIKit

struct CompanionMenuSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let openSettings: () -> Void
    let openLifeTimeline: () -> Void
    let closeMenu: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Companion")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text(appModel.forgeHostLabel)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
                    .lineLimit(1)
            }

            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 12) {
                    compactStatusRow(
                        "Status",
                        value: appModel.companionOperationalStatusLabel,
                        detail: appModel.companionOperationalDetailLabel
                    )
                    compactStatusRow("Last sync", value: appModel.lastSuccessfulSyncLabel)
                    if let attention = appModel.watchSessionManager.latestBootstrap.inbox?.attention {
                        compactStatusRow(
                            "Attention",
                            value: attention.activeCount == 0 ? "Clear" : "\(attention.activeCount) active",
                            detail: attention.items.first?.title
                        )
                    }
                }
            }

            if appModel.syncUploadStatus.shouldShowHistoricalWorkoutImportPanel {
                CompanionHistoricalWorkoutImportPanel(
                    status: appModel.syncUploadStatus,
                    style: .compact,
                    syncInFlight: appModel.syncUploadStatus.isSyncing
                )
            }

            VStack(spacing: 10) {
                actionButton("Life Timeline", systemName: "point.3.connected.trianglepath.dotted") {
                    companionDebugLog("CompanionMenuSheet", "tap Life Timeline")
                    closeMenu()
                    DispatchQueue.main.async {
                        openLifeTimeline()
                    }
                }

                actionButton("Settings", systemName: "slider.horizontal.3") {
                    companionDebugLog("CompanionMenuSheet", "tap Settings")
                    closeMenu()
                    DispatchQueue.main.async {
                        openSettings()
                    }
                }

                actionButton("Disconnect", systemName: "bolt.slash", destructive: true) {
                    companionDebugLog("CompanionMenuSheet", "tap Disconnect")
                    closeMenu()
                    DispatchQueue.main.async {
                        appModel.disconnect()
                    }
                }
            }

            if let error = appModel.latestError, error.isEmpty == false {
                Text(error)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.destructive)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(width: 248, alignment: .leading)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
        .shadow(color: Color.black.opacity(0.28), radius: 26, x: 0, y: 14)
    }

    private func compactStatusRow(
        _ label: String,
        value: String,
        detail: String? = nil
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 10) {
                Text(label)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)

                Spacer(minLength: 8)

                if label == "Status" {
                    statusBadge(value)
                } else {
                    Text(value)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)
                        .multilineTextAlignment(.trailing)
                }
            }

            if let detail, detail.isEmpty == false {
                Text(detail)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            }
        }
    }

    private func statusBadge(_ label: String) -> some View {
        let fill: Color
        switch appModel.companionOperationalSummary.status {
        case .ok:
            fill = Color(red: 0.35, green: 0.8, blue: 0.56)
        case .warning:
            fill = Color(red: 1, green: 0.75, blue: 0.34)
        case .error:
            fill = CompanionStyle.destructive
        }

        return Text(label)
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 10 / 255, green: 18 / 255, blue: 34 / 255))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(fill, in: Capsule())
    }

    private func actionButton(
        _ title: String,
        systemName: String,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemName)
                    .font(.system(size: 13, weight: .bold))
                    .frame(width: 18)

                Text(title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))

                Spacer(minLength: 8)
            }
            .foregroundStyle(destructive ? CompanionStyle.destructive : CompanionStyle.textPrimary)
        }
        .buttonStyle(CompanionGhostButtonStyle(destructive: destructive))
    }
}

struct CompanionSettingsSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @ObservedObject private var debugLogStore = CompanionDebugLogStore.shared

    let reopenSetup: () -> Void
    let reloadForge: () -> Void
    let openDiagnostics: () -> Void
    let openMovementSettings: () -> Void
    let close: () -> Void

    @State private var syncing = false
    @State private var authorizing = false
    @State private var syncLogsExpanded = false
    @State private var logCopyConfirmation: String?

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    summaryCard
                    dataSourcesCard
                    permissionsCard
                    syncCard
                    movementCard
                    toolsCard
                }
                .padding(18)
            }
            .background(CompanionStyle.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("Settings")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
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

    private var summaryCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Companion status")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text(appModel.companionOperationalStatusLabel)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text(appModel.companionOperationalDetailLabel)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                if let latestError = appModel.latestError, latestError.isEmpty == false {
                    Text(latestError)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var permissionsCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Permissions", subtitle: "Check whether iOS currently allows Forge to read HealthKit, location, and motion data.")

                detailRow("Health", value: appModel.healthAccessLabel)
                detailRow("Location", value: appModel.movementPermissionGateLabel)
                detailRow("Motion", value: appModel.movementStore.motionPermissionStatus)

                Button {
                    authorizing = true
                    Task {
                        await appModel.requestCombinedPermissionsAndSync()
                        authorizing = false
                    }
                }
                label: {
                    HStack(spacing: 10) {
                        if authorizing || appModel.permissionSyncInFlight {
                            ProgressView()
                                .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                        }

                        Text(authorizing || appModel.permissionSyncInFlight ? appModel.permissionSyncButtonLabel : "Authorize + Sync")
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(authorizing || syncing)

                if let progressDetail = appModel.permissionSyncProgressDetail,
                   authorizing || appModel.permissionSyncInFlight
                {
                    detailRow("Progress", value: progressDetail)
                }
            }
        }
    }

    private var dataSourcesCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Data sources", subtitle: "Choose which phone signals Forge may capture and upload during sync.")

                sourceToggleRow(
                    title: "Health",
                    detail: "Sleep, vitals, workouts, routes, and heart-rate evidence from Apple Health.",
                    status: appModel.healthAccessLabel,
                    isOn: Binding(
                        get: { appModel.healthSyncEnabled },
                        set: { appModel.setSourceEnabled(.health, enabled: $0) }
                    )
                )

                sourceToggleRow(
                    title: "Movement",
                    detail: "Background stays, trips, known places, and gaps that explain where days happened.",
                    status: appModel.movementAccessLabel,
                    isOn: Binding(
                        get: { appModel.movementStore.trackingEnabled },
                        set: { appModel.setSourceEnabled(.movement, enabled: $0) }
                    )
                )
            }
        }
    }

    private var syncCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Sync", subtitle: "Send the latest phone data to Forge and resume unfinished HealthKit evidence uploads.")

                detailRow("State", value: appModel.syncStateLabel)
                detailRow("Last sync", value: appModel.lastSuccessfulSyncLabel)
                detailRow("Last payload", value: appModel.latestImportSummary)
                syncStatusPanel
                syncLogDisclosure

                Button {
                    syncing = true
                    Task {
                        defer {
                            syncing = false
                        }
                        await appModel.runManualSync()
                    }
                }
                label: {
                    HStack(spacing: 10) {
                        if syncInFlight {
                            CompanionSyncActivityIndicator(
                                size: 17,
                                color: Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255)
                            )
                        }

                        Text(syncInFlight ? "Syncing now…" : "Run sync now")
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(authorizing || syncInFlight)
            }
        }
    }

    private var syncInFlight: Bool {
        syncing || appModel.syncUploadStatus.isSyncing
    }

    @ViewBuilder
    private var syncStatusPanel: some View {
        let status = appModel.syncUploadStatus
        if status.shouldShowHistoricalWorkoutImportPanel {
            CompanionHistoricalWorkoutImportPanel(
                status: status,
                style: .settings,
                syncInFlight: syncInFlight
            )
        } else {
            standardSyncStatusPanel(status)
        }
    }

    private func standardSyncStatusPanel(_ status: CompanionSyncUploadStatus) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                if syncInFlight {
                    CompanionSyncActivityIndicator(size: 18, color: CompanionStyle.accentStrong)
                } else {
                    Image(systemName: appModel.latestError == nil ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(appModel.latestError == nil ? CompanionStyle.accentStrong : CompanionStyle.destructive)
                }

                Text(status.headline)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            detailRow(syncInFlight ? "Uploading" : "Prepared", value: status.uploadSummary)
            if let pipelineSummary = status.pipelineSummary {
                detailRow("Pipeline", value: pipelineSummary)
            }
            if let speedSummary = status.speedSummary {
                detailRow("Speed", value: speedSummary)
            }
            if let bridgeTimingSummary = status.bridgeTimingSummary {
                detailRow("Transport", value: bridgeTimingSummary)
            }
            if let forgeProcessingSummary = status.forgeProcessingSummary {
                detailRow("Forge", value: forgeProcessingSummary)
            }
            detailRow("Transfer", value: status.transferSummary)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.045))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.07), lineWidth: 1)
                )
        )
    }

    private var syncLogDisclosure: some View {
        DisclosureGroup(isExpanded: $syncLogsExpanded) {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    let exportText = debugLogStore.renderPlainText()
                    UIPasteboard.general.string = exportText
                    logCopyConfirmation = "Copied \(debugLogStore.entries.count) log lines"
                    companionDebugLog("CompanionSettingsSheet", "copy sync diagnostics logs count=\(debugLogStore.entries.count)")
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Copy logs")
                        Spacer(minLength: 8)
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())

                if let logCopyConfirmation {
                    Text(logCopyConfirmation)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.accentStrong)
                }

                ForEach(syncLogPreviewEntries) { entry in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(entry.formattedTimestamp) • \(entry.scope)")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textMuted)
                        Text(entry.message)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(entry.level == .error ? CompanionStyle.destructive : CompanionStyle.textSecondary)
                            .lineLimit(3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.top, 10)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "list.bullet.rectangle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(CompanionStyle.accentStrong)
                    .frame(width: 18)

                Text("Sync logs")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Spacer(minLength: 8)

                Text("\(debugLogStore.entries.count)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
            }
        }
        .tint(CompanionStyle.textPrimary)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.035))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.06), lineWidth: 1)
                )
        )
    }

    private var syncLogPreviewEntries: [CompanionDebugLogEntry] {
        Array(
            debugLogStore.entries
                .filter { entry in
                    entry.scope == "CompanionAppModel" ||
                        entry.scope == "ForgeSyncClient" ||
                        entry.scope == "HealthSyncStore" ||
                        entry.message.localizedCaseInsensitiveContains("sync")
                }
                .prefix(6)
        )
    }

    private var movementCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Movement", subtitle: "Tune how the phone turns location samples into stays, trips, and known places.")

                detailRow("Capture", value: appModel.movementStore.captureSummary)
                detailRow("Latest", value: appModel.movementStore.latestLocationSummary)
                detailRow("Known places", value: "\(appModel.movementStore.knownPlaces.count)")

                Button("Open movement settings") {
                    close()
                    DispatchQueue.main.async {
                        openMovementSettings()
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())
            }
        }
    }

    private var toolsCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Tools", subtitle: "Use these when pairing, diagnostics, or the embedded Forge web app need manual attention.")

                toolButton("Diagnostics") {
                    close()
                    DispatchQueue.main.async {
                        openDiagnostics()
                    }
                }

                toolButton("Reopen setup") {
                    close()
                    DispatchQueue.main.async {
                        reopenSetup()
                    }
                }

                toolButton("Refresh Forge cache") {
                    reloadForge()
                    close()
                }
            }
        }
    }

    private func sectionHeader(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)

            Text(subtitle)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)

            Spacer(minLength: 8)

            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func sourceToggleRow(
        title: String,
        detail: String,
        status: String,
        isOn: Binding<Bool>
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)

                    Text(detail)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Toggle("", isOn: isOn)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .tint(CompanionStyle.accentStrong)
            }

            detailRow("Status", value: status)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.06), lineWidth: 1)
                )
        )
    }

    private func toolButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(CompanionGhostButtonStyle())
    }
}
