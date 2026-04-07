//
//  ForgeCompanionTests.swift
//  ForgeCompanionTests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest
@testable import ForgeCompanion

@MainActor
final class ForgeCompanionTests: XCTestCase {
    func testNormalizedPayloadPreservesPreferredUiBaseUrl() {
        let payload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "http://127.0.0.1:4317",
            uiBaseUrl: nil,
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )

        let normalized = CompanionPairingURLResolver.normalizedPayload(
            payload,
            preferredUiBaseUrl: "http://127.0.0.1:3027/forge"
        )

        XCTAssertEqual(normalized.apiBaseUrl, "http://127.0.0.1:4317/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "http://127.0.0.1:3027/forge/")
    }

    func testNormalizeUiBaseUrlRemovesApiSuffix() {
        XCTAssertEqual(
            CompanionPairingURLResolver.normalizeUiBaseUrl(
                "http://127.0.0.1:3027/forge/api/v1"
            ),
            "http://127.0.0.1:3027/forge/"
        )
    }

    func testWatchBootstrapDecodesCompactHabitPayload() throws {
        let json = """
        {
          "generatedAt": "2026-04-07T10:00:00Z",
          "habits": [
            {
              "id": "habit_1",
              "title": "Morning planning",
              "polarity": "positive",
              "frequency": "daily",
              "targetCount": 1,
              "weekDays": [],
              "streakCount": 3,
              "dueToday": true,
              "cadenceLabel": "1x daily",
              "alignedActionLabel": "Done",
              "unalignedActionLabel": "Missed",
              "currentPeriodStatus": "unknown",
              "last7History": [
                { "id": "1", "label": "S", "periodKey": "2026-04-01", "current": false, "state": "aligned" },
                { "id": "2", "label": "M", "periodKey": "2026-04-02", "current": false, "state": "aligned" },
                { "id": "3", "label": "T", "periodKey": "2026-04-03", "current": false, "state": "unknown" },
                { "id": "4", "label": "W", "periodKey": "2026-04-04", "current": false, "state": "aligned" },
                { "id": "5", "label": "T", "periodKey": "2026-04-05", "current": false, "state": "aligned" },
                { "id": "6", "label": "F", "periodKey": "2026-04-06", "current": false, "state": "unknown" },
                { "id": "7", "label": "S", "periodKey": "2026-04-07", "current": true, "state": "unknown" }
              ]
            }
          ],
          "checkInOptions": {
            "activities": ["Working"],
            "emotions": ["Focused"],
            "triggers": ["Conflict"],
            "placeCategories": ["Home"],
            "routinePrompts": ["Medication taken?"],
            "recentPeople": ["Julien"]
          },
          "pendingPrompts": []
        }
        """

        let bootstrap = try JSONDecoder().decode(
            ForgeWatchBootstrap.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(bootstrap.habits.count, 1)
        XCTAssertEqual(bootstrap.habits.first?.alignedActionLabel, "Done")
        XCTAssertEqual(bootstrap.habits.first?.last7History.count, 7)
        XCTAssertEqual(bootstrap.checkInOptions.recentPeople.first, "Julien")
    }

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }
}
