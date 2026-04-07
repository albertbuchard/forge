import SwiftUI

@main
struct ForgeWatch_Watch_AppApp: App {
    @StateObject private var appModel = WatchAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appModel)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                appModel.consumePendingLaunchDestination()
                appModel.flushPendingActions()
            }
        }
    }
}
