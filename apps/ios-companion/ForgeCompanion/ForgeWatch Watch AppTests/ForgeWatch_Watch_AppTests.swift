//
//  ForgeWatch_Watch_AppTests.swift
//  ForgeWatch Watch AppTests
//
//  Created by Omar Claw on 07.04.2026.
//

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

}
