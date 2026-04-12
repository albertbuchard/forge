import SwiftUI

struct CompanionAppRoot: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var setupVisible = false

    var body: some View {
        ZStack {
            CompanionStyle.background

            if appModel.screenshotScenario?.usesDirectSetupFlow == true {
                CompanionSetupFlow(onFinish: {})
                    .environmentObject(appModel)
            } else if appModel.pairing == nil {
                UnpairedHeroScreen {
                    setupVisible = true
                }
            } else {
                PairedForgeScreen {
                    setupVisible = true
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if #available(iOS 16.0, *) {
                ScreenTimeCaptureHost(screenTimeStore: appModel.screenTimeStore)
            }
        }
        .fullScreenCover(isPresented: $setupVisible) {
            CompanionSetupFlow {
                setupVisible = false
            }
            .environmentObject(appModel)
        }
        .onAppear {
            companionDebugLog(
                "CompanionAppRoot",
                "onAppear pairing=\(appModel.pairing?.sessionId ?? "nil") setupVisible=\(setupVisible)"
            )
        }
        .onChange(of: setupVisible) { _, nextValue in
            companionDebugLog("CompanionAppRoot", "setupVisible -> \(nextValue)")
        }
        .onChange(of: appModel.pairing?.sessionId) { _, sessionId in
            companionDebugLog("CompanionAppRoot", "pairing session changed -> \(sessionId ?? "nil")")
        }
        .onChange(of: scenePhase) { _, nextPhase in
            companionDebugLog("CompanionAppRoot", "scenePhase -> \(String(describing: nextPhase))")
            if nextPhase == .active {
                appModel.handleAppDidBecomeActive()
            }
        }
    }
}
