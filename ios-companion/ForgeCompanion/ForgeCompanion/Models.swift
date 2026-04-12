import Foundation

enum ForgeDiscoverySource: String, Codable {
    case simulator
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

struct PairingPayload: Codable {
    let kind: String
    let apiBaseUrl: String
    let uiBaseUrl: String?
    let sessionId: String
    let pairingToken: String
    let expiresAt: String
    let capabilities: [String]
}

struct CompanionSyncPayload: Codable {
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

    struct WorkoutAnnotations: Codable {
        let subjectiveEffort: Int?
        let moodBefore: String
        let moodAfter: String
        let meaningText: String
        let plannedContext: String
        let socialContext: String
        let tags: [String]
    }

    struct WorkoutSession: Codable {
        let externalUid: String
        let workoutType: String
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
        let links: [HealthLink]
        let annotations: WorkoutAnnotations
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
    let workouts: [WorkoutSession]
    let movement: MovementPayload
    let screenTime: ScreenTimePayload
}

struct SyncReceipt: Decodable {
    struct ImportedCounts: Decodable {
        let sleepSessions: Int
        let workouts: Int
        let createdCount: Int
        let updatedCount: Int
        let mergedCount: Int
        let movementStays: Int?
        let movementTrips: Int?
        let movementKnownPlaces: Int?
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
    }

    let pairingSession: CompanionPairingSessionState?
    let imported: ImportedCounts
    let movement: MovementBootstrapEnvelope?
}

struct SyncReport {
    let syncedAt: Date
    let sleepSessions: Int
    let workouts: Int
    let createdCount: Int
    let updatedCount: Int
    let mergedCount: Int
    let movementStays: Int
    let movementTrips: Int
    let movementKnownPlaces: Int
    let screenTimeDaySummaries: Int
    let screenTimeHourlySegments: Int
}

struct SyncPayloadSummary: Codable {
    let builtAt: Date
    let sleepSessions: Int
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
    let screenTimeDaySummaries: Int
    let screenTimeHourlySegments: Int
    let rawHeartRateDatapointsSynced: Int
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

struct ForgeMovementTimelinePage: Decodable {
    let segments: [ForgeMovementTimelineSegment]
    let nextCursor: String?
    let hasMore: Bool
}

struct ForgeMovementTimelinePlace: Decodable, Hashable, Identifiable {
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

struct ForgeMovementTimelineNote: Decodable, Hashable {
    let id: String
    let title: String
    let slug: String
}

struct ForgeMovementTimelineTripPoint: Decodable, Hashable, Identifiable {
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

struct ForgeMovementTimelineTripStop: Decodable, Hashable, Identifiable {
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

struct ForgeMovementTimelineStay: Decodable, Hashable, Identifiable {
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

struct ForgeMovementTimelineTrip: Decodable, Hashable, Identifiable {
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

struct ForgeMovementTimelineSegment: Decodable, Hashable, Identifiable {
    let id: String
    let kind: String
    let origin: String
    let editable: Bool
    let startedAt: String
    let endedAt: String
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
    let stay: ForgeMovementTimelineStay?
    let trip: ForgeMovementTimelineTrip?
}

struct ForgeMovementStayPatch: Encodable {
    var label: String?
    var status: String?
    var classification: String?
    var startedAt: String?
    var endedAt: String?
    var centerLatitude: Double?
    var centerLongitude: Double?
    var radiusMeters: Double?
    var sampleCount: Int?
    var placeId: String??
    var placeExternalUid: String??
    var placeLabel: String?
    var tags: [String]?
    var metadata: [String: String]?
}

struct ForgeMovementTripPatch: Encodable {
    var label: String?
    var status: String?
    var travelMode: String?
    var activityType: String?
    var startedAt: String?
    var endedAt: String?
    var startPlaceId: String??
    var endPlaceId: String??
    var startPlaceExternalUid: String??
    var endPlaceExternalUid: String??
    var distanceMeters: Double?
    var movingSeconds: Int?
    var idleSeconds: Int?
    var averageSpeedMps: Double??
    var maxSpeedMps: Double??
    var caloriesKcal: Double??
    var expectedMet: Double??
    var tags: [String]?
    var metadata: [String: String]?
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
