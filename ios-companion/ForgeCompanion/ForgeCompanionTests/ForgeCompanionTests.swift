//
//  ForgeCompanionTests.swift
//  ForgeCompanionTests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest
import CoreLocation
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

    func testPassiveStationaryClusterRepairsShortMoveIntoRetroactiveStay() {
        let store = MovementSyncStore(testingState: nil)
        store.debugSetTrackingEnabled(true)

        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let locations = stride(from: 0, through: 10, by: 1).map { minute in
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
        XCTAssertEqual(snapshot.activeStay?.startedAt.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 1)
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

    func testPersistedInvalidActiveTripRepairsToStayOnLoad() {
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
        XCTAssertEqual(snapshot.activeStay?.startedAt.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 1)
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

    func testPersistedActiveTripWithStationaryTailRepairsIntoTripPlusStay() {
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
        XCTAssertEqual(snapshot.trips.first?.endedAt.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.activeStay?.startedAt.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(snapshot.activeStay?.tags.contains("repaired_from_trip") ?? false)
    }

    func testCompletedRecentStayRevivesAcrossShortMissingGap() {
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
        XCTAssertEqual(snapshot.activeStay?.id, "stay_recent")
        XCTAssertEqual(snapshot.activeStay?.status, "active")
        XCTAssertEqual(snapshot.activeStay?.endedAt.timeIntervalSince1970, repairDate.timeIntervalSince1970, accuracy: 1)
    }

    func testCompletedTripCreatesGapSmoothedDestinationStay() {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(42 * 60)
        let repairDate = end.addingTimeInterval(2 * 3600)
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
        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.activeStay?.startedAt.timeIntervalSince1970, end.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.activeStay?.endedAt.timeIntervalSince1970, repairDate.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(snapshot.activeStay?.tags.contains("gap_smoothed") ?? false)
    }

    func testQuietBogusMoveRepairsToActiveStayUsingCurrentTimeNotLastPointTime() {
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
        XCTAssertEqual(snapshot.activeStay?.endedAt.timeIntervalSince1970, repairDate.timeIntervalSince1970, accuracy: 1)
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

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }
}
