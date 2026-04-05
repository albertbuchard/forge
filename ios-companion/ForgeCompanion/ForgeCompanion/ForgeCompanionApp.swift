import SwiftUI

@main
struct ForgeCompanionApp: App {
    @StateObject private var appModel = CompanionAppModel()

    var body: some Scene {
        WindowGroup {
            CompanionAppRoot()
                .environmentObject(appModel)
                .preferredColorScheme(.dark)
        }
    }
}
