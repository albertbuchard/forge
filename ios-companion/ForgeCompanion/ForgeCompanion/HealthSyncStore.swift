import Foundation
import HealthKit
import UIKit

actor HealthSyncStore {
    struct BuildSyncPayloadResult {
        let payload: CompanionSyncPayload
        let healthDataDeferred: Bool
    }

    enum VitalAggregationKind: String {
        case discrete
        case cumulative
    }

    enum SleepBucket {
        case inBed
        case asleep
        case awake
    }

    struct SleepSegment {
        let externalUid: String
        let startDate: Date
        let endDate: Date
        let stageLabel: String
        let bucket: SleepBucket
        let sourceValue: Int
    }

    struct SleepEpisode {
        let startDate: Date
        let endDate: Date
        let localDateKey: String
        let sourceTimezone: String
        let rawSegmentCount: Int
        let timeInBedSeconds: Int
        let asleepSeconds: Int
        let awakeSeconds: Int
        let stageBreakdown: [CompanionSyncPayload.SleepStage]
        let recoveryMetrics: [String: CompanionSyncPayload.ScalarValue]
        let sourceMetrics: [String: CompanionSyncPayload.ScalarValue]
        let links: [CompanionSyncPayload.HealthLink]
        let annotations: CompanionSyncPayload.SleepAnnotations
    }

    struct VitalMetricDefinition {
        let key: String
        let label: String
        let category: String
        let identifier: HKQuantityTypeIdentifier
        let unit: HKUnit
        let displayUnit: String
        let aggregation: VitalAggregationKind
        let displayMultiplier: Double
    }

    struct VitalQuantitySample {
        let startedAt: Date
        let endedAt: Date
        let value: Double
    }

    private let store = HKHealthStore()
    private let syncWindowDays = 21
    private let incrementalLookbackHours = 72
    private let sleepSessionGap: TimeInterval = 4 * 60 * 60
    private let sleepInferenceGap: TimeInterval = 15 * 60
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private var loggedUnavailableAuthorizationStatus = false

    private var vitalMetricDefinitions: [VitalMetricDefinition] {
        [
            VitalMetricDefinition(
                key: "restingHeartRate",
                label: "Resting heart rate",
                category: "recovery",
                identifier: .restingHeartRate,
                unit: HKUnit.count().unitDivided(by: .minute()),
                displayUnit: "bpm",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "heartRateVariabilitySDNN",
                label: "HRV (SDNN)",
                category: "recovery",
                identifier: .heartRateVariabilitySDNN,
                unit: .secondUnit(with: .milli),
                displayUnit: "ms",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "walkingHeartRateAverage",
                label: "Walking heart rate",
                category: "cardio",
                identifier: .walkingHeartRateAverage,
                unit: HKUnit.count().unitDivided(by: .minute()),
                displayUnit: "bpm",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "heartRateRecoveryOneMinute",
                label: "Heart rate recovery",
                category: "cardio",
                identifier: .heartRateRecoveryOneMinute,
                unit: HKUnit.count().unitDivided(by: .minute()),
                displayUnit: "bpm",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "vo2Max",
                label: "VO2 max",
                category: "cardio",
                identifier: .vo2Max,
                unit: HKUnit(from: "ml/(kg*min)"),
                displayUnit: "ml/kg/min",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "respiratoryRate",
                label: "Respiratory rate",
                category: "breathing",
                identifier: .respiratoryRate,
                unit: HKUnit.count().unitDivided(by: .minute()),
                displayUnit: "br/min",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "oxygenSaturation",
                label: "Oxygen saturation",
                category: "breathing",
                identifier: .oxygenSaturation,
                unit: .percent(),
                displayUnit: "%",
                aggregation: .discrete,
                displayMultiplier: 100
            ),
            VitalMetricDefinition(
                key: "bodyTemperature",
                label: "Body temperature",
                category: "temperature",
                identifier: .bodyTemperature,
                unit: .degreeCelsius(),
                displayUnit: "°C",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "appleSleepingWristTemperature",
                label: "Sleeping wrist temperature",
                category: "temperature",
                identifier: .appleSleepingWristTemperature,
                unit: .degreeCelsius(),
                displayUnit: "°C",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "bodyMass",
                label: "Body mass",
                category: "composition",
                identifier: .bodyMass,
                unit: .gramUnit(with: .kilo),
                displayUnit: "kg",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "bodyFatPercentage",
                label: "Body fat",
                category: "composition",
                identifier: .bodyFatPercentage,
                unit: .percent(),
                displayUnit: "%",
                aggregation: .discrete,
                displayMultiplier: 100
            ),
            VitalMetricDefinition(
                key: "leanBodyMass",
                label: "Lean body mass",
                category: "composition",
                identifier: .leanBodyMass,
                unit: .gramUnit(with: .kilo),
                displayUnit: "kg",
                aggregation: .discrete,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "basalEnergyBurned",
                label: "Basal energy",
                category: "activity",
                identifier: .basalEnergyBurned,
                unit: .kilocalorie(),
                displayUnit: "kcal",
                aggregation: .cumulative,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "appleExerciseTime",
                label: "Exercise time",
                category: "activity",
                identifier: .appleExerciseTime,
                unit: .minute(),
                displayUnit: "min",
                aggregation: .cumulative,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "stepCount",
                label: "Steps",
                category: "activity",
                identifier: .stepCount,
                unit: .count(),
                displayUnit: "steps",
                aggregation: .cumulative,
                displayMultiplier: 1
            ),
            VitalMetricDefinition(
                key: "flightsClimbed",
                label: "Flights climbed",
                category: "activity",
                identifier: .flightsClimbed,
                unit: .count(),
                displayUnit: "flights",
                aggregation: .cumulative,
                displayMultiplier: 1
            )
        ]
    }

    private var requestedReadTypes: Set<HKObjectType> {
        let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        let workouts = HKObjectType.workoutType()
        let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)
        let activeEnergy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        let distanceWalking = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        let stepCount = HKQuantityType.quantityType(forIdentifier: .stepCount)
        let bloodPressureSystolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic)
        let bloodPressureDiastolic = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic)
        let vitalTypes = vitalMetricDefinitions.compactMap { definition in
            HKQuantityType.quantityType(forIdentifier: definition.identifier)
        }

        return Set(
            [
                sleep,
                workouts,
                heartRate,
                activeEnergy,
                distanceWalking,
                stepCount,
                bloodPressureSystolic,
                bloodPressureDiastolic
            ]
                .compactMap { $0 } + vitalTypes
        )
    }

    func requestAuthorization() async throws -> Bool {
        guard canAccessHealthAuthorizationStatus else {
            logUnavailableAuthorizationStatusIfNeeded()
            return false
        }
        let readTypes = requestedReadTypes
        companionDebugLog("HealthSyncStore", "requestAuthorization start readTypes=\(readTypes.count)")
        return try await withCheckedThrowingContinuation { continuation in
            store.requestAuthorization(toShare: [], read: readTypes) { success, error in
                if let error {
                    companionDebugLog(
                        "HealthSyncStore",
                        "requestAuthorization failed error=\(error.localizedDescription)"
                    )
                    continuation.resume(throwing: error)
                    return
                }
                companionDebugLog("HealthSyncStore", "requestAuthorization success granted=\(success)")
                continuation.resume(returning: success)
            }
        }
    }

    func accessStatus(previousStoredStatus: HealthAccessStatus = .notSet) async -> HealthAccessStatus {
        guard canAccessHealthAuthorizationStatus else {
            logUnavailableAuthorizationStatusIfNeeded()
            return previousStoredStatus == .notSet ? .notSet : previousStoredStatus
        }
        let statuses = requestedReadTypes.map { store.authorizationStatus(for: $0) }
        let authorizedCount = statuses.filter { $0 == .sharingAuthorized }.count
        companionDebugLog(
            "HealthSyncStore",
            "accessStatus authorized=\(authorizedCount) total=\(statuses.count)"
        )
        if authorizedCount == statuses.count {
            return .fullAccess
        }
        if authorizedCount > 0 {
            return .customAccess
        }

        let requestStatus = await authorizationRequestStatus()
        switch requestStatus {
        case .shouldRequest:
            return .notSet
        case .unnecessary:
            return previousStoredStatus == .notSet ? .customAccess : previousStoredStatus
        case .unknown:
            return previousStoredStatus
        @unknown default:
            return previousStoredStatus
        }
    }

    private func authorizationRequestStatus() async -> HKAuthorizationRequestStatus {
        guard canAccessHealthAuthorizationStatus else {
            return .unknown
        }
        let readTypes = requestedReadTypes
        return await withCheckedContinuation { continuation in
            store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { status, _ in
                continuation.resume(returning: status)
            }
        }
    }

    private var canAccessHealthAuthorizationStatus: Bool {
        guard HKHealthStore.isHealthDataAvailable() else {
            return false
        }
#if targetEnvironment(simulator)
        return false
#else
        return true
#endif
    }

    private func logUnavailableAuthorizationStatusIfNeeded() {
        guard loggedUnavailableAuthorizationStatus == false else {
            return
        }
        loggedUnavailableAuthorizationStatus = true
        companionDebugLog(
            "HealthSyncStore",
            "skipping HealthKit authorization probes because HealthKit is unavailable or the runtime entitlement is missing"
        )
    }

    func buildSyncPayload(
        pairing: PairingPayload,
        healthKitAuthorized: Bool,
        healthSyncEnabled: Bool,
        lastSuccessfulSyncAt: Date?,
        sourceStates: CompanionSyncPayload.SourceStates,
        movementPayload: CompanionSyncPayload.MovementPayload,
        screenTimePayload: CompanionSyncPayload.ScreenTimePayload
    ) async throws -> BuildSyncPayloadResult {
        let endDate = Date()
        let fullWindowStart = Calendar.current.date(byAdding: .day, value: -syncWindowDays, to: endDate)
            ?? endDate.addingTimeInterval(-Double(syncWindowDays) * 24 * 60 * 60)
        let incrementalStart = lastSuccessfulSyncAt?.addingTimeInterval(-Double(incrementalLookbackHours) * 60 * 60)
        let startDate = max(fullWindowStart, incrementalStart ?? fullWindowStart)
        let protectedDataAvailable = await isProtectedDataAvailable()
        let canReadHealthData = healthSyncEnabled && healthKitAuthorized && protectedDataAvailable
        companionDebugLog(
            "HealthSyncStore",
            "buildSyncPayload start session=\(pairing.sessionId) start=\(isoString(startDate)) end=\(isoString(endDate)) incremental=\(incrementalStart.map(isoString) ?? "nil") protectedDataAvailable=\(protectedDataAvailable) canReadHealthData=\(canReadHealthData)"
        )
        let backgroundRefreshEnabled = await MainActor.run {
            UIApplication.shared.backgroundRefreshStatus == .available
        }
        let sleepSessions: [CompanionSyncPayload.SleepSession]
        let sleepNights: [CompanionSyncPayload.SleepNight]
        let sleepSegments: [CompanionSyncPayload.SleepSegment]
        let sleepRawRecords: [CompanionSyncPayload.SleepRawRecord]
        let workouts: [CompanionSyncPayload.WorkoutSession]
        let vitals: CompanionSyncPayload.VitalsPayload
        if canReadHealthData {
            async let fetchedSleepData = fetchSleepPayload(startDate: startDate, endDate: endDate)
            async let fetchedWorkouts = fetchWorkoutSessions(startDate: startDate, endDate: endDate)
            async let fetchedVitals = fetchVitalsPayload(startDate: startDate, endDate: endDate)
            let fetchedSleepPayload = try await fetchedSleepData
            sleepSessions = fetchedSleepPayload.legacySessions
            sleepNights = fetchedSleepPayload.nights
            sleepSegments = fetchedSleepPayload.segments
            sleepRawRecords = fetchedSleepPayload.rawRecords
            workouts = try await fetchedWorkouts
            vitals = try await fetchedVitals
        } else {
            companionDebugLog(
                "HealthSyncStore",
                "buildSyncPayload deferring HealthKit reads because protected data is unavailable or authorization is missing"
            )
            sleepSessions = []
            sleepNights = []
            sleepSegments = []
            sleepRawRecords = []
            workouts = []
            vitals = .init(daySummaries: [])
        }

        let payload = await CompanionSyncPayload(
            sessionId: pairing.sessionId,
            pairingToken: pairing.pairingToken,
            device: .init(
                name: UIDevice.current.name,
                platform: "ios",
                appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0",
                sourceDevice: UIDevice.current.model
            ),
            permissions: .init(
                healthKitAuthorized: healthKitAuthorized,
                backgroundRefreshEnabled: backgroundRefreshEnabled,
                motionReady: movementPayload.settings.motionPermissionStatus == "ready",
                locationReady: movementPayload.settings.locationPermissionStatus == "always"
                    || movementPayload.settings.locationPermissionStatus == "when_in_use",
                screenTimeReady: screenTimePayload.settings.authorizationStatus == "approved"
                    && screenTimePayload.settings.trackingEnabled
                    && screenTimePayload.settings.syncEnabled
            ),
            sourceStates: sourceStates,
            sleepSessions: sleepSessions,
            sleepNights: sleepNights,
            sleepSegments: sleepSegments,
            sleepRawRecords: sleepRawRecords,
            workouts: workouts,
            vitals: vitals,
            movement: movementPayload,
            screenTime: screenTimePayload
        )
        companionDebugLog(
            "HealthSyncStore",
            "buildSyncPayload success sleepLegacy=\(payload.sleepSessions.count) sleepRawRecords=\(payload.sleepRawRecords.count) sleepNights=\(payload.sleepNights.count) sleepSegments=\(payload.sleepSegments.count) workouts=\(payload.workouts.count) vitalsDays=\(payload.vitals.daySummaries.count) trips=\(payload.movement.trips.count) stays=\(payload.movement.stays.count) screenTimeHours=\(payload.screenTime.hourlySegments.count) backgroundRefresh=\(backgroundRefreshEnabled)"
        )
        return BuildSyncPayloadResult(
            payload: payload,
            healthDataDeferred: healthSyncEnabled && healthKitAuthorized && protectedDataAvailable == false
        )
    }

    private func isProtectedDataAvailable() async -> Bool {
        await MainActor.run {
            UIApplication.shared.isProtectedDataAvailable
        }
    }

    private func fetchSleepPayload(
        startDate: Date,
        endDate: Date
    ) async throws -> (
        legacySessions: [CompanionSyncPayload.SleepSession],
        nights: [CompanionSyncPayload.SleepNight],
        segments: [CompanionSyncPayload.SleepSegment],
        rawRecords: [CompanionSyncPayload.SleepRawRecord]
    ) {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            companionDebugLog("HealthSyncStore", "fetchSleepPayload unavailable sleep type")
            return ([], [], [], [])
        }
        companionDebugLog(
            "HealthSyncStore",
            "fetchSleepPayload start start=\(isoString(startDate)) end=\(isoString(endDate))"
        )
        let samples = try await queryCategorySamples(type: sleepType, startDate: startDate, endDate: endDate)
        let segments = samples
            .compactMap(mapSleepSegment(sample:))
            .sorted { left, right in
                if left.startDate == right.startDate {
                    return left.endDate < right.endDate
                }
                return left.startDate < right.startDate
            }
        let anchors = segments.filter { $0.bucket != .inBed }
        guard !anchors.isEmpty else {
            companionDebugLog("HealthSyncStore", "fetchSleepPayload no anchors")
            return (
                [],
                [],
                segments.map { mapRawSleepSegment($0) }.sorted { $0.startedAt > $1.startedAt },
                segments.map { mapRawSleepSourceRecord($0) }.sorted { $0.startedAt > $1.startedAt }
            )
        }

        let clusters = clusterSleepAnchorSegments(anchors)

        let episodes: [SleepEpisode] = clusters.compactMap { cluster in
            guard
                let anchorStart = cluster.map(\.startDate).min(),
                let anchorEnd = cluster.map(\.endDate).max()
            else {
                return nil
            }
            let windowStart = anchorStart.addingTimeInterval(-2 * 60 * 60)
            let windowEnd = anchorEnd.addingTimeInterval(2 * 60 * 60)
            let sessionSegments = segments.filter { segment in
                segment.endDate > windowStart && segment.startDate < windowEnd
            }
            let inBedSegments = sessionSegments.filter { $0.bucket == .inBed }
            let sessionStart = min(anchorStart, inBedSegments.map(\.startDate).min() ?? anchorStart)
            let sessionEnd = max(anchorEnd, inBedSegments.map(\.endDate).max() ?? anchorEnd)
            let boundedSegments = sessionSegments.compactMap { segment -> SleepSegment? in
                guard let clipped = clippedInterval(start: segment.startDate, end: segment.endDate, boundsStart: sessionStart, boundsEnd: sessionEnd) else {
                    return nil
                }
                return SleepSegment(
                    externalUid: segment.externalUid,
                    startDate: clipped.start,
                    endDate: clipped.end,
                    stageLabel: segment.stageLabel,
                    bucket: segment.bucket,
                    sourceValue: segment.sourceValue
                )
            }

            let timeInBedUnion = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .inBed }
                    .map { ($0.startDate, $0.endDate) }
            )
            let asleepSeconds = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .asleep }
                    .map { ($0.startDate, $0.endDate) }
            )
            let explicitAwakeSeconds = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .awake }
                    .map { ($0.startDate, $0.endDate) }
            )
            let inferredGapSeconds = timeInBedUnion > 0
                ? 0
                : inferredGapDuration(
                    for: boundedSegments.filter { $0.bucket != .inBed },
                    threshold: sleepInferenceGap
                )
            let timeInBedSeconds = timeInBedUnion > 0
                ? timeInBedUnion
                : mergedDuration(
                    for: boundedSegments
                        .filter { $0.bucket != .inBed }
                        .map { ($0.startDate, $0.endDate) }
                ) + inferredGapSeconds
            let awakeSeconds = explicitAwakeSeconds + inferredGapSeconds
            guard timeInBedSeconds > 0 || asleepSeconds > 0 else {
                return nil
            }

            let stageBreakdown = mergedStageBreakdown(for: boundedSegments)
                .map { CompanionSyncPayload.SleepStage(stage: $0.stage, seconds: $0.seconds) }
                .sorted { $0.stage < $1.stage }

            return SleepEpisode(
                startDate: sessionStart,
                endDate: sessionEnd,
                localDateKey: localDateKey(for: sessionEnd),
                sourceTimezone: sourceTimeZoneIdentifier(),
                rawSegmentCount: boundedSegments.count,
                timeInBedSeconds: timeInBedSeconds,
                asleepSeconds: asleepSeconds,
                awakeSeconds: awakeSeconds,
                stageBreakdown: stageBreakdown,
                recoveryMetrics: [
                    "sleepWindowStart": .string(isoString(sessionStart)),
                    "sleepWindowEnd": .string(isoString(sessionEnd)),
                    "capturedStages": .number(Double(stageBreakdown.count))
                ],
                sourceMetrics: [
                    "hasInBedSamples": .boolean(timeInBedUnion > 0),
                    "explicitAwakeSeconds": .number(Double(explicitAwakeSeconds)),
                    "inferredGapSeconds": .number(Double(inferredGapSeconds))
                ],
                links: [],
                annotations: .init(
                    qualitySummary: "",
                    notes: "",
                    tags: []
                )
            )
        }

        let canonicalNights = selectCanonicalNights(from: episodes)
            .map { episode in
                CompanionSyncPayload.SleepNight(
                    externalUid: "sleep-\(isoString(episode.startDate))-\(isoString(episode.endDate))",
                    startedAt: isoString(episode.startDate),
                    endedAt: isoString(episode.endDate),
                    sourceTimezone: episode.sourceTimezone,
                    localDateKey: episode.localDateKey,
                    timeInBedSeconds: episode.timeInBedSeconds,
                    asleepSeconds: episode.asleepSeconds,
                    awakeSeconds: episode.awakeSeconds,
                    rawSegmentCount: episode.rawSegmentCount,
                    stageBreakdown: episode.stageBreakdown,
                    recoveryMetrics: episode.recoveryMetrics,
                    sourceMetrics: episode.sourceMetrics,
                    links: episode.links,
                    annotations: episode.annotations
                )
            }
            .sorted { $0.startedAt > $1.startedAt }
        let legacySessions = canonicalNights.map { night in
            CompanionSyncPayload.SleepSession(
                externalUid: night.externalUid,
                startedAt: night.startedAt,
                endedAt: night.endedAt,
                timeInBedSeconds: night.timeInBedSeconds,
                asleepSeconds: night.asleepSeconds,
                awakeSeconds: night.awakeSeconds,
                stageBreakdown: night.stageBreakdown,
                recoveryMetrics: night.recoveryMetrics.mapValues(stringifyMetricValue),
                links: night.links,
                annotations: night.annotations
            )
        }
        companionDebugLog(
            "HealthSyncStore",
            "fetchSleepPayload success samples=\(samples.count) segments=\(segments.count) episodes=\(episodes.count) nights=\(canonicalNights.count)"
        )
        return (
            legacySessions,
            canonicalNights,
            segments.map { mapRawSleepSegment($0) }.sorted { $0.startedAt > $1.startedAt },
            segments.map { mapRawSleepSourceRecord($0) }.sorted { $0.startedAt > $1.startedAt }
        )
    }

    private func fetchWorkoutSessions(startDate: Date, endDate: Date) async throws -> [CompanionSyncPayload.WorkoutSession] {
        companionDebugLog(
            "HealthSyncStore",
            "fetchWorkoutSessions start start=\(isoString(startDate)) end=\(isoString(endDate))"
        )
        let workouts = try await queryWorkouts(startDate: startDate, endDate: endDate)
        let sessions = try await withThrowingTaskGroup(of: CompanionSyncPayload.WorkoutSession.self) { group in
            for workout in workouts {
                group.addTask {
                    try await self.mapWorkoutSession(workout)
                }
            }

            var mapped: [CompanionSyncPayload.WorkoutSession] = []
            for try await session in group {
                mapped.append(session)
            }
            return mapped.sorted { $0.startedAt > $1.startedAt }
        }
        companionDebugLog(
            "HealthSyncStore",
            "fetchWorkoutSessions success workouts=\(workouts.count) mapped=\(sessions.count)"
        )
        return sessions
    }

    private func fetchVitalsPayload(
        startDate: Date,
        endDate: Date
    ) async throws -> CompanionSyncPayload.VitalsPayload {
        let sourceTimezone = sourceTimeZoneIdentifier()
        companionDebugLog(
            "HealthSyncStore",
            "fetchVitalsPayload start start=\(isoString(startDate)) end=\(isoString(endDate))"
        )
        var summariesByDate: [String: [CompanionSyncPayload.VitalMetricSample]] = [:]

        await withTaskGroup(of: [String: [CompanionSyncPayload.VitalMetricSample]].self) { group in
            for definition in vitalMetricDefinitions {
                group.addTask {
                    do {
                        return try await self.buildDailyVitalSamples(
                            for: definition,
                            startDate: startDate,
                            endDate: endDate,
                            sourceTimezone: sourceTimezone
                        )
                    } catch {
                        companionDebugLog(
                            "HealthSyncStore",
                            "fetchVitalsPayload metric failed metric=\(definition.key) error=\(error.localizedDescription)"
                        )
                        return [:]
                    }
                }
            }
            group.addTask {
                do {
                    return try await self.buildDailyBloodPressureSamples(
                        startDate: startDate,
                        endDate: endDate,
                        sourceTimezone: sourceTimezone
                    )
                } catch {
                    companionDebugLog(
                        "HealthSyncStore",
                        "fetchVitalsPayload metric failed metric=bloodPressure error=\(error.localizedDescription)"
                    )
                    return [:]
                }
            }

            for await partial in group {
                for (dateKey, metrics) in partial {
                    summariesByDate[dateKey, default: []].append(contentsOf: metrics)
                }
            }
        }

        let daySummaries = summariesByDate.keys.sorted(by: >).map { dateKey in
            CompanionSyncPayload.VitalDaySummary(
                dateKey: dateKey,
                sourceTimezone: sourceTimezone,
                metrics: (summariesByDate[dateKey] ?? []).sorted { left, right in
                    if left.category == right.category {
                        return left.label < right.label
                    }
                    return left.category < right.category
                }
            )
        }
        companionDebugLog(
            "HealthSyncStore",
            "fetchVitalsPayload success days=\(daySummaries.count) metricEntries=\(daySummaries.reduce(0) { $0 + $1.metrics.count })"
        )
        return .init(daySummaries: daySummaries)
    }

    private func mapWorkoutSession(_ workout: HKWorkout) async throws -> CompanionSyncPayload.WorkoutSession {
        companionDebugLog(
            "HealthSyncStore",
            "mapWorkoutSession start id=\(workout.uuid.uuidString.lowercased()) type=\(workout.workoutActivityType.rawValue)"
        )
        let activityDescriptor = workoutActivityDescriptor(for: workout.workoutActivityType)
        async let averageHeartRate = quantityStatistic(
            identifier: .heartRate,
            unit: HKUnit.count().unitDivided(by: .minute()),
            startDate: workout.startDate,
            endDate: workout.endDate,
            option: .discreteAverage
        )
        async let maxHeartRate = quantityStatistic(
            identifier: .heartRate,
            unit: HKUnit.count().unitDivided(by: .minute()),
            startDate: workout.startDate,
            endDate: workout.endDate,
            option: .discreteMax
        )
        async let minHeartRate = quantityStatistic(
            identifier: .heartRate,
            unit: HKUnit.count().unitDivided(by: .minute()),
            startDate: workout.startDate,
            endDate: workout.endDate,
            option: .discreteMin
        )
        async let stepCount = quantityStatistic(
            identifier: .stepCount,
            unit: HKUnit.count(),
            startDate: workout.startDate,
            endDate: workout.endDate,
            option: .cumulativeSum
        )
        async let activeEnergy = quantityStatistic(
            identifier: .activeEnergyBurned,
            unit: HKUnit.kilocalorie(),
            startDate: workout.startDate,
            endDate: workout.endDate,
            option: .cumulativeSum
        )

        let totalEnergy = safeDoubleValue(
            workout.totalEnergyBurned,
            for: .kilocalorie(),
            context: "workout.totalEnergyBurned"
        )
        let distance = safeDoubleValue(
            workout.totalDistance,
            for: .meter(),
            context: "workout.totalDistance"
        )
        let sourceDevice = workout.device?.name ?? workout.sourceRevision.source.name
        let sourceBundleIdentifier = workout.sourceRevision.source.bundleIdentifier
        let sourceProductType = workout.sourceRevision.productType
        let resolvedStepCount = try await stepCount
        let resolvedAverageHeartRate = try await averageHeartRate
        let resolvedMaxHeartRate = try await maxHeartRate
        let resolvedMinHeartRate = try await minHeartRate
        let resolvedActiveEnergy = try await activeEnergy
        let metadataProjection = serializeWorkoutMetadata(workout.metadata ?? [:])
        let details = CompanionSyncPayload.WorkoutDetails(
            sourceSystem: "apple_health",
            metrics: buildWorkoutMetrics(
                workout: workout,
                averageHeartRate: resolvedAverageHeartRate,
                maxHeartRate: resolvedMaxHeartRate,
                minHeartRate: resolvedMinHeartRate,
                stepCount: resolvedStepCount,
                activeEnergyKcal: resolvedActiveEnergy,
                totalEnergyKcal: totalEnergy,
                distanceMeters: distance,
                metadataMetrics: metadataProjection.metrics
            ),
            events: serializeWorkoutEvents(workout.workoutEvents ?? []),
            components: serializeWorkoutComponents(workout),
            metadata: metadataProjection.metadata
        )

        let session = CompanionSyncPayload.WorkoutSession(
            externalUid: workout.uuid.uuidString.lowercased(),
            workoutType: activityDescriptor.canonicalKey,
            sourceSystem: "apple_health",
            sourceBundleIdentifier: sourceBundleIdentifier,
            sourceProductType: sourceProductType,
            activity: activityDescriptor,
            details: details,
            startedAt: isoString(workout.startDate),
            endedAt: isoString(workout.endDate),
            activeEnergyKcal: resolvedActiveEnergy,
            totalEnergyKcal: totalEnergy,
            distanceMeters: distance,
            stepCount: resolvedStepCount.map { Int($0.rounded()) },
            exerciseMinutes: workout.duration / 60,
            averageHeartRate: resolvedAverageHeartRate,
            maxHeartRate: resolvedMaxHeartRate,
            sourceDevice: sourceDevice,
            links: [],
            annotations: .init(
                subjectiveEffort: nil,
                moodBefore: "",
                moodAfter: "",
                meaningText: "",
                plannedContext: "",
                socialContext: "",
                tags: []
            )
        )
        companionDebugLog(
            "HealthSyncStore",
            "mapWorkoutSession success id=\(session.externalUid) type=\(session.workoutType) steps=\(session.stepCount.map(String.init) ?? "nil")"
        )
        return session
    }

    private func buildDailyVitalSamples(
        for definition: VitalMetricDefinition,
        startDate: Date,
        endDate: Date,
        sourceTimezone: String
    ) async throws -> [String: [CompanionSyncPayload.VitalMetricSample]] {
        let samples = try await queryQuantitySamples(
            definition: definition,
            startDate: startDate,
            endDate: endDate
        )
        guard samples.isEmpty == false else {
            return [:]
        }
        let grouped = Dictionary(grouping: samples) { sample in
            localDateKey(for: sample.endedAt, timeZoneIdentifier: sourceTimezone)
        }
        var summaries: [String: [CompanionSyncPayload.VitalMetricSample]] = [:]
        for (dateKey, daySamples) in grouped {
            let metric = makeVitalMetricSample(
                definition: definition,
                samples: daySamples
            )
            summaries[dateKey] = [metric]
        }
        return summaries
    }

    private func buildDailyBloodPressureSamples(
        startDate: Date,
        endDate: Date,
        sourceTimezone: String
    ) async throws -> [String: [CompanionSyncPayload.VitalMetricSample]] {
        guard
            HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic) != nil,
            HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) != nil
        else {
            return [:]
        }
        let systolicDefinition = VitalMetricDefinition(
            key: "bloodPressureSystolic",
            label: "Systolic pressure",
            category: "cardio",
            identifier: .bloodPressureSystolic,
            unit: .millimeterOfMercury(),
            displayUnit: "mmHg",
            aggregation: .discrete,
            displayMultiplier: 1
        )
        let diastolicDefinition = VitalMetricDefinition(
            key: "bloodPressureDiastolic",
            label: "Diastolic pressure",
            category: "cardio",
            identifier: .bloodPressureDiastolic,
            unit: .millimeterOfMercury(),
            displayUnit: "mmHg",
            aggregation: .discrete,
            displayMultiplier: 1
        )
        async let systolicSamples = queryQuantitySamples(
            definition: systolicDefinition,
            startDate: startDate,
            endDate: endDate
        )
        async let diastolicSamples = queryQuantitySamples(
            definition: diastolicDefinition,
            startDate: startDate,
            endDate: endDate
        )

        var summaries: [String: [CompanionSyncPayload.VitalMetricSample]] = [:]
        for (definition, samples) in [
            (systolicDefinition, try await systolicSamples),
            (diastolicDefinition, try await diastolicSamples)
        ] {
            let grouped = Dictionary(grouping: samples) { sample in
                localDateKey(for: sample.endedAt, timeZoneIdentifier: sourceTimezone)
            }
            for (dateKey, daySamples) in grouped {
                summaries[dateKey, default: []].append(
                    makeVitalMetricSample(definition: definition, samples: daySamples)
                )
            }
        }
        return summaries
    }

    private func makeVitalMetricSample(
        definition: VitalMetricDefinition,
        samples: [VitalQuantitySample]
    ) -> CompanionSyncPayload.VitalMetricSample {
        let sortedSamples = samples.sorted { left, right in
            if left.endedAt == right.endedAt {
                return left.startedAt < right.startedAt
            }
            return left.endedAt < right.endedAt
        }
        let values = sortedSamples.map(\.value)
        let latestValue = definition.aggregation == .cumulative
            ? values.reduce(0, +)
            : sortedSamples.last?.value
        return CompanionSyncPayload.VitalMetricSample(
            metric: definition.key,
            label: definition.label,
            category: definition.category,
            unit: definition.displayUnit,
            displayUnit: definition.displayUnit,
            aggregation: definition.aggregation.rawValue,
            average: definition.aggregation == .discrete ? average(values) : nil,
            minimum: definition.aggregation == .discrete ? values.min() : nil,
            maximum: definition.aggregation == .discrete ? values.max() : nil,
            latest: latestValue,
            total: definition.aggregation == .cumulative ? values.reduce(0, +) : nil,
            sampleCount: values.count,
            latestSampleAt: sortedSamples.last.map { isoString($0.endedAt) }
        )
    }

    private func queryQuantitySamples(
        definition: VitalMetricDefinition,
        startDate: Date,
        endDate: Date
    ) async throws -> [VitalQuantitySample] {
        guard let quantityType = HKQuantityType.quantityType(forIdentifier: definition.identifier) else {
            return []
        }
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[VitalQuantitySample], Error>) in
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
            let sortDescriptors = [
                NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true),
                NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            ]
            let query = HKSampleQuery(
                sampleType: quantityType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: sortDescriptors
            ) { _, samples, error in
                if let error {
                    if self.isHealthKitNoDataError(error) {
                        companionDebugLog(
                            "HealthSyncStore",
                            "queryQuantitySamples no data metric=\(definition.key)"
                        )
                        continuation.resume(returning: [])
                        return
                    }
                    continuation.resume(throwing: error)
                    return
                }
                let resolved: [VitalQuantitySample] = (samples as? [HKQuantitySample] ?? []).compactMap { sample in
                    guard
                        let value = self.safeDoubleValue(
                            sample.quantity,
                            for: definition.unit,
                            context: "vital_sample.\(definition.key)"
                        )
                    else {
                        return nil
                    }
                    return VitalQuantitySample(
                        startedAt: sample.startDate,
                        endedAt: sample.endDate,
                        value: value * definition.displayMultiplier
                    )
                }
                continuation.resume(returning: resolved)
            }
            self.store.execute(query)
        }
    }

    private func queryCategorySamples(
        type: HKCategoryType,
        startDate: Date,
        endDate: Date
    ) async throws -> [HKCategorySample] {
        companionDebugLog(
            "HealthSyncStore",
            "queryCategorySamples start start=\(isoString(startDate)) end=\(isoString(endDate))"
        )
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKCategorySample], Error>) in
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])
            let sortDescriptors = [
                NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true),
                NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            ]
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: sortDescriptors
            ) { _, samples, error in
                if let error {
                    if self.isHealthKitNoDataError(error) {
                        companionDebugLog("HealthSyncStore", "queryCategorySamples no data")
                        continuation.resume(returning: [])
                        return
                    }
                    companionDebugLog(
                        "HealthSyncStore",
                        "queryCategorySamples failed error=\(error.localizedDescription)"
                    )
                    continuation.resume(throwing: error)
                    return
                }
                let resolved = samples as? [HKCategorySample] ?? []
                companionDebugLog("HealthSyncStore", "queryCategorySamples success count=\(resolved.count)")
                continuation.resume(returning: resolved)
            }
            self.store.execute(query)
        }
    }

    private func queryWorkouts(startDate: Date, endDate: Date) async throws -> [HKWorkout] {
        companionDebugLog(
            "HealthSyncStore",
            "queryWorkouts start start=\(isoString(startDate)) end=\(isoString(endDate))"
        )
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKWorkout], Error>) in
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [.strictStartDate])
            let sortDescriptors = [
                NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
            ]
            let query = HKSampleQuery(
                sampleType: HKWorkoutType.workoutType(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: sortDescriptors
            ) { _, samples, error in
                if let error {
                    if self.isHealthKitNoDataError(error) {
                        companionDebugLog("HealthSyncStore", "queryWorkouts no data")
                        continuation.resume(returning: [])
                        return
                    }
                    companionDebugLog(
                        "HealthSyncStore",
                        "queryWorkouts failed error=\(error.localizedDescription)"
                    )
                    continuation.resume(throwing: error)
                    return
                }
                let resolved = samples as? [HKWorkout] ?? []
                companionDebugLog("HealthSyncStore", "queryWorkouts success count=\(resolved.count)")
                continuation.resume(returning: resolved)
            }
            self.store.execute(query)
        }
    }

    private func quantityStatistic(
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        startDate: Date,
        endDate: Date,
        option: HKStatisticsOptions
    ) async throws -> Double? {
        guard let quantityType = HKObjectType.quantityType(forIdentifier: identifier) else {
            return nil
        }
        return try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [.strictStartDate])
            let query = HKStatisticsQuery(
                quantityType: quantityType,
                quantitySamplePredicate: predicate,
                options: option
            ) { _, statistics, error in
                if let error {
                    if self.isHealthKitNoDataError(error) {
                        continuation.resume(returning: nil)
                        return
                    }
                    continuation.resume(throwing: error)
                    return
                }
                let value: Double?
                if option.contains(.cumulativeSum) {
                    value = self.safeDoubleValue(
                        statistics?.sumQuantity(),
                        for: unit,
                        context: "quantity_statistic.\(identifier.rawValue).sum"
                    )
                } else if option.contains(.discreteAverage) {
                    value = self.safeDoubleValue(
                        statistics?.averageQuantity(),
                        for: unit,
                        context: "quantity_statistic.\(identifier.rawValue).average"
                    )
                } else if option.contains(.discreteMax) {
                    value = self.safeDoubleValue(
                        statistics?.maximumQuantity(),
                        for: unit,
                        context: "quantity_statistic.\(identifier.rawValue).max"
                    )
                } else {
                    value = nil
                }
                continuation.resume(returning: value)
            }
            self.store.execute(query)
        }
    }

    private nonisolated func isHealthKitNoDataError(_ error: Error) -> Bool {
        let nsError = error as NSError
        return (nsError.domain == HKErrorDomain && nsError.code == 11) // HKErrorNoData
            || nsError.localizedDescription == "No data available for the specified predicate."
    }

    nonisolated func safeDoubleValue(
        _ quantity: HKQuantity?,
        for unit: HKUnit,
        context: String
    ) -> Double? {
        guard let quantity else {
            return nil
        }
        guard quantity.is(compatibleWith: unit) else {
            companionDebugLog(
                "HealthSyncStore",
                "skipping incompatible quantity conversion context=\(context) targetUnit=\(unit) quantity=\(quantity)"
            )
            return nil
        }
        return quantity.doubleValue(for: unit)
    }

    private func mapSleepSegment(sample: HKCategorySample) -> SleepSegment? {
        let mapping: (label: String, bucket: SleepBucket)?
        switch sample.value {
        case 0:
            mapping = ("in_bed", .inBed)
        case 1:
            mapping = ("asleep", .asleep)
        case 2:
            mapping = ("awake", .awake)
        case 3:
            mapping = ("core", .asleep)
        case 4:
            mapping = ("deep", .asleep)
        case 5:
            mapping = ("rem", .asleep)
        default:
            mapping = nil
        }
        guard let mapping else {
            return nil
        }
        return SleepSegment(
            externalUid: sample.uuid.uuidString.lowercased(),
            startDate: sample.startDate,
            endDate: sample.endDate,
            stageLabel: mapping.label,
            bucket: mapping.bucket,
            sourceValue: sample.value
        )
    }

    private func mapRawSleepSegment(_ segment: SleepSegment) -> CompanionSyncPayload.SleepSegment {
        let sourceTimezone = sourceTimeZoneIdentifier()
        return CompanionSyncPayload.SleepSegment(
            externalUid: segment.externalUid,
            startedAt: isoString(segment.startDate),
            endedAt: isoString(segment.endDate),
            sourceTimezone: sourceTimezone,
            localDateKey: localDateKey(for: segment.endDate, timeZoneIdentifier: sourceTimezone),
            stage: segment.stageLabel,
            bucket: rawBucketLabel(for: segment.bucket),
            sourceValue: segment.sourceValue,
            metadata: [
                "durationSeconds": .number(segment.endDate.timeIntervalSince(segment.startDate))
            ]
        )
    }

    private func mapRawSleepSourceRecord(_ segment: SleepSegment) -> CompanionSyncPayload.SleepRawRecord {
        let sourceTimezone = sourceTimeZoneIdentifier()
        return CompanionSyncPayload.SleepRawRecord(
            externalUid: segment.externalUid,
            startedAt: isoString(segment.startDate),
            endedAt: isoString(segment.endDate),
            sourceTimezone: sourceTimezone,
            localDateKey: localDateKey(for: segment.endDate, timeZoneIdentifier: sourceTimezone),
            providerRecordType: "healthkit_sleep_sample",
            rawStage: segment.stageLabel,
            rawValue: segment.sourceValue,
            payload: [
                "bucket": .string(rawBucketLabel(for: segment.bucket)),
                "sourceValue": .number(Double(segment.sourceValue))
            ],
            metadata: [
                "durationSeconds": .number(segment.endDate.timeIntervalSince(segment.startDate))
            ]
        )
    }

    private func rawBucketLabel(for bucket: SleepBucket) -> String {
        switch bucket {
        case .inBed:
            return "in_bed"
        case .asleep:
            return "asleep"
        case .awake:
            return "awake"
        }
    }

    private func sourceTimeZoneIdentifier() -> String {
        let identifier = TimeZone.current.identifier
        return identifier.isEmpty ? "UTC" : identifier
    }

    private func localDateKey(for date: Date, timeZoneIdentifier: String? = nil) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier ?? sourceTimeZoneIdentifier()) ?? .current
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 1970,
            components.month ?? 1,
            components.day ?? 1
        )
    }

    private func localHour(for date: Date, timeZoneIdentifier: String? = nil) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier ?? sourceTimeZoneIdentifier()) ?? .current
        return calendar.component(.hour, from: date)
    }

    func clusterSleepAnchorSegments(_ anchors: [SleepSegment]) -> [[SleepSegment]] {
        guard !anchors.isEmpty else {
            return []
        }
        var clusters: [[SleepSegment]] = []
        var currentCluster: [SleepSegment] = []
        var currentEnd: Date?
        for segment in anchors {
            if let existingEnd = currentEnd, segment.startDate.timeIntervalSince(existingEnd) > sleepSessionGap {
                if !currentCluster.isEmpty {
                    clusters.append(currentCluster)
                }
                currentCluster = [segment]
                currentEnd = segment.endDate
                continue
            }
            currentCluster.append(segment)
            currentEnd = max(currentEnd ?? segment.endDate, segment.endDate)
        }
        if !currentCluster.isEmpty {
            clusters.append(currentCluster)
        }
        return clusters
    }

    func selectCanonicalNights(from episodes: [SleepEpisode]) -> [SleepEpisode] {
        let eligible = episodes.filter { episode in
            let startHour = localHour(for: episode.startDate, timeZoneIdentifier: episode.sourceTimezone)
            return startHour >= 18 || startHour < 8
        }
        let grouped = Dictionary(grouping: eligible, by: \.localDateKey)
        return grouped.values
            .compactMap { nights in
                nights.max { left, right in
                    let leftDuration = left.endDate.timeIntervalSince(left.startDate)
                    let rightDuration = right.endDate.timeIntervalSince(right.startDate)
                    if leftDuration == rightDuration {
                        return left.startDate > right.startDate
                    }
                    return leftDuration < rightDuration
                }
            }
            .sorted { $0.startDate > $1.startDate }
    }

    private func stringifyMetricValue(_ value: CompanionSyncPayload.ScalarValue) -> String {
        switch value {
        case .string(let stringValue):
            return stringValue
        case .number(let numberValue):
            if numberValue.rounded() == numberValue {
                return String(Int(numberValue))
            }
            return String(numberValue)
        case .boolean(let booleanValue):
            return booleanValue ? "true" : "false"
        case .null:
            return ""
        }
    }

    private func average(_ values: [Double]) -> Double? {
        guard values.isEmpty == false else {
            return nil
        }
        return values.reduce(0, +) / Double(values.count)
    }

    func inferredGapDuration(
        for segments: [SleepSegment],
        threshold: TimeInterval
    ) -> Int {
        let merged = mergedIntervals(
            for: segments.map { ($0.startDate, $0.endDate) }
        )
        guard merged.count > 1 else {
            return 0
        }
        var total: TimeInterval = 0
        for index in 1..<merged.count {
            let gap = merged[index].0.timeIntervalSince(merged[index - 1].1)
            if gap > 0, gap <= threshold {
                total += gap
            }
        }
        return Int(total)
    }

    func mergedStageBreakdown(
        for segments: [SleepSegment]
    ) -> [(stage: String, seconds: Int)] {
        let stageLabels = Set(
            segments
                .filter { $0.bucket != .inBed }
                .map(\.stageLabel)
        )
        return stageLabels.map { stageLabel in
            let seconds = mergedDuration(
                for: segments
                    .filter { $0.stageLabel == stageLabel && $0.bucket != .inBed }
                    .map { ($0.startDate, $0.endDate) }
            )
            return (stage: stageLabel, seconds: seconds)
        }
        .filter { $0.seconds > 0 }
    }

    func workoutActivityDescriptor(for rawValue: Int) -> CompanionSyncPayload.WorkoutActivityDescriptor {
        let entry = Self.appleWorkoutActivityCatalog[rawValue]
        let canonicalKey = entry?.key ?? "activity_\(rawValue)"
        let family = workoutFamily(for: canonicalKey)
        return .init(
            sourceSystem: "apple_health",
            providerActivityType: "hk_workout_activity_type",
            providerRawValue: rawValue,
            canonicalKey: canonicalKey,
            canonicalLabel: entry?.label ?? humanizedWorkoutKey(canonicalKey),
            familyKey: family.key,
            familyLabel: family.label,
            isFallback: entry == nil
        )
    }

    private func workoutActivityDescriptor(
        for type: HKWorkoutActivityType
    ) -> CompanionSyncPayload.WorkoutActivityDescriptor {
        workoutActivityDescriptor(for: Int(type.rawValue))
    }

    private func humanizedWorkoutKey(_ key: String) -> String {
        key
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { word in
                guard let first = word.first else { return "" }
                return first.uppercased() + word.dropFirst().lowercased()
            }
            .joined(separator: " ")
    }

    private func workoutFamily(for key: String) -> (key: String, label: String) {
        let normalized = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if Self.cardioWorkoutKeys.contains(normalized) {
            return ("cardio", "Cardio")
        }
        if Self.strengthWorkoutKeys.contains(normalized) {
            return ("strength", "Strength")
        }
        if Self.mobilityWorkoutKeys.contains(normalized) {
            return ("mobility", "Mobility")
        }
        if Self.mindfulWorkoutKeys.contains(normalized) {
            return ("mindful", "Mindful")
        }
        if Self.waterWorkoutKeys.contains(normalized) {
            return ("water", "Water")
        }
        if Self.teamWorkoutKeys.contains(normalized) {
            return ("team_sport", "Team sport")
        }
        if Self.racketWorkoutKeys.contains(normalized) {
            return ("racket", "Racket")
        }
        if Self.combatWorkoutKeys.contains(normalized) {
            return ("combat", "Combat")
        }
        if Self.winterWorkoutKeys.contains(normalized) {
            return ("winter", "Winter")
        }
        if normalized.contains("dance") || normalized == "play" || normalized == "golf" {
            return ("recreation", "Recreation")
        }
        return ("other", "Other")
    }

    private func buildWorkoutMetrics(
        workout: HKWorkout,
        averageHeartRate: Double?,
        maxHeartRate: Double?,
        minHeartRate: Double?,
        stepCount: Double?,
        activeEnergyKcal: Double?,
        totalEnergyKcal: Double?,
        distanceMeters: Double?,
        metadataMetrics: [CompanionSyncPayload.WorkoutMetric]
    ) -> [CompanionSyncPayload.WorkoutMetric] {
        var metrics: [CompanionSyncPayload.WorkoutMetric] = [
            .init(
                key: "duration_seconds",
                label: "Recorded duration",
                category: "time",
                unit: "sec",
                statistic: "total",
                value: .number(workout.duration),
                startedAt: isoString(workout.startDate),
                endedAt: isoString(workout.endDate)
            ),
            .init(
                key: "exercise_minutes",
                label: "Exercise minutes",
                category: "time",
                unit: "min",
                statistic: "total",
                value: .number(workout.duration / 60),
                startedAt: isoString(workout.startDate),
                endedAt: isoString(workout.endDate)
            )
        ]
        if let activeEnergyKcal {
            metrics.append(
                .init(
                    key: "active_energy_kcal",
                    label: "Active energy",
                    category: "energy",
                    unit: "kcal",
                    statistic: "total",
                    value: .number(activeEnergyKcal),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let totalEnergyKcal {
            metrics.append(
                .init(
                    key: "total_energy_kcal",
                    label: "Total energy",
                    category: "energy",
                    unit: "kcal",
                    statistic: "total",
                    value: .number(totalEnergyKcal),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let distanceMeters {
            metrics.append(
                .init(
                    key: "distance_meters",
                    label: "Distance",
                    category: "distance",
                    unit: "m",
                    statistic: "total",
                    value: .number(distanceMeters),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let stepCount {
            metrics.append(
                .init(
                    key: "step_count",
                    label: "Step count",
                    category: "volume",
                    unit: "count",
                    statistic: "total",
                    value: .number(stepCount),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let averageHeartRate {
            metrics.append(
                .init(
                    key: "heart_rate_avg",
                    label: "Average heart rate",
                    category: "cardio",
                    unit: "bpm",
                    statistic: "average",
                    value: .number(averageHeartRate),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let maxHeartRate {
            metrics.append(
                .init(
                    key: "heart_rate_max",
                    label: "Max heart rate",
                    category: "cardio",
                    unit: "bpm",
                    statistic: "max",
                    value: .number(maxHeartRate),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let minHeartRate {
            metrics.append(
                .init(
                    key: "heart_rate_min",
                    label: "Min heart rate",
                    category: "cardio",
                    unit: "bpm",
                    statistic: "min",
                    value: .number(minHeartRate),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let totalFlights = safeDoubleValue(
            workout.totalFlightsClimbed,
            for: .count(),
            context: "workout.totalFlightsClimbed"
        ) {
            metrics.append(
                .init(
                    key: "flights_climbed",
                    label: "Flights climbed",
                    category: "volume",
                    unit: "count",
                    statistic: "total",
                    value: .number(totalFlights),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        if let strokeCount = safeDoubleValue(
            workout.totalSwimmingStrokeCount,
            for: .count(),
            context: "workout.totalSwimmingStrokeCount"
        ) {
            metrics.append(
                .init(
                    key: "swimming_stroke_count",
                    label: "Swimming strokes",
                    category: "volume",
                    unit: "count",
                    statistic: "total",
                    value: .number(strokeCount),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }
        metrics.append(contentsOf: metadataMetrics)
        return metrics.sorted { left, right in
            if left.category == right.category {
                return left.label < right.label
            }
            return left.category < right.category
        }
    }

    private func serializeWorkoutMetadata(
        _ metadata: [String: Any]
    ) -> (
        metrics: [CompanionSyncPayload.WorkoutMetric],
        metadata: [String: CompanionSyncPayload.ScalarValue]
    ) {
        var metrics: [CompanionSyncPayload.WorkoutMetric] = []
        var scalarMetadata: [String: CompanionSyncPayload.ScalarValue] = [:]

        func appendQuantityMetric(
            _ metadataKey: String,
            key: String,
            label: String,
            category: String,
            unit: HKUnit,
            unitLabel: String,
            statistic: String = "value"
        ) {
            guard let quantity = metadata[metadataKey] as? HKQuantity else {
                return
            }
            guard
                let value = safeDoubleValue(
                    quantity,
                    for: unit,
                    context: "workout.metadata.\(metadataKey)"
                )
            else {
                return
            }
            metrics.append(
                .init(
                    key: key,
                    label: label,
                    category: category,
                    unit: unitLabel,
                    statistic: statistic,
                    value: .number(value),
                    startedAt: nil,
                    endedAt: nil
                )
            )
        }

        appendQuantityMetric(
            HKMetadataKeyAverageSpeed,
            key: "average_speed_mps",
            label: "Average speed",
            category: "pace",
            unit: HKUnit.meter().unitDivided(by: .second()),
            unitLabel: "m/s",
            statistic: "average"
        )
        appendQuantityMetric(
            HKMetadataKeyMaximumSpeed,
            key: "maximum_speed_mps",
            label: "Maximum speed",
            category: "pace",
            unit: HKUnit.meter().unitDivided(by: .second()),
            unitLabel: "m/s",
            statistic: "max"
        )
        appendQuantityMetric(
            HKMetadataKeyAverageMETs,
            key: "average_mets",
            label: "Average METs",
            category: "cardio",
            unit: .count(),
            unitLabel: "METs",
            statistic: "average"
        )
        appendQuantityMetric(
            HKMetadataKeyElevationAscended,
            key: "elevation_ascended_m",
            label: "Elevation ascended",
            category: "elevation",
            unit: .meter(),
            unitLabel: "m",
            statistic: "total"
        )
        appendQuantityMetric(
            HKMetadataKeyElevationDescended,
            key: "elevation_descended_m",
            label: "Elevation descended",
            category: "elevation",
            unit: .meter(),
            unitLabel: "m",
            statistic: "total"
        )
        appendQuantityMetric(
            HKMetadataKeyLapLength,
            key: "lap_length_m",
            label: "Lap length",
            category: "lap",
            unit: .meter(),
            unitLabel: "m"
        )
        appendQuantityMetric(
            HKMetadataKeyVO2MaxValue,
            key: "vo2_max_ml_kg_min",
            label: "VO2 max",
            category: "cardio",
            unit: HKUnit(from: "ml/(kg*min)"),
            unitLabel: "ml/kg/min"
        )
        appendQuantityMetric(
            HKMetadataKeyWeatherTemperature,
            key: "weather_temperature_c",
            label: "Weather temperature",
            category: "environment",
            unit: .degreeCelsius(),
            unitLabel: "degC"
        )
        appendQuantityMetric(
            HKMetadataKeyWeatherHumidity,
            key: "weather_humidity_percent",
            label: "Weather humidity",
            category: "environment",
            unit: .percent(),
            unitLabel: "%"
        )

        if let brand = metadata[HKMetadataKeyWorkoutBrandName] as? String, brand.isEmpty == false {
            scalarMetadata["workoutBrandName"] = .string(brand)
        }
        if let indoor = metadata[HKMetadataKeyIndoorWorkout] as? NSNumber {
            scalarMetadata["indoorWorkout"] = metadataScalarValue(indoor)
        }
        if let coached = metadata[HKMetadataKeyCoachedWorkout] as? NSNumber {
            scalarMetadata["coachedWorkout"] = metadataScalarValue(coached)
        }
        if let groupFitness = metadata[HKMetadataKeyGroupFitness] as? NSNumber {
            scalarMetadata["groupFitness"] = metadataScalarValue(groupFitness)
        }
        if let weatherCondition = metadata[HKMetadataKeyWeatherCondition] {
            scalarMetadata["weatherCondition"] = metadataScalarValue(weatherCondition)
        }
        if let swimmingLocation = metadata[HKMetadataKeySwimmingLocationType] as? NSNumber {
            scalarMetadata["swimmingLocationType"] = .string(
                swimmingLocationTypeLabel(swimmingLocation.intValue)
            )
        }
        if let strokeStyle = metadata[HKMetadataKeySwimmingStrokeStyle] as? NSNumber {
            scalarMetadata["swimmingStrokeStyle"] = .string(
                swimmingStrokeStyleLabel(strokeStyle.intValue)
            )
        }

        return (metrics, scalarMetadata)
    }

    private func metadataScalarValue(_ value: Any) -> CompanionSyncPayload.ScalarValue {
        if let string = value as? String {
            return .string(string)
        }
        if let date = value as? Date {
            return .string(isoString(date))
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .boolean(number.boolValue)
            }
            return .number(number.doubleValue)
        }
        return .string(String(describing: value))
    }

    private func serializeWorkoutEvents(
        _ events: [HKWorkoutEvent]
    ) -> [CompanionSyncPayload.WorkoutEvent] {
        events.map { event in
            let interval = event.dateInterval
            let startedAt = isoString(interval.start)
            let endedAt = interval.duration > 0 ? isoString(interval.end) : nil
            let metadata = (event.metadata ?? [:]).reduce(
                into: [String: CompanionSyncPayload.ScalarValue]()
            ) { partial, entry in
                partial[entry.key] = metadataScalarValue(entry.value)
            }
            return .init(
                type: workoutEventTypeKey(event.type),
                label: workoutEventTypeLabel(event.type),
                startedAt: startedAt,
                endedAt: endedAt,
                durationSeconds: Int(interval.duration.rounded()),
                metadata: metadata
            )
        }
    }

    private func serializeWorkoutComponents(
        _ workout: HKWorkout
    ) -> [CompanionSyncPayload.WorkoutComponent] {
        guard #available(iOS 16.0, *) else {
            return []
        }
        return workout.workoutActivities.map { activity in
            let metadata = (activity.metadata ?? [:]).reduce(
                into: [String: CompanionSyncPayload.ScalarValue]()
            ) { partial, entry in
                partial[entry.key] = metadataScalarValue(entry.value)
            }
            return .init(
                externalUid: activity.uuid.uuidString.lowercased(),
                startedAt: isoString(activity.startDate),
                endedAt: activity.endDate.map(isoString),
                durationSeconds: Int(activity.duration.rounded()),
                activity: workoutActivityDescriptor(
                    for: activity.workoutConfiguration.activityType
                ),
                metrics: workoutMetrics(for: activity),
                metadata: metadata
            )
        }
    }

    @available(iOS 16.0, *)
    private func workoutMetrics(
        for activity: HKWorkoutActivity
    ) -> [CompanionSyncPayload.WorkoutMetric] {
        var metrics: [CompanionSyncPayload.WorkoutMetric] = []
        func appendStatistic(
            identifier: HKQuantityTypeIdentifier,
            key: String,
            label: String,
            category: String,
            unit: HKUnit,
            unitLabel: String,
            statistic: String,
            resolver: (HKStatistics) -> HKQuantity?
        ) {
            guard
                let quantityType = HKQuantityType.quantityType(forIdentifier: identifier),
                let stats = activity.statistics(for: quantityType),
                let quantity = resolver(stats)
            else {
                return
            }
            guard
                let value = safeDoubleValue(
                    quantity,
                    for: unit,
                    context: "workout.activity.\(identifier.rawValue).\(statistic)"
                )
            else {
                return
            }
            metrics.append(
                .init(
                    key: key,
                    label: label,
                    category: category,
                    unit: unitLabel,
                    statistic: statistic,
                    value: .number(value),
                    startedAt: isoString(activity.startDate),
                    endedAt: activity.endDate.map(isoString)
                )
            )
        }
        appendStatistic(
            identifier: .activeEnergyBurned,
            key: "active_energy_kcal",
            label: "Active energy",
            category: "energy",
            unit: .kilocalorie(),
            unitLabel: "kcal",
            statistic: "total",
            resolver: { $0.sumQuantity() }
        )
        appendStatistic(
            identifier: .heartRate,
            key: "heart_rate_avg",
            label: "Average heart rate",
            category: "cardio",
            unit: HKUnit.count().unitDivided(by: .minute()),
            unitLabel: "bpm",
            statistic: "average",
            resolver: { $0.averageQuantity() }
        )
        appendStatistic(
            identifier: .heartRate,
            key: "heart_rate_max",
            label: "Max heart rate",
            category: "cardio",
            unit: HKUnit.count().unitDivided(by: .minute()),
            unitLabel: "bpm",
            statistic: "max",
            resolver: { $0.maximumQuantity() }
        )
        appendStatistic(
            identifier: .distanceWalkingRunning,
            key: "distance_meters",
            label: "Distance",
            category: "distance",
            unit: .meter(),
            unitLabel: "m",
            statistic: "total",
            resolver: { $0.sumQuantity() }
        )
        appendStatistic(
            identifier: .distanceCycling,
            key: "cycling_distance_meters",
            label: "Cycling distance",
            category: "distance",
            unit: .meter(),
            unitLabel: "m",
            statistic: "total",
            resolver: { $0.sumQuantity() }
        )
        appendStatistic(
            identifier: .distanceSwimming,
            key: "swimming_distance_meters",
            label: "Swimming distance",
            category: "distance",
            unit: .meter(),
            unitLabel: "m",
            statistic: "total",
            resolver: { $0.sumQuantity() }
        )
        return metrics.sorted { left, right in
            if left.category == right.category {
                return left.label < right.label
            }
            return left.category < right.category
        }
    }

    private func workoutEventTypeKey(_ type: HKWorkoutEventType) -> String {
        switch type {
        case .pause:
            return "pause"
        case .resume:
            return "resume"
        case .lap:
            return "lap"
        case .marker:
            return "marker"
        case .motionPaused:
            return "motion_paused"
        case .motionResumed:
            return "motion_resumed"
        case .segment:
            return "segment"
        case .pauseOrResumeRequest:
            return "pause_or_resume_request"
        @unknown default:
            return "event_\(type.rawValue)"
        }
    }

    private func workoutEventTypeLabel(_ type: HKWorkoutEventType) -> String {
        switch type {
        case .pause:
            return "Pause"
        case .resume:
            return "Resume"
        case .lap:
            return "Lap"
        case .marker:
            return "Marker"
        case .motionPaused:
            return "Motion paused"
        case .motionResumed:
            return "Motion resumed"
        case .segment:
            return "Segment"
        case .pauseOrResumeRequest:
            return "Pause or resume request"
        @unknown default:
            return "Workout event"
        }
    }

    private func swimmingLocationTypeLabel(_ rawValue: Int) -> String {
        switch rawValue {
        case 1:
            return "Pool"
        case 2:
            return "Open water"
        default:
            return "Unknown"
        }
    }

    private func swimmingStrokeStyleLabel(_ rawValue: Int) -> String {
        switch rawValue {
        case 1:
            return "Mixed"
        case 2:
            return "Freestyle"
        case 3:
            return "Backstroke"
        case 4:
            return "Breaststroke"
        case 5:
            return "Butterfly"
        case 6:
            return "Kickboard"
        default:
            return "Unknown"
        }
    }

    private static let appleWorkoutActivityCatalog: [Int: (key: String, label: String)] = [
        1: ("american_football", "American football"),
        2: ("archery", "Archery"),
        3: ("australian_football", "Australian football"),
        4: ("badminton", "Badminton"),
        5: ("baseball", "Baseball"),
        6: ("basketball", "Basketball"),
        7: ("bowling", "Bowling"),
        8: ("boxing", "Boxing"),
        9: ("climbing", "Climbing"),
        10: ("cricket", "Cricket"),
        11: ("cross_training", "Cross training"),
        12: ("curling", "Curling"),
        13: ("cycling", "Cycling"),
        14: ("dance", "Dance"),
        15: ("dance_inspired_training", "Dance-inspired training"),
        16: ("elliptical", "Elliptical"),
        17: ("equestrian_sports", "Equestrian sports"),
        18: ("fencing", "Fencing"),
        19: ("fishing", "Fishing"),
        20: ("functional_strength_training", "Functional strength training"),
        21: ("golf", "Golf"),
        22: ("gymnastics", "Gymnastics"),
        23: ("handball", "Handball"),
        24: ("hiking", "Hiking"),
        25: ("hockey", "Hockey"),
        26: ("hunting", "Hunting"),
        27: ("lacrosse", "Lacrosse"),
        28: ("martial_arts", "Martial arts"),
        29: ("mind_and_body", "Mind and body"),
        30: ("mixed_metabolic_cardio_training", "Mixed metabolic cardio training"),
        31: ("paddle_sports", "Paddle sports"),
        32: ("play", "Play"),
        33: ("preparation_and_recovery", "Preparation and recovery"),
        34: ("racquetball", "Racquetball"),
        35: ("rowing", "Rowing"),
        36: ("rugby", "Rugby"),
        37: ("running", "Running"),
        38: ("sailing", "Sailing"),
        39: ("skating_sports", "Skating sports"),
        40: ("snow_sports", "Snow sports"),
        41: ("soccer", "Soccer"),
        42: ("softball", "Softball"),
        43: ("squash", "Squash"),
        44: ("stair_climbing", "Stair climbing"),
        45: ("surfing_sports", "Surfing sports"),
        46: ("swimming", "Swimming"),
        47: ("table_tennis", "Table tennis"),
        48: ("tennis", "Tennis"),
        49: ("track_and_field", "Track and field"),
        50: ("traditional_strength_training", "Traditional strength training"),
        51: ("volleyball", "Volleyball"),
        52: ("walking", "Walking"),
        53: ("water_fitness", "Water fitness"),
        54: ("water_polo", "Water polo"),
        55: ("water_sports", "Water sports"),
        56: ("wrestling", "Wrestling"),
        57: ("yoga", "Yoga"),
        58: ("barre", "Barre"),
        59: ("core_training", "Core training"),
        60: ("cross_country_skiing", "Cross-country skiing"),
        61: ("downhill_skiing", "Downhill skiing"),
        62: ("flexibility", "Flexibility"),
        63: ("high_intensity_interval_training", "High-intensity interval training"),
        64: ("jump_rope", "Jump rope"),
        65: ("kickboxing", "Kickboxing"),
        66: ("pilates", "Pilates"),
        67: ("snowboarding", "Snowboarding"),
        68: ("stairs", "Stairs"),
        69: ("step_training", "Step training"),
        70: ("wheelchair_walk_pace", "Wheelchair walk pace"),
        71: ("wheelchair_run_pace", "Wheelchair run pace"),
        72: ("tai_chi", "Tai chi"),
        73: ("mixed_cardio", "Mixed cardio"),
        74: ("hand_cycling", "Hand cycling"),
        75: ("disc_sports", "Disc sports"),
        76: ("fitness_gaming", "Fitness gaming"),
        77: ("cardio_dance", "Cardio dance"),
        78: ("social_dance", "Social dance"),
        79: ("pickleball", "Pickleball"),
        80: ("cooldown", "Cooldown"),
        82: ("swim_bike_run", "Swim-bike-run"),
        83: ("transition", "Transition"),
        84: ("underwater_diving", "Underwater diving"),
        3000: ("other", "Other")
    ]

    private static let cardioWorkoutKeys: Set<String> = [
        "walking",
        "running",
        "cycling",
        "rowing",
        "elliptical",
        "hiking",
        "mixed_cardio",
        "mixed_metabolic_cardio_training",
        "high_intensity_interval_training",
        "jump_rope",
        "stair_climbing",
        "stairs",
        "step_training",
        "cross_country_skiing",
        "downhill_skiing",
        "snowboarding",
        "hand_cycling",
        "wheelchair_walk_pace",
        "wheelchair_run_pace",
        "track_and_field",
        "cross_training",
        "cardio_dance",
        "fitness_gaming",
        "swim_bike_run",
        "transition"
    ]

    private static let strengthWorkoutKeys: Set<String> = [
        "traditional_strength_training",
        "functional_strength_training",
        "core_training",
        "cross_training",
        "climbing"
    ]

    private static let mobilityWorkoutKeys: Set<String> = [
        "barre",
        "pilates",
        "flexibility",
        "preparation_and_recovery",
        "cooldown"
    ]

    private static let mindfulWorkoutKeys: Set<String> = [
        "mind_and_body",
        "yoga",
        "tai_chi"
    ]

    private static let waterWorkoutKeys: Set<String> = [
        "swimming",
        "water_fitness",
        "water_polo",
        "water_sports",
        "paddle_sports",
        "surfing_sports",
        "sailing",
        "underwater_diving"
    ]

    private static let teamWorkoutKeys: Set<String> = [
        "american_football",
        "australian_football",
        "baseball",
        "basketball",
        "cricket",
        "handball",
        "hockey",
        "lacrosse",
        "rugby",
        "soccer",
        "softball",
        "volleyball",
        "water_polo"
    ]

    private static let racketWorkoutKeys: Set<String> = [
        "badminton",
        "pickleball",
        "racquetball",
        "squash",
        "table_tennis",
        "tennis"
    ]

    private static let combatWorkoutKeys: Set<String> = [
        "boxing",
        "kickboxing",
        "martial_arts",
        "wrestling",
        "fencing"
    ]

    private static let winterWorkoutKeys: Set<String> = [
        "cross_country_skiing",
        "downhill_skiing",
        "snow_sports",
        "snowboarding",
        "curling"
    ]

    private func clippedInterval(
        start: Date,
        end: Date,
        boundsStart: Date,
        boundsEnd: Date
    ) -> (start: Date, end: Date)? {
        let clippedStart = max(start, boundsStart)
        let clippedEnd = min(end, boundsEnd)
        guard clippedEnd > clippedStart else {
            return nil
        }
        return (clippedStart, clippedEnd)
    }

    private func mergedDuration(for intervals: [(Date, Date)]) -> Int {
        mergedIntervals(for: intervals).reduce(0) { partialResult, interval in
            partialResult + Int(interval.1.timeIntervalSince(interval.0))
        }
    }

    private func mergedIntervals(for intervals: [(Date, Date)]) -> [(Date, Date)] {
        guard !intervals.isEmpty else {
            return []
        }
        let sorted = intervals.sorted { left, right in
            if left.0 == right.0 {
                return left.1 < right.1
            }
            return left.0 < right.0
        }
        var merged: [(Date, Date)] = [sorted[0]]
        for interval in sorted.dropFirst() {
            if let last = merged.last, interval.0 <= last.1 {
                merged[merged.count - 1] = (last.0, max(last.1, interval.1))
            } else {
                merged.append(interval)
            }
        }
        return merged
    }

    private func isoString(_ date: Date) -> String {
        isoFormatter.string(from: date)
    }
}
