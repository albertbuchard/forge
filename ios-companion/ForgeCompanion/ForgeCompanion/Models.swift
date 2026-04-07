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
    }

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

    let sessionId: String
    let pairingToken: String
    let device: Device
    let permissions: Permissions
    let sleepSessions: [SleepSession]
    let workouts: [WorkoutSession]
    let movement: MovementPayload
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

        let settings: Settings
        let places: [Place]
    }

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
    let rawHeartRateDatapointsSynced: Int
}

struct SyncCoverageRow: Identifiable {
    let id: String
    let title: String
    let value: String
    let detail: String
    let isMissing: Bool
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
