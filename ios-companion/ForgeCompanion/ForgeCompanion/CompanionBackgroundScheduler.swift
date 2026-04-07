@preconcurrency import BackgroundTasks
import Foundation

@MainActor
final class CompanionBackgroundScheduler {
    private let taskIdentifier = "com.albertbuchard.ForgeCompanion.health-sync"

    func register(onRefresh: @escaping @Sendable () async -> Bool) {
#if targetEnvironment(simulator)
        return
#else
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { [weak self] task in
            guard
                let self,
                let refreshTask = task as? BGAppRefreshTask
            else {
                task.setTaskCompleted(success: false)
                return
            }

            self.schedule()

            refreshTask.expirationHandler = {
                refreshTask.setTaskCompleted(success: false)
            }

            Task { [onRefresh] in
                let success = await onRefresh()
                refreshTask.setTaskCompleted(success: success)
            }
        }
#endif
    }

    func schedule() {
#if targetEnvironment(simulator)
        return
#else
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 30)
        try? BGTaskScheduler.shared.submit(request)
#endif
    }
}
