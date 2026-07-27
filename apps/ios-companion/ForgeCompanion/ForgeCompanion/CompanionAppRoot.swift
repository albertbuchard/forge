import SwiftUI

struct CompanionAppRoot: View {
    @EnvironmentObject private var appModel: CompanionAppModel
    @EnvironmentObject private var peoplePeerStore: PeoplePeerStore
    @Environment(\.scenePhase) private var scenePhase

    @State private var setupVisible = false

    var body: some View {
        ZStack {
            CompanionStyle.background

            if appModel.screenshotScenario?.usesDirectSetupFlow == true {
                CompanionSetupFlow(onFinish: {})
                    .environmentObject(appModel)
            } else if appModel.pairing == nil {
                UnpairedHeroScreen(
                    recoveryMessage: appModel.pairingRecoveryRequired
                        ? "This device’s Forge authorization ended. Pair again once to resume background sync."
                        : nil
                ) {
                    setupVisible = true
                }
            } else {
                PairedForgeScreen {
                    setupVisible = true
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .fullScreenCover(isPresented: $setupVisible) {
            CompanionSetupFlow {
                setupVisible = false
            }
            .environmentObject(appModel)
        }
        .onAppear {
            peoplePeerStore.configureWatchRelay { snapshot in
                appModel.watchSessionManager.updatePeopleGlance(
                    snapshot,
                    pairingSessionId: appModel.pairing?.sessionId
                )
            }
            peoplePeerStore.configure(
                pairing: appModel.pairing,
                ownerUserId: appModel.pairingOwnerUserId
            )
            Task { await peoplePeerStore.refreshWatchGlance() }
            companionDebugLog(
                "CompanionAppRoot",
                "onAppear pairing=\(appModel.pairing?.sessionId ?? "nil") setupVisible=\(setupVisible)"
            )
        }
        .onChange(of: setupVisible) { _, nextValue in
            companionDebugLog("CompanionAppRoot", "setupVisible -> \(nextValue)")
        }
        .onChange(of: appModel.pairing?.sessionId) { _, sessionId in
            peoplePeerStore.configure(
                pairing: appModel.pairing,
                ownerUserId: appModel.pairingOwnerUserId
            )
            Task { await peoplePeerStore.refreshWatchGlance() }
            companionDebugLog("CompanionAppRoot", "pairing session changed -> \(sessionId ?? "nil")")
        }
        .onChange(of: appModel.pairingRecoveryRequired) { _, required in
            if required {
                setupVisible = true
            }
        }
        .onChange(of: appModel.pairingOwnerUserId) { _, ownerUserId in
            peoplePeerStore.configure(
                pairing: appModel.pairing,
                ownerUserId: ownerUserId
            )
            Task { await peoplePeerStore.refreshWatchGlance() }
        }
        .onOpenURL { url in
            peoplePeerStore.handleDeepLink(url)
        }
        .onChange(of: scenePhase) { _, nextPhase in
            companionDebugLog("CompanionAppRoot", "scenePhase -> \(String(describing: nextPhase))")
            if nextPhase == .active {
                appModel.handleAppDidBecomeActive()
                peoplePeerStore.sceneDidBecomeActive()
            } else if nextPhase == .inactive || nextPhase == .background {
                appModel.handleAppWillLeaveForeground()
                peoplePeerStore.sceneDidLeaveForeground()
            }
        }
    }
}
