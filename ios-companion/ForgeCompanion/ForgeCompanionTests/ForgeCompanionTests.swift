//
//  ForgeCompanionTests.swift
//  ForgeCompanionTests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest
import CoreLocation
@testable import ForgeCompanion

private struct SharedMovementFixtureCatalog: Decodable {
    let scenarios: [SharedMovementFixtureScenario]
}

private struct SharedMovementFixtureScenario: Decodable {
    let id: String
    let title: String
    let projectedTimeline: [ForgeMovementTimelineSegment]
}

private let sharedMovementFixtureDateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

@MainActor
final class ForgeCompanionTests: XCTestCase {
    private func loadSharedMovementFixture(id: String) throws -> SharedMovementFixtureScenario {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("test-fixtures")
            .appendingPathComponent("movement-canonical-box-fixtures.json")
        let data = try Data(contentsOf: fixtureURL)
        let catalog = try JSONDecoder().decode(SharedMovementFixtureCatalog.self, from: data)
        guard let scenario = catalog.scenarios.first(where: { $0.id == id }) else {
            throw NSError(
                domain: "ForgeCompanionTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Missing shared movement fixture \(id)"]
            )
        }
        return scenario
    }

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

    func testCompanionOperationalSummaryFlagsMissingAuthorizationAsWarning() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .permissionDenied,
            latestError: nil,
            healthSyncEnabled: true,
            healthAccessStatus: .notSet,
            movementEnabled: true,
            movementPermissionStatus: "not_determined",
            movementBackgroundReady: false,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "not_determined"
        )

        XCTAssertEqual(summary.status, .warning)
        XCTAssertEqual(summary.detail, "Missing authorization")
    }

    func testCompanionOperationalSummaryReturnsOkWhenSignalsAreReady() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .healthy,
            latestError: nil,
            healthSyncEnabled: true,
            healthAccessStatus: .fullAccess,
            movementEnabled: true,
            movementPermissionStatus: "authorized_always",
            movementBackgroundReady: true,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "approved"
        )

        XCTAssertEqual(summary.status, .ok)
        XCTAssertEqual(summary.detail, "All core signals ready")
    }

    func testCompanionOperationalSummaryPromotesErrorsAboveAuthorizationWarnings() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .healthy,
            latestError: "Upload failed",
            healthSyncEnabled: true,
            healthAccessStatus: .fullAccess,
            movementEnabled: true,
            movementPermissionStatus: "authorized_always",
            movementBackgroundReady: true,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "approved"
        )

        XCTAssertEqual(summary.status, .error)
        XCTAssertEqual(summary.detail, "Upload failed")
    }

    func testPermissionSyncPhaseUsesBusyLabelsForLiveWork() {
        XCTAssertTrue(CompanionPermissionSyncPhase.requestingHealth.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.requestingHealth.buttonLabel, "Requesting Health…")
        XCTAssertEqual(CompanionPermissionSyncPhase.requestingHealth.progressDetail, "Waiting for Health access.")

        XCTAssertTrue(CompanionPermissionSyncPhase.syncing.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.syncing.buttonLabel, "Syncing now…")
        XCTAssertEqual(CompanionPermissionSyncPhase.syncing.progressDetail, "Sending the latest payload to Forge.")
    }

    func testPermissionSyncPhaseFallsBackToRetryAfterFailure() {
        XCTAssertFalse(CompanionPermissionSyncPhase.failed.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.failed.buttonLabel, "Try again")
        XCTAssertEqual(CompanionPermissionSyncPhase.failed.progressDetail, "The action did not finish. You can retry.")
    }

    func testManualProbeCandidatesPreferTailscaleServeForMagicDNSHosts() {
        let candidates = ForgeServerDiscovery.manualProbeCandidates(
            for: "macbook-pro.tail47ba04.ts.net"
        )

        XCTAssertTrue(
            candidates.contains {
                $0.apiBaseUrl == "https://macbook-pro.tail47ba04.ts.net/api/v1"
                    && $0.uiBaseUrl == "https://macbook-pro.tail47ba04.ts.net/forge/"
                    && $0.source == .tailscale
                    && $0.canBootstrapPairing
            }
        )
    }

    func testManualProbeCandidatesNormalizeExplicitLocalApiUrl() {
        let candidates = ForgeServerDiscovery.manualProbeCandidates(
            for: "http://192.168.1.42:4317"
        )

        XCTAssertTrue(
            candidates.contains {
                $0.apiBaseUrl == "http://192.168.1.42:4317/api/v1"
                    && $0.uiBaseUrl == "http://192.168.1.42:4317/forge/"
                    && $0.source == .lan
            }
        )
    }

    func testPassiveStationaryClusterRepairsShortMoveIntoRetroactiveStay() throws {
        let store = MovementSyncStore(testingState: nil)
        store.debugSetTrackingEnabled(true)

        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let locations = stride(from: 0, through: 11, by: 1).map { minute in
            makeLocation(
                latitude: 46.5191,
                longitude: 6.6323,
                timestamp: start.addingTimeInterval(Double(minute) * 60)
            )
        }

        store.debugProcessLocations(locations)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertNotNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.stays.count, 1)
        let activeStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(activeStayStart.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 61)
        XCTAssertEqual(snapshot.activeStay?.status, "active")
        XCTAssertEqual(snapshot.latestLocationSummary, "Current state: staying")
    }

    func testValidMovePersistsWhenDurationAndDistanceExceedThresholds() {
        let store = MovementSyncStore(testingState: nil)
        store.debugSetTrackingEnabled(true)

        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let locations = [
            makeLocation(latitude: 46.5191, longitude: 6.6323, timestamp: start),
            makeLocation(latitude: 46.5196, longitude: 6.6334, timestamp: start.addingTimeInterval(60)),
            makeLocation(latitude: 46.5201, longitude: 6.6348, timestamp: start.addingTimeInterval(120)),
            makeLocation(latitude: 46.5207, longitude: 6.6362, timestamp: start.addingTimeInterval(180)),
            makeLocation(latitude: 46.5213, longitude: 6.6377, timestamp: start.addingTimeInterval(240)),
            makeLocation(latitude: 46.5218, longitude: 6.6391, timestamp: start.addingTimeInterval(300)),
            makeLocation(latitude: 46.5224, longitude: 6.6405, timestamp: start.addingTimeInterval(360))
        ]

        store.debugProcessLocations(locations)
        let snapshot = store.debugSnapshot()

        XCTAssertNotNil(snapshot.activeTrip)
        XCTAssertNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertGreaterThan(snapshot.activeTrip?.distanceMeters ?? 0, 100)
        XCTAssertEqual(snapshot.latestLocationSummary, "Current state: moving")
    }

    func testPersistedInvalidActiveTripRepairsToStayOnLoad() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(6.2 * 3600)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_bad",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 42,
                    movingSeconds: Int(6.2 * 3600),
                    idleSeconds: 0,
                    averageSpeedMps: 0.2,
                    maxSpeedMps: 0.3,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "point_a",
                            externalUid: "point_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_b",
                            externalUid: "point_b",
                            recordedAt: end,
                            latitude: 46.5192,
                            longitude: 6.63235,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.1,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 0)
        XCTAssertEqual(snapshot.stays.count, 1)
        let repairedStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(repairedStayStart.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.activeStay?.status, "active")
        XCTAssertTrue(snapshot.activeStay?.tags.contains("invalid_trip_replaced") ?? false)
    }

    func testRepairRemovesOverlappingSameKindSegmentsFromLocalState() {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_a",
                    label: "Stay A",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start,
                    endedAt: start.addingTimeInterval(3600),
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 3,
                    placeExternalUid: "",
                    placeLabel: "",
                    tags: [],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_b",
                    label: "Stay B",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start.addingTimeInterval(1800),
                    endedAt: start.addingTimeInterval(5400),
                    centerLatitude: 46.5192,
                    centerLongitude: 6.6324,
                    radiusMeters: 100,
                    sampleCount: 3,
                    placeExternalUid: "",
                    placeLabel: "",
                    tags: [],
                    metadata: [:]
                )
            ],
            trips: []
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: start.addingTimeInterval(7200))
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.stays.first?.id, "stay_a")
    }

    func testPersistedActiveTripWithStationaryTailRepairsIntoTripPlusStay() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let tailStart = start.addingTimeInterval(9 * 60)
        let end = start.addingTimeInterval(20 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_tail",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 650,
                    movingSeconds: Int(20 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.4,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "point_a",
                            externalUid: "point_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.1,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_b",
                            externalUid: "point_b",
                            recordedAt: start.addingTimeInterval(5 * 60),
                            latitude: 46.5212,
                            longitude: 6.6378,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_c",
                            externalUid: "point_c",
                            recordedAt: tailStart,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.1,
                            isStopAnchor: true
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_d",
                            externalUid: "point_d",
                            recordedAt: start.addingTimeInterval(14 * 60),
                            latitude: 46.52345,
                            longitude: 6.64125,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_e",
                            externalUid: "point_e",
                            recordedAt: end,
                            latitude: 46.52341,
                            longitude: 6.64119,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.trips.first?.status, "completed")
        let repairedTripEnd = try XCTUnwrap(snapshot.trips.first?.endedAt)
        XCTAssertEqual(repairedTripEnd.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.stays.count, 1)
        let tailStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(tailStayStart.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(snapshot.activeStay?.tags.contains("repaired_from_trip") ?? false)
    }

    func testCompletedRecentStayDoesNotReviveWithoutFreshLocationSignal() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(2 * 3600)
        let repairDate = end.addingTimeInterval(4 * 3600)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_recent",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start,
                    endedAt: end,
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 12,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: []
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.stays.first?.id, "stay_recent")
        XCTAssertEqual(snapshot.stays.first?.status, "completed")
        let preservedStayEnd = try XCTUnwrap(snapshot.stays.first?.endedAt)
        XCTAssertEqual(preservedStayEnd.timeIntervalSince1970, end.timeIntervalSince1970, accuracy: 1)
    }

    func testCompletedTripDoesNotPersistGapSmoothedDestinationStayWithoutFreshLocation() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(42 * 60)
        let repairDate = end.addingTimeInterval(30 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_done",
                    label: "Travel",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 900,
                    movingSeconds: Int(42 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_a",
                            externalUid: "trip_done_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_b",
                            externalUid: "trip_done_b",
                            recordedAt: end,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.stays.count, 0)
        XCTAssertNil(snapshot.activeStay)
    }

    func testCompletedTripDoesNotCreateGapSmoothedStayAcrossLongMissingGap() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(42 * 60)
        let repairDate = end.addingTimeInterval((60 * 60) + 1)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_done",
                    label: "Travel",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 900,
                    movingSeconds: Int(42 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_a",
                            externalUid: "trip_done_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_b",
                            externalUid: "trip_done_b",
                            recordedAt: end,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.stays.count, 0)
        XCTAssertNil(snapshot.activeStay)
    }

    func testQuietBogusMoveRepairsToActiveStayUsingCurrentTimeNotLastPointTime() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let lastPointAt = start.addingTimeInterval(60)
        let repairDate = start.addingTimeInterval(15 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_before_trip",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start.addingTimeInterval(-3 * 3600),
                    endedAt: start,
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 20,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_stuck",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: lastPointAt,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 12,
                    movingSeconds: 60,
                    idleSeconds: 0,
                    averageSpeedMps: 0.2,
                    maxSpeedMps: 0.3,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_stuck_a",
                            externalUid: "trip_stuck_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_stuck_b",
                            externalUid: "trip_stuck_b",
                            recordedAt: lastPointAt,
                            latitude: 46.51915,
                            longitude: 6.63231,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 0)
        XCTAssertNotNil(snapshot.activeStay)
        let repairedCurrentStayEnd = try XCTUnwrap(snapshot.activeStay?.endedAt)
        XCTAssertEqual(repairedCurrentStayEnd.timeIntervalSince1970, repairDate.timeIntervalSince1970, accuracy: 1)
    }

    func testHistoricalTimelineSynthesizesRepairedGapsAndMissingTail() {
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let office = CLLocationCoordinate2D(latitude: 46.5252, longitude: 6.6492)
        let park = CLLocationCoordinate2D(latitude: 46.5236, longitude: 6.6458)
        let cafe = CLLocationCoordinate2D(latitude: 46.5218, longitude: 6.6418)
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-05T12:30:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_home_1",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T07:00:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:00:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 8,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_home_2",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:20:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:40:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 6,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_cafe",
                    label: "Cafe",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:30:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T10:00:00Z") ?? Date(),
                    centerLatitude: cafe.latitude,
                    centerLongitude: cafe.longitude,
                    radiusMeters: 90,
                    sampleCount: 4,
                    placeExternalUid: "",
                    placeLabel: "Cafe",
                    tags: ["cafe"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_office_park",
                    label: "Office to park",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:44:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:10:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 1600,
                    movingSeconds: 1300,
                    idleSeconds: 60,
                    averageSpeedMps: 1.3,
                    maxSpeedMps: 2.1,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_start",
                            externalUid: "trip_start",
                            recordedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:44:00Z") ?? Date(),
                            latitude: office.latitude,
                            longitude: office.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_end",
                            externalUid: "trip_end",
                            recordedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:10:00Z") ?? Date(),
                            latitude: park.latitude,
                            longitude: park.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.4,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)

        XCTAssertGreaterThanOrEqual(timeline.filter { $0.origin == .recorded }.count, 1)
        XCTAssertEqual(
            timeline.filter { $0.origin == .repairedGap && $0.kind == .stay }.count,
            1
        )
        XCTAssertEqual(
            timeline.filter { $0.origin == .repairedGap && $0.kind == .trip }.count,
            1
        )
        XCTAssertEqual(
            timeline.filter { $0.origin == .missing && $0.kind == .missing }.count,
            1
        )
        XCTAssertTrue(
            timeline.contains(where: {
                $0.origin == .repairedGap
                    && $0.kind == .stay
                    && $0.tags.contains("suppressed-short-jump")
                    && $0.editable == false
            })
        )
        XCTAssertTrue(
            timeline.allSatisfy { segment in
                segment.origin == .recorded ? segment.editable : segment.editable == false
            }
        )
        let sortedTimeline = timeline.sorted { $0.startedAt < $1.startedAt }
        XCTAssertEqual(sortedTimeline.first?.startedAt, ISO8601DateFormatter().date(from: "2026-04-05T07:00:00Z"))
        XCTAssertEqual(sortedTimeline.last?.endedAt, referenceDate)
        for index in 1..<sortedTimeline.count {
            XCTAssertEqual(sortedTimeline[index - 1].endedAt, sortedTimeline[index].startedAt)
        }
        XCTAssertTrue(
            sortedTimeline
                .filter { $0.kind == .missing }
                .allSatisfy { $0.endedAt.timeIntervalSince($0.startedAt) >= (60 * 60) }
        )
    }

    func testHistoricalTimelineMakesLongOvernightGapsExplicitInsteadOfBlank() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let tripStart = CLLocationCoordinate2D(latitude: 46.5216, longitude: 6.6404)
        let tripEnd = CLLocationCoordinate2D(latitude: 46.5226, longitude: 6.6424)
        let referenceDate = formatter.date(from: "2026-04-06T02:40:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_home_evening",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: formatter.date(from: "2026-04-05T21:15:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-05T21:30:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 5,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_night_move",
                    label: "Night move",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T02:34:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T02:40:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 650,
                    movingSeconds: 300,
                    idleSeconds: 60,
                    averageSpeedMps: 1.8,
                    maxSpeedMps: 2.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_start",
                            externalUid: "trip_start",
                            recordedAt: formatter.date(from: "2026-04-06T02:34:00Z") ?? Date(),
                            latitude: tripStart.latitude,
                            longitude: tripStart.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.6,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_end",
                            externalUid: "trip_end",
                            recordedAt: formatter.date(from: "2026-04-06T02:40:00Z") ?? Date(),
                            latitude: tripEnd.latitude,
                            longitude: tripEnd.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.9,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)
        let sortedTimeline = timeline.sorted { $0.startedAt < $1.startedAt }

        XCTAssertEqual(sortedTimeline.count, 3)
        XCTAssertEqual(sortedTimeline[0].kind, .stay)
        XCTAssertEqual(sortedTimeline[0].origin, .recorded)
        XCTAssertEqual(sortedTimeline[1].kind, .missing)
        XCTAssertEqual(sortedTimeline[1].origin, .missing)
        XCTAssertEqual(
            Int(sortedTimeline[1].endedAt.timeIntervalSince(sortedTimeline[1].startedAt)),
            Int((5 * 60 * 60) + (4 * 60))
        )
        XCTAssertEqual(sortedTimeline[2].kind, .trip)
        XCTAssertEqual(sortedTimeline[2].origin, .recorded)
        for index in 1..<sortedTimeline.count {
            XCTAssertEqual(sortedTimeline[index - 1].endedAt, sortedTimeline[index].startedAt)
        }
    }

    func testHistoricalTimelineKeepsLoopTripWhenCumulativeDistanceIsValid() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let loopMid = CLLocationCoordinate2D(latitude: 46.5217, longitude: 6.6376)
        let referenceDate = formatter.date(from: "2026-04-06T10:10:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_loop_valid",
                    label: "Loop walk",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T10:08:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 340,
                    movingSeconds: 420,
                    idleSeconds: 30,
                    averageSpeedMps: 1.2,
                    maxSpeedMps: 1.8,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_start",
                            externalUid: "loop_start",
                            recordedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_mid",
                            externalUid: "loop_mid",
                            recordedAt: formatter.date(from: "2026-04-06T10:04:00Z") ?? Date(),
                            latitude: loopMid.latitude,
                            longitude: loopMid.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.4,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_end",
                            externalUid: "loop_end",
                            recordedAt: formatter.date(from: "2026-04-06T10:08:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)

        XCTAssertEqual(timeline.filter { $0.kind == .trip && $0.origin == .recorded }.count, 1)
        XCTAssertFalse(timeline.contains(where: { $0.kind == .stay && $0.tags.contains("invalid_trip_replaced") }))
    }

    func testInvalidCompletedTripRepairsIntoStayUsingCumulativeDistanceRule() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let referenceDate = formatter.date(from: "2026-04-06T11:00:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_tiny_invalid_completed",
                    label: "Tiny move",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T10:20:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T10:32:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 80,
                    movingSeconds: 720,
                    idleSeconds: 0,
                    averageSpeedMps: 0.5,
                    maxSpeedMps: 0.8,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "tiny_start",
                            externalUid: "tiny_start",
                            recordedAt: formatter.date(from: "2026-04-06T10:20:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.5,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "tiny_end",
                            externalUid: "tiny_end",
                            recordedAt: formatter.date(from: "2026-04-06T10:32:00Z") ?? Date(),
                            latitude: home.latitude + 0.0002,
                            longitude: home.longitude + 0.0002,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.4,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: referenceDate)
        let snapshot = store.debugSnapshot()

        XCTAssertTrue(snapshot.trips.isEmpty)
        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.timeline.filter { $0.kind == .trip }.count, 0)
        XCTAssertTrue(
            snapshot.stays.contains(where: {
                $0.metadata["derivedFrom"] == "invalid_trip"
                    && $0.metadata["invalidTripReason"] == "under_cumulative_distance_threshold"
            })
        )
    }

    func testDisplayNormalizerCollapsesTinyTailTripIntoOneOngoingStay() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-06T10:02:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-home",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "tiny-trip",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:15Z") ?? Date(),
                durationSeconds: 15,
                distanceMeters: 12,
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineDisplayNormalizer.normalize(items: items, referenceDate: referenceDate)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Home")
        XCTAssertTrue(normalized.first?.isCurrent ?? false)
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testDisplayNormalizerCollapsesTinyTripBetweenSamePlaceStays() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-06T10:03:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-home-a",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "tiny-trip",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:20Z") ?? Date(),
                durationSeconds: 20,
                distanceMeters: 18,
                origin: .recorded
            ),
            makeDisplayItem(
                id: "stay-home-b",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:01:20Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:02:00Z") ?? Date(),
                origin: .recorded,
                isCurrent: true
            )
        ]

        let normalized = MovementTimelineDisplayNormalizer.normalize(items: items, referenceDate: referenceDate)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Home")
        XCTAssertFalse(normalized.contains(where: { $0.kind == .trip }))
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testCanonicalNormalizerKeepsSharedBackendMissingBoxVisible() throws {
        let scenario = try loadSharedMovementFixture(id: "overnight_gap_before_move")
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-06T02:40:00Z") ?? Date()
        let items = scenario.projectedTimeline.compactMap(MovementLifeTimelineItem.init(remote:))

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: referenceDate
        )

        XCTAssertEqual(normalized.count, 3)
        XCTAssertEqual(normalized[1].kind, .missing)
        XCTAssertEqual(normalized[1].origin, .missing)
        XCTAssertEqual(
            normalized[1].startedAtDate,
            sharedMovementFixtureDateFormatter.date(from: "2026-04-05T21:30:00.000Z")
        )
        XCTAssertEqual(
            normalized[1].endedAtDate,
            sharedMovementFixtureDateFormatter.date(from: "2026-04-06T02:34:00.000Z")
        )
    }

    func testCanonicalNormalizerExtendsLastCanonicalStayToNowWithoutInventingExtraBoxes() throws {
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-05T10:20:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "canonical-stay",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:00:00Z") ?? Date(),
                endedAt: ISO8601DateFormatter().date(from: "2026-04-05T10:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: referenceDate
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertTrue(normalized.first?.isCurrent ?? false)
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testMovementStoreCachesCanonicalProjectedBoxesFromBootstrap() {
        let projected = try! loadSharedMovementFixture(
            id: "user_defined_missing_override"
        ).projectedTimeline

        let store = MovementSyncStore(testingState: nil)
        store.mergeBootstrap(
            SyncReceipt.MovementBootstrapEnvelope(
                stayOverrides: [],
                tripOverrides: [],
                deletedStayExternalUids: [],
                deletedTripExternalUids: [],
                settings: .init(
                    trackingEnabled: true,
                    publishMode: "auto_publish",
                    retentionMode: "aggregates_only",
                    locationPermissionStatus: "always",
                    motionPermissionStatus: "ready",
                    backgroundTrackingReady: true
                ),
                places: [],
                projectedBoxes: projected
            )
        )

        XCTAssertEqual(store.cachedProjectedBoxes.map(\.id), projected.map(\.id))
        XCTAssertTrue(
            store.cachedProjectedBoxes.contains(where: { box in
                box.sourceKind == "user_defined" && box.id == "user_missing_override_fixture"
            })
        )
    }

    func testRemoteMovementTimelineItemPreservesCanonicalUserDefinedBoxSemantics() throws {
        let segment = try loadSharedMovementFixture(
            id: "user_defined_missing_override"
        )
            .projectedTimeline
            .first(where: { $0.sourceKind == "user_defined" && $0.kind == "missing" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .missing)
        XCTAssertEqual(item.sourceKind, "user_defined")
        XCTAssertEqual(item.origin, .userInvalidated)
        XCTAssertEqual(item.overrideCount, 1)
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds.count, 0)
        XCTAssertEqual(item.rawPointCount, 0)
        XCTAssertTrue(item.editable)
        guard case .remoteUserBox(let boxId, _) = item.source else {
            return XCTFail("Expected a remote user-defined movement box source.")
        }
        XCTAssertEqual(boxId, "user_missing_override_fixture")
    }

    func testRemoteMovementTimelineItemPreservesCanonicalMissingCoverageSemantics() throws {
        let segment = try loadSharedMovementFixture(
            id: "overnight_gap_before_move"
        )
            .projectedTimeline
            .first(where: { $0.kind == "missing" && $0.sourceKind == "automatic" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .missing)
        XCTAssertEqual(item.sourceKind, "automatic")
        XCTAssertEqual(item.origin, .missing)
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds.count, 0)
        XCTAssertEqual(item.rawPointCount, 0)
        XCTAssertFalse(item.editable)
    }

    func testRemoteMovementTimelineItemPreservesCanonicalRawTripReferences() throws {
        let segment = try loadSharedMovementFixture(
            id: "overnight_gap_before_move"
        )
            .projectedTimeline
            .first(where: { $0.kind == "trip" && $0.sourceKind == "automatic" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .trip)
        XCTAssertEqual(item.sourceKind, "automatic")
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds, ["trip_night_move"])
        XCTAssertEqual(item.rawPointCount, 3)
        XCTAssertFalse(item.editable)
    }

    private func makeLocation(
        latitude: Double,
        longitude: Double,
        timestamp: Date
    ) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            altitude: 0,
            horizontalAccuracy: 8,
            verticalAccuracy: 8,
            course: 0,
            speed: 0,
            timestamp: timestamp
        )
    }

    private func makeDisplayItem(
        id: String,
        kind: MovementLifeTimelineItem.Kind,
        title: String,
        placeLabel: String?,
        startedAt: Date,
        endedAt: Date,
        durationSeconds: Int? = nil,
        distanceMeters: Double? = nil,
        origin: MovementLifeTimelineItem.Origin,
        isCurrent: Bool = false
    ) -> MovementLifeTimelineItem {
        MovementLifeTimelineItem(
            id: id,
            source: .derived(id),
            kind: kind,
            title: title,
            subtitle: "",
            placeLabel: placeLabel,
            tags: [],
            syncSource: "test",
            startedAtDate: startedAt,
            endedAtDate: endedAt,
            durationSeconds: durationSeconds ?? max(60, Int(endedAt.timeIntervalSince(startedAt))),
            laneSide: kind == .trip ? .right : .left,
            connectorFromLane: kind == .trip ? .right : .left,
            connectorToLane: kind == .trip ? .right : .left,
            distanceMeters: distanceMeters,
            averageSpeedMps: nil,
            origin: origin,
            editable: origin == .recorded,
            isCurrent: isCurrent
        )
    }

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }
}
