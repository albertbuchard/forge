import SwiftUI

struct SetupPermissionsScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                CompanionIconButton(systemName: "xmark") {
                    companionDebugLog("SetupPermissionsScreen", "tap Close")
                    close()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 18) {
                Text("Authorize device signals")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Grant the companion access once, sync the essentials, then open Forge.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 12) {
                        statusRow("Status", "\(appModel.companionOperationalStatusLabel) · \(appModel.companionOperationalDetailLabel)")

                        ForEach(appModel.permissionGateStatusRows, id: \.id) { row in
                            statusRow(row.title, row.value)
                        }
                    }
                }

                Button {
                    companionDebugLog("SetupPermissionsScreen", "tap Authorize + Sync")
                    Task {
                        await appModel.requestCombinedPermissionsAndSync()
                    }
                }
                label: {
                    HStack(spacing: 10) {
                        if appModel.permissionSyncInFlight {
                            ProgressView()
                                .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                        }

                        Text(appModel.permissionSyncButtonLabel)
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(appModel.permissionSyncInFlight)

                if let progressDetail = appModel.permissionSyncProgressDetail {
                    HStack(spacing: 10) {
                        if appModel.permissionSyncInFlight {
                            ProgressView()
                                .tint(CompanionStyle.accentStrong)
                                .scaleEffect(0.82)
                        }

                        Text(progressDetail)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                    .padding(.horizontal, 4)
                    .transition(.opacity)
                }

                Button(appModel.permissionSyncInFlight ? "Continue without waiting" : "Continue to Forge") {
                    companionDebugLog(
                        "SetupPermissionsScreen",
                        "tap Continue to Forge status=\(appModel.companionOperationalStatusLabel)"
                    )
                    if appModel.healthSyncEnabled && appModel.healthAccessStatus == .notSet {
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
                "SetupPermissionsScreen",
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
