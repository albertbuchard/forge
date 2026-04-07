import SwiftUI

struct CompanionMenuSheet: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let reopenSetup: () -> Void
    let reloadForge: () -> Void
    let openMovementSettings: () -> Void
    let closeMenu: () -> Void

    @State private var syncing = false
    @State private var requestingHealth = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Forge Companion")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text(appModel.forgeHostLabel)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
            }

            VStack(alignment: .leading, spacing: 8) {
                statusRow("Connection", appModel.syncStateLabel)
                statusRow("Health", appModel.healthAccessLabel)
                statusRow("Movement", appModel.movementAccessLabel)
                statusRow("Watch", appModel.watchSyncLabel)
                statusRow("Last sync", appModel.latestImportSummary)
            }

            VStack(spacing: 10) {
                Button("Run sync now") {
                    companionDebugLog("CompanionMenuSheet", "tap Run sync now")
                    syncing = true
                    Task {
                        await appModel.runManualSync()
                        syncing = false
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(syncing || requestingHealth)

                Button("Request Health access") {
                    companionDebugLog("CompanionMenuSheet", "tap Request Health access")
                    requestingHealth = true
                    Task {
                        await appModel.requestHealthPermissions()
                        requestingHealth = false
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())
                .disabled(syncing || requestingHealth)

                Button("Movement settings") {
                    companionDebugLog("CompanionMenuSheet", "tap Movement settings")
                    closeMenu()
                    DispatchQueue.main.async {
                        openMovementSettings()
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())

                Button("Reload Forge") {
                    companionDebugLog("CompanionMenuSheet", "tap Reload Forge")
                    reloadForge()
                    closeMenu()
                }
                .buttonStyle(CompanionGhostButtonStyle())

                Button("Reconnect") {
                    companionDebugLog("CompanionMenuSheet", "tap Reconnect")
                    closeMenu()
                    DispatchQueue.main.async {
                        reopenSetup()
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())

                Button("Disconnect") {
                    companionDebugLog("CompanionMenuSheet", "tap Disconnect")
                    closeMenu()
                    DispatchQueue.main.async {
                        appModel.disconnect()
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle(destructive: true))
            }

            if let error = appModel.latestError {
                Text(error)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.destructive)
            }
        }
        .padding(18)
        .frame(width: 262, alignment: .leading)
        .background(CompanionStyle.sheetBackground(cornerRadius: 28))
        .shadow(color: Color.black.opacity(0.28), radius: 26, x: 0, y: 14)
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
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
}
