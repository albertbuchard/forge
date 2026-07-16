import SwiftUI
import UIKit

final class ForgeCompanionAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        ForgeBackgroundUploadCoordinator.shared.setBackgroundEventsCompletionHandler(
            completionHandler,
            for: identifier
        )
    }
}

@main
struct ForgeCompanionApp: App {
    @UIApplicationDelegateAdaptor(ForgeCompanionAppDelegate.self) private var appDelegate
    @StateObject private var appModel = CompanionAppModel()
    @StateObject private var peoplePeerStore = PeoplePeerStore()

    var body: some Scene {
        WindowGroup {
            CompanionAppRoot()
                .environmentObject(appModel)
                .environmentObject(peoplePeerStore)
                .preferredColorScheme(.dark)
        }
    }
}
