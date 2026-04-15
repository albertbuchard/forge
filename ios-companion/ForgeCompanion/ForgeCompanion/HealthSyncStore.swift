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
        let readTypes = requestedReadTypes
        return await withCheckedContinuation { continuation in
            store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { status, _ in
                continuation.resume(returning: status)
            }
        }
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

        let totalEnergy = workout.totalEnergyBurned?.doubleValue(for: .kilocalorie())
        let distance = workout.totalDistance?.doubleValue(for: .meter())
        let sourceDevice = workout.device?.name ?? workout.sourceRevision.source.name
        let resolvedStepCount = try await stepCount
        let resolvedAverageHeartRate = try await averageHeartRate
        let resolvedMaxHeartRate = try await maxHeartRate
        let resolvedActiveEnergy = try await activeEnergy

        let session = CompanionSyncPayload.WorkoutSession(
            externalUid: workout.uuid.uuidString.lowercased(),
            workoutType: workoutTypeLabel(for: workout.workoutActivityType),
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
                    continuation.resume(throwing: error)
                    return
                }
                let resolved = (samples as? [HKQuantitySample] ?? []).map { sample in
                    VitalQuantitySample(
                        startedAt: sample.startDate,
                        endedAt: sample.endDate,
                        value: sample.quantity.doubleValue(for: definition.unit) * definition.displayMultiplier
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
                    continuation.resume(throwing: error)
                    return
                }
                let value: Double?
                if option.contains(.cumulativeSum) {
                    value = statistics?.sumQuantity()?.doubleValue(for: unit)
                } else if option.contains(.discreteAverage) {
                    value = statistics?.averageQuantity()?.doubleValue(for: unit)
                } else if option.contains(.discreteMax) {
                    value = statistics?.maximumQuantity()?.doubleValue(for: unit)
                } else {
                    value = nil
                }
                continuation.resume(returning: value)
            }
            self.store.execute(query)
        }
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

    private func workoutTypeLabel(for type: HKWorkoutActivityType) -> String {
        switch type {
        case .walking:
            return "walking"
        case .running:
            return "running"
        case .cycling:
            return "cycling"
        case .hiking:
            return "hiking"
        case .swimming:
            return "swimming"
        case .traditionalStrengthTraining:
            return "strength_training"
        case .functionalStrengthTraining:
            return "functional_strength"
        case .yoga:
            return "yoga"
        case .mindAndBody:
            return "mind_and_body"
        case .tennis:
            return "tennis"
        case .basketball:
            return "basketball"
        case .rowing:
            return "rowing"
        case .elliptical:
            return "elliptical"
        case .stairClimbing:
            return "stair_climbing"
        case .cooldown:
            return "cooldown"
        case .flexibility:
            return "flexibility"
        case .mixedCardio:
            return "mixed_cardio"
        default:
            return "activity_\(type.rawValue)"
        }
    }

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
