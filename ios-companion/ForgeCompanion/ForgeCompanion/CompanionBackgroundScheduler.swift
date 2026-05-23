@preconcurrency import BackgroundTasks
import Foundation

@MainActor
final class CompanionBackgroundScheduler {
    private let refreshTaskIdentifier = "com.albertbuchard.ForgeCompanion.health-sync"
    private let processingTaskIdentifier = "com.albertbuchard.ForgeCompanion.health-sync.processing"

    func register(onRefresh: @escaping @Sendable () async -> Bool) {
#if targetEnvironment(simulator)
        return
#else
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskIdentifier, using: nil) { [weak self] task in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            self.schedule()
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.run(task: refreshTask, onRefresh: onRefresh)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingTaskIdentifier, using: nil) { [weak self] task in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            self.schedule()
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.run(task: processingTask, onRefresh: onRefresh)
        }
#endif
    }

    func schedule() {
#if targetEnvironment(simulator)
        return
#else
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 15)
        try? BGTaskScheduler.shared.submit(request)

        let processingRequest = BGProcessingTaskRequest(identifier: processingTaskIdentifier)
        processingRequest.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 5)
        processingRequest.requiresNetworkConnectivity = true
        processingRequest.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(processingRequest)
#endif
    }

#if !targetEnvironment(simulator)
    private func run(
        task: BGTask,
        onRefresh: @escaping @Sendable () async -> Bool
    ) {
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        Task { [onRefresh] in
            let success = await onRefresh()
            task.setTaskCompleted(success: success)
        }
    }
#endif
}
