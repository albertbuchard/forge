import SwiftUI

@main
struct ForgeWatch_Watch_AppApp: App {
    @StateObject private var appModel: WatchAppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let previewMode = arguments.contains("--forge-watch-preview")
        let model = WatchAppModel(preview: previewMode)
        if let surfaceArgument = arguments.first(where: { $0.hasPrefix("--forge-watch-surface=") }) {
            let rawValue = surfaceArgument.replacingOccurrences(of: "--forge-watch-surface=", with: "")
            model.selectedSurface = WatchSurface(rawValue: rawValue) ?? model.selectedSurface
        }
        _appModel = StateObject(wrappedValue: model)
    }

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
