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

struct PairingPayload: Codable {
    let kind: String
    let apiBaseUrl: String
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

    let sessionId: String
    let pairingToken: String
    let device: Device
    let permissions: Permissions
    let sleepSessions: [SleepSession]
    let workouts: [WorkoutSession]
}

struct SyncReceipt: Decodable {
    struct ImportedCounts: Decodable {
        let sleepSessions: Int
        let workouts: Int
        let createdCount: Int
        let updatedCount: Int
        let mergedCount: Int
    }

    let imported: ImportedCounts
}

struct SyncReport {
    let syncedAt: Date
    let sleepSessions: Int
    let workouts: Int
    let createdCount: Int
    let updatedCount: Int
    let mergedCount: Int
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
