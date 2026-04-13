import SwiftUI

struct CompanionMenuSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let openSettings: () -> Void
    let openScreenTimeSettings: () -> Void
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
                }
            }

            VStack(spacing: 10) {
                actionButton("Life Timeline", systemName: "point.3.connected.trianglepath.dotted") {
                    companionDebugLog("CompanionMenuSheet", "tap Life Timeline")
                    closeMenu()
                    DispatchQueue.main.async {
                        openLifeTimeline()
                    }
                }

                actionButton("Screen Time", systemName: "hourglass.bottomhalf.filled") {
                    companionDebugLog("CompanionMenuSheet", "tap Screen Time")
                    closeMenu()
                    DispatchQueue.main.async {
                        openScreenTimeSettings()
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

    let reopenSetup: () -> Void
    let reloadForge: () -> Void
    let openDiagnostics: () -> Void
    let openMovementSettings: () -> Void
    let openScreenTimeSettings: () -> Void
    let close: () -> Void

    @State private var syncing = false
    @State private var authorizing = false

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    summaryCard
                    dataSourcesCard
                    permissionsCard
                    syncCard
                    screenTimeCard
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
                sectionHeader("Permissions", subtitle: "Read-only grant state from the phone. Use the switches above to decide what Forge should keep in sync.")

                detailRow("Health", value: appModel.healthAccessLabel)
                detailRow("Location", value: appModel.movementPermissionGateLabel)
                detailRow("Motion", value: appModel.movementStore.motionPermissionStatus)
                detailRow("Screen Time", value: appModel.screenTimePermissionGateLabel)

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
                sectionHeader("Data sources", subtitle: "One toggle per source. Off means no capture and no sync. On means Forge checks authorization and syncs when allowed.")

                sourceToggleRow(
                    title: "Health",
                    detail: "Sleep and workouts from Apple Health",
                    status: appModel.healthAccessLabel,
                    isOn: Binding(
                        get: { appModel.healthSyncEnabled },
                        set: { appModel.setSourceEnabled(.health, enabled: $0) }
                    )
                )

                sourceToggleRow(
                    title: "Movement",
                    detail: "Passive stays, trips, and place continuity",
                    status: appModel.movementAccessLabel,
                    isOn: Binding(
                        get: { appModel.movementStore.trackingEnabled },
                        set: { appModel.setSourceEnabled(.movement, enabled: $0) }
                    )
                )

                sourceToggleRow(
                    title: "Screen Time",
                    detail: "Daily and hourly device usage summaries",
                    status: appModel.screenTimeAccessLabel,
                    isOn: Binding(
                        get: { appModel.screenTimeStore.enabled },
                        set: { appModel.setSourceEnabled(.screenTime, enabled: $0) }
                    )
                )
            }
        }
    }

    private var syncCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Sync", subtitle: "Refresh the native signals and send a new payload to Forge.")

                detailRow("State", value: appModel.syncStateLabel)
                detailRow("Last sync", value: appModel.lastSuccessfulSyncLabel)
                detailRow("Last payload", value: appModel.latestImportSummary)

                Button {
                    syncing = true
                    Task {
                        await appModel.runManualSync()
                        syncing = false
                    }
                }
                label: {
                    HStack(spacing: 10) {
                        if syncing {
                            ProgressView()
                                .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                        }

                        Text(syncing ? "Syncing now…" : "Run sync now")
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(authorizing || syncing)
            }
        }
    }

    private var screenTimeCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Screen Time", subtitle: "Status and recent capture history. The actual on or off decision now lives in Data sources.")

                detailRow("Access", value: appModel.screenTimeAccessLabel)
                detailRow("Capture", value: appModel.screenTimeStore.latestCaptureSummary)
                detailRow("Freshness", value: appModel.screenTimeStore.freshnessSummary)

                Button("Open Screen Time details") {
                    close()
                    DispatchQueue.main.async {
                        openScreenTimeSettings()
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())
            }
        }
    }

    private var movementCard: some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                sectionHeader("Movement", subtitle: "Known places, publish mode, and capture heuristics.")

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
                sectionHeader("Tools", subtitle: "Troubleshooting and setup actions.")

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

                toolButton("Reload Forge") {
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
