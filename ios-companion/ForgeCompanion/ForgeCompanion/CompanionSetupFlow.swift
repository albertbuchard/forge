import SwiftUI

private enum CompanionSetupStep {
    case discovery
    case qr
    case manual
    case health
}

struct CompanionSetupFlow: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @Environment(\.dismiss) private var dismiss

    let onFinish: () -> Void

    @State private var step: CompanionSetupStep = .discovery

    var body: some View {
        ZStack {
            CompanionStyle.background

            switch step {
            case .discovery:
                SetupDiscoveryScreen(
                    openQR: { step = .qr },
                    openManual: { step = .manual },
                    openHealth: { step = .health },
                    close: finish
                )
            case .qr:
                SetupQRScreen(
                    goBack: { step = .discovery },
                    openHealth: { step = .health }
                )
            case .manual:
                SetupManualScreen(
                    goBack: { step = .discovery },
                    openHealth: { step = .health }
                )
            case .health:
                SetupPermissionsScreen(
                    close: finish
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if appModel.pairing != nil {
                step = .health
            }
            companionDebugLog("CompanionSetupFlow", "onAppear step=\(String(describing: step))")
        }
        .onChange(of: step) { _, nextStep in
            companionDebugLog("CompanionSetupFlow", "step -> \(String(describing: nextStep))")
        }
        .onChange(of: appModel.pairing?.sessionId) { _, sessionId in
            companionDebugLog(
                "CompanionSetupFlow",
                "pairing session changed -> \(sessionId ?? "nil")"
            )
            if sessionId != nil {
                step = .health
            } else {
                step = .discovery
            }
        }
    }

    private func finish() {
        companionDebugLog("CompanionSetupFlow", "finish")
        onFinish()
        dismiss()
    }
}
