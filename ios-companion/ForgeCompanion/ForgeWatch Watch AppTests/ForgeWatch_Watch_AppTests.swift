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

    func testHabitRingAlwaysUsesSevenSegments() throws {
        let model = WatchAppModel(preview: true)
        let habit = try XCTUnwrap(model.bootstrap.habits.first)
        XCTAssertEqual(habit.last7History.count, 7)
        XCTAssertEqual(habit.last7History.filter(\.current).count, 1)
    }

}
