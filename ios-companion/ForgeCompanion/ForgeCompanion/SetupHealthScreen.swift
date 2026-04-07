import SwiftUI

struct SetupHealthScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let close: () -> Void

    @State private var requesting = false
    @State private var requestingMovement = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                CompanionIconButton(systemName: "xmark") {
                    companionDebugLog("SetupHealthScreen", "tap Close")
                    close()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 18) {
                Text("Device permissions")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Grant HealthKit and passive location before opening Forge so sleep, workouts, stays, and trips can sync truthfully.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 12) {
                        statusRow("Health", appModel.healthAccessLabel)
                        statusRow("Location", appModel.movementStore.locationPermissionStatus.replacingOccurrences(of: "_", with: " "))
                        statusRow("Background", appModel.movementStore.backgroundTrackingReady ? "ready" : "not ready")
                        statusRow("Sync", appModel.syncStateLabel)
                    }
                }

                Button("Grant recommended permissions") {
                    companionDebugLog("SetupHealthScreen", "tap Grant recommended permissions")
                    requesting = true
                    Task {
                        await appModel.requestRecommendedPermissions()
                        requesting = false
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(requesting || requestingMovement)

                Button("Request Health access") {
                    companionDebugLog("SetupHealthScreen", "tap Request Health access")
                    requesting = true
                    Task {
                        await appModel.requestHealthPermissions()
                        requesting = false
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())
                .disabled(requesting || requestingMovement)

                Button("Request passive location") {
                    companionDebugLog("SetupHealthScreen", "tap Request passive location")
                    requestingMovement = true
                    appModel.requestMovementPermissions()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        requestingMovement = false
                    }
                }
                .buttonStyle(CompanionGhostButtonStyle())
                .disabled(requesting || requestingMovement)

                Button("Continue to Forge") {
                    companionDebugLog(
                        "SetupHealthScreen",
                        "tap Continue to Forge healthAccessStatus=\(appModel.healthAccessStatus.rawValue) locationStatus=\(appModel.movementStore.locationPermissionStatus)"
                    )
                    if appModel.healthAccessStatus == .notSet {
                        appModel.deferHealthPermissionPrompt()
                    }
                    if appModel.movementStore.locationPermissionStatus == "not_determined" {
                        appModel.deferMovementPermissionPrompt()
                    }
                    close()
                }
                .buttonStyle(CompanionGhostButtonStyle())

                if let error = appModel.latestError {
                    Text(error)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.destructive)
                }
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 34)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            companionDebugLog(
                "SetupHealthScreen",
                "onAppear healthAccessStatus=\(appModel.healthAccessStatus.rawValue) syncState=\(appModel.syncState.rawValue)"
            )
            Task {
                await appModel.refreshHealthAccessStatus()
            }
        }
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textMuted)

            Spacer(minLength: 8)

            Text(value)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(CompanionStyle.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }
}
