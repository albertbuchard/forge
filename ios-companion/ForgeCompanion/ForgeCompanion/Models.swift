import Foundation

enum ForgeDiscoverySource: String, Codable {
    case simulator
    case iroh
    case tailscale
    case lan
    case bonjour
}

struct DiscoveredForgeServer: Identifiable, Hashable {
    let id: String
    let name: String
    let host: String
    let apiBaseUrl: String
    let uiBaseUrl: String
    let source: ForgeDiscoverySource
    let canBootstrapPairing: Bool
    let detail: String
}

struct DiscoveredTailscaleDevice: Identifiable, Hashable {
    let id: String
    let name: String
    let host: String
    let dnsName: String?
    let forgeApiBaseUrl: String?
    let forgeUiBaseUrl: String?
    let forgeApiReachable: Bool
    let forgeUiReachable: Bool
    let detail: String
}

struct ForgeDiscoveryReport {
    let servers: [DiscoveredForgeServer]
    let tailscaleDevices: [DiscoveredTailscaleDevice]
    let tailscaleStatusMessage: String
}

struct CompanionSourceState: Codable, Hashable {
    let desiredEnabled: Bool
    let appliedEnabled: Bool
    let authorizationStatus: String
    let syncEligible: Bool
    let lastObservedAt: String?
    let metadata: LooseJSONObject
}

struct CompanionSourceStates: Codable, Hashable {
    let health: CompanionSourceState
    let movement: CompanionSourceState
    let screenTime: CompanionSourceState
}

struct CompanionPairingSessionState: Decodable, Hashable {
    let id: String
    let userId: String
    let label: String
    let status: String
    let capabilities: [String]
    let deviceName: String?
    let platform: String?
    let appVersion: String?
    let apiBaseUrl: String
    let lastSeenAt: String?
    let lastSyncAt: String?
    let lastSyncError: String?
    let pairedAt: String?
    let sourceStates: CompanionSourceStates
    let expiresAt: String
    let createdAt: String
    let updatedAt: String
}

struct PairingTransportPairPayload: Codable, Hashable {
    let v: Int
    let nodeId: String
    let token: String
    let hostName: String?
    let relay: String?

    enum CodingKeys: String, CodingKey {
        case v
        case nodeId = "node_id"
        case token
        case hostName = "host_name"
        case relay
    }
}

struct PairingTransport: Codable, Hashable {
    let protocolName: String
    let provider: String
    let status: String
    let publicBaseUrl: String?
    let localBaseUrl: String?
    let nodeId: String?
    let relay: String?
    let alpn: String?
    let agent: String?
    let pairPayload: PairingTransportPairPayload?
    let recreateCommand: String?
    let startedAt: String?
    let lastError: String?
    let notes: [String]

    enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case provider
        case status
        case publicBaseUrl
        case localBaseUrl
        case nodeId
        case relay
        case alpn
        case agent
        case pairPayload
        case recreateCommand
        case startedAt
        case lastError
        case notes
    }
}

extension PairingTransport {
    var isIrohTransport: Bool {
        protocolName == "iroh"
    }
}

struct PairingPayload: Codable {
    let kind: String
    let apiBaseUrl: String
    let uiBaseUrl: String?
    let transportMode: String?
    let transport: PairingTransport?
    let sessionId: String
    let pairingToken: String
    let expiresAt: String
    let capabilities: [String]

    init(
        kind: String,
        apiBaseUrl: String,
        uiBaseUrl: String?,
        sessionId: String,
        pairingToken: String,
        expiresAt: String,
        capabilities: [String],
        transportMode: String? = nil,
        transport: PairingTransport? = nil
    ) {
        self.kind = kind
        self.apiBaseUrl = apiBaseUrl
        self.uiBaseUrl = uiBaseUrl
        self.transportMode = transportMode
        self.transport = transport
        self.sessionId = sessionId
        self.pairingToken = pairingToken
        self.expiresAt = expiresAt
        self.capabilities = capabilities
    }
}

struct CompanionSyncPayload: Codable {
    enum ScalarValue: Codable, Hashable {
        case string(String)
        case number(Double)
        case boolean(Bool)
        case null

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .null
            } else if let boolValue = try? container.decode(Bool.self) {
                self = .boolean(boolValue)
            } else if let numberValue = try? container.decode(Double.self) {
                self = .number(numberValue)
            } else {
                self = .string(try container.decode(String.self))
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .string(let value):
                try container.encode(value)
            case .number(let value):
                try container.encode(value)
            case .boolean(let value):
                try container.encode(value)
            case .null:
                try container.encodeNil()
            }
        }
    }

    struct Device: Codable {
        let name: String
        let platform: String
        let appVersion: String
        let sourceDevice: String
    }

    struct Permissions: Codable {
        let healthKitAuthorized: Bool
        let backgroundRefreshEnabled: Bool
        let motionReady: Bool
        let locationReady: Bool
        let screenTimeReady: Bool
    }

    typealias SourceStates = CompanionSourceStates

    struct HealthLink: Codable {
        let entityType: String
        let entityId: String
        let relationshipType: String
    }

    struct SleepStage: Codable {
        let stage: String
        let seconds: Int
    }

    struct SleepAnnotations: Codable {
        let qualitySummary: String
        let notes: String
        let tags: [String]
    }

    struct SleepSession: Codable {
        let externalUid: String
        let startedAt: String
        let endedAt: String
        let timeInBedSeconds: Int
        let asleepSeconds: Int
        let awakeSeconds: Int
        let stageBreakdown: [SleepStage]
        let recoveryMetrics: [String: String]
        let links: [HealthLink]
        let annotations: SleepAnnotations
    }

    struct SleepNight: Codable {
        let externalUid: String
        let startedAt: String
        let endedAt: String
        let sourceTimezone: String
        let localDateKey: String
        let timeInBedSeconds: Int
        let asleepSeconds: Int
        let awakeSeconds: Int
        let rawSegmentCount: Int
        let stageBreakdown: [SleepStage]
        let recoveryMetrics: [String: ScalarValue]
        let sourceMetrics: [String: ScalarValue]
        let links: [HealthLink]
        let annotations: SleepAnnotations
    }

    struct SleepSegment: Codable {
        let externalUid: String
        let startedAt: String
        let endedAt: String
        let sourceTimezone: String
        let localDateKey: String
        let stage: String
        let bucket: String
        let sourceValue: Int?
        let metadata: [String: ScalarValue]
    }

    struct SleepRawRecord: Codable {
        let externalUid: String
        let startedAt: String
        let endedAt: String
        let sourceTimezone: String
        let localDateKey: String
        let providerRecordType: String
        let rawStage: String
        let rawValue: Int?
        let payload: [String: ScalarValue]
        let metadata: [String: ScalarValue]
    }

    struct WorkoutAnnotations: Codable {
        let subjectiveEffort: Int?
        let moodBefore: String
        let moodAfter: String
        let meaningText: String
        let plannedContext: String
        let socialContext: String
        let tags: [String]
    }

    struct WorkoutActivityDescriptor: Codable {
        let sourceSystem: String
        let providerActivityType: String
        let providerRawValue: Int?
        let canonicalKey: String
        let canonicalLabel: String
        let familyKey: String
        let familyLabel: String
        let isFallback: Bool
    }

    struct WorkoutMetric: Codable {
        let key: String
        let label: String
        let category: String
        let unit: String
        let statistic: String
        let value: ScalarValue
        let startedAt: String?
        let endedAt: String?
    }

    struct WorkoutEvent: Codable {
        let type: String
        let label: String
        let startedAt: String
        let endedAt: String?
        let durationSeconds: Int
        let metadata: [String: ScalarValue]
    }

    struct WorkoutComponent: Codable {
        let externalUid: String
        let startedAt: String
        let endedAt: String?
        let durationSeconds: Int
        let activity: WorkoutActivityDescriptor
        let metrics: [WorkoutMetric]
        let metadata: [String: ScalarValue]
    }

    struct WorkoutDetails: Codable {
        let sourceSystem: String
        let metrics: [WorkoutMetric]
        let events: [WorkoutEvent]
        let components: [WorkoutComponent]
        let metadata: [String: ScalarValue]
    }

    struct WorkoutTimeSeriesSample: Codable {
        let sourceSampleUid: String
        let seriesIndex: Int
        let metricKey: String
        let label: String
        let category: String
        let unit: String
        let value: Double
        let startedAt: String
        let endedAt: String
        let sourceDevice: String
        let sourceBundleIdentifier: String?
        let sourceProductType: String?
        let captureMethod: String
        let qualityFlags: [String]
        let metadata: [String: ScalarValue]
        let provenance: [String: ScalarValue]
    }

    struct WorkoutRoutePoint: Codable {
        let sourceRouteUid: String
        let pointIndex: Int
        let recordedAt: String
        let latitude: Double
        let longitude: Double
        let altitudeMeters: Double?
        let horizontalAccuracyMeters: Double?
        let verticalAccuracyMeters: Double?
        let speedMps: Double?
        let courseDegrees: Double?
        let metadata: [String: ScalarValue]
        let provenance: [String: ScalarValue]
    }

    struct WorkoutCaptureQuality: Codable {
        let status: String
        let flags: [String]
        let heartRateSamples: Int
        let routePoints: Int
        let associatedSampleQueryUsed: Bool
        let fallbackTimeWindowUsed: Bool
        let condensedSeriesExpanded: Bool
    }

    struct WorkoutSession: Codable {
        let externalUid: String
        let workoutType: String
        let sourceSystem: String
        let sourceBundleIdentifier: String?
        let sourceProductType: String?
        let activity: WorkoutActivityDescriptor
        let details: WorkoutDetails
        let startedAt: String
        let endedAt: String
        let activeEnergyKcal: Double?
        let totalEnergyKcal: Double?
        let distanceMeters: Double?
        let stepCount: Int?
        let exerciseMinutes: Double?
        let averageHeartRate: Double?
        let maxHeartRate: Double?
        let sourceDevice: String
        let timeSeriesSamples: [WorkoutTimeSeriesSample]
        let routePoints: [WorkoutRoutePoint]
        let captureQuality: WorkoutCaptureQuality
        let syncCursor: [String: ScalarValue]
        let links: [HealthLink]
        let annotations: WorkoutAnnotations
    }

    struct VitalMetricSample: Codable {
        let metric: String
        let label: String
        let category: String
        let unit: String
        let displayUnit: String
        let aggregation: String
        let average: Double?
        let minimum: Double?
        let maximum: Double?
        let latest: Double?
        let total: Double?
        let sampleCount: Int
        let latestSampleAt: String?
    }

    struct VitalDaySummary: Codable {
        let dateKey: String
        let sourceTimezone: String
        let metrics: [VitalMetricSample]
    }

    struct VitalsPayload: Codable {
        let daySummaries: [VitalDaySummary]
    }

    struct MovementKnownPlace: Codable, Identifiable, Hashable {
        let id: String
        let externalUid: String
        let label: String
        let aliases: [String]
        let latitude: Double
        let longitude: Double
        let radiusMeters: Double
        let categoryTags: [String]
        let visibility: String
        let wikiNoteId: String?
        let metadata: [String: String]
    }

    struct MovementSettings: Codable {
        let trackingEnabled: Bool
        let publishMode: String
        let retentionMode: String
        let locationPermissionStatus: String
        let motionPermissionStatus: String
        let backgroundTrackingReady: Bool
        let metadata: [String: String]
    }

    struct MovementStay: Codable {
        let externalUid: String
        let label: String
        let status: String
        let classification: String
        let startedAt: String
        let endedAt: String
        let centerLatitude: Double
        let centerLongitude: Double
        let radiusMeters: Double
        let sampleCount: Int
        let placeExternalUid: String
        let placeLabel: String
        let tags: [String]
        let metadata: [String: String]
    }

    struct MovementTripPoint: Codable {
        let externalUid: String
        let recordedAt: String
        let latitude: Double
        let longitude: Double
        let accuracyMeters: Double?
        let altitudeMeters: Double?
        let speedMps: Double?
        let isStopAnchor: Bool
    }

    struct MovementTripStop: Codable {
        let externalUid: String
        let label: String
        let startedAt: String
        let endedAt: String
        let latitude: Double
        let longitude: Double
        let radiusMeters: Double
        let placeExternalUid: String
        let metadata: [String: String]
    }

    struct MovementTrip: Codable {
        let externalUid: String
        let label: String
        let status: String
        let travelMode: String
        let activityType: String
        let startedAt: String
        let endedAt: String
        let startPlaceExternalUid: String
        let endPlaceExternalUid: String
        let distanceMeters: Double
        let movingSeconds: Int
        let idleSeconds: Int
        let averageSpeedMps: Double?
        let maxSpeedMps: Double?
        let caloriesKcal: Double?
        let expectedMet: Double?
        let tags: [String]
        let metadata: [String: String]
        let points: [MovementTripPoint]
        let stops: [MovementTripStop]
    }

    struct MovementPayload: Codable {
        let settings: MovementSettings
        let knownPlaces: [MovementKnownPlace]
        let stays: [MovementStay]
        let trips: [MovementTrip]
    }

    struct ScreenTimeSettings: Codable {
        let trackingEnabled: Bool
        let syncEnabled: Bool
        let authorizationStatus: String
        let captureState: String
        let lastCapturedDayKey: String?
        let lastCaptureStartedAt: String?
        let lastCaptureEndedAt: String?
        let metadata: [String: String]
    }

    struct ScreenTimeDaySummary: Codable {
        let dateKey: String
        let totalActivitySeconds: Int
        let pickupCount: Int
        let notificationCount: Int
        let firstPickupAt: String?
        let longestActivitySeconds: Int
        let topAppBundleIdentifiers: [String]
        let topCategoryLabels: [String]
        let metadata: [String: String]
    }

    struct ScreenTimeAppUsage: Codable {
        let bundleIdentifier: String
        let displayName: String
        let categoryLabel: String?
        let totalActivitySeconds: Int
        let pickupCount: Int
        let notificationCount: Int
    }

    struct ScreenTimeCategoryUsage: Codable {
        let categoryLabel: String
        let totalActivitySeconds: Int
    }

    struct ScreenTimeHourlySegment: Codable {
        let dateKey: String
        let hourIndex: Int
        let startedAt: String
        let endedAt: String
        let totalActivitySeconds: Int
        let pickupCount: Int
        let notificationCount: Int
        let firstPickupAt: String?
        let longestActivityStartedAt: String?
        let longestActivityEndedAt: String?
        let metadata: [String: String]
        let apps: [ScreenTimeAppUsage]
        let categories: [ScreenTimeCategoryUsage]
    }

    struct ScreenTimePayload: Codable {
        let settings: ScreenTimeSettings
        let daySummaries: [ScreenTimeDaySummary]
        let hourlySegments: [ScreenTimeHourlySegment]
    }

    let sessionId: String
    let pairingToken: String
    let device: Device
    let permissions: Permissions
    let sourceStates: SourceStates
    let sleepSessions: [SleepSession]
    let sleepNights: [SleepNight]
    let sleepSegments: [SleepSegment]
    let sleepRawRecords: [SleepRawRecord]
    let workouts: [WorkoutSession]
    let vitals: VitalsPayload
    let movement: MovementPayload
    let screenTime: ScreenTimePayload
}

struct SyncReceipt: Decodable {
    struct ImportedCounts: Decodable {
        let sleepSessions: Int
        let sleepNights: Int?
        let sleepSegments: Int?
        let sleepRawRecords: Int?
        let workouts: Int
        let createdCount: Int
        let updatedCount: Int
        let mergedCount: Int
        let movementStays: Int?
        let movementTrips: Int?
        let movementKnownPlaces: Int?
        let vitalsDaySummaries: Int?
        let vitalsMetricEntries: Int?
        let screenTimeDaySummaries: Int?
        let screenTimeHourlySegments: Int?
    }

    struct MovementBootstrapEnvelope: Decodable {
        struct Settings: Decodable {
            let trackingEnabled: Bool
            let publishMode: String
            let retentionMode: String
            let locationPermissionStatus: String
            let motionPermissionStatus: String
            let backgroundTrackingReady: Bool
        }

        struct Place: Decodable, Identifiable {
            let id: String
            let externalUid: String
            let label: String
            let aliases: [String]
            let latitude: Double
            let longitude: Double
            let radiusMeters: Double
            let categoryTags: [String]
        }

        let stayOverrides: [ForgeMovementTimelineStay]
        let tripOverrides: [ForgeMovementTimelineTrip]
        let deletedStayExternalUids: [String]
        let deletedTripExternalUids: [String]
        let settings: Settings
        let places: [Place]
        let projectedBoxes: [ForgeMovementTimelineSegment]
    }

    let pairingSession: CompanionPairingSessionState?
    let imported: ImportedCounts
    let movement: MovementBootstrapEnvelope?
}

struct SyncReport {
    let syncedAt: Date
    let sleepSessions: Int
    let sleepNights: Int
    let sleepSegments: Int
    let sleepRawRecords: Int
    let workouts: Int
    let createdCount: Int
    let updatedCount: Int
    let mergedCount: Int
    let movementStays: Int
    let movementTrips: Int
    let movementKnownPlaces: Int
    let vitalsDaySummaries: Int
    let vitalsMetricEntries: Int
    let screenTimeDaySummaries: Int
    let screenTimeHourlySegments: Int
    let screenTimeTotalActivitySeconds: Int
}

struct SyncPayloadSummary: Codable {
    let builtAt: Date
    let sleepSessions: Int
    let sleepNights: Int
    let sleepSegments: Int
    let sleepRawRecords: Int
    let sleepStageEntries: Int
    let workouts: Int
    let workoutsWithAverageHeartRate: Int
    let workoutsWithMaxHeartRate: Int
    let workoutsWithStepCount: Int
    let movementKnownPlaces: Int
    let movementStays: Int
    let movementTrips: Int
    let movementTripPoints: Int
    let movementTripStops: Int
    let vitalsDaySummaries: Int
    let vitalsMetricEntries: Int
    let screenTimeDaySummaries: Int
    let screenTimeHourlySegments: Int
    let screenTimeTotalActivitySeconds: Int
    let rawHeartRateDatapointsSynced: Int

    init(
        builtAt: Date,
        sleepSessions: Int,
        sleepNights: Int,
        sleepSegments: Int,
        sleepRawRecords: Int,
        sleepStageEntries: Int,
        workouts: Int,
        workoutsWithAverageHeartRate: Int,
        workoutsWithMaxHeartRate: Int,
        workoutsWithStepCount: Int,
        movementKnownPlaces: Int,
        movementStays: Int,
        movementTrips: Int,
        movementTripPoints: Int,
        movementTripStops: Int,
        vitalsDaySummaries: Int,
        vitalsMetricEntries: Int,
        screenTimeDaySummaries: Int,
        screenTimeHourlySegments: Int,
        screenTimeTotalActivitySeconds: Int,
        rawHeartRateDatapointsSynced: Int
    ) {
        self.builtAt = builtAt
        self.sleepSessions = sleepSessions
        self.sleepNights = sleepNights
        self.sleepSegments = sleepSegments
        self.sleepRawRecords = sleepRawRecords
        self.sleepStageEntries = sleepStageEntries
        self.workouts = workouts
        self.workoutsWithAverageHeartRate = workoutsWithAverageHeartRate
        self.workoutsWithMaxHeartRate = workoutsWithMaxHeartRate
        self.workoutsWithStepCount = workoutsWithStepCount
        self.movementKnownPlaces = movementKnownPlaces
        self.movementStays = movementStays
        self.movementTrips = movementTrips
        self.movementTripPoints = movementTripPoints
        self.movementTripStops = movementTripStops
        self.vitalsDaySummaries = vitalsDaySummaries
        self.vitalsMetricEntries = vitalsMetricEntries
        self.screenTimeDaySummaries = screenTimeDaySummaries
        self.screenTimeHourlySegments = screenTimeHourlySegments
        self.screenTimeTotalActivitySeconds = screenTimeTotalActivitySeconds
        self.rawHeartRateDatapointsSynced = rawHeartRateDatapointsSynced
    }

    private enum CodingKeys: String, CodingKey {
        case builtAt
        case sleepSessions
        case sleepNights
        case sleepSegments
        case sleepRawRecords
        case sleepStageEntries
        case workouts
        case workoutsWithAverageHeartRate
        case workoutsWithMaxHeartRate
        case workoutsWithStepCount
        case movementKnownPlaces
        case movementStays
        case movementTrips
        case movementTripPoints
        case movementTripStops
        case vitalsDaySummaries
        case vitalsMetricEntries
        case screenTimeDaySummaries
        case screenTimeHourlySegments
        case screenTimeTotalActivitySeconds
        case rawHeartRateDatapointsSynced
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        builtAt = try container.decode(Date.self, forKey: .builtAt)
        sleepSessions = try container.decode(Int.self, forKey: .sleepSessions)
        sleepNights = try container.decode(Int.self, forKey: .sleepNights)
        sleepSegments = try container.decode(Int.self, forKey: .sleepSegments)
        sleepRawRecords = try container.decodeIfPresent(Int.self, forKey: .sleepRawRecords) ?? 0
        sleepStageEntries = try container.decode(Int.self, forKey: .sleepStageEntries)
        workouts = try container.decode(Int.self, forKey: .workouts)
        workoutsWithAverageHeartRate = try container.decode(Int.self, forKey: .workoutsWithAverageHeartRate)
        workoutsWithMaxHeartRate = try container.decode(Int.self, forKey: .workoutsWithMaxHeartRate)
        workoutsWithStepCount = try container.decode(Int.self, forKey: .workoutsWithStepCount)
        movementKnownPlaces = try container.decode(Int.self, forKey: .movementKnownPlaces)
        movementStays = try container.decode(Int.self, forKey: .movementStays)
        movementTrips = try container.decode(Int.self, forKey: .movementTrips)
        movementTripPoints = try container.decode(Int.self, forKey: .movementTripPoints)
        movementTripStops = try container.decode(Int.self, forKey: .movementTripStops)
        vitalsDaySummaries = try container.decode(Int.self, forKey: .vitalsDaySummaries)
        vitalsMetricEntries = try container.decode(Int.self, forKey: .vitalsMetricEntries)
        screenTimeDaySummaries = try container.decode(Int.self, forKey: .screenTimeDaySummaries)
        screenTimeHourlySegments = try container.decode(Int.self, forKey: .screenTimeHourlySegments)
        screenTimeTotalActivitySeconds = try container.decode(Int.self, forKey: .screenTimeTotalActivitySeconds)
        rawHeartRateDatapointsSynced = try container.decode(Int.self, forKey: .rawHeartRateDatapointsSynced)
    }
}

struct SyncTransferStats: Equatable {
    let totalBytesSent: Int
    let currentBytesPerSecond: Double
    let averageBytesPerSecond: Double
    let uploadedChunks: Int
    let uploadedRecords: Int
    let skippedChunks: Int
    let secondsSinceLastChunk: Int?
}

enum CompanionSyncMode: Equatable {
    case normal
    case historicalWorkoutImport
}

struct HistoricalWorkoutImportStatus: Equatable {
    var indexedWorkouts: Int
    var totalWorkouts: Int?
    var uploadedWorkoutSummaries: Int
    var uploadedTimeSeriesSamples: Int
    var uploadedRoutePoints: Int
    var targetHeartRateSamples: Int
    var targetTimeSeriesSamples: Int
    var targetRoutePoints: Int
    var uploadedChunks: Int
    var resumedChunks: Int

    var remainingWorkouts: Int? {
        guard let totalWorkouts else {
            return nil
        }
        return max(0, totalWorkouts - uploadedWorkoutSummaries)
    }

    var progressFraction: Double {
        guard let totalWorkouts, totalWorkouts > 0 else {
            return uploadedWorkoutSummaries > 0 ? 1 : 0
        }
        return min(1, max(0, Double(uploadedWorkoutSummaries) / Double(totalWorkouts)))
    }
}

struct CompanionSyncUploadStatus {
    let isSyncing: Bool
    let syncMode: CompanionSyncMode
    let message: String?
    let payloadSummary: SyncPayloadSummary?
    let lastChunkFamily: String?
    let lastPayloadBytes: Int?
    let activeSessionId: String?
    let transferStats: SyncTransferStats?
    let historicalWorkoutImport: HistoricalWorkoutImportStatus?

    var isHistoricalWorkoutImport: Bool {
        syncMode == .historicalWorkoutImport
    }

    var shouldShowHistoricalWorkoutImportPanel: Bool {
        if isHistoricalWorkoutImport {
            return true
        }
        guard historicalWorkoutImport != nil else {
            return false
        }
        let lowercasedMessage = message?.lowercased() ?? ""
        return lowercasedMessage.contains("historical workout")
            || lowercasedMessage.contains("workout history")
            || lowercasedMessage.contains("historical workouts")
            || lowercasedMessage.contains("heart-rate and route evidence")
    }

    var headline: String {
        if isHistoricalWorkoutImport {
            return isSyncing ? "Historical workout import" : "Historical workout import ready"
        }
        guard isSyncing else {
            return "Ready for the next sync"
        }
        guard let message, message.isEmpty == false else {
            return "Preparing sync"
        }
        return message
    }

    var uploadSummary: String {
        guard let payloadSummary else {
            return isSyncing ? "Counting HealthKit and movement records" : "No payload counted yet"
        }
        let parts = [
            "\(payloadSummary.sleepRawRecords) raw sleep",
            "\(payloadSummary.sleepSegments) segments",
            "\(payloadSummary.sleepNights) nights",
            "\(payloadSummary.workouts) workouts",
            "\(payloadSummary.rawHeartRateDatapointsSynced) HR samples",
            "\(payloadSummary.movementTrips) trips"
        ]
        return parts.joined(separator: ", ")
    }

    var transferSummary: String {
        var parts: [String] = []
        if let lastChunkFamily, lastChunkFamily.isEmpty == false {
            parts.append(lastChunkFamily.replacingOccurrences(of: "_", with: " "))
        }
        if let transferStats {
            parts.append("\(Self.formatBytes(transferStats.totalBytesSent)) sent")
        } else if let lastPayloadBytes {
            parts.append(Self.formatBytes(lastPayloadBytes))
        }
        if let activeSessionId, activeSessionId.isEmpty == false {
            parts.append("session \(Self.shortSessionId(activeSessionId))")
        }
        return parts.isEmpty ? "Waiting for the first upload chunk" : parts.joined(separator: " • ")
    }

    var speedSummary: String? {
        guard let transferStats else {
            return nil
        }
        var parts = [
            "\(Self.formatBytes(Int(transferStats.currentBytesPerSecond)))/s now",
            "\(Self.formatBytes(Int(transferStats.averageBytesPerSecond)))/s avg",
            "\(transferStats.uploadedChunks) chunks"
        ]
        if transferStats.skippedChunks > 0 {
            parts.append("\(transferStats.skippedChunks) resumed")
        }
        if let secondsSinceLastChunk = transferStats.secondsSinceLastChunk,
           secondsSinceLastChunk >= 3 {
            parts.append("\(secondsSinceLastChunk)s since ack")
        }
        return parts.joined(separator: " • ")
    }

    private static func shortSessionId(_ value: String) -> String {
        guard value.count > 10 else {
            return value
        }
        return String(value.suffix(10))
    }

    private static func formatBytes(_ value: Int) -> String {
        guard value >= 1024 else {
            return "\(value) B"
        }
        let kilobytes = Double(value) / 1024
        guard kilobytes >= 1024 else {
            return String(format: "%.1f KB", kilobytes)
        }
        return String(format: "%.1f MB", kilobytes / 1024)
    }
}

struct SyncCoverageRow: Identifiable {
    let id: String
    let title: String
    let value: String
    let detail: String
    let isMissing: Bool
}

struct LooseJSONObject: Codable, Hashable {
    let values: [String: String]

    init(values: [String: String] = [:]) {
        self.values = values
    }

    init(from decoder: Decoder) throws {
        if let keyed = try? decoder.container(keyedBy: DynamicCodingKey.self) {
            var collected: [String: String] = [:]
            for key in keyed.allKeys {
                collected[key.stringValue] = try keyed.decodeLossyString(forKey: key)
            }
            values = collected
            return
        }
        if var unkeyed = try? decoder.unkeyedContainer() {
            var collected: [String: String] = [:]
            var index = 0
            while unkeyed.isAtEnd == false {
                let nestedDecoder = try unkeyed.superDecoder()
                let nestedValue = try LooseJSONLeaf(from: nestedDecoder)
                collected["\(index)"] = nestedValue.stringValue
                index += 1
            }
            values = collected
            return
        }
        let singleValue = try decoder.singleValueContainer()
        if singleValue.decodeNil() {
            values = [:]
            return
        }
        let leaf = try LooseJSONLeaf(from: decoder)
        values = ["value": leaf.stringValue]
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: DynamicCodingKey.self)
        for (key, value) in values {
            try container.encode(value, forKey: DynamicCodingKey(key))
        }
    }
}

enum MovementTimelineLaneSide: String, Codable {
    case left
    case right
}

struct ForgeMovementTimelinePage: Codable {
    let segments: [ForgeMovementTimelineSegment]
    let sleepOverlays: [ForgeMovementTimelineSleepOverlay]
    let nextCursor: String?
    let hasMore: Bool
}

struct ForgeMovementTimelineSleepOverlay: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let startedAt: String
    let endedAt: String
    let localDateKey: String
    let sourceTimezone: String
    let asleepSeconds: Int?
    let timeInBedSeconds: Int?
    let sleepScore: Int?
    let regularityScore: Int?
    let efficiency: Double?
    let recoveryState: String?
}

struct ForgeMovementTimelinePlace: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let label: String
    let aliases: [String]
    let latitude: Double
    let longitude: Double
    let radiusMeters: Double
    let categoryTags: [String]
    let visibility: String
    let wikiNoteId: String?
}

struct ForgeMovementTimelineNote: Codable, Hashable {
    let id: String
    let title: String
    let slug: String
}

struct ForgeMovementTimelineTripPoint: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let recordedAt: String
    let latitude: Double
    let longitude: Double
    let accuracyMeters: Double?
    let altitudeMeters: Double?
    let speedMps: Double?
    let isStopAnchor: Bool
}

struct ForgeMovementTimelineTripStop: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let sequenceIndex: Int
    let label: String
    let placeId: String?
    let startedAt: String
    let endedAt: String
    let durationSeconds: Int
    let latitude: Double
    let longitude: Double
    let radiusMeters: Double
    let metadata: LooseJSONObject
    let place: ForgeMovementTimelinePlace?
}

struct ForgeMovementTimelineStay: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let pairingSessionId: String?
    let userId: String
    let placeId: String?
    let label: String
    let status: String
    let classification: String
    let startedAt: String
    let endedAt: String
    let durationSeconds: Int
    let centerLatitude: Double
    let centerLongitude: Double
    let radiusMeters: Double
    let sampleCount: Int
    let weather: LooseJSONObject
    let metrics: LooseJSONObject
    let metadata: LooseJSONObject
    let publishedNoteId: String?
    let createdAt: String
    let updatedAt: String
    let place: ForgeMovementTimelinePlace?
    let note: ForgeMovementTimelineNote?
}

struct ForgeMovementTimelineTrip: Codable, Hashable, Identifiable {
    let id: String
    let externalUid: String
    let pairingSessionId: String?
    let userId: String
    let startPlaceId: String?
    let endPlaceId: String?
    let label: String
    let status: String
    let travelMode: String
    let activityType: String
    let startedAt: String
    let endedAt: String
    let durationSeconds: Int
    let distanceMeters: Double
    let movingSeconds: Int
    let idleSeconds: Int
    let averageSpeedMps: Double?
    let maxSpeedMps: Double?
    let caloriesKcal: Double?
    let expectedMet: Double?
    let weather: LooseJSONObject
    let tags: [String]
    let metadata: LooseJSONObject
    let publishedNoteId: String?
    let createdAt: String
    let updatedAt: String
    let startPlace: ForgeMovementTimelinePlace?
    let endPlace: ForgeMovementTimelinePlace?
    let points: [ForgeMovementTimelineTripPoint]
    let stops: [ForgeMovementTimelineTripStop]
    let note: ForgeMovementTimelineNote?
}

struct ForgeMovementTimelineSegment: Codable, Hashable, Identifiable {
    let id: String
    let boxId: String?
    let kind: String
    let sourceKind: String
    let origin: String
    let editable: Bool
    let startedAt: String
    let endedAt: String
    let trueStartedAt: String?
    let trueEndedAt: String?
    let visibleStartedAt: String?
    let visibleEndedAt: String?
    let durationSeconds: Int
    let laneSide: MovementTimelineLaneSide
    let connectorFromLane: MovementTimelineLaneSide
    let connectorToLane: MovementTimelineLaneSide
    let title: String
    let subtitle: String
    let placeLabel: String?
    let tags: [String]
    let syncSource: String
    let cursor: String
    let overrideCount: Int
    let overriddenAutomaticBoxIds: [String]
    let overriddenUserBoxIds: [String]?
    let isFullyHidden: Bool?
    let rawStayIds: [String]
    let rawTripIds: [String]
    let rawPointCount: Int
    let hasLegacyCorrections: Bool
    let stay: ForgeMovementTimelineStay?
    let trip: ForgeMovementTimelineTrip?
}

struct ForgeMovementBoxDetailCoordinate: Codable, Hashable {
    let latitude: Double
    let longitude: Double
    let recordedAt: String?
    let label: String?
    let accuracyMeters: Double?
    let altitudeMeters: Double?
    let speedMps: Double?
    let isStopAnchor: Bool?
}

struct ForgeMovementBoxStayDetail: Codable, Hashable {
    let positions: [ForgeMovementBoxDetailCoordinate]
    let averagePosition: ForgeMovementBoxDetailCoordinate?
    let canonicalPlace: ForgeMovementTimelinePlace?
    let radiusMeters: Double?
    let sampleCount: Int
}

struct ForgeMovementBoxTripDetail: Codable, Hashable {
    let positions: [ForgeMovementBoxDetailCoordinate]
    let startPosition: ForgeMovementBoxDetailCoordinate?
    let endPosition: ForgeMovementBoxDetailCoordinate?
    let totalDistanceMeters: Double
    let movingSeconds: Int
    let idleSeconds: Int
    let averageSpeedMps: Double?
    let maxSpeedMps: Double?
    let stopCount: Int
}

struct ForgeMovementBoxDetail: Codable, Hashable {
    let segment: ForgeMovementTimelineSegment
    let rawStays: [ForgeMovementTimelineStay]
    let rawTrips: [ForgeMovementTimelineTrip]
    let stayDetail: ForgeMovementBoxStayDetail?
    let tripDetail: ForgeMovementBoxTripDetail?
}

struct ForgeMovementUserBoxPreflight: Codable, Hashable {
    let overlapsAnything: Bool
    let visibleRangeStart: String?
    let visibleRangeEnd: String?
    let suggestedStartedAt: String?
    let suggestedEndedAt: String?
    let nearestMissingStartedAt: String?
    let nearestMissingEndedAt: String?
    let affectedAutomaticBoxIds: [String]
    let affectedUserBoxIds: [String]
    let fullyOverriddenUserBoxIds: [String]
    let trimmedUserBoxIds: [String]
}

struct ForgeMovementUserBoxPayload: Encodable {
    var kind: String?
    var startedAt: String?
    var endedAt: String?
    var title: String?
    var subtitle: String?
    var placeLabel: String??
    var anchorExternalUid: String??
    var tags: [String]?
    var distanceMeters: Double?
    var averageSpeedMps: Double??
    var metadata: [String: String]?
}

struct ForgeMovementUserBoxPreflightPayload: Encodable {
    var kind: String
    var startedAt: String
    var endedAt: String
    var title: String
    var subtitle: String
    var placeLabel: String?
    var anchorExternalUid: String?
    var tags: [String]
    var distanceMeters: Double?
    var averageSpeedMps: Double?
    var metadata: [String: String]
    var excludeBoxId: String?
    var rangeStart: String?
    var rangeEnd: String?
}

enum HealthAccessStatus: String, Codable {
    case notSet = "not_set"
    case customAccess = "custom_access"
    case fullAccess = "full_access"
}

enum SyncState: String {
    case disconnected
    case connected
    case syncing
    case healthy
    case stale
    case permissionDenied
    case error
}

private struct DynamicCodingKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int?

    init(_ stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(stringValue: String) {
        self.init(stringValue)
    }

    init?(intValue: Int) {
        self.stringValue = "\(intValue)"
        self.intValue = intValue
    }
}

private struct LooseJSONLeaf: Decodable {
    let stringValue: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            stringValue = "null"
        } else if let value = try? container.decode(String.self) {
            stringValue = value
        } else if let value = try? container.decode(Double.self) {
            stringValue = value.formatted(.number)
        } else if let value = try? container.decode(Int.self) {
            stringValue = "\(value)"
        } else if let value = try? container.decode(Bool.self) {
            stringValue = value ? "true" : "false"
        } else {
            stringValue = "<object>"
        }
    }
}

private extension KeyedDecodingContainer where Key == DynamicCodingKey {
    func decodeLossyString(forKey key: Key) throws -> String {
        if let value = try? decode(String.self, forKey: key) {
            return value
        }
        if let value = try? decode(Double.self, forKey: key) {
            return value.formatted(.number)
        }
        if let value = try? decode(Int.self, forKey: key) {
            return "\(value)"
        }
        if let value = try? decode(Bool.self, forKey: key) {
            return value ? "true" : "false"
        }
        if let nested = try? decode(LooseJSONObject.self, forKey: key) {
            return nested.values
                .sorted { $0.key < $1.key }
                .map { "\($0.key): \($0.value)" }
                .joined(separator: ", ")
        }
        if let values = try? decode([String].self, forKey: key) {
            return values.joined(separator: ", ")
        }
        return "<value>"
    }
}
