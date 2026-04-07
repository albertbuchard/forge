import SwiftUI

struct CompanionAppRoot: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    @State private var setupVisible = false

    var body: some View {
        ZStack {
            CompanionStyle.background

            if appModel.pairing == nil {
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
    }
}
