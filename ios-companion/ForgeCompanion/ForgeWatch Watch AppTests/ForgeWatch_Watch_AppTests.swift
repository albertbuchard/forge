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

}
