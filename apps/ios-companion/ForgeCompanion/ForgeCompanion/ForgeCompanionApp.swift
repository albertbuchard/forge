import SwiftUI
import UIKit
import UserNotifications

final class ForgeCompanionAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

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
                .environmentObject(appModel.agentMessageStore)
                .environmentObject(peoplePeerStore)
                .preferredColorScheme(.dark)
        }
    }
}
