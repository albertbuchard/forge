import Foundation
import HealthKit
import UIKit

actor HealthSyncStore {
    private enum SleepBucket {
        case inBed
        case asleep
        case awake
    }

    private struct SleepSegment {
        let startDate: Date
        let endDate: Date
        let stageLabel: String
        let bucket: SleepBucket
    }

    private let store = HKHealthStore()
    private let syncWindowDays = 21
    private let incrementalLookbackHours = 72
    private let sleepSessionGap: TimeInterval = 4 * 60 * 60
    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private var requestedReadTypes: Set<HKObjectType> {
        let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        let workouts = HKObjectType.workoutType()
        let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate)
        let activeEnergy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        let distanceWalking = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        let stepCount = HKQuantityType.quantityType(forIdentifier: .stepCount)

        return Set([sleep, workouts, heartRate, activeEnergy, distanceWalking, stepCount].compactMap { $0 })
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
        lastSuccessfulSyncAt: Date?,
        movementPayload: CompanionSyncPayload.MovementPayload
    ) async throws -> CompanionSyncPayload {
        let endDate = Date()
        let fullWindowStart = Calendar.current.date(byAdding: .day, value: -syncWindowDays, to: endDate)
            ?? endDate.addingTimeInterval(-Double(syncWindowDays) * 24 * 60 * 60)
        let incrementalStart = lastSuccessfulSyncAt?.addingTimeInterval(-Double(incrementalLookbackHours) * 60 * 60)
        let startDate = max(fullWindowStart, incrementalStart ?? fullWindowStart)
        companionDebugLog(
            "HealthSyncStore",
            "buildSyncPayload start session=\(pairing.sessionId) start=\(isoString(startDate)) end=\(isoString(endDate)) incremental=\(incrementalStart.map(isoString) ?? "nil")"
        )
        async let sleepSessions = fetchSleepSessions(startDate: startDate, endDate: endDate)
        async let workouts = fetchWorkoutSessions(startDate: startDate, endDate: endDate)
        let backgroundRefreshEnabled = await MainActor.run {
            UIApplication.shared.backgroundRefreshStatus == .available
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
                    || movementPayload.settings.locationPermissionStatus == "when_in_use"
            ),
            sleepSessions: try await sleepSessions,
            workouts: try await workouts,
            movement: movementPayload
        )
        companionDebugLog(
            "HealthSyncStore",
            "buildSyncPayload success sleep=\(payload.sleepSessions.count) workouts=\(payload.workouts.count) trips=\(payload.movement.trips.count) stays=\(payload.movement.stays.count) backgroundRefresh=\(backgroundRefreshEnabled)"
        )
        return payload
    }

    private func fetchSleepSessions(startDate: Date, endDate: Date) async throws -> [CompanionSyncPayload.SleepSession] {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            companionDebugLog("HealthSyncStore", "fetchSleepSessions unavailable sleep type")
            return []
        }
        companionDebugLog(
            "HealthSyncStore",
            "fetchSleepSessions start start=\(isoString(startDate)) end=\(isoString(endDate))"
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
            companionDebugLog("HealthSyncStore", "fetchSleepSessions no anchors")
            return []
        }

        var clusters: [[SleepSegment]] = []
        var currentCluster: [SleepSegment] = []
        var currentEnd: Date?

        for segment in anchors {
            if var currentEnd, segment.startDate.timeIntervalSince(currentEnd) > sleepSessionGap {
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

        let sessions: [CompanionSyncPayload.SleepSession] = clusters.compactMap { cluster in
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
                    startDate: clipped.start,
                    endDate: clipped.end,
                    stageLabel: segment.stageLabel,
                    bucket: segment.bucket
                )
            }

            let timeInBedSeconds = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .inBed }
                    .map { ($0.startDate, $0.endDate) }
            )
            let asleepSeconds = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .asleep }
                    .map { ($0.startDate, $0.endDate) }
            )
            let awakeSeconds = mergedDuration(
                for: boundedSegments
                    .filter { $0.bucket == .awake }
                    .map { ($0.startDate, $0.endDate) }
            )
            guard timeInBedSeconds > 0 || asleepSeconds > 0 else {
                return nil
            }

            var stageTotals: [String: Int] = [:]
            for segment in boundedSegments where segment.bucket != .inBed {
                stageTotals[segment.stageLabel, default: 0] += Int(segment.endDate.timeIntervalSince(segment.startDate))
            }
            let stageBreakdown = stageTotals
                .map { CompanionSyncPayload.SleepStage(stage: $0.key, seconds: $0.value) }
                .sorted { $0.stage < $1.stage }

            return CompanionSyncPayload.SleepSession(
                externalUid: "sleep-\(isoString(sessionStart))-\(isoString(sessionEnd))",
                startedAt: isoString(sessionStart),
                endedAt: isoString(sessionEnd),
                timeInBedSeconds: timeInBedSeconds,
                asleepSeconds: asleepSeconds,
                awakeSeconds: awakeSeconds,
                stageBreakdown: stageBreakdown,
                recoveryMetrics: [
                    "sleepWindowStart": isoString(sessionStart),
                    "sleepWindowEnd": isoString(sessionEnd),
                    "capturedStages": String(stageBreakdown.count)
                ],
                links: [],
                annotations: .init(
                    qualitySummary: "",
                    notes: "",
                    tags: []
                )
            )
        }
        .sorted { $0.startedAt > $1.startedAt }
        companionDebugLog(
            "HealthSyncStore",
            "fetchSleepSessions success samples=\(samples.count) segments=\(segments.count) sessions=\(sessions.count)"
        )
        return sessions
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
            startDate: sample.startDate,
            endDate: sample.endDate,
            stageLabel: mapping.label,
            bucket: mapping.bucket
        )
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
        guard !intervals.isEmpty else {
            return 0
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
        return merged.reduce(0) { partialResult, interval in
            partialResult + Int(interval.1.timeIntervalSince(interval.0))
        }
    }

    private func isoString(_ date: Date) -> String {
        isoFormatter.string(from: date)
    }
}
