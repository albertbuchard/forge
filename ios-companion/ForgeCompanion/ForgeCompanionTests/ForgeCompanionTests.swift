//
//  ForgeCompanionTests.swift
//  ForgeCompanionTests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest
import CoreLocation
import HealthKit
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
    private func makeDate(_ value: String) -> Date {
        guard let date = sharedMovementFixtureDateFormatter.date(from: value) else {
            XCTFail("Invalid test date \(value)")
            return Date(timeIntervalSince1970: 0)
        }
        return date
    }

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

    func testSleepInferenceCountsShortInternalGapsWhenInBedIsMissing() async {
        let store = HealthSyncStore()
        let segments = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T23:10:00.000Z"),
                endDate: makeDate("2026-04-05T00:00:00.000Z"),
                stageLabel: "rem",
                bucket: .asleep,
                sourceValue: 5
            )
        ]

        let inferredGap = await store.inferredGapDuration(for: segments, threshold: 15 * 60)

        XCTAssertEqual(inferredGap, 600)
    }

    func testSleepInferenceMergesOverlappingStageSegments() async {
        let store = HealthSyncStore()
        let segments = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T22:30:00.000Z"),
                endDate: makeDate("2026-04-04T23:30:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            )
        ]

        let breakdown = await store.mergedStageBreakdown(for: segments)

        XCTAssertEqual(breakdown.count, 1)
        XCTAssertEqual(breakdown.first?.stage, "core")
        XCTAssertEqual(breakdown.first?.seconds, 5_400)
    }

    func testSleepInferenceSelectsLongestOvernightEpisodePerWakeDate() async {
        let store = HealthSyncStore()
        let episodes = [
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-05T05:30:00.000Z"),
                localDateKey: "2026-04-05",
                sourceTimezone: "UTC",
                rawSegmentCount: 6,
                timeInBedSeconds: 27_000,
                asleepSeconds: 25_800,
                awakeSeconds: 1_200,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            ),
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-05T12:00:00.000Z"),
                endDate: makeDate("2026-04-05T13:00:00.000Z"),
                localDateKey: "2026-04-05",
                sourceTimezone: "UTC",
                rawSegmentCount: 2,
                timeInBedSeconds: 3_600,
                asleepSeconds: 3_000,
                awakeSeconds: 600,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            ),
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-05T23:00:00.000Z"),
                endDate: makeDate("2026-04-06T06:00:00.000Z"),
                localDateKey: "2026-04-06",
                sourceTimezone: "UTC",
                rawSegmentCount: 5,
                timeInBedSeconds: 25_200,
                asleepSeconds: 24_000,
                awakeSeconds: 1_200,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            )
        ]

        let canonical = await store.selectCanonicalNights(from: episodes)

        XCTAssertEqual(canonical.count, 2)
        XCTAssertEqual(canonical[0].localDateKey, "2026-04-06")
        XCTAssertEqual(canonical[1].localDateKey, "2026-04-05")
        XCTAssertEqual(canonical[1].timeInBedSeconds, 27_000)
    }

    func testSleepInferenceClusteringSplitsOnlyOnRealLongGaps() async {
        let store = HealthSyncStore()
        let anchors = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T23:20:00.000Z"),
                endDate: makeDate("2026-04-05T00:00:00.000Z"),
                stageLabel: "deep",
                bucket: .asleep,
                sourceValue: 4
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_3",
                startDate: makeDate("2026-04-05T05:10:00.000Z"),
                endDate: makeDate("2026-04-05T06:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_4",
                startDate: makeDate("2026-04-05T06:10:00.000Z"),
                endDate: makeDate("2026-04-05T06:40:00.000Z"),
                stageLabel: "rem",
                bucket: .asleep,
                sourceValue: 5
            )
        ]

        let clusters = await store.clusterSleepAnchorSegments(anchors)

        XCTAssertEqual(clusters.count, 2)
        XCTAssertEqual(clusters[0].count, 2)
        XCTAssertEqual(clusters[1].count, 2)
    }

    func testCompanionSyncPayloadEncodesRawSleepRecordsAlongsideSegmentsAndNights() throws {
        let payload = CompanionSyncPayload(
            sessionId: "pair_1",
            pairingToken: "token",
            device: .init(
                name: "Omar iPhone",
                platform: "ios",
                appVersion: "1.0",
                sourceDevice: "iPhone"
            ),
            permissions: .init(
                healthKitAuthorized: true,
                backgroundRefreshEnabled: true,
                motionReady: false,
                locationReady: false,
                screenTimeReady: false
            ),
            sourceStates: .init(
                health: .init(
                    desiredEnabled: true,
                    appliedEnabled: true,
                    authorizationStatus: "approved",
                    syncEligible: true,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                movement: .init(
                    desiredEnabled: false,
                    appliedEnabled: false,
                    authorizationStatus: "not_determined",
                    syncEligible: false,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                screenTime: .init(
                    desiredEnabled: false,
                    appliedEnabled: false,
                    authorizationStatus: "not_determined",
                    syncEligible: false,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                )
            ),
            sleepSessions: [],
            sleepNights: [
                .init(
                    externalUid: "night_1",
                    startedAt: "2026-04-04T22:00:00.000Z",
                    endedAt: "2026-04-05T06:00:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    timeInBedSeconds: 28_800,
                    asleepSeconds: 27_000,
                    awakeSeconds: 1_800,
                    rawSegmentCount: 2,
                    stageBreakdown: [.init(stage: "core", seconds: 18_000)],
                    recoveryMetrics: [:],
                    sourceMetrics: [:],
                    links: [],
                    annotations: .init(qualitySummary: "", notes: "", tags: [])
                )
            ],
            sleepSegments: [
                .init(
                    externalUid: "seg_1",
                    startedAt: "2026-04-04T22:15:00.000Z",
                    endedAt: "2026-04-05T01:15:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    stage: "core",
                    bucket: "asleep",
                    sourceValue: 3,
                    metadata: [:]
                )
            ],
            sleepRawRecords: [
                .init(
                    externalUid: "seg_1",
                    startedAt: "2026-04-04T22:15:00.000Z",
                    endedAt: "2026-04-05T01:15:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    providerRecordType: "healthkit_sleep_sample",
                    rawStage: "core",
                    rawValue: 3,
                    payload: ["source": .string("unit-test")],
                    metadata: [:]
                )
            ],
            workouts: [],
            vitals: .init(daySummaries: []),
            movement: .init(
                settings: .init(
                    trackingEnabled: false,
                    publishMode: "disabled",
                    retentionMode: "device_only",
                    locationPermissionStatus: "not_determined",
                    motionPermissionStatus: "not_determined",
                    backgroundTrackingReady: false,
                    metadata: [:]
                ),
                knownPlaces: [],
                stays: [],
                trips: []
            ),
            screenTime: .init(
                settings: .init(
                    trackingEnabled: false,
                    syncEnabled: false,
                    authorizationStatus: "not_determined",
                    captureState: "disabled",
                    lastCapturedDayKey: nil,
                    lastCaptureStartedAt: nil,
                    lastCaptureEndedAt: nil,
                    metadata: [:]
                ),
                daySummaries: [],
                hourlySegments: []
            )
        )

        let encoded = try JSONEncoder().encode(payload)
        let json = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]

        XCTAssertEqual((json?["sleepRawRecords"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((json?["sleepSegments"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((json?["sleepNights"] as? [[String: Any]])?.count, 1)
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

    func testCanonicalNormalizerCoalescesTouchingSamePlaceStays() throws {
        let formatter = ISO8601DateFormatter()
        let firstStart = try XCTUnwrap(formatter.date(from: "2026-04-22T13:51:00Z"))
        let secondEnd = try XCTUnwrap(formatter.date(from: "2026-04-22T15:05:00Z"))
        let items = [
            makeDisplayItem(
                id: "canonical-gym-a",
                kind: .stay,
                title: "Gym",
                placeLabel: "Gym",
                startedAt: firstStart,
                endedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "canonical-gym-b",
                kind: .stay,
                title: "Gym",
                placeLabel: "Gym",
                startedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
                endedAt: secondEnd,
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: secondEnd
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Gym")
        XCTAssertEqual(normalized.first?.startedAtDate, firstStart)
        XCTAssertEqual(normalized.first?.endedAtDate, secondEnd)
    }

    func testCanonicalNormalizerCoalescesTouchingStaysSharingRawStayIdsEvenWhenLabelsDiffer() throws {
        let formatter = ISO8601DateFormatter()
        let firstStart = try XCTUnwrap(formatter.date(from: "2026-04-22T13:51:00Z"))
        let secondEnd = try XCTUnwrap(formatter.date(from: "2026-04-22T15:05:00Z"))
        let first = makeDisplayItem(
            id: "canonical-stay-a",
            kind: .stay,
            title: "Stay",
            placeLabel: nil,
            startedAt: firstStart,
            endedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
            origin: .recorded
        ).copy(rawStayIds: ["stay_remote_1"])
        let second = makeDisplayItem(
            id: "canonical-stay-b",
            kind: .stay,
            title: "Gym",
            placeLabel: "Gym",
            startedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
            endedAt: secondEnd,
            origin: .recorded
        ).copy(rawStayIds: ["remote_1"])

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: [first, second],
            liveOverlay: nil,
            referenceDate: secondEnd
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Gym")
        XCTAssertEqual(normalized.first?.rawStayIds, ["remote_1", "stay_remote_1"])
    }

    func testSleepOverlayNormalizerSlicesMovementItemsWithoutPersistingFragments() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-20T08:00:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-before",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T20:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-19T23:00:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "trip-after",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-20T06:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-20T07:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T22:00:00Z",
                endedAt: "2026-04-20T06:30:00Z",
                localDateKey: "2026-04-20",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 28_800,
                timeInBedSeconds: 30_600,
                sleepScore: 84,
                regularityScore: 77,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: items,
            overlays: overlays,
            referenceDate: referenceDate
        )

        XCTAssertEqual(overlaid.count, 3)
        XCTAssertEqual(overlaid[0].startedAtDate, formatter.date(from: "2026-04-19T20:00:00Z"))
        XCTAssertEqual(overlaid[0].endedAtDate, formatter.date(from: "2026-04-19T21:59:59Z"))
        XCTAssertEqual(overlaid[0].durationSeconds, 7_199)
        XCTAssertTrue(overlaid[1].isSleepOverlay)
        XCTAssertEqual(overlaid[1].startedAtDate, formatter.date(from: "2026-04-19T22:00:00Z"))
        XCTAssertEqual(overlaid[1].endedAtDate, formatter.date(from: "2026-04-20T06:30:00Z"))
        XCTAssertEqual(overlaid[2].startedAtDate, formatter.date(from: "2026-04-20T06:30:01Z"))
        XCTAssertEqual(overlaid[2].endedAtDate, formatter.date(from: "2026-04-20T07:00:00Z"))
        XCTAssertEqual(overlaid[2].durationSeconds, 1_799)
    }

    func testSleepOverlaySlicesRecalculateDisplayDurationFromTrimmedDates() throws {
        let formatter = ISO8601DateFormatter()
        let sourceStay = makeDisplayItem(
            id: "long-source-stay",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-18T19:19:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-19T04:05:00Z") ?? Date(),
            durationSeconds: 86_400,
            origin: .recorded
        )
        let overlay = ForgeMovementTimelineSleepOverlay(
            id: "sleep-slice",
            externalUid: "sleep-slice",
            startedAt: "2026-04-19T01:43:00Z",
            endedAt: "2026-04-19T03:54:00Z",
            localDateKey: "2026-04-19",
            sourceTimezone: "Europe/Zurich",
            asleepSeconds: 7_860,
            timeInBedSeconds: 7_860,
            sleepScore: 84,
            regularityScore: 77,
            efficiency: 0.94,
            recoveryState: "rested"
        )

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: [sourceStay],
            overlays: [overlay],
            referenceDate: formatter.date(from: "2026-04-19T06:00:00Z") ?? Date()
        )

        XCTAssertEqual(overlaid.count, 3)
        XCTAssertEqual(overlaid[0].startedAtDate, formatter.date(from: "2026-04-18T19:19:00Z"))
        XCTAssertEqual(overlaid[0].endedAtDate, formatter.date(from: "2026-04-19T01:42:59Z"))
        XCTAssertEqual(overlaid[0].durationSeconds, 23_039)
        XCTAssertTrue(overlaid[1].isSleepOverlay)
        XCTAssertEqual(overlaid[2].startedAtDate, formatter.date(from: "2026-04-19T03:54:01Z"))
        XCTAssertEqual(overlaid[2].endedAtDate, formatter.date(from: "2026-04-19T04:05:00Z"))
        XCTAssertEqual(overlaid[2].durationSeconds, 659)
        XCTAssertEqual(overlaid[2].durationLabel, "10m")
    }

    func testSleepOverlayNormalizerHidesFullyCoveredBoxes() {
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T22:00:00Z",
                endedAt: "2026-04-20T06:30:00Z",
                localDateKey: "2026-04-20",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 28_800,
                timeInBedSeconds: 30_600,
                sleepScore: 84,
                regularityScore: 77,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]
        let formatter = ISO8601DateFormatter()
        let items = [
            makeDisplayItem(
                id: "covered-stay",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T23:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-20T01:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: items,
            overlays: overlays,
            referenceDate: formatter.date(from: "2026-04-20T08:00:00Z") ?? Date()
        )

        XCTAssertEqual(overlaid.count, 1)
        XCTAssertTrue(overlaid[0].isSleepOverlay)
    }

    func testRenderManagerBuildsCanonicalPostOverlaySegmentsWithoutSyntheticBackgroundBands() {
        let formatter = ISO8601DateFormatter()
        let baseItems = [
            makeDisplayItem(
                id: "home-overnight",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T02:15:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-19T23:20:00Z") ?? Date(),
                origin: .recorded
            )
        ]
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T04:05:00Z",
                endedAt: "2026-04-19T11:08:00Z",
                localDateKey: "2026-04-19",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 25_380,
                timeInBedSeconds: 26_040,
                sleepScore: 84,
                regularityScore: 78,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]

        let renderState = MovementTimelineRenderManager.render(
            baseItems: baseItems,
            sleepOverlays: overlays,
            referenceDate: formatter.date(from: "2026-04-19T23:20:00Z") ?? Date(),
            sleepOverlayVisible: true
        )

        XCTAssertEqual(renderState.items.count, 3)
        XCTAssertTrue(renderState.items.contains(where: { $0.isSleepOverlay }))
        XCTAssertTrue(
            renderState.items.contains(where: { item in
                item.isSleepOverlay == false
                    && item.startedAtDate == formatter.date(from: "2026-04-19T11:08:01Z")
                    && item.endedAtDate == formatter.date(from: "2026-04-19T23:20:00Z")
            })
        )
    }

    func testLifeTimelineScreenshotFixtureUsesLongPostSleepState() {
        let state = CompanionScreenshotFixtures.movementState(for: .lifeTimeline)

        XCTAssertEqual(state.knownPlaces.count, 1)
        XCTAssertEqual(state.trips.count, 0)
        XCTAssertEqual(state.stays.count, 3)
        XCTAssertEqual(state.stays.last?.startedAt, makeDate("2026-04-19T09:08:00.000Z"))
        XCTAssertEqual(state.stays.last?.endedAt, CompanionScreenshotFixtures.lifeTimelineReferenceDate)
    }

    func testLifeTimelineScreenshotFixtureProvidesOvernightSleepOverlay() {
        let overlays = CompanionScreenshotFixtures.sleepTimelineOverlays(for: .lifeTimeline)

        XCTAssertEqual(overlays.count, 1)
        XCTAssertEqual(overlays.first?.startedAt, "2026-04-19T02:05:00.000Z")
        XCTAssertEqual(overlays.first?.endedAt, "2026-04-19T09:08:00.000Z")
    }

    func testViewportHourMarkersTrackCompressedSleepOverlayGeometry() throws {
        let formatter = ISO8601DateFormatter()
        let sleepItem = makeDisplayItem(
            id: "sleep-overlay",
            kind: .stay,
            title: "Sleep",
            placeLabel: nil,
            startedAt: formatter.date(from: "2026-04-19T22:00:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-20T06:30:00Z") ?? Date(),
            durationSeconds: 30_600,
            origin: .recorded
        )

        let layout = buildMovementViewportLayoutModel(
            items: [sleepItem],
            viewportHeight: 844,
            safeTopInset: 0,
            bottomPadding: 0,
            rangeEnd: sleepItem.endedAtDate
        )
        let row = try XCTUnwrap(layout.items.first)
        let rangeEnd = sleepItem.endedAtDate

        let startY = try XCTUnwrap(
            movementViewportYPosition(for: sleepItem.startedAtDate, layout: layout, rangeEnd: rangeEnd)
        )
        let midnightY = try XCTUnwrap(
            movementViewportYPosition(
                for: formatter.date(from: "2026-04-20T00:00:00Z") ?? Date(),
                layout: layout,
                rangeEnd: rangeEnd
            )
        )
        let fourAmY = try XCTUnwrap(
            movementViewportYPosition(
                for: formatter.date(from: "2026-04-20T04:00:00Z") ?? Date(),
                layout: layout,
                rangeEnd: rangeEnd
            )
        )
        let endY = try XCTUnwrap(
            movementViewportYPosition(for: sleepItem.endedAtDate, layout: layout, rangeEnd: rangeEnd)
        )

        XCTAssertEqual(startY, row.boxTop, accuracy: 0.5)
        XCTAssertEqual(endY, row.boxBottom, accuracy: 0.5)
        XCTAssertGreaterThan(midnightY, startY)
        XCTAssertGreaterThan(fourAmY, midnightY)
        XCTAssertLessThan(fourAmY, endY)

        let inBoxMarkers = buildMovementViewportHourMarkers(
            layout: layout,
            rangeEnd: rangeEnd
        )
        .filter { $0.y >= row.boxTop - 0.5 && $0.y <= row.boxBottom + 0.5 }

        XCTAssertFalse(inBoxMarkers.isEmpty)
        XCTAssertTrue(
            zip(inBoxMarkers, inBoxMarkers.dropFirst()).allSatisfy { previous, next in
                next.y > previous.y
            }
        )
    }

    func testViewportHourMarkerLinesUseExactFractionalHourCoordinates() throws {
        let formatter = ISO8601DateFormatter()
        let postSleepStay = makeDisplayItem(
            id: "post-sleep-home",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-19T03:54:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-19T04:05:00Z") ?? Date(),
            durationSeconds: 660,
            origin: .recorded
        )

        let rangeEnd = formatter.date(from: "2026-04-19T05:00:00Z") ?? Date()
        let fourAm = formatter.date(from: "2026-04-19T04:00:00Z") ?? Date()
        let layout = buildMovementViewportLayoutModel(
            items: [postSleepStay],
            viewportHeight: 844,
            safeTopInset: 0,
            bottomPadding: 0,
            rangeEnd: rangeEnd
        )
        let row = try XCTUnwrap(layout.items.first)
        let fourAmY = try XCTUnwrap(
            movementViewportYPosition(for: fourAm, layout: layout, rangeEnd: rangeEnd)
        )
        let fourAmMarker = try XCTUnwrap(
            buildMovementViewportHourMarkers(layout: layout, rangeEnd: rangeEnd)
                .first { $0.date == fourAm }
        )
        let expectedRatio = CGFloat(fourAm.timeIntervalSince(postSleepStay.startedAtDate) / postSleepStay.endedAtDate.timeIntervalSince(postSleepStay.startedAtDate))

        XCTAssertEqual(fourAmMarker.y, fourAmY, accuracy: 0.5)
        XCTAssertEqual(movementViewportHourMarkerLineOffset(for: fourAmMarker), fourAmY, accuracy: 0.5)
        XCTAssertEqual(fourAmY - row.boxTop, row.boxHeight * expectedRatio, accuracy: 0.5)
        XCTAssertEqual(row.boxBottom - fourAmY, row.boxHeight * (1 - expectedRatio), accuracy: 0.5)
        XCTAssertLessThan(row.boxTop, movementViewportHourMarkerLineOffset(for: fourAmMarker))
        XCTAssertGreaterThan(row.boxBottom, movementViewportHourMarkerLineOffset(for: fourAmMarker))
    }

    func testViewportVirtualizationUsesAbsoluteTimelineGeometry() throws {
        let formatter = ISO8601DateFormatter()
        let overnightStay = makeDisplayItem(
            id: "home-overnight",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-25T22:06:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T17:15:00Z") ?? Date(),
            durationSeconds: 68_940,
            origin: .recorded
        )
        let shortMove = makeDisplayItem(
            id: "move-after-home",
            kind: .trip,
            title: "Move",
            placeLabel: nil,
            startedAt: formatter.date(from: "2026-04-26T17:15:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T17:26:00Z") ?? Date(),
            durationSeconds: 660,
            distanceMeters: 2_900,
            origin: .recorded
        )
        let gymStay = makeDisplayItem(
            id: "gym-stay",
            kind: .stay,
            title: "Gym",
            placeLabel: "Gym",
            startedAt: formatter.date(from: "2026-04-26T17:26:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T19:52:00Z") ?? Date(),
            durationSeconds: 8_760,
            origin: .recorded
        )
        let laterStay = makeDisplayItem(
            id: "later-stay",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-29T01:00:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-29T03:00:00Z") ?? Date(),
            durationSeconds: 7_200,
            origin: .recorded
        )

        let layout = buildMovementViewportLayoutModel(
            items: [overnightStay, shortMove, gymStay, laterStay],
            viewportHeight: 844,
            safeTopInset: 47,
            bottomPadding: 114,
            rangeEnd: (formatter.date(from: "2026-04-29T04:00:00Z") ?? Date())
        )
        let rangeEnd = formatter.date(from: "2026-04-29T04:00:00Z") ?? Date()

        for metric in layout.items {
            let startY = try XCTUnwrap(
                movementViewportYPosition(for: metric.item.startedAtDate, layout: layout, rangeEnd: rangeEnd)
            )
            let endY = try XCTUnwrap(
                movementViewportYPosition(for: metric.item.endedAtDate, layout: layout, rangeEnd: rangeEnd)
            )

            XCTAssertEqual(startY, metric.boxTop, accuracy: 0.5)
            XCTAssertEqual(endY, metric.boxBottom, accuracy: 0.5)
        }

        let visibleAtTop = visibleMovementViewportItems(
            layout: layout,
            scrollTop: 0,
            viewportHeight: 844
        )
        XCTAssertTrue(visibleAtTop.contains(where: { $0.id == overnightStay.id }))
        XCTAssertTrue(visibleAtTop.contains(where: { $0.id == laterStay.id }))

        let gymMetric = try XCTUnwrap(layout.items.first(where: { $0.id == gymStay.id }))
        let visibleAroundGym = visibleMovementViewportItems(
            layout: layout,
            scrollTop: gymMetric.boxTop - 120,
            viewportHeight: 360
        )

        XCTAssertTrue(visibleAroundGym.contains(where: { $0.id == gymStay.id }))
        XCTAssertTrue(visibleAroundGym.allSatisfy { $0.boxBottom >= 0 })
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

    func testMovementStoreDeduplicatesKnownPlacesFromTestingState() {
        let duplicateExternalUid = "user-place-work-ucpt"
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [
                    MovementSyncStore.StoredKnownPlace(
                        id: "place_a",
                        externalUid: duplicateExternalUid,
                        label: "Work",
                        aliases: [],
                        latitude: 46.5191,
                        longitude: 6.6323,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    ),
                    MovementSyncStore.StoredKnownPlace(
                        id: "place_b",
                        externalUid: duplicateExternalUid,
                        label: "Work Duplicate",
                        aliases: [],
                        latitude: 46.5192,
                        longitude: 6.6324,
                        radiusMeters: 120,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    )
                ],
                stays: [],
                trips: []
            )
        )

        let payload = store.buildMovementPayload()

        XCTAssertEqual(payload.knownPlaces.count, 1)
        XCTAssertEqual(payload.knownPlaces.first?.externalUid, duplicateExternalUid)
        XCTAssertEqual(payload.knownPlaces.first?.id, "place_a")
    }

    func testMovementStoreMergeBootstrapDeduplicatesLocalAndRemoteKnownPlaces() {
        let duplicateExternalUid = "user-place-work-ucpt"
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [
                    MovementSyncStore.StoredKnownPlace(
                        id: "local_place_a",
                        externalUid: duplicateExternalUid,
                        label: "Work",
                        aliases: ["Office"],
                        latitude: 46.5191,
                        longitude: 6.6323,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    ),
                    MovementSyncStore.StoredKnownPlace(
                        id: "local_place_b",
                        externalUid: duplicateExternalUid,
                        label: "Work Duplicate",
                        aliases: [],
                        latitude: 46.5192,
                        longitude: 6.6324,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    )
                ],
                stays: [],
                trips: []
            )
        )

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
                places: [
                    .init(
                        id: "remote_place_a",
                        externalUid: duplicateExternalUid,
                        label: "Remote Work",
                        aliases: [],
                        latitude: 46.6,
                        longitude: 6.7,
                        radiusMeters: 90,
                        categoryTags: ["work"]
                    ),
                    .init(
                        id: "remote_place_b",
                        externalUid: duplicateExternalUid,
                        label: "Remote Work Duplicate",
                        aliases: [],
                        latitude: 46.61,
                        longitude: 6.71,
                        radiusMeters: 95,
                        categoryTags: ["work"]
                    )
                ],
                projectedBoxes: []
            )
        )

        let payload = store.buildMovementPayload()

        XCTAssertEqual(payload.knownPlaces.count, 1)
        XCTAssertEqual(payload.knownPlaces.first?.externalUid, duplicateExternalUid)
        XCTAssertEqual(payload.knownPlaces.first?.id, "local_place_a")
        XCTAssertEqual(payload.knownPlaces.first?.label, "Work")
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

    func testMovementLifeTimelineItemLinkableStayIdsKeepRemoteRawStayIdsWithoutLocalCache() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        let store = MovementSyncStore(testingState: nil)
        XCTAssertEqual(item.linkableStayIds(using: store), ["stay_remote_1"])
    }

    func testPromotedCurrentTimelineItemResolvesToStoredStayIdentifier() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let endedAt = startedAt.addingTimeInterval(3600)
        let item = MovementLifeTimelineItem(
            id: "remote-current-stay-item",
            source: .remoteAutomatic(
                "box_remote_current_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: ["workplace"],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: endedAt,
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        let promoted = item.promotedToCurrent(referenceDate: endedAt.addingTimeInterval(1200))
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: endedAt,
                        centerLatitude: 46.5191,
                        centerLongitude: 6.6323,
                        radiusMeters: 85,
                        sampleCount: 4,
                        placeExternalUid: "",
                        placeLabel: "",
                        tags: ["workplace"],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )

        XCTAssertEqual(promoted.rawStayIds, ["stay_remote_1"])
        XCTAssertEqual(promoted.linkableStayIds(using: store), ["stay_remote_1"])
        XCTAssertTrue(promoted.isCurrent)
    }

    func testCanonicalNormalizerPreservesRawStayIdsWhenMergingLiveOverlay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let canonicalStay = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Remote canonical stay",
            placeLabel: "Work",
            tags: ["workplace"],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )
        let liveOverlay = MovementLifeTimelineItem(
            id: "live-stay-item",
            source: .liveStay(
                "remote_1",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Current stay",
            placeLabel: "Work",
            tags: ["workplace"],
            syncSource: "local cache",
            startedAtDate: startedAt.addingTimeInterval(3600),
            endedAtDate: startedAt.addingTimeInterval(4200),
            durationSeconds: 600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: [],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: [canonicalStay],
            liveOverlay: liveOverlay,
            referenceDate: startedAt.addingTimeInterval(4500)
        )
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: startedAt.addingTimeInterval(4200),
                        centerLatitude: 46.5191,
                        centerLongitude: 6.6323,
                        radiusMeters: 110,
                        sampleCount: 6,
                        placeExternalUid: "place_work",
                        placeLabel: "Work",
                        tags: ["workplace"],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )
        let merged = try? XCTUnwrap(normalized.first)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(merged?.rawStayIds, ["stay_remote_1"])
        XCTAssertEqual(merged?.linkableStayIds(using: store), ["stay_remote_1"])
        XCTAssertTrue(merged?.isCurrent ?? false)
    }

    func testMovementLifeTimelineItemResolvedCoordinateFallsBackToStoredStayCenter() throws {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "derived-stay-item",
            source: .derived("derived-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Derived stay",
            placeLabel: nil,
            tags: [],
            syncSource: "local cache",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(1800),
            durationSeconds: 1800,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: startedAt.addingTimeInterval(1800),
                        centerLatitude: 46.5245,
                        centerLongitude: 6.6391,
                        radiusMeters: 95,
                        sampleCount: 8,
                        placeExternalUid: "",
                        placeLabel: "",
                        tags: [],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )

        let resolvedCoordinate = item.resolvedCoordinate(using: store)
        guard let coordinate = resolvedCoordinate else {
            return XCTFail("Expected a resolved coordinate from the stored stay center")
        }

        XCTAssertEqual(coordinate.latitude, 46.5245, accuracy: 0.000001)
        XCTAssertEqual(coordinate.longitude, 6.6391, accuracy: 0.000001)
        XCTAssertEqual(item.stayRadiusMeters(using: store), 95, accuracy: 0.000001)
    }

    func testMovementTimelinePlaceDraftAllowsManualCoordinatesWhenNoSeedCoordinateExists() throws {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "derived-stay-item",
            source: .derived("derived-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Derived stay",
            placeLabel: nil,
            tags: [],
            syncSource: "local cache",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(1800),
            durationSeconds: 1800,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
        var draft = MovementTimelinePlaceDraft(
            item: item,
            label: "Gym",
            coordinate: nil,
            radiusMeters: 80,
            tags: ["fitness"]
        )

        XCTAssertNil(draft.coordinate)

        draft.latitudeText = "46.520000"
        draft.longitudeText = "6.630000"
        let latitude = try XCTUnwrap(draft.latitude)
        let longitude = try XCTUnwrap(draft.longitude)
        guard let coordinate = draft.coordinate else {
            return XCTFail("Expected manual latitude/longitude to produce a coordinate")
        }

        XCTAssertEqual(latitude, 46.52, accuracy: 0.000001)
        XCTAssertEqual(longitude, 6.63, accuracy: 0.000001)
        XCTAssertEqual(coordinate.latitude, 46.52, accuracy: 0.000001)
        XCTAssertEqual(coordinate.longitude, 6.63, accuracy: 0.000001)
    }

    func testPlaceLabelOperationCreatesUserBoxForAutomaticStay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelinePlaceLabelOperation(for: item),
            .createUserBox
        )
    }

    func testPlaceLabelOperationPatchesExistingUserBoxStay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "user-box-stay-item",
            source: .remoteUserBox(
                "mbx_stay_1",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Home",
            subtitle: "User-defined movement box",
            placeLabel: "Home",
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .userDefined,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelinePlaceLabelOperation(for: item),
            .patchUserBox("mbx_stay_1")
        )
    }

    func testSeededCategoryTagsForNewPlaceExcludesSystemRepairTags() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "local-stay-item",
            source: .derived("repaired-gap-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Repaired stay",
            placeLabel: nil,
            tags: ["movement", "stay", "repaired_from_trip", "boundary-incomplete", "home", "coffee"],
            syncSource: "local derived",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_local_1"],
            origin: .repairedGap,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelineSeededCategoryTagsForNewPlace(from: item),
            ["home", "coffee"]
        )
    }

    func testMovementTimelineDetailSnapshotPreservesTimelineItemIdForRemoteActions() {
        let segment = ForgeMovementTimelineSegment(
            id: "box_remote_stay",
            boxId: "box_remote_stay",
            kind: "stay",
            sourceKind: "automatic",
            origin: "recorded",
            editable: false,
            startedAt: "2026-04-15T08:00:00.000Z",
            endedAt: "2026-04-15T09:00:00.000Z",
            trueStartedAt: nil,
            trueEndedAt: nil,
            visibleStartedAt: nil,
            visibleEndedAt: nil,
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            cursor: "cursor_remote_stay",
            overrideCount: 0,
            overriddenAutomaticBoxIds: [],
            overriddenUserBoxIds: nil,
            isFullyHidden: nil,
            rawStayIds: ["stay_remote_1"],
            rawTripIds: [],
            rawPointCount: 0,
            hasLegacyCorrections: false,
            stay: nil,
            trip: nil
        )
        let detail = ForgeMovementBoxDetail(
            segment: segment,
            rawStays: [],
            rawTrips: [],
            stayDetail: nil,
            tripDetail: nil
        )

        let snapshot = MovementTimelineDetailSnapshot(
            detail: detail,
            itemId: "remote-stay-box_remote_stay"
        )

        XCTAssertEqual(snapshot.itemId, "remote-stay-box_remote_stay")
        XCTAssertFalse(snapshot.editable)
    }

    func testMovementStoreKeepsRemoteKnownPlaceIdentityWhenSavingCreatedLabel() {
        let store = MovementSyncStore(testingState: nil)
        let remotePlace = MovementSyncStore.StoredKnownPlace(
            id: "place_remote_1",
            externalUid: "remote-place-1",
            label: "Forge Office",
            aliases: [],
            latitude: 46.5191,
            longitude: 6.6323,
            radiusMeters: 120,
            categoryTags: ["work"],
            visibility: "shared",
            wikiNoteId: nil,
            metadata: [:]
        )

        store.storeKnownPlace(remotePlace)

        XCTAssertEqual(store.knownPlaces.count, 1)
        XCTAssertEqual(store.knownPlaces.first?.externalUid, "remote-place-1")
        XCTAssertEqual(store.knownPlaces.first?.label, "Forge Office")

        store.storeKnownPlace(
            MovementSyncStore.StoredKnownPlace(
                id: "place_remote_1_updated",
                externalUid: "remote-place-1",
                label: "Forge HQ",
                aliases: ["Office"],
                latitude: 46.5191,
                longitude: 6.6323,
                radiusMeters: 140,
                categoryTags: ["work", "hq"],
                visibility: "shared",
                wikiNoteId: nil,
                metadata: [:]
            )
        )

        XCTAssertEqual(store.knownPlaces.count, 1)
        XCTAssertEqual(store.knownPlaces.first?.externalUid, "remote-place-1")
        XCTAssertEqual(store.knownPlaces.first?.label, "Forge HQ")
        XCTAssertEqual(store.knownPlaces.first?.categoryTags, ["work", "hq"])
    }

    func testForgeSyncClientGeneratedMovementPlaceExternalUidUsesIosPrefix() {
        let externalUid = ForgeSyncClient.generatedMovementPlaceExternalUid()

        XCTAssertTrue(externalUid.hasPrefix("ios-place-"))
        XCTAssertGreaterThan(externalUid.count, "ios-place-".count)
    }

    func testCompanionDebugLogPlainTextExportUsesChronologicalLines() {
        let earlier = CompanionDebugLogEntry(
            id: "log_earlier",
            timestamp: makeDate("2026-04-18T10:00:00.000Z"),
            scope: "MovementLifeTimeline",
            message: "openPlaceLabelDraft item=stay_1 initialQuery=Home",
            level: .info
        )
        let later = CompanionDebugLogEntry(
            id: "log_later",
            timestamp: makeDate("2026-04-18T10:00:05.500Z"),
            scope: "MovementLifeTimeline",
            message: "savePlaceDraft failed item=stay_1 label=Home error=Request timed out",
            level: .error
        )

        let rendered = CompanionDebugLogStore.renderPlainText(entries: [later, earlier])

        XCTAssertTrue(rendered.contains("[INFO][MovementLifeTimeline] openPlaceLabelDraft item=stay_1 initialQuery=Home"))
        XCTAssertTrue(rendered.contains("[ERROR][MovementLifeTimeline] savePlaceDraft failed item=stay_1 label=Home error=Request timed out"))
    }

    func testCompanionDebugLogPrunesRegularLogsBeforeErrors() {
        let pruned = CompanionDebugLogStore.prunedEntries(
            entries: [
                CompanionDebugLogEntry(
                    id: "regular_old",
                    timestamp: makeDate("2026-04-17T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync start trigger=manual",
                    level: .info
                ),
                CompanionDebugLogEntry(
                    id: "error_old",
                    timestamp: makeDate("2026-04-12T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync failed trigger=manual error=timeout",
                    level: .error
                ),
                CompanionDebugLogEntry(
                    id: "error_recent",
                    timestamp: makeDate("2026-04-18T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync failed trigger=manual error=timeout",
                    level: .error
                )
            ],
            settings: .init(regularDays: 1, errorDays: 10),
            referenceDate: makeDate("2026-04-19T12:00:00.000Z")
        )

        XCTAssertEqual(pruned.map(\.id), ["error_old", "error_recent"])
    }

    func testWorkoutActivityDescriptorNormalizesKnownAppleHealthCodes() async {
        let store = HealthSyncStore()

        let descriptor = await store.workoutActivityDescriptor(for: 52)

        XCTAssertEqual(descriptor.sourceSystem, "apple_health")
        XCTAssertEqual(descriptor.providerActivityType, "hk_workout_activity_type")
        XCTAssertEqual(descriptor.providerRawValue, 52)
        XCTAssertEqual(descriptor.canonicalKey, "walking")
        XCTAssertEqual(descriptor.canonicalLabel, "Walking")
        XCTAssertEqual(descriptor.familyKey, "cardio")
        XCTAssertEqual(descriptor.familyLabel, "Cardio")
        XCTAssertFalse(descriptor.isFallback)
    }

    func testWorkoutActivityDescriptorFallsBackForUnknownAppleHealthCodes() async {
        let store = HealthSyncStore()

        let descriptor = await store.workoutActivityDescriptor(for: 9999)

        XCTAssertEqual(descriptor.providerRawValue, 9999)
        XCTAssertEqual(descriptor.canonicalKey, "activity_9999")
        XCTAssertEqual(descriptor.canonicalLabel, "Activity 9999")
        XCTAssertEqual(descriptor.familyKey, "other")
        XCTAssertEqual(descriptor.familyLabel, "Other")
        XCTAssertTrue(descriptor.isFallback)
    }

    func testSafeDoubleValueReturnsNilForIncompatibleQuantityUnits() {
        let store = HealthSyncStore()
        let quantity = HKQuantity(unit: .second(), doubleValue: 30)

        let value = store.safeDoubleValue(
            quantity,
            for: .meter(),
            context: "test.incompatible_quantity"
        )

        XCTAssertNil(value)
    }

    func testSafeDoubleValueConvertsCompatibleQuantityUnits() {
        let store = HealthSyncStore()
        let quantity = HKQuantity(unit: HKUnit.meterUnit(with: .kilo), doubleValue: 1.5)

        let value = store.safeDoubleValue(
            quantity,
            for: .meter(),
            context: "test.compatible_quantity"
        )

        XCTAssertNotNil(value)
        XCTAssertEqual(value ?? 0, 1500, accuracy: 0.001)
    }

    func testWorkoutDetailsEncodesMetricsEventsAndComponents() throws {
        let payload = CompanionSyncPayload.WorkoutDetails(
            sourceSystem: "apple_health",
            metrics: [
                .init(
                    key: "average_speed",
                    label: "Average speed",
                    category: "cardio",
                    unit: "km/h",
                    statistic: "average",
                    value: .number(5.1),
                    startedAt: nil,
                    endedAt: nil
                )
            ],
            events: [
                .init(
                    type: "pause",
                    label: "Pause",
                    startedAt: "2026-04-07T07:33:00.000Z",
                    endedAt: "2026-04-07T07:35:00.000Z",
                    durationSeconds: 120,
                    metadata: [:]
                )
            ],
            components: [
                .init(
                    externalUid: "component_1",
                    startedAt: "2026-04-07T07:50:00.000Z",
                    endedAt: "2026-04-07T08:00:00.000Z",
                    durationSeconds: 600,
                    activity: .init(
                        sourceSystem: "apple_health",
                        providerActivityType: "hk_workout_activity_type",
                        providerRawValue: 80,
                        canonicalKey: "cooldown",
                        canonicalLabel: "Cooldown",
                        familyKey: "mobility",
                        familyLabel: "Mobility",
                        isFallback: false
                    ),
                    metrics: [],
                    metadata: [:]
                )
            ],
            metadata: [
                "indoorWorkout": .boolean(false)
            ]
        )

        let encoded = try JSONEncoder().encode(payload)
        let rendered = try XCTUnwrap(String(data: encoded, encoding: .utf8))

        XCTAssertTrue(rendered.contains("\"average_speed\""))
        XCTAssertTrue(rendered.contains("\"pause\""))
        XCTAssertTrue(rendered.contains("\"Cooldown\""))
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
