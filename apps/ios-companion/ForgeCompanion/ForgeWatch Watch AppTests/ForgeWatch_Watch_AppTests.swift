//
//  ForgeWatch_Watch_AppTests.swift
//  ForgeWatch Watch AppTests
//
//  Created by Omar Claw on 07.04.2026.
//

import SwiftUI
import XCTest
@testable import ForgeWatch_Watch_App

@MainActor
final class ForgeWatch_Watch_AppTests: XCTestCase {

    private func makeEnvelope(id: String) -> ForgeWatchOutboundEnvelope {
        ForgeWatchOutboundEnvelope(
            id: id,
            createdAt: "2026-07-11T10:00:00Z",
            device: ForgeWatchDeviceDescriptor(
                name: "Apple Watch",
                platform: "watchos",
                appVersion: "1.0",
                sourceDevice: "Watch"
            ),
            kind: .captureEvent,
            habitCheckIn: nil,
            captureEvent: ForgeWatchCaptureEventAction(
                eventType: "note",
                recordedAt: "2026-07-11T10:00:00Z",
                promptId: nil,
                linkedContext: .empty,
                payload: ["note": id]
            ),
            command: nil
        )
    }

    private func makeGoal(
        id: String,
        title: String,
        horizon: String,
        targetPoints: Int
    ) -> ForgeWatchGoalSummary {
        ForgeWatchGoalSummary(
            id: id,
            title: title,
            horizon: horizon,
            status: "active",
            targetPoints: targetPoints
        )
    }

    private func makeProject(
        id: String,
        title: String,
        workflowStatus: String,
        activeRunCount: Int = 0,
        openTaskCount: Int = 1
    ) -> ForgeWatchProjectSummary {
        ForgeWatchProjectSummary(
            id: id,
            title: title,
            status: "active",
            workflowStatus: workflowStatus,
            goalId: "goal_watch",
            goalTitle: "Watch quality",
            activeRunCount: activeRunCount,
            openTaskCount: openTaskCount
        )
    }

    private func makeTask(
        id: String,
        title: String,
        status: String,
        priority: String,
        points: Int = 1
    ) -> ForgeWatchTaskSummary {
        ForgeWatchTaskSummary(
            id: id,
            title: title,
            status: status,
            level: "task",
            priority: priority,
            dueDate: "2026-07-15",
            projectId: "project_watch",
            goalId: "goal_watch",
            parentWorkItemId: nil,
            points: points,
            effort: "medium",
            energy: "focus",
            updatedAt: "2026-07-15T10:00:00Z"
        )
    }

    private func makePeopleSnapshot(
        generatedAt: String = "2026-07-16T11:59:00Z",
        event: ForgeWatchPeopleGlanceSnapshot.SharedEvent? = ForgeWatchPeopleGlanceSnapshot.SharedEvent(
            title: "Project check-in",
            startsAt: "2026-07-16T13:00:00Z",
            sharedAt: "2026-07-16T11:55:00Z",
            validUntil: "2026-07-16T14:00:00Z"
        )
    ) -> ForgeWatchPeopleGlanceSnapshot {
        ForgeWatchPeopleGlanceSnapshot(
            selection: .selected,
            generatedAt: generatedAt,
            personName: "Ada Lovelace",
            lastConnectedAt: "2026-07-16T11:58:00Z",
            nextSharedEvent: event
        )
    }

    private func makePeopleConnection(sessionId: String) -> ForgeWatchConnection {
        ForgeWatchConnection(
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: sessionId,
            pairingToken: "watch-test-token",
            transportLabel: "HTTPS",
            directNetworkingEnabled: true
        )
    }

    func testQueueHabitCheckInOptimisticallyUpdatesCurrentSegment() throws {
        ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        defer {
            ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        }
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)
        let originalStreak = habit.streakCount

        model.queueHabitCheckIn(for: habit, status: "done")

        let updated = try XCTUnwrap(model.bootstrap.habits.first)
        XCTAssertEqual(updated.currentPeriodStatus, .aligned)
        XCTAssertFalse(updated.dueToday)
        XCTAssertGreaterThanOrEqual(updated.streakCount, originalStreak)
        XCTAssertEqual(updated.last7History.filter(\.current).first?.state, .aligned)
    }

    func testQueueHabitCheckInShowsDirectTailscalePendingAction() throws {
        ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        defer {
            ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        }
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)

        model.queueHabitCheckIn(for: habit, status: "done")

        XCTAssertEqual(model.pendingActionCount, 1)
        XCTAssertEqual(model.lastStatusMessage, "Sending to Forge through Tailscale")
    }

    func testDeferredPhoneFallbackAckKeepsActionToSend() throws {
        ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        defer {
            ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        }
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)

        model.queueHabitCheckIn(for: habit, status: "done")
        model.applyAckForTesting(
            ForgeWatchAckEnvelope(
                actionId: "fallback-deferred",
                processedAt: ISO8601DateFormatter().string(from: Date()),
                status: "deferred",
                error: ["message": "Tailscale not reachable from iPhone"],
                bootstrap: nil
            )
        )

        XCTAssertEqual(model.pendingActionCount, 1)
        XCTAssertTrue(model.lastStatusMessage.contains("Still sending"))
        XCTAssertFalse(model.lastStatusMessage.localizedCaseInsensitiveContains("queued"))
        XCTAssertFalse(model.lastStatusMessage.localizedCaseInsensitiveContains("relay"))
    }

    func testDeferredBackupAckWithoutMessageDoesNotExposeQueueOrPhoneFallbackJargon() throws {
        ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        defer {
            ForgeWatchStorage.sharedDefaults().removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        }
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)

        model.queueHabitCheckIn(for: habit, status: "done")
        model.applyAckForTesting(
            ForgeWatchAckEnvelope(
                actionId: "fallback-deferred",
                processedAt: ISO8601DateFormatter().string(from: Date()),
                status: "deferred",
                error: nil,
                bootstrap: nil
            )
        )

        XCTAssertEqual(model.pendingActionCount, 1)
        XCTAssertTrue(model.lastStatusMessage.contains("Still sending"))
        XCTAssertTrue(model.lastStatusMessage.contains("paired iPhone backup"))
        XCTAssertFalse(model.lastStatusMessage.localizedCaseInsensitiveContains("queued"))
        XCTAssertFalse(model.lastStatusMessage.localizedCaseInsensitiveContains("phone fallback"))
        XCTAssertFalse(model.lastStatusMessage.localizedCaseInsensitiveContains("relay"))
    }

    func testPlan17CompletionConfirmationIsExplicitAccessibleAndCancellable() {
        let task = WatchTaskCloseoutPresentation.taskCompletion
        let run = WatchTaskCloseoutPresentation.runCompletion

        XCTAssertEqual(task.title, "Complete this task?")
        XCTAssertTrue(task.message.contains("closes the task"))
        XCTAssertTrue(task.message.contains("remain deferred"))
        XCTAssertTrue(task.message.contains("Files"))
        XCTAssertTrue(task.message.contains("Git references"))
        XCTAssertTrue(task.message.contains("completion note"))
        XCTAssertEqual(task.confirmTitle, "Complete")
        XCTAssertEqual(task.accessibilityLabel, "Complete task and defer evidence")
        XCTAssertTrue(task.accessibilityHint.contains("must be added later"))

        XCTAssertTrue(run.message.contains("closes the run and its task"))
        XCTAssertEqual(run.accessibilityLabel, "Complete run and defer evidence")

        let modal = WatchCommandModalView(
            item: WatchCommandModalItem(
                id: "plan-17-confirmation",
                title: "Small Watch closeout",
                subtitle: "Long text remains vertically scrollable at accessibility sizes.",
                actions: [
                    WatchCommandModalAction(
                        id: "complete",
                        title: "Complete",
                        systemImage: "checkmark.circle.fill",
                        tint: .green,
                        confirmation: task,
                        perform: {}
                    )
                ]
            )
        )
        let renderer = ImageRenderer(
            content: modal
                .environment(\.dynamicTypeSize, .accessibility5)
                .frame(width: 162, height: 197)
        )
        renderer.proposedSize = ProposedViewSize(width: 162, height: 197)
        XCTAssertNotNil(renderer.cgImage)
    }

    func testPlan17StructuredReceiptErrorRoundTripsWithoutDroppingNestedDetails() throws {
        let error: [String: ForgeWatchJSONValue] = [
            "statusCode": 404,
            "code": "watch_task_not_found",
            "message": "Task not found",
            "details": .object([
                "retryable": false,
                "operationId": "stable-operation-id"
            ])
        ]
        let receipt = ForgeWatchCommandReceipt(
            actionId: "stable-operation-id",
            kind: ForgeWatchActionKind.taskStatusUpdate.rawValue,
            status: "failed",
            processedAt: "2026-07-16T10:00:00Z",
            error: error
        )

        let decoded = try JSONDecoder().decode(
            ForgeWatchCommandReceipt.self,
            from: JSONEncoder().encode(receipt)
        )

        XCTAssertEqual(decoded, receipt)
        XCTAssertEqual(decoded.error?["statusCode"]?.integerValue, 404)
        XCTAssertEqual(decoded.error?["code"]?.stringValue, "watch_task_not_found")
        XCTAssertEqual(decoded.error?["details"], error["details"])
    }

    func testPlan17DeferredReceiptRetainsStableOperationForDeliberateRetry() {
        let envelope = makeEnvelope(id: "stable-operation-id")
        let ack = ForgeWatchAckEnvelope(
            actionId: envelope.id,
            kind: envelope.kind.rawValue,
            processedAt: "2026-07-16T10:00:00Z",
            status: "deferred",
            error: [
                "code": "watch_transport_offline",
                "message": "Forge is offline"
            ],
            bootstrap: nil
        )

        let update = ForgeWatchReceiptLifecycle.applying(
            ack,
            to: [envelope],
            receiptHistory: []
        )

        XCTAssertEqual(update.remainingQueue.map(\.id), ["stable-operation-id"])
        XCTAssertNil(update.completedReceipt)
        XCTAssertFalse(update.shouldContinueFlushing)
    }

    func testPlan17TaskCloseoutStateDecodesNewAndLegacySnapshots() throws {
        let legacy = Data(
            #"{"id":"task-legacy","title":"Legacy","status":"done","level":"task","priority":"medium","dueDate":null,"projectId":null,"goalId":null,"parentWorkItemId":null,"points":1,"effort":"medium","energy":"focus","updatedAt":"2026-07-16T10:00:00Z"}"#.utf8
        )
        let current = Data(
            #"{"id":"task-current","title":"Current","status":"done","level":"task","priority":"medium","dueDate":null,"projectId":null,"goalId":null,"parentWorkItemId":null,"points":1,"effort":"medium","energy":"focus","closeoutState":"deferred","updatedAt":"2026-07-16T10:00:00Z"}"#.utf8
        )

        XCTAssertNil(
            try JSONDecoder().decode(ForgeWatchTaskSummary.self, from: legacy).closeoutState
        )
        XCTAssertEqual(
            try JSONDecoder().decode(ForgeWatchTaskSummary.self, from: current).closeoutState,
            "deferred"
        )
    }

    func testHabitRingAlwaysUsesSevenSegments() throws {
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)
        XCTAssertEqual(habit.last7History.count, 7)
        XCTAssertEqual(habit.last7History.filter(\.current).count, 1)
    }

    func testNegativeHabitPreviewUsesResistedAndPerformedCopy() throws {
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(
            model.bootstrap.habits.first(where: { $0.polarity == "negative" })
        )

        XCTAssertEqual(habit.alignedActionLabel, "Resisted")
        XCTAssertEqual(habit.unalignedActionLabel, "Performed")
    }

    func testLocalHabitDateKeyUsesTheSuppliedTravelTimezone() throws {
        let instant = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-01-01T00:30:00Z")
        )
        let losAngeles = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let zurich = try XCTUnwrap(TimeZone(identifier: "Europe/Zurich"))

        XCTAssertEqual(
            WatchAppModel.localDateKey(at: instant, timeZone: losAngeles),
            "2025-12-31"
        )
        XCTAssertEqual(
            WatchAppModel.localDateKey(at: instant, timeZone: zurich),
            "2026-01-01"
        )
    }

    func testTailscaleHttpsConnectionCanUseWatchDirectNetworking() {
        let connection = ForgeWatchConnection(
            apiBaseUrl: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            transportLabel: "Tailscale",
            directNetworkingEnabled: true
        )

        XCTAssertTrue(WatchAppModel.canUseDirectNetworking(connection))
    }

    func testWatchDirectNetworkingRejectsLoopbackHttpAndLogicalIroh() {
        let loopback = ForgeWatchConnection(
            apiBaseUrl: "https://127.0.0.1:4317/api/v1",
            uiBaseUrl: "https://127.0.0.1:4317/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            transportLabel: "Loopback",
            directNetworkingEnabled: true
        )
        let insecureHttp = ForgeWatchConnection(
            apiBaseUrl: "http://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/api/v1",
            uiBaseUrl: "http://macbook-pro--de-francis-lalanne.tail47ba04.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            transportLabel: "HTTP",
            directNetworkingEnabled: true
        )
        let iroh = ForgeWatchConnection(
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            transportLabel: "Iroh",
            directNetworkingEnabled: true
        )

        XCTAssertFalse(WatchAppModel.canUseDirectNetworking(loopback))
        XCTAssertFalse(WatchAppModel.canUseDirectNetworking(insecureHttp))
        XCTAssertFalse(WatchAppModel.canUseDirectNetworking(iroh))
    }

    func testDirectMetricUsesBackupWordingWithoutIrohOrQueueJargon() {
        let metric = ForgeWatchDirectSyncMetric(
            operation: "actions",
            transportLabel: "Tailscale",
            requestBytes: 1536,
            responseBytes: 512,
            durationMs: 240,
            itemCount: 3,
            succeeded: false,
            fallbackUsed: true,
            errorDescription: "timed out"
        )

        XCTAssertTrue(metric.summary.contains("Tailscale"))
        XCTAssertTrue(metric.summary.contains("paired iPhone backup"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("phone fallback"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("Iroh"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("queued"))
    }

    func testSnapshotFreshnessDistinguishesFreshStaleClockSkewAndUnavailable() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-11T12:00:00Z"))

        let fresh = ForgeWatchSnapshotFreshness.evaluate(
            generatedAt: "2026-07-11T11:55:00Z",
            hasSnapshot: true,
            now: now
        )
        let stale = ForgeWatchSnapshotFreshness.evaluate(
            generatedAt: "2026-07-11T11:40:00Z",
            hasSnapshot: true,
            now: now
        )
        let skewed = ForgeWatchSnapshotFreshness.evaluate(
            generatedAt: "2026-07-11T12:06:00Z",
            hasSnapshot: true,
            now: now
        )
        let unavailable = ForgeWatchSnapshotFreshness.evaluate(
            generatedAt: "not-a-date",
            hasSnapshot: false,
            now: now
        )

        XCTAssertEqual(fresh.state, .fresh)
        XCTAssertEqual(fresh.shortLabel, "Fresh 5m")
        XCTAssertEqual(stale.state, .stale)
        XCTAssertEqual(stale.shortLabel, "Stale 20m")
        XCTAssertEqual(skewed.state, .clockSkew)
        XCTAssertEqual(unavailable.state, .unavailable)
    }

    func testWatchActionBatchPolicyBoundsExchangeWithoutDroppingOutboxItems() {
        let outbox = (0..<47).map { makeEnvelope(id: "action_\($0)") }

        let batch = ForgeWatchActionBatchPolicy.nextBatch(from: outbox)

        XCTAssertEqual(batch.count, ForgeWatchActionBatchPolicy.maximumActionCount)
        XCTAssertEqual(batch.map(\.id), Array(outbox.prefix(20)).map(\.id))
        XCTAssertEqual(outbox.count, 47)
    }

    func testReceiptHistoryIsBoundedAndReplacesDuplicateActionReceipt() {
        let existing = (0..<30).map {
            ForgeWatchStoredReceipt(
                actionId: "action_\($0)",
                kind: "capture_event",
                status: "processed",
                processedAt: "2026-07-11T10:00:00Z",
                errorMessage: nil
            )
        }
        let replacement = ForgeWatchStoredReceipt(
            actionId: "action_5",
            kind: "capture_event",
            status: "failed",
            processedAt: "2026-07-11T10:05:00Z",
            errorMessage: "Forge rejected this action"
        )

        let merged = ForgeWatchReceiptHistoryPolicy.merging([replacement], into: existing)

        XCTAssertEqual(merged.count, ForgeWatchReceiptHistoryPolicy.maximumReceiptCount)
        XCTAssertEqual(merged.first, replacement)
        XCTAssertEqual(merged.filter { $0.actionId == replacement.actionId }.count, 1)
    }

    func testWatchOutboxRemainsPendingUntilReceiptThenPersistsReceipt() throws {
        let defaults = ForgeWatchStorage.sharedDefaults()
        defaults.removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
        defaults.removeObject(forKey: ForgeWatchStorage.receiptHistoryKey)
        defer {
            defaults.removeObject(forKey: ForgeWatchStorage.outgoingQueueKey)
            defaults.removeObject(forKey: ForgeWatchStorage.receiptHistoryKey)
        }
        let model = WatchAppModel(preview: true)

        model.queueCaptureEvent(eventType: "note", payload: ["note": "Remember this"])
        let queueData = try XCTUnwrap(defaults.data(forKey: ForgeWatchStorage.outgoingQueueKey))
        let queue = try JSONDecoder().decode([ForgeWatchOutboundEnvelope].self, from: queueData)
        let action = try XCTUnwrap(queue.first)

        XCTAssertEqual(model.pendingActionCount, 1)
        XCTAssertNil(model.latestReceipt)

        model.applyAckForTesting(
            ForgeWatchAckEnvelope(
                actionId: action.id,
                kind: action.kind.rawValue,
                processedAt: "2026-07-11T10:01:00Z",
                status: "processed",
                error: nil,
                bootstrap: nil
            )
        )

        XCTAssertEqual(model.pendingActionCount, 0)
        XCTAssertEqual(model.latestReceipt?.actionId, action.id)
        let receiptData = try XCTUnwrap(defaults.data(forKey: ForgeWatchStorage.receiptHistoryKey))
        let stored = try JSONDecoder().decode([ForgeWatchStoredReceipt].self, from: receiptData)
        XCTAssertEqual(stored.first?.actionId, action.id)
    }

    func testWatch07GoalsPresentationIsDeterministicAndBounded() {
        let presentation = ForgeWatchGoalsPresentation(
            goals: [
                makeGoal(id: "lifetime", title: "Lifetime", horizon: "lifetime", targetPoints: 500),
                makeGoal(id: "quarter-low", title: "Quarter low", horizon: "quarter", targetPoints: 10),
                makeGoal(id: "year", title: "Year", horizon: "year", targetPoints: 100),
                makeGoal(id: "quarter-high", title: "Quarter high", horizon: "quarter", targetPoints: 90),
                makeGoal(id: "quarter-mid", title: "Quarter mid", horizon: "quarter", targetPoints: 40)
            ],
            projects: [
                makeProject(id: "backlog", title: "Backlog", workflowStatus: "backlog"),
                makeProject(id: "focus-idle", title: "Focus idle", workflowStatus: "focus"),
                makeProject(id: "blocked", title: "Blocked", workflowStatus: "blocked"),
                makeProject(id: "progress", title: "Progress", workflowStatus: "in_progress"),
                makeProject(id: "focus-run", title: "Focus run", workflowStatus: "focus", activeRunCount: 1)
            ],
            totalGoalCount: 12,
            totalProjectCount: 10
        )

        XCTAssertEqual(
            presentation.goals.map(\.id),
            ["quarter-high", "quarter-mid", "quarter-low"]
        )
        XCTAssertEqual(
            presentation.projects.map(\.id),
            ["focus-run", "focus-idle", "progress"]
        )
        XCTAssertEqual(presentation.hiddenGoalCount, 9)
        XCTAssertEqual(presentation.hiddenProjectCount, 7)
        XCTAssertEqual(presentation.cardCount, 7)
    }

    func testWatch07TodayPresentationOrdersWorkAndKeepsCountsHonest() {
        let today = ForgeWatchTodaySnapshot(
            dateKey: "2026-07-15",
            dueTasks: [
                makeTask(id: "backlog-high", title: "Backlog high", status: "backlog", priority: "high"),
                makeTask(id: "focus-low", title: "Focus low", status: "focus", priority: "low"),
                makeTask(id: "progress-low", title: "Progress low", status: "in_progress", priority: "low"),
                makeTask(id: "focus-high", title: "Focus high", status: "focus", priority: "high", points: 5),
                makeTask(id: "blocked", title: "Blocked", status: "blocked", priority: "high")
            ],
            dueCount: 9,
            recentDone: [
                makeTask(id: "done-one", title: "Done one", status: "done", priority: "low"),
                makeTask(id: "done-two", title: "Done two", status: "done", priority: "low")
            ]
        )

        let presentation = ForgeWatchTodayPresentation(today: today)

        XCTAssertEqual(
            presentation.dueTasks.map(\.id),
            ["focus-high", "focus-low", "progress-low", "blocked"]
        )
        XCTAssertEqual(presentation.snapshotDueCount, 9)
        XCTAssertEqual(presentation.hiddenDueTaskCount, 5)
        XCTAssertEqual(presentation.recentDoneCount, 2)
        XCTAssertEqual(presentation.cardCount, 5)
    }

    func testWatch07CompactSurfacePolicyDistinguishesLifecycleStates() {
        let fresh = ForgeWatchSnapshotFreshness(state: .fresh, ageSeconds: 10)
        let stale = ForgeWatchSnapshotFreshness(state: .stale, ageSeconds: 1_000)
        let skewed = ForgeWatchSnapshotFreshness(state: .clockSkew, ageSeconds: -400)

        XCTAssertEqual(
            ForgeWatchCompactSurfacePolicy.notice(
                hasPayload: false,
                freshness: fresh,
                refreshState: .refreshing
            ),
            .loading
        )
        XCTAssertEqual(
            ForgeWatchCompactSurfacePolicy.notice(
                hasPayload: false,
                freshness: fresh,
                refreshState: .failed
            ),
            .failed
        )
        XCTAssertEqual(
            ForgeWatchCompactSurfacePolicy.notice(
                hasPayload: true,
                freshness: fresh,
                refreshState: .idle
            ),
            .none
        )
        XCTAssertEqual(
            ForgeWatchCompactSurfacePolicy.notice(
                hasPayload: true,
                freshness: stale,
                refreshState: .idle
            ),
            .stale
        )
        XCTAssertEqual(
            ForgeWatchCompactSurfacePolicy.notice(
                hasPayload: true,
                freshness: skewed,
                refreshState: .idle
            ),
            .clockSkew
        )
    }

    func testWatch07PhoneHandoffBuildsExactSanitizedForgeURLs() throws {
        let base = "https://user:secret@forge.example.test/forge/?token=private#fragment"

        let goalUrl = try XCTUnwrap(
            ForgeWatchPhoneHandoff.url(
                uiBaseUrl: base,
                destination: .goal("goal_watch-07")
            )
        )
        let todayUrl = try XCTUnwrap(
            ForgeWatchPhoneHandoff.url(uiBaseUrl: base, destination: .today)
        )

        XCTAssertEqual(goalUrl.absoluteString, "https://forge.example.test/forge/goals/goal_watch-07")
        XCTAssertEqual(todayUrl.absoluteString, "https://forge.example.test/forge/today")
        XCTAssertFalse(goalUrl.absoluteString.contains("secret"))
        XCTAssertFalse(goalUrl.absoluteString.contains("token"))
        XCTAssertNil(
            ForgeWatchPhoneHandoff.url(
                uiBaseUrl: "forge-iroh://node/forge/",
                destination: .goals
            )
        )
        XCTAssertEqual(
            ForgeWatchPhoneHandoff.iPhoneURL(
                uiBaseUrl: "forge-iroh://user:secret@node/forge/?token=private#fragment",
                destination: .task("task_watch-07")
            )?.absoluteString,
            "forge-iroh://node/forge/tasks/task_watch-07"
        )
        XCTAssertNil(
            ForgeWatchPhoneHandoff.url(
                uiBaseUrl: "https://forge.example.test/forge/",
                destination: .task("../../unsafe")
            )
        )
    }

    func testWatch07LogicalPhoneDestinationRoundTripsAndRejectsTraversal() throws {
        let request = try XCTUnwrap(
            ForgeWatchPhoneHandoffRequest(
                id: "handoff-watch-07",
                createdAt: "2026-07-15T10:00:00Z",
                destination: .project("project_watch-07")
            )
        )

        let data = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(ForgeWatchPhoneHandoffRequest.self, from: data)

        XCTAssertEqual(decoded, request)
        XCTAssertNil(ForgeWatchPhoneHandoffRequest(destination: .goal("../../unsafe")))
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                ForgeWatchPhoneHandoffRequest.self,
                from: Data(
                    #"{"id":"unsafe","createdAt":"2026-07-15T10:00:00Z","destination":{"kind":"task","entityId":"../../unsafe"}}"#.utf8
                )
            )
        )
    }

    func testWatch07RefreshPolicyBoundsDeadlineAndMatchesRequestId() throws {
        let formatter = ISO8601DateFormatter()
        let createdAt = try XCTUnwrap(formatter.date(from: "2026-07-15T10:00:00Z"))
        let deadline = ForgeWatchRefreshRequestPolicy.deadline(for: createdAt)
        let request = ForgeWatchControlRequest(
            id: "refresh-watch-07",
            createdAt: formatter.string(from: createdAt),
            reason: "manual",
            deadlineAt: formatter.string(from: deadline)
        )
        let response = ForgeWatchRefreshResponse(
            requestId: request.id,
            completedAt: formatter.string(from: createdAt),
            status: .refreshed,
            message: "Refreshed"
        )

        XCTAssertEqual(
            deadline.timeIntervalSince(createdAt),
            ForgeWatchRefreshRequestPolicy.timeoutSeconds,
            accuracy: 0.001
        )
        XCTAssertFalse(
            ForgeWatchRefreshRequestPolicy.isExpired(
                request,
                now: createdAt.addingTimeInterval(11)
            )
        )
        XCTAssertTrue(
            ForgeWatchRefreshRequestPolicy.isExpired(
                request,
                now: createdAt.addingTimeInterval(12)
            )
        )
        XCTAssertTrue(
            ForgeWatchRefreshRequestPolicy.accepts(
                response,
                activeRequestId: request.id
            )
        )
        XCTAssertFalse(
            ForgeWatchRefreshRequestPolicy.accepts(
                response,
                activeRequestId: "newer-refresh"
            )
        )
    }

    func testWatch07PreviewScenariosCoverEmptyLoadingStaleErrorAndLongContent() {
        let empty = WatchAppModel(preview: true, previewScenario: .empty)
        let loading = WatchAppModel(preview: true, previewScenario: .loading)
        let stale = WatchAppModel(preview: true, previewScenario: .stale)
        let error = WatchAppModel(preview: true, previewScenario: .error)
        let longContent = WatchAppModel(preview: true, previewScenario: .longContent)

        XCTAssertEqual(empty.bootstrap.goals, [])
        XCTAssertEqual(empty.bootstrap.today?.dueTasks, [])
        XCTAssertEqual(loading.refreshState, .refreshing)
        XCTAssertNil(loading.bootstrap.today)
        XCTAssertEqual(stale.snapshotFreshness().state, .stale)
        XCTAssertEqual(error.refreshState, .failed)
        XCTAssertNil(error.bootstrap.goals)
        XCTAssertGreaterThan(
            longContent.bootstrap.goals?.count ?? 0,
            ForgeWatchGoalsPresentation.maximumGoalCount
        )
        XCTAssertGreaterThan(
            longContent.bootstrap.today?.dueTasks.count ?? 0,
            ForgeWatchTodayPresentation.maximumDueTaskCount
        )
    }

    func testWatch07PreviewCardSelectionIsClampedToCompactSurfaceBounds() {
        let navigation = WatchNavigationModel()
        navigation.registerCardCount(4, for: .goals)

        navigation.selectCard(2, for: .goals)
        XCTAssertEqual(navigation.selectedCardIndex(for: .goals), 2)

        navigation.selectCard(99, for: .goals)
        XCTAssertEqual(navigation.selectedCardIndex(for: .goals), 3)

        navigation.selectCard(-1, for: .goals)
        XCTAssertEqual(navigation.selectedCardIndex(for: .goals), 0)
    }

    func testPeopleGlanceRedactsEveryLockedDimNotificationScreenshotAndInactiveContext() throws {
        let snapshot = makePeopleSnapshot()
        let privateContexts = ForgeWatchPeoplePrivacyContext.allCases.filter {
            $0 != .unlockedActive
        }

        XCTAssertEqual(Set(privateContexts), [
            .locked, .wristDown, .alwaysOn, .notification,
            .screenshotFixture, .inactive
        ])
        for context in privateContexts {
            let presentation = ForgeWatchPeopleDisplayPolicy.presentation(
                snapshot: snapshot,
                context: context,
                now: try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-16T12:00:00Z"))
            )
            XCTAssertEqual(presentation.title, "Forge People", "Context: \(context)")
            XCTAssertEqual(presentation.indicator, "Private", "Context: \(context)")
            XCTAssertNil(presentation.personName, "Context: \(context)")
            XCTAssertNil(presentation.connectivity, "Context: \(context)")
            XCTAssertNil(presentation.eventTitle, "Context: \(context)")
            XCTAssertNil(presentation.eventTiming, "Context: \(context)")
            XCTAssertNil(presentation.eventStatus, "Context: \(context)")
            XCTAssertFalse(presentation.isDetailed)
        }
    }

    func testPeopleGlanceUnlockedActiveShowsOnlyRelayedFreshnessConnectivityAndExplicitEvent() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-16T12:00:00Z"))

        let presentation = ForgeWatchPeopleDisplayPolicy.presentation(
            snapshot: makePeopleSnapshot(),
            context: .unlockedActive,
            now: now
        )

        XCTAssertEqual(presentation.title, "Forge People")
        XCTAssertEqual(presentation.indicator, "iPhone snapshot fresh")
        XCTAssertEqual(presentation.personName, "Ada Lovelace")
        XCTAssertEqual(presentation.connectivity, "Last connected 2m ago")
        XCTAssertEqual(presentation.eventTitle, "Project check-in")
        XCTAssertEqual(presentation.eventTiming, "Starts in 1h")
        XCTAssertEqual(presentation.eventStatus, "Explicitly shared")
        XCTAssertTrue(presentation.isDetailed)
    }

    func testPeopleGlanceStaleExpiredUnavailableAndNeutralStatesNeverInventTogetherData() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-16T12:00:00Z"))
        let expiredEvent = ForgeWatchPeopleGlanceSnapshot.SharedEvent(
            title: "Expired private event",
            startsAt: "2026-07-16T13:00:00Z",
            sharedAt: "2026-07-16T10:00:00Z",
            validUntil: "2026-07-16T11:59:59Z"
        )
        let stale = ForgeWatchPeopleDisplayPolicy.presentation(
            snapshot: makePeopleSnapshot(
                generatedAt: "2026-07-16T11:40:00Z",
                event: expiredEvent
            ),
            context: .unlockedActive,
            now: now
        )
        XCTAssertEqual(stale.indicator, "iPhone snapshot stale")
        XCTAssertEqual(stale.personName, "Ada Lovelace")
        XCTAssertNil(stale.eventTitle)
        XCTAssertNil(stale.eventTiming)
        XCTAssertEqual(stale.eventStatus, "Shared event stale")
        XCTAssertFalse(String(describing: stale).contains("Expired private event"))

        let neutral = ForgeWatchPeopleDisplayPolicy.presentation(
            snapshot: .chooseOnIPhone(generatedAt: "2026-07-16T12:00:00Z"),
            context: .unlockedActive,
            now: now
        )
        XCTAssertEqual(neutral.title, "Forge People")
        XCTAssertEqual(neutral.indicator, "Choose a Person on iPhone")
        XCTAssertNil(neutral.personName)
        XCTAssertFalse(neutral.isDetailed)

        let unavailable = ForgeWatchPeopleDisplayPolicy.presentation(
            snapshot: nil,
            context: .unlockedActive,
            now: now
        )
        XCTAssertEqual(unavailable.indicator, "iPhone snapshot unavailable")
        XCTAssertNil(unavailable.personName)
        XCTAssertNil(unavailable.eventTitle)
    }

    func testPeopleGlanceSurvivesOnlySameCompanionSessionBootstrapRefresh() {
        let snapshot = makePeopleSnapshot()
        let cached = ForgeWatchBootstrap.empty
            .withConnection(makePeopleConnection(sessionId: "pair-one"))
            .withPeople(snapshot)
        let sameSession = ForgeWatchBootstrap.empty
            .withConnection(makePeopleConnection(sessionId: "pair-one"))
            .preservingPeople(from: cached)
        let otherSession = ForgeWatchBootstrap.empty
            .withConnection(makePeopleConnection(sessionId: "pair-two"))
            .preservingPeople(from: cached)

        XCTAssertEqual(sameSession.people, snapshot)
        XCTAssertNil(otherSession.people)
        XCTAssertEqual(sameSession.withPeople(nil).preservingPeople(from: cached).people, snapshot)
    }

    func testPeopleGlanceBootstrapDecodesLegacyPayloadWithoutPeopleField() throws {
        let legacyData = try JSONEncoder().encode(ForgeWatchBootstrap.empty)
        let rendered = try XCTUnwrap(String(data: legacyData, encoding: .utf8))
        XCTAssertFalse(rendered.contains("\"people\""))

        let decoded = try JSONDecoder().decode(ForgeWatchBootstrap.self, from: legacyData)

        XCTAssertNil(decoded.people)
        XCTAssertEqual(decoded.schemaVersion, ForgeWatchBootstrap.empty.schemaVersion)
    }

    func testWatchHasReadOnlyPeopleGlanceButNoIdentityGrantOrPeerManagementAuthority() throws {
        let surfaceNames = WatchSurface.allCases.map(\.rawValue)
        let launchDestinations = ForgeWatchLaunchDestination.allCases.map(\.rawValue)
        let actionKinds = [
            ForgeWatchActionKind.habitCheckIn,
            .captureEvent,
            .taskRunStart,
            .taskRunHeartbeat,
            .taskRunFocus,
            .taskRunComplete,
            .taskRunRelease,
            .taskStatusUpdate
        ].map(\.rawValue)
        let nativeAuthority = (launchDestinations + actionKinds)
            .joined(separator: " ")
            .lowercased()

        XCTAssertTrue(surfaceNames.contains("people"))
        XCTAssertEqual(actionKinds.count, 8)
        for forbidden in ["people", "peer", "relationship", "grant", "identity", "revoke"] {
            XCTAssertFalse(nativeAuthority.contains(forbidden))
        }

        let encodedEnvelope = String(
            decoding: try JSONEncoder().encode(makeEnvelope(id: "watch-negative-peer-surface")),
            as: UTF8.self
        ).lowercased()
        for forbidden in ["relationship", "grant", "identity", "revoke"] {
            XCTAssertFalse(encodedEnvelope.contains(forbidden))
        }

        let encodedGlance = String(
            decoding: try JSONEncoder().encode(makePeopleSnapshot()),
            as: UTF8.self
        ).lowercased()
        for forbidden in [
            "relationshipid", "grantid", "deviceid", "identityid",
            "owneruserid", "principalid", "revoke", "accept", "approve"
        ] {
            XCTAssertFalse(encodedGlance.contains(forbidden))
        }
    }

}
