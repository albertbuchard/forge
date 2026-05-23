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

    func schedule(activeSync: Bool = false, reason: String = "standard") {
#if targetEnvironment(simulator)
        return
#else
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: activeSync ? 60 * 2 : 60 * 15)
        submit(request, kind: "refresh", reason: reason, activeSync: activeSync)

        let processingRequest = BGProcessingTaskRequest(identifier: processingTaskIdentifier)
        processingRequest.earliestBeginDate = Date(timeIntervalSinceNow: activeSync ? 30 : 60 * 5)
        processingRequest.requiresNetworkConnectivity = true
        processingRequest.requiresExternalPower = false
        submit(processingRequest, kind: "processing", reason: reason, activeSync: activeSync)
#endif
    }

#if !targetEnvironment(simulator)
    private func submit(
        _ request: BGTaskRequest,
        kind: String,
        reason: String,
        activeSync: Bool
    ) {
        do {
            try BGTaskScheduler.shared.submit(request)
            companionDebugLog(
                "CompanionBackgroundScheduler",
                "schedule \(kind) accepted reason=\(reason) activeSync=\(activeSync) earliest=\(request.earliestBeginDate?.description ?? "nil")"
            )
        } catch {
            companionDebugLog(
                "CompanionBackgroundScheduler",
                "schedule \(kind) rejected reason=\(reason) activeSync=\(activeSync) error=\(error.localizedDescription)"
            )
        }
    }

    private func run(
        task: BGTask,
        onRefresh: @escaping @Sendable () async -> Bool
    ) {
        task.expirationHandler = {
            companionDebugLog(
                "CompanionBackgroundScheduler",
                "task expired identifier=\(task.identifier)"
            )
            task.setTaskCompleted(success: false)
        }

        Task { [onRefresh] in
            companionDebugLog(
                "CompanionBackgroundScheduler",
                "task started identifier=\(task.identifier)"
            )
            let success = await onRefresh()
            companionDebugLog(
                "CompanionBackgroundScheduler",
                "task completed identifier=\(task.identifier) success=\(success)"
            )
            task.setTaskCompleted(success: success)
        }
    }
#endif
}
