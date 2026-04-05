import SwiftUI

struct SetupHealthScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let close: () -> Void

    @State private var requesting = false

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
                Text("Health access")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Allow HealthKit to import sleep and workouts.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(appModel.healthAccessLabel)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)

                        Text(appModel.syncStateLabel)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }
                }

                Button("Request Health access") {
                    companionDebugLog("SetupHealthScreen", "tap Request Health access")
                    requesting = true
                    Task {
                        await appModel.requestHealthPermissions()
                        requesting = false
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(requesting)

                Button("Continue to Forge") {
                    companionDebugLog(
                        "SetupHealthScreen",
                        "tap Continue to Forge healthAccessStatus=\(appModel.healthAccessStatus.rawValue)"
                    )
                    if appModel.healthAccessStatus == .notSet {
                        appModel.deferHealthPermissionPrompt()
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
        }
    }
}
