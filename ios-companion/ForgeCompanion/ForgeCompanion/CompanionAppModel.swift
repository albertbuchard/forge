import Foundation
import SwiftUI
import Combine

enum CompanionPairingURLResolver {
    private static func upgradedSchemeIfNeeded(_ components: inout URLComponents) {
        if components.host?.contains(".ts.net") == true, components.scheme == "http" {
            components.scheme = "https"
        }
    }

    static func normalizeApiBaseUrl(_ rawValue: String) -> String {
        guard let url = URL(string: rawValue) else {
            return rawValue
        }
        let trimmedPath = url.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        let normalizedPath: String
        if trimmedPath.hasSuffix("/forge/api/v1") {
            normalizedPath = trimmedPath.replacingOccurrences(
                of: "/forge/api/v1$",
                with: "/api/v1",
                options: .regularExpression
            )
        } else if trimmedPath == "/forge" {
            normalizedPath = "/api/v1"
        } else if trimmedPath.hasSuffix("/api/v1") {
            normalizedPath = trimmedPath
        } else {
            normalizedPath = "\(trimmedPath)/api/v1"
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = normalizedPath
        if components != nil {
            upgradedSchemeIfNeeded(&components!)
        }
        return components?.url?.absoluteString ?? rawValue
    }

    static func normalizeUiBaseUrl(_ rawValue: String) -> String {
        guard let url = URL(string: rawValue) else {
            return rawValue
        }
        let trimmedPath = url.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        let withoutApiPath = trimmedPath.replacingOccurrences(
            of: "/api/v1$",
            with: "",
            options: .regularExpression
        )
        let normalizedPath: String
        if withoutApiPath.isEmpty || withoutApiPath == "/" {
            normalizedPath = "/forge/"
        } else if withoutApiPath == "/forge" {
            normalizedPath = "/forge/"
        } else {
            normalizedPath = "\(withoutApiPath)/"
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = normalizedPath
        components?.query = nil
        components?.fragment = nil
        if components != nil {
            upgradedSchemeIfNeeded(&components!)
        }
        return components?.url?.absoluteString ?? rawValue
    }

    static func deriveUiBaseUrl(from apiBaseUrl: String) -> String {
        guard let url = URL(string: normalizeApiBaseUrl(apiBaseUrl)) else {
            return apiBaseUrl
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = "/forge/"
        components?.query = nil
        components?.fragment = nil
        if components != nil {
            upgradedSchemeIfNeeded(&components!)
        }
        return components?.url?.absoluteString ?? apiBaseUrl
    }

    static func normalizedPayload(
        _ payload: PairingPayload,
        preferredUiBaseUrl: String? = nil,
        preferredApiBaseUrl: String? = nil
    ) -> PairingPayload {
        let normalizedApiBaseUrl = normalizeApiBaseUrl(preferredApiBaseUrl ?? payload.apiBaseUrl)
        let resolvedUiBaseUrl = preferredUiBaseUrl ?? payload.uiBaseUrl
        return PairingPayload(
            kind: payload.kind,
            apiBaseUrl: normalizedApiBaseUrl,
            uiBaseUrl: resolvedUiBaseUrl.map(normalizeUiBaseUrl) ?? deriveUiBaseUrl(from: normalizedApiBaseUrl),
            sessionId: payload.sessionId,
            pairingToken: payload.pairingToken,
            expiresAt: payload.expiresAt,
            capabilities: payload.capabilities,
            transportMode: payload.transportMode,
            transport: payload.transport
        )
    }

    static func payload(
        _ payload: PairingPayload,
        refreshedBy session: CompanionPairingSessionState
    ) -> PairingPayload {
        guard session.id == payload.sessionId else {
            return payload
        }
        return PairingPayload(
            kind: payload.kind,
            apiBaseUrl: payload.apiBaseUrl,
            uiBaseUrl: payload.uiBaseUrl,
            sessionId: payload.sessionId,
            pairingToken: payload.pairingToken,
            expiresAt: session.expiresAt,
            capabilities: session.capabilities.isEmpty ? payload.capabilities : session.capabilities,
            transportMode: payload.transportMode,
            transport: payload.transport
        )
    }
}

enum CompanionOperationalStatus: String {
    case ok = "OK"
    case warning = "Warning"
    case error = "Error"
}

enum CompanionPermissionSyncPhase: Equatable {
    case idle
    case requestingHealth
    case requestingLocation
    case requestingScreenTime
    case preparingSync
    case syncing
    case completed
    case failed

    var isBusy: Bool {
        switch self {
        case .requestingHealth, .requestingLocation, .requestingScreenTime, .preparingSync, .syncing:
            return true
        case .idle, .completed, .failed:
            return false
        }
    }

    var buttonLabel: String {
        switch self {
        case .idle:
            return "Authorize + Sync"
        case .requestingHealth:
            return "Requesting Health…"
        case .requestingLocation:
            return "Requesting Location…"
        case .requestingScreenTime:
            return "Requesting Screen Time…"
        case .preparingSync:
            return "Preparing sync…"
        case .syncing:
            return "Syncing now…"
        case .completed:
            return "Synced"
        case .failed:
            return "Try again"
        }
    }

    var progressDetail: String? {
        switch self {
        case .idle:
            return nil
        case .requestingHealth:
            return "Waiting for Health access."
        case .requestingLocation:
            return "Opening location and motion access."
        case .requestingScreenTime:
            return "Opening Screen Time access."
        case .preparingSync:
            return "Checking the latest device signals."
        case .syncing:
            return "Sending the latest payload to Forge."
        case .completed:
            return "Everything available has been sent."
        case .failed:
            return "The action did not finish. You can retry."
        }
    }
}

enum CompanionSourceKey: String, CaseIterable, Identifiable {
    case health
    case movement
    case screenTime

    var id: String { rawValue }

    var title: String {
        switch self {
        case .health:
            return "Health"
        case .movement:
            return "Movement"
        case .screenTime:
            return "Screen Time"
        }
    }
}

struct CompanionOperationalSummary {
    let status: CompanionOperationalStatus
    let detail: String

    static func derive(
        syncState: SyncState,
        latestError: String?,
        healthSyncEnabled: Bool,
        healthAccessStatus: HealthAccessStatus,
        movementEnabled: Bool,
        movementPermissionStatus: String,
        movementBackgroundReady: Bool,
        screenTimeEnabled: Bool,
        screenTimeAuthorizationStatus: String
    ) -> CompanionOperationalSummary {
        if latestError?.isEmpty == false || syncState == .error {
            return .init(status: .error, detail: latestError ?? "Sync error")
        }
        let missingAuthorization =
            (healthSyncEnabled && healthAccessStatus == .notSet)
            || (movementEnabled && (
                movementPermissionStatus == "not_determined"
                    || movementPermissionStatus == "denied"
                    || movementPermissionStatus == "restricted"
                    || movementBackgroundReady == false
            ))
            || (screenTimeEnabled && (
                screenTimeAuthorizationStatus == "not_determined"
                    || screenTimeAuthorizationStatus == "denied"
                    || screenTimeAuthorizationStatus == "unavailable"
            ))
        if missingAuthorization || syncState == .permissionDenied || syncState == .stale {
            return .init(status: .warning, detail: "Missing authorization")
        }
        return .init(status: .ok, detail: "All core signals ready")
    }
}

struct CompanionSourceDiagnosticsRow: Identifiable {
    let id: String
    let title: String
    let desiredEnabled: Bool
    let appliedEnabled: Bool
    let authorizationStatus: String
    let syncEligible: Bool
    let lastObservedAt: String?
}

struct WorkoutBackfillSyncPlan {
    let requiresBackfill: Bool
    let workoutCursorDate: Date?

    init(lastSuccessfulSyncAt: Date?, workoutBackfillCompletedAt: Date?) {
        requiresBackfill = workoutBackfillCompletedAt == nil
        workoutCursorDate = requiresBackfill ? nil : lastSuccessfulSyncAt
    }
}

struct ActiveHealthSyncCheckpoint: Codable, Equatable {
    private enum CodingKeys: String, CodingKey {
        case syncSessionId
        case schemaVersion
        case requestedFamilies
        case createdAt
        case windowEnd
        case requiresWorkoutBackfill
        case lastReceivedChunkCount
        case lastReceivedBytes
        case clientChunkingVersion
    }

    let syncSessionId: String
    let schemaVersion: String
    let requestedFamilies: [String]
    let createdAt: Date
    let windowEnd: Date
    let requiresWorkoutBackfill: Bool
    var lastReceivedChunkCount: Int
    var lastReceivedBytes: Int
    let clientChunkingVersion: String

    var resumeSessionId: String {
        syncSessionId
    }

    init(
        syncSessionId: String,
        schemaVersion: String,
        requestedFamilies: [String],
        createdAt: Date,
        windowEnd: Date,
        requiresWorkoutBackfill: Bool,
        lastReceivedChunkCount: Int,
        lastReceivedBytes: Int,
        clientChunkingVersion: String = ForgeSyncClient.legacyHTTPHealthSyncChunkingVersion
    ) {
        self.syncSessionId = syncSessionId
        self.schemaVersion = schemaVersion
        self.requestedFamilies = requestedFamilies
        self.createdAt = createdAt
        self.windowEnd = windowEnd
        self.requiresWorkoutBackfill = requiresWorkoutBackfill
        self.lastReceivedChunkCount = lastReceivedChunkCount
        self.lastReceivedBytes = lastReceivedBytes
        self.clientChunkingVersion = clientChunkingVersion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            syncSessionId: try container.decode(String.self, forKey: .syncSessionId),
            schemaVersion: try container.decode(String.self, forKey: .schemaVersion),
            requestedFamilies: try container.decode([String].self, forKey: .requestedFamilies),
            createdAt: try container.decode(Date.self, forKey: .createdAt),
            windowEnd: try container.decode(Date.self, forKey: .windowEnd),
            requiresWorkoutBackfill: try container.decode(Bool.self, forKey: .requiresWorkoutBackfill),
            lastReceivedChunkCount: try container.decode(Int.self, forKey: .lastReceivedChunkCount),
            lastReceivedBytes: try container.decode(Int.self, forKey: .lastReceivedBytes),
            clientChunkingVersion: try container.decodeIfPresent(
                String.self,
                forKey: .clientChunkingVersion
            ) ?? ForgeSyncClient.legacyHTTPHealthSyncChunkingVersion
        )
    }
}

@MainActor
final class CompanionAppModel: ObservableObject {
    private enum AutoSyncPolicy {
        static let movementDebounceNanoseconds: UInt64 = 12_000_000_000
        static let immediateDebounceNanoseconds: UInt64 = 1_500_000_000
        static let foregroundMinimumInterval: TimeInterval = 5 * 60
        static let maintenanceHeartbeatInterval: TimeInterval = 5 * 60
        static let maintenanceSyncMinimumInterval: TimeInterval = 15 * 60
        static let movementMinimumInterval: TimeInterval = 3 * 60
        static let pairingMinimumInterval: TimeInterval = 15
    }

    enum HealthSyncLifecyclePolicy {
        static let stalledAckInterval: TimeInterval = 5 * 60

        static func stallReason(
            startedAt: Date?,
            lastChunkAt: Date?,
            uploadedChunks: Int,
            now: Date
        ) -> String? {
            if let lastChunkAt {
                let elapsed = now.timeIntervalSince(lastChunkAt)
                if elapsed >= stalledAckInterval {
                    return "no accepted health sync chunk for \(Int(elapsed.rounded(.down)))s"
                }
            } else if uploadedChunks == 0, let startedAt {
                let elapsed = now.timeIntervalSince(startedAt)
                if elapsed >= stalledAckInterval {
                    return "no health sync upload acknowledgement within \(Int(elapsed.rounded(.down)))s"
                }
            }
            return nil
        }
    }

    private struct SimulatorPairingResponse: Decodable {
        let qrPayload: PairingPayload
    }

    private struct SimulatorPairingRequest: Encodable {
        let label: String
        let capabilities: [String]
    }

    private struct WorkoutUploadStats {
        var workouts = 0
        var workoutsWithAverageHeartRate = 0
        var workoutsWithMaxHeartRate = 0
        var workoutsWithStepCount = 0
        var rawHeartRateDatapoints = 0
        var rawTimeSeriesDatapoints = 0
        var routePoints = 0
    }

    private struct BackendWorkoutImportSnapshot {
        let uploadedWorkoutExternalUids: Set<String>
        let uploadedWorkoutCount: Int
        let existingWorkoutCount: Int
        let incompleteWorkoutCount: Int
        let timeSeriesSampleCount: Int
        let routePointCount: Int
    }

    private struct HealthSyncRunResult {
        let receipt: SyncReceipt
        let payloadSummary: SyncPayloadSummary
        let healthDataDeferred: Bool
        let completedWorkoutBackfill: Bool
    }

    private final class HealthSyncUploadRecoveryContext {
        var uploadSession: ForgeSyncClient.HealthSyncUploadSession?
    }

    private enum SimulatorLocalForge {
        static let apiBaseUrl = "http://127.0.0.1:4317"
        static let uiBaseUrl = "http://127.0.0.1:3027/forge/"
        static let pairingLabel = "iOS Simulator"
        static let capabilities = ["healthkit.sleep", "healthkit.fitness"]
    }

    private static var disablesSimulatorAutomation: Bool {
#if DEBUG
        let environment = ProcessInfo.processInfo.environment
        return environment["FORGE_COMPANION_DISABLE_SIMULATOR_AUTOMATION"] == "1"
            || environment["XCTestConfigurationFilePath"] != nil
#else
        false
#endif
    }

    private enum StorageKeys {
        static let pairingPayload = "forge_companion_pairing_payload"
        static let latestSyncReport = "forge_companion_latest_sync_report"
        static let latestSyncPayloadSummary = "forge_companion_latest_sync_payload_summary"
        static let lastSuccessfulSyncAt = "forge_companion_last_successful_sync_at"
        static let workoutBackfillCompletedAt = "forge_companion_workout_backfill_completed_at"
        static let healthSyncEnabled = "forge_companion_health_sync_enabled"
        static let healthAuthorizationGranted = "forge_companion_health_authorized"
        static let healthAccessStatus = "forge_companion_health_access_status"
        static let deferredHealthPrompt = "forge_companion_deferred_health_prompt"
        static let movementPromptDeferred = "forge_companion_deferred_movement_prompt"
        static let activeHealthSyncSessionId = "forge_companion_active_health_sync_session_id"
        static let activeHealthSyncCheckpoint = "forge_companion_active_health_sync_checkpoint"
    }

    @Published var pairing: PairingPayload? {
        didSet {
            companionDebugLog(
                "CompanionAppModel",
                "pairing -> session=\(pairing?.sessionId ?? "nil") apiBaseUrl=\(pairing?.apiBaseUrl ?? "nil") uiBaseUrl=\(pairing?.uiBaseUrl ?? "nil")"
            )
        }
    }
    @Published var syncState: SyncState = .disconnected {
        didSet {
            companionDebugLog("CompanionAppModel", "syncState -> \(syncState.rawValue)")
        }
    }
    @Published var lastSyncMessage: String = "Not paired" {
        didSet {
            companionDebugLog("CompanionAppModel", "lastSyncMessage -> \(lastSyncMessage)")
        }
    }
    @Published var latestError: String? {
        didSet {
            companionDebugLog("CompanionAppModel", "latestError -> \(latestError ?? "nil")")
        }
    }
    @Published var latestSyncReport: SyncReport?
    @Published var latestSyncPayloadSummary: SyncPayloadSummary?
    @Published var activeHealthSyncSessionId: String?
    private var activeHealthSyncCheckpoint: ActiveHealthSyncCheckpoint?
    @Published var lastHealthSyncChunkId: String?
    @Published var lastHealthSyncChunkFamily: String?
    @Published var lastHealthSyncPayloadBytes: Int?
    @Published var healthSyncChunkTargetBytes: Int?
    @Published var healthSyncChunkMaxBytes: Int?
    @Published var healthSyncLegacyFallbackReason: String?
    @Published var healthSyncTransferStats: SyncTransferStats?
    @Published var activeSyncMode: CompanionSyncMode = .normal
    @Published var historicalWorkoutImportStatus: HistoricalWorkoutImportStatus?
    @Published var healthSyncEnabled = true {
        didSet {
            UserDefaults.standard.set(healthSyncEnabled, forKey: StorageKeys.healthSyncEnabled)
            companionDebugLog(
                "CompanionAppModel",
                "healthSyncEnabled -> \(healthSyncEnabled)"
            )
        }
    }
    @Published var healthAuthorizationGranted = false
    @Published var healthAccessStatus: HealthAccessStatus = .notSet {
        didSet {
            companionDebugLog(
                "CompanionAppModel",
                "healthAccessStatus -> \(healthAccessStatus.rawValue)"
            )
        }
    }
    @Published var lastSuccessfulSyncAt: Date?
    private var workoutBackfillCompletedAt: Date?
    @Published var healthPermissionPromptDeferred = false
    @Published var movementPermissionPromptDeferred = false
    @Published private(set) var permissionSyncPhase: CompanionPermissionSyncPhase = .idle
    @Published var discoveredServers: [DiscoveredForgeServer] = [] {
        didSet {
            companionDebugLog(
                "CompanionAppModel",
                "discoveredServers -> count=\(discoveredServers.count)"
            )
        }
    }
    @Published var discoveryInFlight = false {
        didSet {
            companionDebugLog("CompanionAppModel", "discoveryInFlight -> \(discoveryInFlight)")
        }
    }
    @Published var discoveryMessage = "Search the local network and Tailscale for Forge." {
        didSet {
            companionDebugLog("CompanionAppModel", "discoveryMessage -> \(discoveryMessage)")
        }
    }
    @Published var discoveredTailscaleDevices: [DiscoveredTailscaleDevice] = [] {
        didSet {
            companionDebugLog(
                "CompanionAppModel",
                "discoveredTailscaleDevices -> count=\(discoveredTailscaleDevices.count)"
            )
        }
    }
    @Published var tailscaleDiscoveryMessage = "Checking Tailscale devices…" {
        didSet {
            companionDebugLog(
                "CompanionAppModel",
                "tailscaleDiscoveryMessage -> \(tailscaleDiscoveryMessage)"
            )
        }
    }

    let screenshotScenario: CompanionScreenshotScenario?
    let healthStore: HealthSyncStore
    let movementStore: MovementSyncStore
    let screenTimeStore: ScreenTimeStore
    let syncClient: ForgeSyncClient
    let watchSessionManager: WatchSessionManager
    let qrScanner = QRPairingScanner()
    let backgroundScheduler = CompanionBackgroundScheduler()
    let discoveryService = ForgeServerDiscovery()
    private let keychain = KeychainStore(service: "com.aurel.forgecompanion")
    private var cancellables: Set<AnyCancellable> = []
    private var autoSyncDebounceTask: Task<Void, Never>?
    private var deferredStartupRefreshTask: Task<Void, Never>?
    private var remoteSourceReconciliationTask: Task<Void, Never>?
    private var activeSyncTask: Task<Bool, Never>?
    private var activeSyncTaskId: UUID?
    private var maintenanceTask: Task<Void, Never>?
    private var healthSyncTransferTickerTask: Task<Void, Never>?
    private var healthSyncTransferStartedAt: Date?
    private var healthSyncTransferLastSnapshotAt: Date?
    private var healthSyncTransferLastSnapshotBytes = 0
    private var healthSyncTransferBytesSent = 0
    private var healthSyncTransferCurrentBytesPerSecond = 0.0
    private var healthSyncTransferUploadedChunks = 0
    private var healthSyncTransferUploadedRecords = 0
    private var healthSyncTransferSkippedChunks = 0
    private var healthSyncTransferLastChunkAt: Date?
    private var backgroundRefreshTask: UIBackgroundTaskIdentifier = .invalid
    private var pendingRemoteSourceReconciliation: Set<CompanionSourceKey> = []
    private var lastAutoSyncAttemptAt: Date?
    private var lastHeartbeatAt: Date?

    init() {
        let screenshotScenario = CompanionScreenshotScenario.current
        self.screenshotScenario = screenshotScenario
        let healthStore = HealthSyncStore()
        self.healthStore = healthStore
#if DEBUG
        if let screenshotScenario, screenshotScenario != .pairing {
            self.movementStore = MovementSyncStore(
                testingState: CompanionScreenshotFixtures.movementState(for: screenshotScenario)
            )
        } else {
            self.movementStore = MovementSyncStore()
        }
#else
        self.movementStore = MovementSyncStore()
#endif
        self.screenTimeStore = ScreenTimeStore()
        let syncClient = ForgeSyncClient()
        self.syncClient = syncClient
        watchSessionManager = WatchSessionManager(syncClient: syncClient)
        companionDebugLog("CompanionAppModel", "init start")
        movementStore.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.objectWillChange.send()
                self?.scheduleAutomaticSync(
                    reason: "movement change",
                    debounceNanoseconds: AutoSyncPolicy.movementDebounceNanoseconds,
                    minimumInterval: AutoSyncPolicy.movementMinimumInterval
                )
            }
            .store(in: &cancellables)
        screenTimeStore.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(
            for: UIApplication.protectedDataDidBecomeAvailableNotification
        )
        .receive(on: DispatchQueue.main)
        .sink { [weak self] _ in
            companionDebugLog("CompanionAppModel", "protected data became available")
            self?.scheduleAutomaticSync(
                reason: "device unlocked",
                debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
                minimumInterval: 0,
                force: true
            )
        }
        .store(in: &cancellables)
        if let screenshotScenario {
            companionDebugLog(
                "CompanionAppModel",
                "init screenshot scenario=\(screenshotScenario.rawValue)"
            )
            configureScreenshotScenario(screenshotScenario)
            return
        }
        if Self.disablesSimulatorAutomation {
            restoreCachedState()
            Task {
                companionDebugLog("CompanionAppModel", "startup simulator automation disabled")
                await refreshHealthAccessStatus()
                refreshSyncState()
            }
            return
        }
        watchSessionManager.configure { [weak self] in
            self?.pairing
        }
        watchSessionManager.activate()
        restorePairing()
        restoreCachedState()
        backgroundScheduler.register(
            onRefresh: { [weak self] in
                guard let self else { return false }
                companionDebugLog("CompanionAppModel", "background refresh closure invoked")
                return await self.performBackgroundRefresh()
            },
            onExpiration: { [weak self] in
                Task { @MainActor [weak self] in
                    self?.handleBackgroundSyncExpiration(reason: "system background task expired")
                }
            }
        )
        if pairing != nil {
            companionDebugLog("CompanionAppModel", "init scheduling background refresh because pairing exists")
            backgroundScheduler.schedule()
            startMaintenanceLoop(reason: "restore")
        }
        Task {
            companionDebugLog("CompanionAppModel", "startup task begin")
            await attemptLocalSimulatorBootstrapIfNeeded()
            await refreshHealthAccessStatus()
            refreshSyncState()
            scheduleDeferredStartupRefresh()
            scheduleAutomaticSync(
                reason: "startup",
                debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
                minimumInterval: AutoSyncPolicy.foregroundMinimumInterval
            )
            await attemptAutomaticSimulatorSyncIfPossible()
            companionDebugLog("CompanionAppModel", "startup task complete")
        }
    }

    func connect(with payload: PairingPayload, preferredUiBaseUrl: String? = nil) {
        companionDebugLog(
            "CompanionAppModel",
            "connect called session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        completeConnection(
            with: payload,
            preferredUiBaseUrl: preferredUiBaseUrl,
            message: "Pairing ready"
        )
    }

    func verifyAndConnect(
        with payload: PairingPayload,
        preferredUiBaseUrl: String? = nil,
        preferredApiBaseUrl: String? = nil
    ) async throws {
        companionDebugLog(
            "CompanionAppModel",
            "verifyAndConnect start session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        let normalizedPayload = normalizedPairingPayload(
            payload,
            preferredUiBaseUrl: preferredUiBaseUrl,
            preferredApiBaseUrl: preferredApiBaseUrl
        )
        let verifiedSession = try await syncClient.verifyPairing(
            payload: normalizedPayload,
            apiBaseUrl: normalizedPayload.apiBaseUrl
        )
        let verifiedPayload = CompanionPairingURLResolver.payload(
            normalizedPayload,
            refreshedBy: verifiedSession
        )
        companionDebugLog(
            "CompanionAppModel",
            "verifyAndConnect verifyPairing success session=\(verifiedPayload.sessionId)"
        )
        completeConnection(with: verifiedPayload, message: "Connected to Forge")
        applyPairingSessionState(verifiedSession, reason: "verify")
        await refreshMovementBootstrap()
        await refreshHealthAccessStatus()
        await refreshWatchBootstrap(reason: "pairing")
        refreshSyncState()
        scheduleAutomaticSync(
            reason: "pairing completed",
            debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
            minimumInterval: AutoSyncPolicy.pairingMinimumInterval,
            force: true
        )
        companionDebugLog("CompanionAppModel", "verifyAndConnect complete")
    }

    func disconnect() {
        companionDebugLog(
            "CompanionAppModel",
            "disconnect start currentSession=\(pairing?.sessionId ?? "nil")"
        )
        pairing = nil
        syncState = .disconnected
        lastSyncMessage = "Not paired"
        latestError = nil
        healthPermissionPromptDeferred = false
        maintenanceTask?.cancel()
        maintenanceTask = nil
        autoSyncDebounceTask?.cancel()
        deferredStartupRefreshTask?.cancel()
        remoteSourceReconciliationTask?.cancel()
        keychain.delete(forKey: StorageKeys.pairingPayload)
        UserDefaults.standard.removeObject(forKey: StorageKeys.pairingPayload)
        UserDefaults.standard.removeObject(forKey: StorageKeys.deferredHealthPrompt)
        UserDefaults.standard.removeObject(forKey: StorageKeys.workoutBackfillCompletedAt)
        clearActiveHealthSyncCheckpoint()
        workoutBackfillCompletedAt = nil
        Task {
            await refreshWatchBootstrap(reason: "disconnect")
        }
        companionDebugLog("CompanionAppModel", "disconnect complete")
    }

    func requestHealthPermissions() async {
        guard healthSyncEnabled else {
            companionDebugLog("CompanionAppModel", "requestHealthPermissions skipped health disabled")
            return
        }
        companionDebugLog("CompanionAppModel", "requestHealthPermissions start")
        do {
            let granted = try await healthStore.requestAuthorization()
            companionDebugLog("CompanionAppModel", "requestHealthPermissions result granted=\(granted)")
            if granted {
                healthAccessStatus = .customAccess
                healthAuthorizationGranted = true
                UserDefaults.standard.set(healthAccessStatus.rawValue, forKey: StorageKeys.healthAccessStatus)
                UserDefaults.standard.set(true, forKey: StorageKeys.healthAuthorizationGranted)
            }
            try? await Task.sleep(for: .milliseconds(350))
            await refreshHealthAccessStatus()
            refreshSyncState()
            if syncState != .syncing && activeSyncTask == nil {
                lastSyncMessage = healthAccessStatus == .fullAccess
                    ? "Health access granted"
                    : healthAccessStatus == .customAccess
                        ? "Health access is partial"
                        : "Health access not set"
            }
            if healthAccessStatus != .notSet {
                healthPermissionPromptDeferred = false
                UserDefaults.standard.set(false, forKey: StorageKeys.deferredHealthPrompt)
                scheduleAutomaticSync(
                    reason: "health permission granted",
                    debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
                    minimumInterval: 0,
                    force: true
                )
            }
            latestError = nil
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "requestHealthPermissions failed error=\(error.localizedDescription)"
            )
            latestError = error.localizedDescription
            syncState = .error
        }
    }

    func requestMovementPermissions() {
        companionDebugLog("CompanionAppModel", "requestMovementPermissions")
        movementStore.setTrackingEnabled(true)
        movementStore.requestLocationAuthorization()
        movementPermissionPromptDeferred = false
        UserDefaults.standard.set(false, forKey: StorageKeys.movementPromptDeferred)
        scheduleAutomaticSync(
            reason: "movement permission requested",
            debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
            minimumInterval: 0,
            force: true
        )
    }

    func requestRecommendedPermissions() async {
        await requestCombinedPermissionsAndSync()
    }

    func requestCombinedPermissionsAndSync() async {
        companionDebugLog("CompanionAppModel", "requestCombinedPermissionsAndSync start")
        if healthSyncEnabled {
            permissionSyncPhase = .requestingHealth
            await Task.yield()
            await requestHealthPermissions()
        }
        if movementStore.trackingEnabled {
            permissionSyncPhase = .requestingLocation
            await Task.yield()
            requestMovementPermissions()
        }
        if screenTimeStore.enabled {
            permissionSyncPhase = .requestingScreenTime
            await Task.yield()
            await screenTimeStore.enableAndAuthorize()
        }
        permissionSyncPhase = .preparingSync
        await Task.yield()
        await refreshHealthAccessStatus()
        refreshSyncState()
        permissionSyncPhase = .syncing
        await Task.yield()
        let syncSucceeded = await performSync(trigger: "manual")
        permissionSyncPhase = syncSucceeded ? .completed : .failed
        if syncSucceeded {
            try? await Task.sleep(for: .milliseconds(900))
            if permissionSyncPhase == .completed {
                permissionSyncPhase = .idle
            }
        }
        companionDebugLog("CompanionAppModel", "requestCombinedPermissionsAndSync complete")
    }

    func setSourceEnabled(_ source: CompanionSourceKey, enabled: Bool) {
        companionDebugLog(
            "CompanionAppModel",
            "setSourceEnabled source=\(source.rawValue) enabled=\(enabled)"
        )
        switch source {
        case .health:
            healthSyncEnabled = enabled
            if enabled == false {
                healthPermissionPromptDeferred = false
                UserDefaults.standard.set(false, forKey: StorageKeys.deferredHealthPrompt)
            }
        case .movement:
            movementStore.setTrackingEnabled(enabled)
            if enabled == false {
                movementPermissionPromptDeferred = false
                UserDefaults.standard.set(false, forKey: StorageKeys.movementPromptDeferred)
            }
        case .screenTime:
            screenTimeStore.setEnabled(enabled)
        }
        refreshSyncState()
        Task {
            await pushCurrentSourceState(source)
            if enabled {
                switch source {
                case .health:
                    await requestHealthPermissions()
                case .movement:
                    requestMovementPermissions()
                case .screenTime:
                    await screenTimeStore.enableAndAuthorize()
                }
                _ = await performSync(trigger: "\(source.rawValue) enabled")
            }
        }
    }

    func runManualSync() async {
        companionDebugLog("CompanionAppModel", "runManualSync start")
        _ = await performSync(trigger: "manual")
    }

    func handleAppDidBecomeActive() {
        companionDebugLog("CompanionAppModel", "handleAppDidBecomeActive")
        screenTimeStore.handleAppDidBecomeActive()
        startMaintenanceLoop(reason: "app became active")
        cancelActiveSyncIfStalled(now: Date(), reason: "app became active")
        Task {
            await performMaintenanceHeartbeat(reason: "app became active", force: true)
        }
        scheduleRemoteSourceReconciliation(reason: "app became active")
        scheduleAutomaticSync(
            reason: "app became active",
            debounceNanoseconds: AutoSyncPolicy.immediateDebounceNanoseconds,
            minimumInterval: AutoSyncPolicy.foregroundMinimumInterval
        )
    }

    func handleAppWillLeaveForeground() {
        companionDebugLog("CompanionAppModel", "handleAppWillLeaveForeground")
        guard pairing != nil else {
            return
        }
        backgroundScheduler.schedule(
            activeSync: activeSyncTask != nil || activeHealthSyncSessionId != nil,
            reason: "scene background"
        )
        beginBackgroundRefreshWindow(reason: "scene background")
    }

    func discoverForgeServers() async {
        companionDebugLog("CompanionAppModel", "discoverForgeServers start")
        discoveryInFlight = true
        discoveryMessage = "Scanning for Forge runtimes…"
        tailscaleDiscoveryMessage = "Checking Tailscale devices…"
        let report = await discoveryService.discoverEnvironment()
        discoveredServers = report.servers
        discoveredTailscaleDevices = report.tailscaleDevices
        tailscaleDiscoveryMessage = report.tailscaleStatusMessage
        discoveryInFlight = false
        discoveryMessage = report.servers.isEmpty
            ? "No Forge runtime found yet. Keep Forge running, scan a Forge QR, or use Manual connection if you know the machine name."
            : "Found \(report.servers.count) Forge runtime\(report.servers.count == 1 ? "" : "s")."
        companionDebugLog(
            "CompanionAppModel",
            "discoverForgeServers complete runtimes=\(report.servers.count) tailscaleDevices=\(report.tailscaleDevices.count)"
        )
    }

    func bootstrapPairing(for server: DiscoveredForgeServer) async throws {
        companionDebugLog(
            "CompanionAppModel",
            "bootstrapPairing start serverId=\(server.id) apiBaseUrl=\(server.apiBaseUrl)"
        )
        let payload = try await syncClient.bootstrapPairingSession(
            baseUrl: server.apiBaseUrl,
            label: UIDevice.current.name,
            capabilities: SimulatorLocalForge.capabilities
        )
        companionDebugLog(
            "CompanionAppModel",
            "bootstrapPairing bootstrap success session=\(payload.sessionId)"
        )
        try await verifyAndConnect(
            with: payload,
            preferredUiBaseUrl: server.uiBaseUrl,
            preferredApiBaseUrl: server.apiBaseUrl
        )
        lastSyncMessage = "Connected to \(server.name)"
        ForgeServerDiscovery.rememberSuccessfulServer(server)
        companionDebugLog("CompanionAppModel", "bootstrapPairing complete")
    }

    func connectToManualRuntime(_ rawInput: String) async throws {
        companionDebugLog("CompanionAppModel", "connectToManualRuntime start raw=\(rawInput)")
        guard let server = await discoveryService.probeManualRuntime(rawInput) else {
            companionDebugLog("CompanionAppModel", "connectToManualRuntime no runtime found")
            throw NSError(
                domain: "ForgeCompanion",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "No Forge runtime answered there. Check the machine name and make sure Forge is running."]
            )
        }

        if server.canBootstrapPairing {
            try await bootstrapPairing(for: server)
        } else {
            throw NSError(
                domain: "ForgeCompanion",
                code: 400,
                userInfo: [NSLocalizedDescriptionKey: "That host answered, but one-tap pairing is not available there yet. Use a pairing code for local-network targets."]
            )
        }
    }

    func ensureActivePairingIfPossible(
        reason: String,
        forceRenewal: Bool = false
    ) async -> PairingPayload? {
        guard let pairing else {
            return nil
        }
        let normalized = normalizedPairingPayload(pairing)
        if normalized.sessionId != pairing.sessionId
            || normalized.apiBaseUrl != pairing.apiBaseUrl
            || normalized.uiBaseUrl != pairing.uiBaseUrl
        {
            self.pairing = normalized
            persistPairing()
        }
        guard forceRenewal || pairingNeedsRenewal(normalized) else {
            return normalized
        }

        companionDebugLog(
            "CompanionAppModel",
            "ensureActivePairingIfPossible renewing reason=\(reason) session=\(normalized.sessionId)"
        )
        if forceRenewal == false {
            do {
                let session = try await syncClient.heartbeatPairing(
                    payload: normalized,
                    apiBaseUrl: normalized.apiBaseUrl
                )
                let refreshed = CompanionPairingURLResolver.payload(
                    normalized,
                    refreshedBy: session
                )
                self.pairing = refreshed
                persistPairing()
                applyPairingSessionState(session, reason: "renewal-heartbeat-\(reason)")
                companionDebugLog(
                    "CompanionAppModel",
                    "ensureActivePairingIfPossible refreshed existing session reason=\(reason)"
                )
                return refreshed
            } catch {
                companionDebugLog(
                    "CompanionAppModel",
                    "ensureActivePairingIfPossible heartbeat refresh failed reason=\(reason) error=\(error.localizedDescription)"
                )
            }
        }
        do {
            let renewed = try await renewPairingSession(from: normalized, reason: reason)
            return renewed
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "ensureActivePairingIfPossible renewal failed reason=\(reason) error=\(error.localizedDescription)"
            )
            return nil
        }
    }

    private func persistPairing() {
        guard let pairing, let data = try? JSONEncoder().encode(pairing) else {
            companionDebugLog("CompanionAppModel", "persistPairing skipped")
            return
        }
        if keychain.save(data, forKey: StorageKeys.pairingPayload) {
            UserDefaults.standard.removeObject(forKey: StorageKeys.pairingPayload)
            companionDebugLog("CompanionAppModel", "persistPairing saved session=\(pairing.sessionId)")
        } else {
            UserDefaults.standard.set(data, forKey: StorageKeys.pairingPayload)
            companionDebugLog(
                "CompanionAppModel",
                "persistPairing keychain failed; saved temporary fallback session=\(pairing.sessionId)"
            )
        }
    }

    private func restorePairing() {
        companionDebugLog("CompanionAppModel", "restorePairing start")
        guard
            let data =
                keychain.load(forKey: StorageKeys.pairingPayload) ??
                UserDefaults.standard.data(forKey: StorageKeys.pairingPayload),
            let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else {
            companionDebugLog("CompanionAppModel", "restorePairing no stored payload")
            return
        }
        pairing = normalizedPairingPayload(payload)
        lastSyncMessage = "Pairing restored"
        persistPairing()
        if Self.disablesSimulatorAutomation == false {
            startMaintenanceLoop(reason: "restorePairing")
        }
        companionDebugLog("CompanionAppModel", "restorePairing restored session=\(payload.sessionId)")
    }

    private func restoreCachedState() {
        companionDebugLog("CompanionAppModel", "restoreCachedState start")
        if UserDefaults.standard.object(forKey: StorageKeys.healthSyncEnabled) != nil {
            healthSyncEnabled = UserDefaults.standard.bool(
                forKey: StorageKeys.healthSyncEnabled
            )
        } else {
            healthSyncEnabled = true
        }
        healthAuthorizationGranted = UserDefaults.standard.bool(
            forKey: StorageKeys.healthAuthorizationGranted
        )
        if
            let rawValue = UserDefaults.standard.string(forKey: StorageKeys.healthAccessStatus),
            let storedStatus = HealthAccessStatus(rawValue: rawValue)
        {
            healthAccessStatus = storedStatus
        }

        if UserDefaults.standard.object(forKey: StorageKeys.lastSuccessfulSyncAt) != nil {
            lastSuccessfulSyncAt = Date(
                timeIntervalSince1970: UserDefaults.standard.double(
                    forKey: StorageKeys.lastSuccessfulSyncAt
                )
            )
        }
        if UserDefaults.standard.object(forKey: StorageKeys.workoutBackfillCompletedAt) != nil {
            workoutBackfillCompletedAt = Date(
                timeIntervalSince1970: UserDefaults.standard.double(
                    forKey: StorageKeys.workoutBackfillCompletedAt
                )
            )
        }

        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.latestSyncReport),
            let report = try? JSONDecoder().decode(PersistedSyncReport.self, from: data)
        {
            latestSyncReport = report.asSyncReport
        }
        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.latestSyncPayloadSummary),
            let summary = try? JSONDecoder().decode(SyncPayloadSummary.self, from: data)
        {
            latestSyncPayloadSummary = summary
        }
        if
            let data = UserDefaults.standard.data(forKey: StorageKeys.activeHealthSyncCheckpoint),
            let checkpoint = try? JSONDecoder().decode(ActiveHealthSyncCheckpoint.self, from: data)
        {
            activeHealthSyncCheckpoint = checkpoint
            activeHealthSyncSessionId = checkpoint.syncSessionId
        } else {
            activeHealthSyncSessionId = UserDefaults.standard.string(
                forKey: StorageKeys.activeHealthSyncSessionId
            )
        }

        healthPermissionPromptDeferred = UserDefaults.standard.bool(
            forKey: StorageKeys.deferredHealthPrompt
        )
        movementPermissionPromptDeferred = UserDefaults.standard.bool(
            forKey: StorageKeys.movementPromptDeferred
        )
        companionDebugLog(
            "CompanionAppModel",
            "restoreCachedState complete healthAuthorized=\(healthAuthorizationGranted) lastSuccessfulSyncAt=\(lastSuccessfulSyncAt?.description ?? "nil") workoutBackfillCompletedAt=\(workoutBackfillCompletedAt?.description ?? "nil")"
        )
    }

    private func persistSyncState(report: SyncReport, payloadSummary: SyncPayloadSummary) {
        lastSuccessfulSyncAt = report.syncedAt
        UserDefaults.standard.set(
            report.syncedAt.timeIntervalSince1970,
            forKey: StorageKeys.lastSuccessfulSyncAt
        )
        if let data = try? JSONEncoder().encode(PersistedSyncReport(report: report)) {
            UserDefaults.standard.set(data, forKey: StorageKeys.latestSyncReport)
        }
        if let data = try? JSONEncoder().encode(payloadSummary) {
            UserDefaults.standard.set(data, forKey: StorageKeys.latestSyncPayloadSummary)
        }
    }

    private func markWorkoutBackfillCompleted(at date: Date) {
        workoutBackfillCompletedAt = date
        UserDefaults.standard.set(
            date.timeIntervalSince1970,
            forKey: StorageKeys.workoutBackfillCompletedAt
        )
        companionDebugLog(
            "CompanionAppModel",
            "workout raw backfill completed at \(date)"
        )
    }

    private func persistActiveHealthSyncCheckpoint(_ checkpoint: ActiveHealthSyncCheckpoint) {
        activeHealthSyncCheckpoint = checkpoint
        activeHealthSyncSessionId = checkpoint.syncSessionId
        if let data = try? JSONEncoder().encode(checkpoint) {
            UserDefaults.standard.set(data, forKey: StorageKeys.activeHealthSyncCheckpoint)
        }
        UserDefaults.standard.set(
            checkpoint.syncSessionId,
            forKey: StorageKeys.activeHealthSyncSessionId
        )
    }

    private func clearActiveHealthSyncCheckpoint() {
        activeHealthSyncCheckpoint = nil
        activeHealthSyncSessionId = nil
        UserDefaults.standard.removeObject(forKey: StorageKeys.activeHealthSyncCheckpoint)
        UserDefaults.standard.removeObject(forKey: StorageKeys.activeHealthSyncSessionId)
    }

    private func updateActiveHealthSyncCheckpointProgress(chunkCount: Int?, receivedBytes: Int?) {
        guard var checkpoint = activeHealthSyncCheckpoint else {
            return
        }
        if let chunkCount {
            checkpoint.lastReceivedChunkCount = chunkCount
        }
        if let receivedBytes {
            checkpoint.lastReceivedBytes = receivedBytes
        }
        persistActiveHealthSyncCheckpoint(checkpoint)
    }

    private func configureScreenshotScenario(_ scenario: CompanionScreenshotScenario) {
        discoveredServers = CompanionScreenshotFixtures.discoveredServers()
        discoveredTailscaleDevices = CompanionScreenshotFixtures.tailscaleDevices()
        discoveryInFlight = false
        discoveryMessage = "Found 2 Forge runtimes ready for pairing."
        tailscaleDiscoveryMessage = "2 Tailscale devices online. Forge is reachable through the tailnet."
        healthPermissionPromptDeferred = false
        movementPermissionPromptDeferred = false
        latestError = nil
        lastAutoSyncAttemptAt = CompanionScreenshotFixtures.referenceDate.addingTimeInterval(-120)
#if DEBUG
        CompanionScreenshotFixtures.seedLogs()
#endif

        switch scenario {
        case .pairing:
            pairing = nil
            syncState = .disconnected
            lastSyncMessage = "Choose your Forge runtime"
            healthAuthorizationGranted = false
            healthAccessStatus = .notSet
            lastSuccessfulSyncAt = nil
            latestSyncReport = nil
            latestSyncPayloadSummary = nil
        case .home, .lifeTimeline, .diagnostics:
            pairing = normalizedPairingPayload(CompanionScreenshotFixtures.pairingPayload())
            syncState = .healthy
            lastSyncMessage = "Everything is syncing automatically"
            healthAuthorizationGranted = true
            healthAccessStatus = .fullAccess
            lastSuccessfulSyncAt = CompanionScreenshotFixtures.referenceDate.addingTimeInterval(-4 * 60)
            latestSyncReport = CompanionScreenshotFixtures.syncReport()
            latestSyncPayloadSummary = CompanionScreenshotFixtures.syncPayloadSummary()
        }
    }

    func refreshHealthAccessStatus() async {
        companionDebugLog("CompanionAppModel", "refreshHealthAccessStatus start")
        let status = await healthStore.accessStatus(previousStoredStatus: healthAccessStatus)
        healthAccessStatus = status
        healthAuthorizationGranted = status != .notSet
        if status != .notSet {
            healthPermissionPromptDeferred = false
            UserDefaults.standard.set(false, forKey: StorageKeys.deferredHealthPrompt)
        }
        UserDefaults.standard.set(status.rawValue, forKey: StorageKeys.healthAccessStatus)
        UserDefaults.standard.set(healthAuthorizationGranted, forKey: StorageKeys.healthAuthorizationGranted)
        companionDebugLog(
            "CompanionAppModel",
            "refreshHealthAccessStatus complete status=\(status.rawValue) authorized=\(healthAuthorizationGranted)"
        )
    }

    func deferHealthPermissionPrompt() {
        companionDebugLog("CompanionAppModel", "deferHealthPermissionPrompt")
        healthPermissionPromptDeferred = true
        UserDefaults.standard.set(true, forKey: StorageKeys.deferredHealthPrompt)
    }

    func deferMovementPermissionPrompt() {
        companionDebugLog("CompanionAppModel", "deferMovementPermissionPrompt")
        movementPermissionPromptDeferred = true
        UserDefaults.standard.set(true, forKey: StorageKeys.movementPromptDeferred)
    }

    private func refreshSyncState() {
        companionDebugLog("CompanionAppModel", "refreshSyncState evaluating")
        guard pairing != nil else {
            syncState = .disconnected
            companionDebugLog("CompanionAppModel", "refreshSyncState -> disconnected")
            return
        }
        if missingRequiredAuthorization {
            syncState = .permissionDenied
            companionDebugLog("CompanionAppModel", "refreshSyncState -> permissionDenied")
            return
        }
        if let lastSuccessfulSyncAt,
           Date.now.timeIntervalSince(lastSuccessfulSyncAt) > 24 * 60 * 60
        {
            syncState = .stale
            companionDebugLog("CompanionAppModel", "refreshSyncState -> stale")
            return
        }
        syncState = lastSuccessfulSyncAt == nil ? .connected : .healthy
        companionDebugLog("CompanionAppModel", "refreshSyncState -> \(syncState.rawValue)")
    }

    private var protectedHealthDataCurrentlyUnavailable: Bool {
        healthSyncEnabled &&
            healthAuthorizationGranted &&
            UIApplication.shared.isProtectedDataAvailable == false
    }

    private func performBackgroundRefresh() async -> Bool {
        companionDebugLog("CompanionAppModel", "performBackgroundRefresh start")
        if let activeSyncTask {
            if cancelActiveSyncIfStalled(now: Date(), reason: "background refresh") {
                return false
            }
            companionDebugLog("CompanionAppModel", "performBackgroundRefresh joining active foreground sync")
            let syncSucceeded = await activeSyncTask.value
            backgroundScheduler.schedule(
                activeSync: activeHealthSyncSessionId != nil,
                reason: "background joined active sync"
            )
            return syncSucceeded
        }
        let hasUnfinishedHealthSyncSession = activeHealthSyncSessionId?.isEmpty == false
        let heartbeatSucceeded = await performMaintenanceHeartbeat(
            reason: "background refresh",
            force: true
        )
        if hasUnfinishedHealthSyncSession && protectedHealthDataCurrentlyUnavailable {
            lastSyncMessage = "Waiting for device unlock to read HealthKit again"
            latestError = nil
            refreshSyncState()
            backgroundScheduler.schedule(
                activeSync: false,
                reason: "background health sync waiting for unlock"
            )
            companionDebugLog(
                "CompanionAppModel",
                "performBackgroundRefresh deferred unfinished health sync until protected data is available"
            )
            return heartbeatSucceeded
        }
        let syncSucceeded = await performAutomaticSyncIfNeededReturningResult(
            reason: hasUnfinishedHealthSyncSession ? "background resume unfinished health sync" : "background refresh",
            minimumInterval: hasUnfinishedHealthSyncSession ? 0 : AutoSyncPolicy.maintenanceSyncMinimumInterval,
            force: hasUnfinishedHealthSyncSession
        )
        backgroundScheduler.schedule(
            activeSync: activeHealthSyncSessionId != nil,
            reason: "background refresh complete"
        )
        return heartbeatSucceeded || syncSucceeded
    }

    private func completeConnection(
        with payload: PairingPayload,
        preferredUiBaseUrl: String? = nil,
        message: String
    ) {
        companionDebugLog(
            "CompanionAppModel",
            "completeConnection start session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        pairing = normalizedPairingPayload(payload, preferredUiBaseUrl: preferredUiBaseUrl)
        if let host = URL(string: pairing?.apiBaseUrl ?? payload.apiBaseUrl)?.host {
            ForgeServerDiscovery.rememberSuccessfulHost(host)
        }
        healthPermissionPromptDeferred = false
        movementPermissionPromptDeferred = false
        UserDefaults.standard.set(false, forKey: StorageKeys.deferredHealthPrompt)
        UserDefaults.standard.set(false, forKey: StorageKeys.movementPromptDeferred)
        lastSyncMessage = message
        latestError = nil
        persistPairing()
        backgroundScheduler.schedule()
        startMaintenanceLoop(reason: "connection")
        Task {
            await refreshHealthAccessStatus()
            refreshSyncState()
        }
        companionDebugLog("CompanionAppModel", "completeConnection scheduled follow-up refresh")
    }

    private func scheduleDeferredStartupRefresh() {
        guard pairing != nil else {
            return
        }
        deferredStartupRefreshTask?.cancel()
        deferredStartupRefreshTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, Task.isCancelled == false else { return }
            guard self.activeSyncTask == nil && self.syncState != .syncing else {
                companionDebugLog(
                    "CompanionAppModel",
                    "deferred startup refresh skipped because health sync is active"
                )
                return
            }
            companionDebugLog("CompanionAppModel", "deferred startup refresh begin")
            _ = await self.ensureActivePairingIfPossible(reason: "startup-deferred")
            await self.refreshMovementBootstrap()
            await self.refreshWatchBootstrap(reason: "startup-deferred")
            companionDebugLog("CompanionAppModel", "deferred startup refresh complete")
        }
    }

    private func scheduleAutomaticSync(
        reason: String,
        debounceNanoseconds: UInt64,
        minimumInterval: TimeInterval,
        force: Bool = false
    ) {
        guard pairing != nil else {
            return
        }
        autoSyncDebounceTask?.cancel()
        autoSyncDebounceTask = Task { [weak self] in
            guard let self else { return }
            if debounceNanoseconds > 0 {
                try? await Task.sleep(nanoseconds: debounceNanoseconds)
            }
            guard Task.isCancelled == false else {
                return
            }
            Task { [weak self] in
                guard let self else { return }
                await self.performAutomaticSyncIfNeeded(
                    reason: reason,
                    minimumInterval: minimumInterval,
                    force: force
                )
            }
        }
    }

    private func startMaintenanceLoop(reason: String) {
        guard pairing != nil else {
            return
        }
        guard maintenanceTask == nil || maintenanceTask?.isCancelled == true else {
            return
        }
        companionDebugLog("CompanionAppModel", "startMaintenanceLoop reason=\(reason)")
        maintenanceTask = Task { [weak self] in
            while Task.isCancelled == false {
                try? await Task.sleep(
                    for: .seconds(AutoSyncPolicy.maintenanceHeartbeatInterval)
                )
                guard let self, Task.isCancelled == false else {
                    return
                }
                await self.performMaintenanceHeartbeat(reason: "periodic", force: false)
                await self.performAutomaticSyncIfNeeded(
                    reason: "periodic maintenance",
                    minimumInterval: AutoSyncPolicy.maintenanceSyncMinimumInterval,
                    force: false
                )
            }
        }
    }

    @discardableResult
    private func performMaintenanceHeartbeat(reason: String, force: Bool) async -> Bool {
        guard pairing != nil else {
            return false
        }
        if activeSyncTask != nil || syncState == .syncing {
            companionDebugLog(
                "CompanionAppModel",
                "performMaintenanceHeartbeat skipped reason=\(reason) activeSync=true"
            )
            return true
        }
        if force == false,
           let lastHeartbeatAt,
           Date().timeIntervalSince(lastHeartbeatAt) < AutoSyncPolicy.maintenanceHeartbeatInterval
        {
            return true
        }
        guard let resolvedPairing = await ensureActivePairingIfPossible(reason: "heartbeat-\(reason)") ?? pairing else {
            return false
        }
        do {
            let session = try await syncClient.heartbeatPairing(
                payload: resolvedPairing,
                apiBaseUrl: resolvedPairing.apiBaseUrl
            )
            applyPairingSessionState(session, reason: "heartbeat-\(reason)")
            lastHeartbeatAt = Date()
            backgroundScheduler.schedule()
            companionDebugLog(
                "CompanionAppModel",
                "performMaintenanceHeartbeat success reason=\(reason)"
            )
            return true
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "performMaintenanceHeartbeat failed reason=\(reason) error=\(error.localizedDescription)"
            )
            return false
        }
    }

    private func beginBackgroundRefreshWindow(reason: String) {
        backgroundScheduler.schedule(
            activeSync: activeSyncTask != nil || activeHealthSyncSessionId != nil,
            reason: reason
        )
        if backgroundRefreshTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundRefreshTask)
            backgroundRefreshTask = .invalid
        }
        backgroundRefreshTask = UIApplication.shared.beginBackgroundTask(
            withName: "ForgeCompanionSync"
        ) { [weak self] in
            guard let self else { return }
            companionDebugLog("CompanionAppModel", "background task expired reason=\(reason)")
            Task { @MainActor [weak self] in
                self?.handleBackgroundSyncExpiration(reason: "foreground background task expired: \(reason)")
            }
            if self.backgroundRefreshTask != .invalid {
                UIApplication.shared.endBackgroundTask(self.backgroundRefreshTask)
                self.backgroundRefreshTask = .invalid
            }
        }
        Task { [weak self] in
            guard let self else { return }
            if let activeSyncTask = self.activeSyncTask {
                companionDebugLog(
                    "CompanionAppModel",
                    "background task waiting for active sync reason=\(reason)"
                )
                _ = await activeSyncTask.value
            } else {
                _ = await self.performBackgroundRefresh()
            }
            if self.backgroundRefreshTask != .invalid {
                UIApplication.shared.endBackgroundTask(self.backgroundRefreshTask)
                self.backgroundRefreshTask = .invalid
            }
        }
    }

    private func performAutomaticSyncIfNeeded(
        reason: String,
        minimumInterval: TimeInterval,
        force: Bool
    ) async {
        _ = await performAutomaticSyncIfNeededReturningResult(
            reason: reason,
            minimumInterval: minimumInterval,
            force: force
        )
    }

    private func performAutomaticSyncIfNeededReturningResult(
        reason: String,
        minimumInterval: TimeInterval,
        force: Bool
    ) async -> Bool {
        guard pairing != nil else {
            return false
        }
        guard syncState != .syncing else {
            return false
        }
        guard hasAnyEnabledSource else {
            companionDebugLog(
                "CompanionAppModel",
                "performAutomaticSyncIfNeeded skipped reason=\(reason) all sources disabled"
            )
            return false
        }
        let referenceDate = Date()
        if force == false {
            if let lastAutoSyncAttemptAt,
               referenceDate.timeIntervalSince(lastAutoSyncAttemptAt) < minimumInterval
            {
                return false
            }
            if let lastSuccessfulSyncAt,
               referenceDate.timeIntervalSince(lastSuccessfulSyncAt) < minimumInterval
            {
                return false
            }
        }
        lastAutoSyncAttemptAt = referenceDate
        companionDebugLog(
            "CompanionAppModel",
            "performAutomaticSyncIfNeeded triggering reason=\(reason)"
        )
        return await performSync(trigger: "auto \(reason)")
    }

    private func normalizedPairingPayload(
        _ payload: PairingPayload,
        preferredUiBaseUrl: String? = nil,
        preferredApiBaseUrl: String? = nil
    ) -> PairingPayload {
        CompanionPairingURLResolver.normalizedPayload(
            payload,
            preferredUiBaseUrl: preferredUiBaseUrl,
            preferredApiBaseUrl: preferredApiBaseUrl
        )
    }

    private func normalizeApiBaseUrl(_ rawValue: String) -> String {
        CompanionPairingURLResolver.normalizeApiBaseUrl(rawValue)
    }

    private func makeLocalOperatorRequest(path: String, method: String) -> URLRequest? {
        guard let url = URL(string: "\(SimulatorLocalForge.apiBaseUrl)/api/v1\(path)") else {
            return nil
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(SimulatorLocalForge.uiBaseUrl, forHTTPHeaderField: "Origin")
        request.setValue(
            "\(SimulatorLocalForge.uiBaseUrl)/settings/mobile",
            forHTTPHeaderField: "Referer"
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func bootstrapLocalOperatorSession() async throws {
        guard var request = makeLocalOperatorRequest(path: "/auth/operator-session", method: "GET") else {
            throw URLError(.badURL)
        }
        request.httpBody = nil
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode)
        else {
            throw URLError(.cannotConnectToHost)
        }
    }

    private func createLocalSimulatorPairing() async throws -> PairingPayload {
        try await bootstrapLocalOperatorSession()
        guard var request = makeLocalOperatorRequest(path: "/health/pairing-sessions", method: "POST") else {
            throw URLError(.badURL)
        }
        request.httpBody = try JSONEncoder().encode(
            SimulatorPairingRequest(
                label: SimulatorLocalForge.pairingLabel,
                capabilities: SimulatorLocalForge.capabilities
            )
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode)
        else {
            throw URLError(.cannotConnectToHost)
        }
        return try JSONDecoder().decode(SimulatorPairingResponse.self, from: data).qrPayload
    }

    private func attemptLocalSimulatorBootstrapIfNeeded() async {
#if targetEnvironment(simulator)
        companionDebugLog("CompanionAppModel", "attemptLocalSimulatorBootstrapIfNeeded start")
        let expectedApiBaseUrl = normalizeApiBaseUrl(SimulatorLocalForge.uiBaseUrl)
        if pairing?.apiBaseUrl == expectedApiBaseUrl {
            companionDebugLog("CompanionAppModel", "attemptLocalSimulatorBootstrapIfNeeded skipped existing local pairing")
            return
        }
        do {
            let payload = try await createLocalSimulatorPairing()
            connect(with: payload, preferredUiBaseUrl: SimulatorLocalForge.uiBaseUrl)
            lastSyncMessage = "Connected to local Forge"
            latestError = nil
            companionDebugLog("CompanionAppModel", "attemptLocalSimulatorBootstrapIfNeeded success session=\(payload.sessionId)")
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "attemptLocalSimulatorBootstrapIfNeeded failed error=\(error.localizedDescription)"
            )
            if latestError == nil {
                lastSyncMessage = "Local Forge not connected"
            }
        }
#endif
    }

    private func attemptAutomaticSimulatorSyncIfPossible() async {
#if targetEnvironment(simulator)
        companionDebugLog("CompanionAppModel", "attemptAutomaticSimulatorSyncIfPossible start")
        guard pairing != nil else { return }
        guard healthAccessStatus != .notSet else {
            refreshSyncState()
            companionDebugLog("CompanionAppModel", "attemptAutomaticSimulatorSyncIfPossible skipped healthAccessStatus not set")
            return
        }
        _ = await performSync(trigger: "simulator startup")
#endif
    }

    private func performSync(trigger: String) async -> Bool {
        if let activeSyncTask {
            if cancelActiveSyncIfStalled(now: Date(), reason: "performSync \(trigger)") {
                companionDebugLog(
                    "CompanionAppModel",
                    "performSync cancelled stalled active sync before trigger=\(trigger)"
                )
            } else {
                companionDebugLog(
                    "CompanionAppModel",
                    "performSync join existing trigger=\(trigger)"
                )
                return await activeSyncTask.value
            }
        }

        let taskId = UUID()
        let task = Task { @MainActor [weak self, taskId] in
            guard let self else {
                return false
            }
            defer {
                if self.activeSyncTaskId == taskId {
                    self.activeSyncTask = nil
                    self.activeSyncTaskId = nil
                }
            }
            return await self.runSync(trigger: trigger)
        }
        activeSyncTask = task
        activeSyncTaskId = taskId
        return await task.value
    }

    @discardableResult
    private func cancelActiveSyncIfStalled(now: Date, reason: String) -> Bool {
        guard activeSyncTask != nil else {
            return false
        }
        guard let stallReason = HealthSyncLifecyclePolicy.stallReason(
            startedAt: healthSyncTransferStartedAt,
            lastChunkAt: healthSyncTransferLastChunkAt,
            uploadedChunks: healthSyncTransferUploadedChunks,
            now: now
        ) else {
            return false
        }
        return cancelActiveSync(
            reason: "\(reason): \(stallReason)",
            userMessage: "Sync paused after a stalled upload. Forge will resume from the last accepted chunk."
        )
    }

    private func handleBackgroundSyncExpiration(reason: String) {
        cancelActiveSync(
            reason: reason,
            userMessage: "Sync paused in the background. Forge will resume from the last accepted chunk."
        )
    }

    @discardableResult
    private func cancelActiveSync(reason: String, userMessage: String) -> Bool {
        guard let task = activeSyncTask else {
            return false
        }
        companionDebugLog("CompanionAppModel", "cancelActiveSync reason=\(reason)")
        task.cancel()
        activeSyncTask = nil
        activeSyncTaskId = nil
        lastSyncMessage = userMessage
        latestError = nil
        if syncState == .syncing {
            refreshSyncState()
        }
        stopHealthSyncTransferTelemetry()
        backgroundScheduler.schedule(
            activeSync: activeHealthSyncSessionId != nil && protectedHealthDataCurrentlyUnavailable == false,
            reason: "active health sync cancelled"
        )
        return true
    }

    private func runSync(trigger: String) async -> Bool {
        companionDebugLog("CompanionAppModel", "performSync start trigger=\(trigger)")
        let resolvedPairing = await ensureActivePairingIfPossible(reason: "sync-\(trigger)") ?? self.pairing
        guard let pairing = resolvedPairing else {
            return false
        }
        syncState = .syncing
        do {
            await screenTimeStore.prepareSnapshotForSync(reason: trigger)
            let movementPayload = movementStore.buildMovementPayload()
            let screenTimePayload = screenTimeStore.buildScreenTimePayload()
            let syncResult = try await runChunkedHealthSync(
                pairing: pairing,
                trigger: trigger,
                movementPayload: movementPayload,
                screenTimePayload: screenTimePayload
            )
            let receipt = syncResult.receipt
            let payloadSummary = syncResult.payloadSummary
            if let pairingSession = receipt.pairingSession {
                applyPairingSessionState(pairingSession, reason: "sync-\(trigger)")
            }
            movementStore.mergeBootstrap(receipt.movement)
            _ = movementStore.runCoverageRepair(
                reason: "sync \(trigger)",
                referenceDate: Date()
            )
            let report = SyncReport(
                syncedAt: Date.now,
                sleepSessions: receipt.imported.sleepSessions,
                sleepNights: receipt.imported.sleepNights ?? receipt.imported.sleepSessions,
                sleepSegments: receipt.imported.sleepSegments ?? 0,
                sleepRawRecords: receipt.imported.sleepRawRecords ?? 0,
                workouts: receipt.imported.workouts,
                createdCount: receipt.imported.createdCount,
                updatedCount: receipt.imported.updatedCount,
                mergedCount: receipt.imported.mergedCount,
                movementStays: receipt.imported.movementStays ?? 0,
                movementTrips: receipt.imported.movementTrips ?? 0,
                movementKnownPlaces: receipt.imported.movementKnownPlaces ?? 0,
                vitalsDaySummaries: receipt.imported.vitalsDaySummaries ?? 0,
                vitalsMetricEntries: receipt.imported.vitalsMetricEntries ?? 0,
                screenTimeDaySummaries: receipt.imported.screenTimeDaySummaries ?? 0,
                screenTimeHourlySegments: receipt.imported.screenTimeHourlySegments ?? 0,
                screenTimeTotalActivitySeconds: payloadSummary.screenTimeTotalActivitySeconds
            )
            latestSyncReport = report
            persistSyncState(report: report, payloadSummary: payloadSummary)
            if syncResult.completedWorkoutBackfill {
                markWorkoutBackfillCompleted(at: report.syncedAt)
            }
            if syncResult.healthDataDeferred {
                lastSyncMessage =
                    "Synced movement while HealthKit stayed locked. Health data will resume after unlock."
            } else {
                lastSyncMessage =
                    "Synced \(receipt.imported.sleepNights ?? receipt.imported.sleepSessions) nights, \(receipt.imported.workouts) workouts, \(receipt.imported.vitalsMetricEntries ?? 0) body metrics, and \(receipt.imported.movementTrips ?? 0) trips via \(trigger)"
            }
            latestError = nil
            await refreshHealthAccessStatus()
            await pushAllCurrentSourceStatesIfNeeded()
            await refreshWatchBootstrap(reason: trigger)
            refreshSyncState()
            backgroundScheduler.schedule()
            companionDebugLog(
                "CompanionAppModel",
                "performSync success trigger=\(trigger) created=\(receipt.imported.createdCount) updated=\(receipt.imported.updatedCount) merged=\(receipt.imported.mergedCount)"
            )
            return true
        } catch {
            if error is CancellationError {
                companionDebugLog(
                    "CompanionAppModel",
                    "performSync cancelled trigger=\(trigger)"
                )
                refreshSyncState()
                return false
            }
            let nsError = error as NSError
            if Self.isProtectedHealthDataInaccessible(error) {
                companionDebugLog(
                    "CompanionAppModel",
                    "performSync deferred trigger=\(trigger) because protected data is inaccessible"
                )
                lastSyncMessage = "Waiting for device unlock to read HealthKit again"
                latestError = nil
                refreshSyncState()
                backgroundScheduler.schedule()
                return false
            }
            let failureReason = nsError.userInfo[NSLocalizedFailureReasonErrorKey] as? String
            if Self.isHealthSyncChunkChecksumMismatch(error) {
                let message = "Forge rejected a corrupted chunk. Retry starts a clean sync session."
                companionDebugLog(
                    "CompanionAppModel",
                    "performSync failed trigger=\(trigger) checksumMismatch description=\(nsError.localizedDescription) reason=\(failureReason ?? "nil")"
                )
                lastSyncMessage = message
                latestError = message
                syncState = .error
                return false
            }
            let combinedMessage = failureReason?.isEmpty == false
                ? "\(error.localizedDescription): \(failureReason!)"
                : error.localizedDescription
            companionDebugLog(
                "CompanionAppModel",
                "performSync failed trigger=\(trigger) error=\(combinedMessage)"
            )
            latestError = combinedMessage
            syncState = .error
            return false
        }
    }

    private func runChunkedHealthSync(
        pairing: PairingPayload,
        trigger: String,
        movementPayload: CompanionSyncPayload.MovementPayload,
        screenTimePayload: CompanionSyncPayload.ScreenTimePayload
    ) async throws -> HealthSyncRunResult {
        let permissions = currentHealthSyncPermissions(
            movementPayload: movementPayload,
            screenTimePayload: screenTimePayload
        )
        let sourceStates = currentSourceStates
        let syncClient = self.syncClient
        let recoveryContext = HealthSyncUploadRecoveryContext()
        var sequence = 0
        var workoutStats = WorkoutUploadStats()
        var healthDataDeferred = false
        let workoutBackfillPlan = WorkoutBackfillSyncPlan(
            lastSuccessfulSyncAt: lastSuccessfulSyncAt,
            workoutBackfillCompletedAt: workoutBackfillCompletedAt
        )
        let restoredCheckpoint = activeHealthSyncCheckpoint
        let clientChunkingVersion = ForgeSyncClient.healthSyncChunkingVersion(for: pairing)
        let resumableCheckpoint = restoredCheckpoint?.clientChunkingVersion == clientChunkingVersion
            ? restoredCheckpoint
            : nil
        if let restoredCheckpoint, resumableCheckpoint == nil {
            companionDebugLog(
                "CompanionAppModel",
                "discarding active health sync checkpoint session=\(restoredCheckpoint.syncSessionId) chunkingVersion=\(restoredCheckpoint.clientChunkingVersion) currentChunkingVersion=\(clientChunkingVersion)"
            )
        }
        var syncWindowEnd = resumableCheckpoint?.windowEnd ?? Date()
        let resumeSyncSessionId = resumableCheckpoint?.resumeSessionId
        activeSyncMode = workoutBackfillPlan.requiresBackfill ? .historicalWorkoutImport : .normal
        historicalWorkoutImportStatus = workoutBackfillPlan.requiresBackfill
            ? HistoricalWorkoutImportStatus(
                indexedWorkouts: 0,
                totalWorkouts: nil,
                uploadedWorkoutSummaries: 0,
                uploadedTimeSeriesSamples: 0,
                uploadedRoutePoints: 0,
                targetHeartRateSamples: 0,
                targetTimeSeriesSamples: 0,
                targetRoutePoints: 0,
                uploadedChunks: 0,
                resumedChunks: 0
            )
            : nil

        do {
            lastSyncMessage = workoutBackfillPlan.requiresBackfill
                ? "Starting one-time workout history import"
                : "Starting Forge sync"
            healthSyncLegacyFallbackReason = nil
            var session = try await syncClient.startHealthSyncSession(
                pairing: pairing,
                permissions: permissions,
                sourceStates: sourceStates,
                resumeSyncSessionId: resumeSyncSessionId
            )
            recoveryContext.uploadSession = session
            let initialBackendWorkoutSnapshot = Self.backendWorkoutImportSnapshot(from: session)
            var backendUploadedWorkoutExternalUids = initialBackendWorkoutSnapshot.uploadedWorkoutExternalUids
            applyBackendWorkoutImportSnapshot(
                initialBackendWorkoutSnapshot,
                requiresBackfill: workoutBackfillPlan.requiresBackfill,
                announceProgress: true
            )
            let resumedRestoredCheckpoint = resumableCheckpoint?.syncSessionId == session.syncSessionId
            if resumedRestoredCheckpoint == false {
                syncWindowEnd = Date()
            }
            let checkpoint = ActiveHealthSyncCheckpoint(
                syncSessionId: session.syncSessionId,
                schemaVersion: session.schemaVersion,
                requestedFamilies: session.acceptedFamilies,
                createdAt: resumedRestoredCheckpoint
                    ? resumableCheckpoint?.createdAt ?? Date()
                    : Date(),
                windowEnd: syncWindowEnd,
                requiresWorkoutBackfill: workoutBackfillPlan.requiresBackfill,
                lastReceivedChunkCount: session.progress?.chunkCount ?? session.receivedChunkIds.count,
                lastReceivedBytes: session.progress?.receivedBytes ?? 0,
                clientChunkingVersion: clientChunkingVersion
            )
            persistActiveHealthSyncCheckpoint(checkpoint)
            backgroundScheduler.schedule(activeSync: true, reason: "health sync started")
            startHealthSyncTransferTelemetry()
            let onChunkUploaded: ForgeSyncClient.HealthSyncChunkUploadHandler = { [weak self] event in
                await MainActor.run {
                    self?.recordHealthSyncChunkUpload(event)
                }
            }
            healthSyncChunkTargetBytes = session.chunkTargetBytes
            healthSyncChunkMaxBytes = session.chunkMaxBytes
            if session.receivedChunkIds.isEmpty == false {
                healthSyncLegacyFallbackReason =
                    "Resuming \(session.receivedChunkIds.count) accepted chunks"
            }

            lastSyncMessage = "Preparing HealthKit data"
            let buildResult = try await healthStore.buildSyncPayload(
                pairing: pairing,
                healthKitAuthorized: healthAuthorizationGranted,
                healthSyncEnabled: healthSyncEnabled,
                lastSuccessfulSyncAt: lastSuccessfulSyncAt,
                sourceStates: sourceStates,
                movementPayload: movementPayload,
                screenTimePayload: screenTimePayload,
                syncWindowEnd: syncWindowEnd,
                includeWorkouts: false
            )
            healthDataDeferred = buildResult.healthDataDeferred
            var payloadSummary = buildPayloadSummary(
                from: buildResult.payload,
                workoutStats: workoutStats
            )
            latestSyncPayloadSummary = payloadSummary

            lastSyncMessage = "Uploading sleep, vitals, movement, and screen time"
            lastHealthSyncChunkFamily = "base_health_families"
            lastHealthSyncPayloadBytes = try? JSONEncoder().encode(buildResult.payload).count
            session = try await syncClient.refreshHealthSyncSessionStatus(
                uploadSession: session,
                pairing: pairing
            )
            recoveryContext.uploadSession = session
            if let workoutImportState = session.workoutImportState {
                let refreshedBackendWorkoutSnapshot = Self.backendWorkoutImportSnapshot(from: workoutImportState)
                backendUploadedWorkoutExternalUids = refreshedBackendWorkoutSnapshot.uploadedWorkoutExternalUids
                applyBackendWorkoutImportSnapshot(
                    refreshedBackendWorkoutSnapshot,
                    requiresBackfill: workoutBackfillPlan.requiresBackfill,
                    announceProgress: false
                )
            }
            sequence = try await syncClient.uploadBaseHealthSyncChunks(
                payload: buildResult.payload,
                uploadSession: session,
                pairing: pairing,
                startingSequence: sequence,
                onChunkUploaded: onChunkUploaded
            )
            lastHealthSyncChunkId = "\(session.syncSessionId)-\(String(format: "%06d", max(0, sequence - 1)))"

            if healthDataDeferred == false {
                lastSyncMessage = workoutBackfillPlan.requiresBackfill
                    ? "Uploading workout history"
                    : "Uploading workouts"
                companionDebugLog(
                    "CompanionAppModel",
                    "workout chunk sync mode=\(workoutBackfillPlan.requiresBackfill ? "all-history-backfill" : "incremental") cursor=\(workoutBackfillPlan.workoutCursorDate?.description ?? "nil")"
                )
                let workoutStreamResult = try await healthStore.streamWorkoutSessionBatches(
                    healthKitAuthorized: healthAuthorizationGranted,
                    healthSyncEnabled: healthSyncEnabled,
                    lastSuccessfulSyncAt: workoutBackfillPlan.workoutCursorDate,
                    syncWindowEnd: syncWindowEnd,
                    batchSize: Int.max,
                    alreadyUploadedWorkoutExternalUids: backendUploadedWorkoutExternalUids,
                    onProgress: { [weak self] progress in
                        guard workoutBackfillPlan.requiresBackfill else {
                            return
                        }
                        await MainActor.run {
                            self?.lastSyncMessage =
                                "Preparing \(progress.uploadedWorkouts)/\(progress.totalWorkouts ?? progress.discoveredWorkouts) historical workouts"
                            self?.updateHistoricalWorkoutImportStatus { status in
                                status.indexedWorkouts = max(status.indexedWorkouts, progress.uploadedWorkouts)
                                status.uploadedWorkoutSummaries = max(
                                    status.uploadedWorkoutSummaries,
                                    progress.uploadedWorkouts
                                )
                                if let totalWorkouts = progress.totalWorkouts {
                                    status.totalWorkouts = totalWorkouts
                                }
                            }
                        }
                    },
                    onBatch: { [weak self] workouts, progress in
                        let batchStats = Self.workoutUploadStats(for: workouts)
                        await MainActor.run {
                            if let totalWorkouts = progress.totalWorkouts {
                                self?.lastSyncMessage =
                                    workoutBackfillPlan.requiresBackfill
                                        ? "Uploading historical workouts \(progress.uploadedWorkouts)/\(totalWorkouts)"
                                        : "Uploading workouts \(progress.uploadedWorkouts)/\(totalWorkouts)"
                            } else if progress.isScanningComplete {
                                self?.lastSyncMessage =
                                    workoutBackfillPlan.requiresBackfill
                                        ? "Uploading historical workouts \(progress.uploadedWorkouts)"
                                        : "Uploading workouts \(progress.uploadedWorkouts)"
                            } else {
                                self?.lastSyncMessage =
                                    workoutBackfillPlan.requiresBackfill
                                        ? "Indexing historical workouts \(progress.uploadedWorkouts) found so far"
                                        : "Uploading workouts \(progress.uploadedWorkouts) found so far"
                            }
                            if workoutBackfillPlan.requiresBackfill {
                                self?.updateHistoricalWorkoutImportStatus { status in
                                    status.indexedWorkouts = max(status.indexedWorkouts, progress.uploadedWorkouts)
                                    if let totalWorkouts = progress.totalWorkouts {
                                        status.totalWorkouts = totalWorkouts
                                    }
                                    status.targetHeartRateSamples += batchStats.rawHeartRateDatapoints
                                    status.targetTimeSeriesSamples += batchStats.rawTimeSeriesDatapoints
                                    status.targetRoutePoints += batchStats.routePoints
                                }
                            }
                            self?.lastHealthSyncChunkFamily = "workout_summaries"
                            self?.lastHealthSyncPayloadBytes = try? JSONEncoder().encode(workouts).count
                        }
                        let refreshedSession = try await syncClient.refreshHealthSyncSessionStatus(
                            uploadSession: session,
                            pairing: pairing
                        )
                        session = refreshedSession
                        recoveryContext.uploadSession = refreshedSession
                        sequence = try await syncClient.uploadWorkoutHealthSyncChunks(
                            workouts: workouts,
                            uploadSession: refreshedSession,
                            pairing: pairing,
                            startingSequence: sequence,
                            onChunkUploaded: onChunkUploaded
                        )
                        await MainActor.run {
                            workoutStats.workouts += batchStats.workouts
                            workoutStats.workoutsWithAverageHeartRate += batchStats.workoutsWithAverageHeartRate
                            workoutStats.workoutsWithMaxHeartRate += batchStats.workoutsWithMaxHeartRate
                            workoutStats.workoutsWithStepCount += batchStats.workoutsWithStepCount
                            workoutStats.rawHeartRateDatapoints += batchStats.rawHeartRateDatapoints
                            workoutStats.rawTimeSeriesDatapoints += batchStats.rawTimeSeriesDatapoints
                            workoutStats.routePoints += batchStats.routePoints
                            payloadSummary = self?.buildPayloadSummary(
                                from: buildResult.payload,
                                workoutStats: workoutStats
                            ) ?? payloadSummary
                            self?.latestSyncPayloadSummary = payloadSummary
                            self?.lastHealthSyncChunkId =
                                "\(session.syncSessionId)-\(String(format: "%06d", max(0, sequence - 1)))"
                        }
                    })
                if workoutStreamResult.healthDataDeferred {
                    healthDataDeferred = true
                }
            }

            if healthDataDeferred {
                companionDebugLog(
                    "CompanionAppModel",
                    "health sync deferred before completion because protected HealthKit data is unavailable"
                )
                lastSyncMessage = "Waiting for device unlock to read HealthKit again"
                throw Self.protectedHealthDataInaccessibleError()
            }

            lastSyncMessage = "Finalizing in Forge"
            var expectedCounts = [
                "sleep_nights": buildResult.payload.sleepNights.count,
                "sleep_segments": buildResult.payload.sleepSegments.count,
                "sleep_raw_records": buildResult.payload.sleepRawRecords.count
            ]
            expectedCounts["workout_summaries"] = workoutStats.workouts
            expectedCounts["workout_time_series"] = workoutStats.rawTimeSeriesDatapoints
            expectedCounts["workout_routes"] = workoutStats.routePoints
            let receipt = try await syncClient.completeHealthSyncSession(
                uploadSession: session,
                pairing: pairing,
                expectedCounts: expectedCounts
            )
            clearActiveHealthSyncCheckpoint()
            backgroundScheduler.schedule(activeSync: false, reason: "health sync completed")
            stopHealthSyncTransferTelemetry()
            return HealthSyncRunResult(
                receipt: receipt,
                payloadSummary: payloadSummary,
                healthDataDeferred: healthDataDeferred,
                completedWorkoutBackfill: workoutBackfillPlan.requiresBackfill && healthDataDeferred == false
            )
        } catch {
            applyHealthSyncChunkErrorDiagnostics(error)
            if Self.isHealthSyncChunkProtocolUnsupported(error) {
                clearActiveHealthSyncCheckpoint()
                lastSyncMessage = "Forge needs a runtime restart before HealthKit chunk sync."
                healthSyncLegacyFallbackReason = "The Forge runtime did not advertise byte-stable chunk support"
            } else if Self.isProtectedHealthDataInaccessible(error) {
                backgroundScheduler.schedule(
                    activeSync: false,
                    reason: "health sync deferred until protected data is available"
                )
                lastSyncMessage = "Waiting for device unlock to read HealthKit again"
            } else if let uploadSession = recoveryContext.uploadSession {
                if Self.isHealthSyncChunkChecksumMismatch(error) {
                    await syncClient.abortHealthSyncSession(uploadSession: uploadSession, pairing: pairing)
                    clearActiveHealthSyncCheckpoint()
                    lastSyncMessage = "Forge rejected a corrupted chunk. Retry starts a clean sync session."
                    healthSyncLegacyFallbackReason = "Last upload session was reset after a chunk checksum mismatch"
                } else {
                    if activeHealthSyncCheckpoint == nil {
                        persistActiveHealthSyncCheckpoint(
                            ActiveHealthSyncCheckpoint(
                                syncSessionId: uploadSession.syncSessionId,
                                schemaVersion: uploadSession.schemaVersion,
                                requestedFamilies: uploadSession.acceptedFamilies,
                                createdAt: Date(),
                                windowEnd: syncWindowEnd,
                                requiresWorkoutBackfill: workoutBackfillPlan.requiresBackfill,
                                lastReceivedChunkCount: uploadSession.progress?.chunkCount ?? uploadSession.receivedChunkIds.count,
                                lastReceivedBytes: uploadSession.progress?.receivedBytes ?? 0,
                                clientChunkingVersion: clientChunkingVersion
                            )
                        )
                    }
                    backgroundScheduler.schedule(activeSync: true, reason: "health sync resumable after error")
                    lastSyncMessage = "Forge will resume from the last accepted chunk"
                }
            }
            stopHealthSyncTransferTelemetry()
            throw error
        }
    }

    private static func backendWorkoutImportSnapshot(
        from session: ForgeSyncClient.HealthSyncUploadSession
    ) -> BackendWorkoutImportSnapshot {
        backendWorkoutImportSnapshot(from: session.workoutImportState)
    }

    private static func backendWorkoutImportSnapshot(
        from state: ForgeSyncClient.HealthSyncWorkoutImportState?
    ) -> BackendWorkoutImportSnapshot {
        let uploadedWorkoutExternalUids = Set(
            state?.alreadyUploadedWorkoutExternalUids.map { $0.lowercased() } ?? []
        )
        return BackendWorkoutImportSnapshot(
            uploadedWorkoutExternalUids: uploadedWorkoutExternalUids,
            uploadedWorkoutCount: state?.alreadyUploadedWorkoutCount ?? uploadedWorkoutExternalUids.count,
            existingWorkoutCount: state?.existingWorkoutCount ?? uploadedWorkoutExternalUids.count,
            incompleteWorkoutCount: state?.incompleteWorkoutCount ?? 0,
            timeSeriesSampleCount: state?.timeSeriesSampleCount ?? 0,
            routePointCount: state?.routePointCount ?? 0
        )
    }

    private func applyBackendWorkoutImportSnapshot(
        _ snapshot: BackendWorkoutImportSnapshot,
        requiresBackfill: Bool,
        announceProgress: Bool
    ) {
        guard requiresBackfill else {
            return
        }
        updateHistoricalWorkoutImportStatus { status in
            status.indexedWorkouts = max(status.indexedWorkouts, snapshot.uploadedWorkoutCount)
            status.uploadedWorkoutSummaries = max(
                status.uploadedWorkoutSummaries,
                snapshot.uploadedWorkoutCount
            )
            status.uploadedTimeSeriesSamples = max(
                status.uploadedTimeSeriesSamples,
                snapshot.timeSeriesSampleCount
            )
            status.uploadedRoutePoints = max(status.uploadedRoutePoints, snapshot.routePointCount)
            status.targetTimeSeriesSamples = max(
                status.targetTimeSeriesSamples,
                snapshot.timeSeriesSampleCount
            )
            status.targetRoutePoints = max(status.targetRoutePoints, snapshot.routePointCount)
        }
        if announceProgress && snapshot.uploadedWorkoutCount > 0 {
            lastSyncMessage =
                "Forge already has \(snapshot.uploadedWorkoutCount) workouts; checking HealthKit for the rest"
        }
        companionDebugLog(
            "CompanionAppModel",
            "health sync backend workout state uploaded=\(snapshot.uploadedWorkoutCount) existing=\(snapshot.existingWorkoutCount) incomplete=\(snapshot.incompleteWorkoutCount)"
        )
    }

    private func startHealthSyncTransferTelemetry() {
        healthSyncTransferTickerTask?.cancel()
        let now = Date()
        healthSyncTransferStartedAt = now
        healthSyncTransferLastSnapshotAt = now
        healthSyncTransferLastSnapshotBytes = 0
        healthSyncTransferBytesSent = 0
        healthSyncTransferCurrentBytesPerSecond = 0
        healthSyncTransferUploadedChunks = 0
        healthSyncTransferUploadedRecords = 0
        healthSyncTransferSkippedChunks = 0
        healthSyncTransferLastChunkAt = nil
        publishHealthSyncTransferStats(now: now)
        healthSyncTransferTickerTask = Task { [weak self] in
            while Task.isCancelled == false {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await MainActor.run {
                    self?.refreshHealthSyncTransferSpeed()
                }
            }
        }
    }

    private func stopHealthSyncTransferTelemetry() {
        healthSyncTransferTickerTask?.cancel()
        healthSyncTransferTickerTask = nil
        refreshHealthSyncTransferSpeed()
    }

    private func recordHealthSyncChunkUpload(_ event: ForgeSyncClient.HealthSyncChunkUploadEvent) {
        if healthSyncTransferStartedAt == nil {
            startHealthSyncTransferTelemetry()
        }
        lastHealthSyncChunkId = event.chunkId
        lastHealthSyncChunkFamily = event.family
        lastHealthSyncPayloadBytes = event.transferByteCount
        updateActiveHealthSyncCheckpointProgress(
            chunkCount: event.receivedCount,
            receivedBytes: event.receivedBytes
        )
        recordHistoricalWorkoutImportChunk(event)
        if event.skipped {
            healthSyncTransferSkippedChunks += 1
        } else {
            healthSyncTransferBytesSent += event.transferByteCount
            healthSyncTransferUploadedChunks += 1
            healthSyncTransferUploadedRecords += event.recordCount
            healthSyncTransferLastChunkAt = Date()
        }
        publishHealthSyncTransferStats(now: Date())
    }

    private func updateHistoricalWorkoutImportStatus(
        _ update: (inout HistoricalWorkoutImportStatus) -> Void
    ) {
        var status = historicalWorkoutImportStatus ?? HistoricalWorkoutImportStatus(
            indexedWorkouts: 0,
            totalWorkouts: nil,
            uploadedWorkoutSummaries: 0,
            uploadedTimeSeriesSamples: 0,
            uploadedRoutePoints: 0,
            targetHeartRateSamples: 0,
            targetTimeSeriesSamples: 0,
            targetRoutePoints: 0,
            uploadedChunks: 0,
            resumedChunks: 0
        )
        update(&status)
        historicalWorkoutImportStatus = status
    }

    private func recordHistoricalWorkoutImportChunk(
        _ event: ForgeSyncClient.HealthSyncChunkUploadEvent
    ) {
        guard activeSyncMode == .historicalWorkoutImport else {
            return
        }
        guard event.family == "workout_summaries" ||
            event.family == "workout_time_series" ||
            event.family == "workout_routes" else {
            return
        }
        updateHistoricalWorkoutImportStatus { status in
            if event.skipped {
                status.resumedChunks += 1
            } else {
                status.uploadedChunks += 1
            }
            switch event.family {
            case "workout_summaries":
                status.uploadedWorkoutSummaries += event.recordCount
            case "workout_time_series":
                status.uploadedTimeSeriesSamples += event.recordCount
            case "workout_routes":
                status.uploadedRoutePoints += event.recordCount
            default:
                break
            }
        }
    }

    private func refreshHealthSyncTransferSpeed() {
        guard let startedAt = healthSyncTransferStartedAt else {
            return
        }
        let now = Date()
        let previousAt = healthSyncTransferLastSnapshotAt ?? startedAt
        let elapsed = max(now.timeIntervalSince(previousAt), 0.001)
        let byteDelta = max(0, healthSyncTransferBytesSent - healthSyncTransferLastSnapshotBytes)
        healthSyncTransferCurrentBytesPerSecond = Double(byteDelta) / elapsed
        healthSyncTransferLastSnapshotAt = now
        healthSyncTransferLastSnapshotBytes = healthSyncTransferBytesSent
        publishHealthSyncTransferStats(now: now)
        cancelActiveSyncIfStalled(now: now, reason: "health sync transfer watchdog")
    }

    private func publishHealthSyncTransferStats(now: Date) {
        guard let startedAt = healthSyncTransferStartedAt else {
            healthSyncTransferStats = nil
            return
        }
        let totalElapsed = max(now.timeIntervalSince(startedAt), 0.001)
        let secondsSinceLastChunk = healthSyncTransferLastChunkAt.map {
            max(0, Int(now.timeIntervalSince($0).rounded(.down)))
        }
        healthSyncTransferStats = SyncTransferStats(
            totalBytesSent: healthSyncTransferBytesSent,
            currentBytesPerSecond: healthSyncTransferCurrentBytesPerSecond,
            averageBytesPerSecond: Double(healthSyncTransferBytesSent) / totalElapsed,
            uploadedChunks: healthSyncTransferUploadedChunks,
            uploadedRecords: healthSyncTransferUploadedRecords,
            skippedChunks: healthSyncTransferSkippedChunks,
            secondsSinceLastChunk: secondsSinceLastChunk
        )
    }

    private func applyHealthSyncChunkErrorDiagnostics(_ error: Error) {
        let nsError = error as NSError
        if let chunkId = nsError.userInfo["ForgeHealthSyncChunkId"] as? String,
           chunkId.isEmpty == false {
            lastHealthSyncChunkId = chunkId
        }
        if let family = nsError.userInfo["ForgeHealthSyncChunkFamily"] as? String,
           family.isEmpty == false {
            lastHealthSyncChunkFamily = family
        }
        if let byteCountText = nsError.userInfo["ForgeHealthSyncChunkByteCount"] as? String,
           let byteCount = Int(byteCountText) {
            lastHealthSyncPayloadBytes = byteCount
        }
    }

    private static func isHealthSyncChunkProtocolUnsupported(_ error: Error) -> Bool {
        let nsError = error as NSError
        let failureReason = nsError.userInfo[NSLocalizedFailureReasonErrorKey] as? String
        return nsError.domain == "ForgeSyncClient" &&
            (
                nsError.localizedDescription.contains("HealthKit chunk sync") ||
                failureReason?.contains("healthkit_chunk_protocol_unsupported") == true
            )
    }

    private static func isHealthSyncChunkChecksumMismatch(_ error: Error) -> Bool {
        let nsError = error as NSError
        let failureReason = nsError.userInfo[NSLocalizedFailureReasonErrorKey] as? String
        return nsError.domain == "ForgeSyncClient" &&
            (
                nsError.localizedDescription.contains("chunk_checksum_mismatch") ||
                failureReason?.contains("chunk_checksum_mismatch") == true
            )
    }

    private static func isProtectedHealthDataInaccessible(_ error: Error) -> Bool {
        (error as NSError).localizedDescription == "Protected health data is inaccessible"
    }

    private static func protectedHealthDataInaccessibleError() -> NSError {
        NSError(
            domain: "CompanionAppModel",
            code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: "Protected health data is inaccessible"
            ]
        )
    }

    private func currentHealthSyncPermissions(
        movementPayload: CompanionSyncPayload.MovementPayload,
        screenTimePayload: CompanionSyncPayload.ScreenTimePayload
    ) -> CompanionSyncPayload.Permissions {
        CompanionSyncPayload.Permissions(
            healthKitAuthorized: healthAuthorizationGranted,
            backgroundRefreshEnabled: UIApplication.shared.backgroundRefreshStatus == .available,
            motionReady: movementPayload.settings.motionPermissionStatus == "ready",
            locationReady: movementPayload.settings.locationPermissionStatus == "always"
                || movementPayload.settings.locationPermissionStatus == "when_in_use",
            screenTimeReady: screenTimePayload.settings.authorizationStatus == "approved"
                && screenTimePayload.settings.trackingEnabled
                && screenTimePayload.settings.syncEnabled
        )
    }

    private func refreshMovementBootstrap() async {
        let resolvedPairing = await ensureActivePairingIfPossible(reason: "movement-bootstrap") ?? self.pairing
        guard let pairing = resolvedPairing else {
            return
        }
        do {
            let bootstrap = try await syncClient.fetchMovementBootstrap(payload: pairing)
            if let pairingSession = bootstrap.pairingSession {
                applyPairingSessionState(pairingSession, reason: "movement-bootstrap")
            }
            movementStore.mergeBootstrap(bootstrap.movement)
            _ = movementStore.runCoverageRepair(
                reason: "movement bootstrap",
                referenceDate: Date()
            )
            await pushAllCurrentSourceStatesIfNeeded()
            await refreshWatchBootstrap(reason: "movement refresh")
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "refreshMovementBootstrap failed error=\(error.localizedDescription)"
            )
        }
    }

    var shouldShowSetupHero: Bool {
        pairing == nil
    }

    var shouldPromptForHealthAccess: Bool {
        pairing != nil
            && healthSyncEnabled
            && healthAccessStatus == .notSet
            && !healthPermissionPromptDeferred
    }

    var shouldPromptForMovementAccess: Bool {
        pairing != nil
            && movementStore.trackingEnabled
            && movementStore.locationPermissionStatus == "not_determined"
            && !movementPermissionPromptDeferred
    }

    var connectionStatusTitle: String {
        if pairing == nil {
            return "Not connected"
        }
        if syncState == .syncing {
            return "Syncing now"
        }
        if missingRequiredAuthorization {
            return "Needs authorization"
        }
        if latestSyncReport == nil {
            return "Ready to sync"
        }
        if syncState == .stale {
            return "Needs refresh"
        }
        if syncState == .error {
            return "Needs attention"
        }
        return "Connected"
    }

    var healthAccessLabel: String {
        if healthSyncEnabled == false {
            return "Health off"
        }
        switch healthAccessStatus {
        case .fullAccess:
            return "HealthKit full access"
        case .customAccess:
            return "HealthKit custom access"
        case .notSet:
            return "HealthKit not set"
        }
    }

    var movementAccessLabel: String {
        if movementStore.trackingEnabled == false {
            return "Movement off"
        }
        return movementStore.locationPermissionStatus.replacingOccurrences(
            of: "_",
            with: " "
        )
    }

    var screenTimeAccessLabel: String {
        if screenTimeStore.enabled == false {
            return "Screen Time off"
        }
        return screenTimeStore.authorizationStatus.replacingOccurrences(
            of: "_",
            with: " "
        )
    }

    var syncStateLabel: String {
        switch syncState {
        case .disconnected:
            return "Not connected"
        case .connected:
            return "Ready to sync"
        case .syncing:
            return "Syncing now"
        case .healthy:
            return "Healthy sync"
        case .stale:
            return "Stale sync"
        case .permissionDenied:
            return "Permission needed"
        case .error:
            return "Needs attention"
        }
    }

    var forgeWebURL: URL? {
        guard let pairing else {
            return nil
        }
        return URL(
            string: pairing.uiBaseUrl ?? CompanionPairingURLResolver.deriveUiBaseUrl(from: pairing.apiBaseUrl)
        )
    }

    var forgeHostLabel: String {
        guard let forgeWebURL else {
            return "Not connected"
        }
        if forgeWebURL.host == "127.0.0.1" || forgeWebURL.host == "localhost" {
            return "Local Forge"
        }
        return forgeWebURL.host ?? forgeWebURL.absoluteString
    }

    var needsNativeAttention: Bool {
        companionOperationalSummary.status != .ok
    }

    var companionOperationalSummary: CompanionOperationalSummary {
        CompanionOperationalSummary.derive(
            syncState: syncState,
            latestError: latestError,
            healthSyncEnabled: healthSyncEnabled,
            healthAccessStatus: healthAccessStatus,
            movementEnabled: movementStore.trackingEnabled,
            movementPermissionStatus: movementStore.locationPermissionStatus,
            movementBackgroundReady: movementStore.backgroundTrackingReady,
            screenTimeEnabled: screenTimeStore.enabled,
            screenTimeAuthorizationStatus: screenTimeStore.authorizationStatus
        )
    }

    var companionOperationalStatusLabel: String {
        companionOperationalSummary.status.rawValue
    }

    var permissionSyncButtonLabel: String {
        permissionSyncPhase.buttonLabel
    }

    var permissionSyncProgressDetail: String? {
        permissionSyncPhase.progressDetail
    }

    var permissionSyncInFlight: Bool {
        permissionSyncPhase.isBusy
    }

    var companionOperationalDetailLabel: String {
        companionOperationalSummary.detail
    }

    var hasMissingRequiredAuthorization: Bool {
        companionOperationalSummary.status == .warning
    }

    var permissionGateStatusRows: [SyncCoverageRow] {
        [
            SyncCoverageRow(
                id: "health",
                title: "Health",
                value: healthAccessLabel,
                detail: "Sleep, vitals, and workouts",
                isMissing: healthSyncEnabled && healthAccessStatus == .notSet
            ),
            SyncCoverageRow(
                id: "movement",
                title: "Location",
                value: movementPermissionGateLabel,
                detail: movementStore.backgroundTrackingReady ? "Background ready" : "Background not ready",
                isMissing: movementStore.trackingEnabled && movementStore.backgroundTrackingReady == false
            ),
            SyncCoverageRow(
                id: "motion",
                title: "Motion",
                value: movementStore.motionPermissionStatus.replacingOccurrences(of: "_", with: " "),
                detail: "Movement context",
                isMissing: movementStore.motionPermissionStatus == "unavailable"
            )
        ]
    }

    var movementPermissionGateLabel: String {
        if movementStore.trackingEnabled == false {
            return "Off"
        }
        switch movementStore.locationPermissionStatus {
        case "always":
            return "Authorized"
        case "when_in_use":
            return "While open only"
        case "denied":
            return "Denied"
        case "restricted":
            return "Restricted"
        default:
            return "Not authorized"
        }
    }

    var screenTimePermissionGateLabel: String {
        if screenTimeStore.enabled == false {
            return "Off"
        }
        switch screenTimeStore.authorizationStatus {
        case "approved":
            return "Authorized"
        case "unavailable":
            return "Unavailable"
        case "denied":
            return "Denied"
        default:
            return "Not authorized"
        }
    }

    var latestImportSummary: String {
        guard let report = latestSyncReport else {
            return "No sync yet"
        }
        return "\(report.sleepRawRecords) raw, \(report.sleepSegments) segments, \(report.sleepNights) nights, \(report.workouts) workouts"
    }

    var syncUploadStatus: CompanionSyncUploadStatus {
        CompanionSyncUploadStatus(
            isSyncing: syncState == .syncing || activeSyncTask != nil,
            syncMode: activeSyncMode,
            message: lastSyncMessage,
            payloadSummary: latestSyncPayloadSummary,
            lastChunkFamily: lastHealthSyncChunkFamily,
            lastPayloadBytes: lastHealthSyncPayloadBytes,
            activeSessionId: activeHealthSyncSessionId,
            transferStats: healthSyncTransferStats,
            historicalWorkoutImport: historicalWorkoutImportStatus
        )
    }

    var lastSuccessfulSyncLabel: String {
        guard let lastSuccessfulSyncAt else {
            return "Never"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: lastSuccessfulSyncAt, relativeTo: .now)
    }

    var watchSyncLabel: String {
        watchSessionManager.lastStatusMessage
    }

    var syncCoverageRows: [SyncCoverageRow] {
        let payloadSummary = latestSyncPayloadSummary
        return [
            SyncCoverageRow(
                id: "sleep",
                title: "Sleep",
                value: "\(payloadSummary?.sleepRawRecords ?? 0) raw + \(payloadSummary?.sleepSegments ?? 0) segments + \(payloadSummary?.sleepNights ?? 0) nights",
                detail: "Forge sync now carries provider raw sleep records, normalized sleep segments, and canonical overnight nights as separate layers.",
                isMissing: (payloadSummary?.sleepNights ?? 0) == 0
            ),
            SyncCoverageRow(
                id: "workouts",
                title: "Workouts",
                value: "\(payloadSummary?.workouts ?? 0) workouts",
                detail: "Workout sessions sync timing, energy, distance, step count, and average/max heart-rate metrics when available.",
                isMissing: (payloadSummary?.workouts ?? 0) == 0
            ),
            SyncCoverageRow(
                id: "vitals",
                title: "Body signals",
                value: "\(payloadSummary?.vitalsMetricEntries ?? 0) metrics across \(payloadSummary?.vitalsDaySummaries ?? 0) days",
                detail: "Daily HealthKit vitals now include recovery, cardio, breathing, composition, and activity signals such as resting HR, HRV, VO2 max, respiratory rate, SpO2, weight, and exercise totals.",
                isMissing: (payloadSummary?.vitalsMetricEntries ?? 0) == 0
            ),
            SyncCoverageRow(
                id: "heart-rate",
                title: "Heart rate",
                value: "\(payloadSummary?.rawHeartRateDatapointsSynced ?? 0) raw + \(payloadSummary?.workoutsWithAverageHeartRate ?? 0) avg + \(payloadSummary?.workoutsWithMaxHeartRate ?? 0) max",
                detail: "Workout heart-rate samples stream as raw HealthKit evidence in chunked sync, with summaries and daily resting HR/HRV/VO2 max kept alongside them.",
                isMissing: (payloadSummary?.rawHeartRateDatapointsSynced ?? 0) == 0 && (payloadSummary?.workoutsWithAverageHeartRate ?? 0) == 0 && (payloadSummary?.workoutsWithMaxHeartRate ?? 0) == 0 && (payloadSummary?.vitalsMetricEntries ?? 0) == 0
            ),
            SyncCoverageRow(
                id: "movement",
                title: "Movement",
                value: "\(payloadSummary?.movementStays ?? 0) stays, \(payloadSummary?.movementTrips ?? 0) trips",
                detail: "Passive movement sync includes known places, stays, trips, trip points, and stop anchors from the phone.",
                isMissing: (payloadSummary?.movementStays ?? 0) == 0 && (payloadSummary?.movementTrips ?? 0) == 0
            ),
            SyncCoverageRow(
                id: "watch",
                title: "Watch",
                value: watchSyncLabel,
                detail: "The watch uses the phone bridge and does not sync directly to Forge.",
                isMissing: false
            )
        ]
    }

    var sourceDiagnosticsRows: [CompanionSourceDiagnosticsRow] {
        let states = currentSourceStates
        return [
            CompanionSourceDiagnosticsRow(
                id: CompanionSourceKey.health.rawValue,
                title: CompanionSourceKey.health.title,
                desiredEnabled: states.health.desiredEnabled,
                appliedEnabled: states.health.appliedEnabled,
                authorizationStatus: states.health.authorizationStatus,
                syncEligible: states.health.syncEligible,
                lastObservedAt: states.health.lastObservedAt
            ),
            CompanionSourceDiagnosticsRow(
                id: CompanionSourceKey.movement.rawValue,
                title: CompanionSourceKey.movement.title,
                desiredEnabled: states.movement.desiredEnabled,
                appliedEnabled: states.movement.appliedEnabled,
                authorizationStatus: states.movement.authorizationStatus,
                syncEligible: states.movement.syncEligible,
                lastObservedAt: states.movement.lastObservedAt
            )
        ]
    }

    private func refreshWatchBootstrap(reason: String) async {
        await watchSessionManager.refreshBootstrapIfPossible(reason: reason)
    }

    private static func workoutUploadStats(
        for workouts: [CompanionSyncPayload.WorkoutSession]
    ) -> WorkoutUploadStats {
        WorkoutUploadStats(
            workouts: workouts.count,
            workoutsWithAverageHeartRate: workouts.reduce(0) { $0 + ($1.averageHeartRate == nil ? 0 : 1) },
            workoutsWithMaxHeartRate: workouts.reduce(0) { $0 + ($1.maxHeartRate == nil ? 0 : 1) },
            workoutsWithStepCount: workouts.reduce(0) { $0 + ($1.stepCount == nil ? 0 : 1) },
            rawHeartRateDatapoints: workouts.reduce(0) { sum, workout in
                sum + workout.timeSeriesSamples.filter { $0.metricKey == "heart_rate" }.count
            },
            rawTimeSeriesDatapoints: workouts.reduce(0) { $0 + $1.timeSeriesSamples.count },
            routePoints: workouts.reduce(0) { $0 + $1.routePoints.count }
        )
    }

    private func buildPayloadSummary(
        from payload: CompanionSyncPayload,
        workoutStats: WorkoutUploadStats? = nil
    ) -> SyncPayloadSummary {
        let stats = workoutStats ?? Self.workoutUploadStats(for: payload.workouts)
        return SyncPayloadSummary(
            builtAt: .now,
            sleepSessions: payload.sleepSessions.count,
            sleepNights: payload.sleepNights.count,
            sleepSegments: payload.sleepSegments.count,
            sleepRawRecords: payload.sleepRawRecords.count,
            sleepStageEntries: payload.sleepNights.reduce(0) { $0 + $1.stageBreakdown.count },
            workouts: stats.workouts,
            workoutsWithAverageHeartRate: stats.workoutsWithAverageHeartRate,
            workoutsWithMaxHeartRate: stats.workoutsWithMaxHeartRate,
            workoutsWithStepCount: stats.workoutsWithStepCount,
            movementKnownPlaces: payload.movement.knownPlaces.count,
            movementStays: payload.movement.stays.count,
            movementTrips: payload.movement.trips.count,
            movementTripPoints: payload.movement.trips.reduce(0) { $0 + $1.points.count },
            movementTripStops: payload.movement.trips.reduce(0) { $0 + $1.stops.count },
            vitalsDaySummaries: payload.vitals.daySummaries.count,
            vitalsMetricEntries: payload.vitals.daySummaries.reduce(0) { $0 + $1.metrics.count },
            screenTimeDaySummaries: payload.screenTime.daySummaries.count,
            screenTimeHourlySegments: payload.screenTime.hourlySegments.count,
            screenTimeTotalActivitySeconds: payload.screenTime.daySummaries.isEmpty == false
                ? payload.screenTime.daySummaries.reduce(0) { $0 + $1.totalActivitySeconds }
                : payload.screenTime.hourlySegments.reduce(0) { $0 + $1.totalActivitySeconds },
            rawHeartRateDatapointsSynced: stats.rawHeartRateDatapoints
        )
    }

    private func pairingNeedsRenewal(_ payload: PairingPayload) -> Bool {
        guard let expirationDate = parsePairingExpirationDate(payload.expiresAt) else {
            return false
        }
        return expirationDate.timeIntervalSinceNow <= 5 * 60
    }

    private func parsePairingExpirationDate(_ rawValue: String) -> Date? {
        if let date = ISO8601DateFormatter().date(from: rawValue) {
            return date
        }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractionalFormatter.date(from: rawValue)
    }

    private func renewPairingSession(
        from payload: PairingPayload,
        reason: String
    ) async throws -> PairingPayload {
        guard let server = await preferredAutomaticPairingServer(for: payload) else {
            throw NSError(
                domain: "CompanionAppModel",
                code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey: "No trusted Forge target was available to renew the pairing automatically."
                ]
            )
        }

        companionDebugLog(
            "CompanionAppModel",
            "renewPairingSession start reason=\(reason) server=\(server.host)"
        )
        let renewedPayload = try await syncClient.bootstrapPairingSession(
            baseUrl: server.apiBaseUrl,
            label: UIDevice.current.name,
            capabilities: SimulatorLocalForge.capabilities
        )
        let normalizedRenewedPayload = normalizedPairingPayload(
            renewedPayload,
            preferredUiBaseUrl: server.uiBaseUrl,
            preferredApiBaseUrl: server.apiBaseUrl
        )
        let verifiedSession = try await syncClient.verifyPairing(
            payload: normalizedRenewedPayload,
            apiBaseUrl: normalizedRenewedPayload.apiBaseUrl
        )
        let verifiedRenewedPayload = CompanionPairingURLResolver.payload(
            normalizedRenewedPayload,
            refreshedBy: verifiedSession
        )
        completeConnection(
            with: verifiedRenewedPayload,
            preferredUiBaseUrl: server.uiBaseUrl,
            message: "Reconnected to Forge"
        )
        applyPairingSessionState(verifiedSession, reason: "renewal-\(reason)")
        lastSyncMessage = "Reconnected to \(server.name)"
        latestError = nil
        companionDebugLog(
            "CompanionAppModel",
            "renewPairingSession success reason=\(reason) session=\(verifiedRenewedPayload.sessionId)"
        )
        return verifiedRenewedPayload
    }

    private func preferredAutomaticPairingServer(
        for payload: PairingPayload
    ) async -> DiscoveredForgeServer? {
        let normalizedPayload = normalizedPairingPayload(payload)
        let normalizedApiHost = URL(string: normalizedPayload.apiBaseUrl)?.host?.lowercased()
        let normalizedUiHost = URL(string: normalizedPayload.uiBaseUrl ?? "")?.host?.lowercased()

        func matches(_ server: DiscoveredForgeServer) -> Bool {
            let serverHost = server.host.lowercased()
            return serverHost == normalizedApiHost || serverHost == normalizedUiHost
        }

        if let directStoredTarget = automaticBootstrapTarget(from: normalizedPayload) {
            return directStoredTarget
        }

        if let discoveredMatch = discoveredServers.first(where: { $0.canBootstrapPairing && matches($0) }) {
            return discoveredMatch
        }

        let report = await discoveryService.discoverEnvironment()
        discoveredServers = report.servers
        discoveredTailscaleDevices = report.tailscaleDevices
        tailscaleDiscoveryMessage = report.tailscaleStatusMessage

        if let discoveredMatch = report.servers.first(where: { $0.canBootstrapPairing && matches($0) }) {
            return discoveredMatch
        }

        if normalizedApiHost?.contains(".ts.net") == true {
            return report.servers.first(where: { $0.source == .tailscale && $0.canBootstrapPairing })
        }

        return report.servers.first(where: \.canBootstrapPairing)
    }

    private func automaticBootstrapTarget(from payload: PairingPayload) -> DiscoveredForgeServer? {
        guard
            let apiUrl = URL(string: payload.apiBaseUrl),
            let host = apiUrl.host?.lowercased(),
            host.contains(".ts.net")
        else {
            return nil
        }

        let uiBaseUrl = payload.uiBaseUrl ?? CompanionPairingURLResolver.deriveUiBaseUrl(from: payload.apiBaseUrl)
        return DiscoveredForgeServer(
            id: "stored-ts-\(host)",
            name: host,
            host: host,
            apiBaseUrl: payload.apiBaseUrl,
            uiBaseUrl: uiBaseUrl,
            source: .tailscale,
            canBootstrapPairing: true,
            detail: "Stored trusted Tailscale Forge target"
        )
    }

    private var hasAnyEnabledSource: Bool {
        healthSyncEnabled || movementStore.trackingEnabled || screenTimeStore.enabled
    }

    private var missingRequiredAuthorization: Bool {
        (healthSyncEnabled && healthAccessStatus == .notSet)
            || (movementStore.trackingEnabled && (
                movementStore.locationPermissionStatus == "not_determined"
                    || movementStore.locationPermissionStatus == "denied"
                    || movementStore.locationPermissionStatus == "restricted"
                    || movementStore.backgroundTrackingReady == false
            ))
            || (screenTimeStore.enabled && screenTimeStore.authorizationStatus != "approved")
    }

    private var currentSourceStates: CompanionSourceStates {
        let now = ISO8601DateFormatter().string(from: Date())
        return CompanionSourceStates(
            health: CompanionSourceState(
                desiredEnabled: healthSyncEnabled,
                appliedEnabled: healthSyncEnabled,
                authorizationStatus: sourceAuthorizationStatus(for: .health),
                syncEligible: healthSyncEnabled && healthAccessStatus != .notSet,
                lastObservedAt: now,
                metadata: LooseJSONObject(values: [
                    "healthAccessStatus": healthAccessStatus.rawValue
                ])
            ),
            movement: CompanionSourceState(
                desiredEnabled: movementStore.trackingEnabled,
                appliedEnabled: movementStore.trackingEnabled,
                authorizationStatus: sourceAuthorizationStatus(for: .movement),
                syncEligible: movementStore.trackingEnabled && movementStore.backgroundTrackingReady,
                lastObservedAt: now,
                metadata: LooseJSONObject(values: [
                    "locationPermissionStatus": movementStore.locationPermissionStatus,
                    "motionPermissionStatus": movementStore.motionPermissionStatus
                ])
            ),
            screenTime: CompanionSourceState(
                desiredEnabled: screenTimeStore.enabled,
                appliedEnabled: screenTimeStore.enabled,
                authorizationStatus: sourceAuthorizationStatus(for: .screenTime),
                syncEligible: screenTimeStore.readyForSync,
                lastObservedAt: now,
                metadata: LooseJSONObject(values: [
                    "captureState": screenTimeStore.captureState,
                    "captureFreshness": screenTimeStore.captureFreshness
                ])
            )
        )
    }

    private func sourceAuthorizationStatus(for source: CompanionSourceKey) -> String {
        switch source {
        case .health:
            guard healthSyncEnabled else { return "disabled" }
            switch healthAccessStatus {
            case .fullAccess, .customAccess:
                return "approved"
            case .notSet:
                return "not_determined"
            }
        case .movement:
            guard movementStore.trackingEnabled else { return "disabled" }
            switch movementStore.locationPermissionStatus {
            case "always":
                return "approved"
            case "when_in_use":
                return "pending"
            case "denied":
                return "denied"
            case "restricted":
                return "restricted"
            default:
                return "not_determined"
            }
        case .screenTime:
            guard screenTimeStore.enabled else { return "disabled" }
            switch screenTimeStore.authorizationStatus {
            case "approved":
                return "approved"
            case "denied":
                return "denied"
            case "unavailable":
                return "unavailable"
            default:
                return "not_determined"
            }
        }
    }

    private var canPresentPermissionPrompts: Bool {
        UIApplication.shared.applicationState == .active
    }

    private func isSourceEnabled(_ source: CompanionSourceKey) -> Bool {
        switch source {
        case .health:
            return healthSyncEnabled
        case .movement:
            return movementStore.trackingEnabled
        case .screenTime:
            return screenTimeStore.enabled
        }
    }

    private func applyLocalSourceEnabledState(
        _ source: CompanionSourceKey,
        enabled: Bool
    ) {
        switch source {
        case .health:
            healthSyncEnabled = enabled
            if enabled == false {
                healthPermissionPromptDeferred = false
                UserDefaults.standard.set(false, forKey: StorageKeys.deferredHealthPrompt)
            }
        case .movement:
            if movementStore.trackingEnabled != enabled {
                movementStore.setTrackingEnabled(enabled)
            }
            if enabled == false {
                movementPermissionPromptDeferred = false
                UserDefaults.standard.set(false, forKey: StorageKeys.movementPromptDeferred)
            }
        case .screenTime:
            if screenTimeStore.enabled != enabled {
                screenTimeStore.setEnabled(enabled)
            }
        }
    }

    private func applyRemoteSourceStates(_ sourceStates: CompanionSourceStates) {
        var sourcesToPushImmediately: [CompanionSourceKey] = []
        for source in CompanionSourceKey.allCases {
            let remoteState: CompanionSourceState
            switch source {
            case .health:
                remoteState = sourceStates.health
            case .movement:
                remoteState = sourceStates.movement
            case .screenTime:
                remoteState = sourceStates.screenTime
            }

            let localEnabled = isSourceEnabled(source)
            if remoteState.desiredEnabled == false {
                if localEnabled {
                    applyLocalSourceEnabledState(source, enabled: false)
                    sourcesToPushImmediately.append(source)
                }
                pendingRemoteSourceReconciliation.remove(source)
                continue
            }

            if localEnabled == false {
                applyLocalSourceEnabledState(source, enabled: true)
            }

            if remoteState.desiredEnabled != remoteState.appliedEnabled {
                if sourceNeedsInteractiveReconciliation(source) {
                    pendingRemoteSourceReconciliation.insert(source)
                } else {
                    pendingRemoteSourceReconciliation.remove(source)
                }
                continue
            }

            pendingRemoteSourceReconciliation.remove(source)
            if localEnabled == false {
                sourcesToPushImmediately.append(source)
            }
        }
        refreshSyncState()
        if sourcesToPushImmediately.isEmpty == false {
            Task {
                for source in sourcesToPushImmediately {
                    await pushCurrentSourceState(source)
                }
            }
        }
        scheduleRemoteSourceReconciliation(reason: "remote source state update")
    }

    private func applyPairingSessionState(
        _ session: CompanionPairingSessionState,
        reason: String
    ) {
        if let currentPairing = pairing, currentPairing.sessionId == session.id {
            let refreshedPairing = CompanionPairingURLResolver.payload(
                currentPairing,
                refreshedBy: session
            )
            if refreshedPairing.expiresAt != currentPairing.expiresAt
                || refreshedPairing.capabilities != currentPairing.capabilities
            {
                pairing = refreshedPairing
                persistPairing()
                companionDebugLog(
                    "CompanionAppModel",
                    "applyPairingSessionState refreshed local pairing reason=\(reason) expiresAt=\(session.expiresAt)"
                )
            }
        }
        applyRemoteSourceStates(session.sourceStates)
    }

    private func sourceNeedsInteractiveReconciliation(_ source: CompanionSourceKey) -> Bool {
        switch source {
        case .health:
            return healthSyncEnabled && healthAccessStatus == .notSet
        case .movement:
            return movementStore.trackingEnabled
                && (movementStore.locationPermissionStatus == "not_determined"
                    || movementStore.locationPermissionStatus == "denied"
                    || movementStore.locationPermissionStatus == "restricted"
                    || movementStore.backgroundTrackingReady == false)
        case .screenTime:
            return screenTimeStore.enabled == false || screenTimeStore.authorizationStatus != "approved"
        }
    }

    private func scheduleRemoteSourceReconciliation(reason: String) {
        guard pendingRemoteSourceReconciliation.isEmpty == false else {
            return
        }
        remoteSourceReconciliationTask?.cancel()
        remoteSourceReconciliationTask = Task { [weak self] in
            await self?.reconcileRemoteSourceStateIfNeeded(reason: reason)
        }
    }

    private func reconcileRemoteSourceStateIfNeeded(reason: String) async {
        guard pendingRemoteSourceReconciliation.isEmpty == false else {
            return
        }
        guard canPresentPermissionPrompts else {
            let pendingLabels = pendingRemoteSourceReconciliation
                .map(\.rawValue)
                .joined(separator: ",")
            companionDebugLog(
                "CompanionAppModel",
                "reconcileRemoteSourceStateIfNeeded deferred reason=\(reason) pending=\(pendingLabels)"
            )
            return
        }

        let sources = CompanionSourceKey.allCases.filter {
            pendingRemoteSourceReconciliation.contains($0)
        }
        guard sources.isEmpty == false else {
            return
        }

        let sourceLabels = sources.map(\.rawValue).joined(separator: ",")
        companionDebugLog(
            "CompanionAppModel",
            "reconcileRemoteSourceStateIfNeeded start reason=\(reason) sources=\(sourceLabels)"
        )

        var shouldSync = false
        for source in sources {
            guard pendingRemoteSourceReconciliation.contains(source) else {
                continue
            }
            applyLocalSourceEnabledState(source, enabled: true)
            switch source {
            case .health:
                await requestHealthPermissions()
            case .movement:
                requestMovementPermissions()
            case .screenTime:
                await screenTimeStore.enableAndAuthorize()
            }
            await pushCurrentSourceState(source)
            pendingRemoteSourceReconciliation.remove(source)
            shouldSync = true
        }

        refreshSyncState()
        if shouldSync && hasAnyEnabledSource {
            _ = await performSync(trigger: "remote \(reason)")
        }
    }

    private func pushCurrentSourceState(_ source: CompanionSourceKey) async {
        guard let pairing else {
            return
        }
        do {
            let state: CompanionSourceState
            switch source {
            case .health:
                state = currentSourceStates.health
            case .movement:
                state = currentSourceStates.movement
            case .screenTime:
                state = currentSourceStates.screenTime
            }
            let session = try await syncClient.updateSourceState(
                payload: pairing,
                source: source.rawValue,
                desiredEnabled: state.desiredEnabled,
                appliedEnabled: state.appliedEnabled,
                authorizationStatus: state.authorizationStatus,
                syncEligible: state.syncEligible,
                lastObservedAt: state.lastObservedAt,
                metadata: state.metadata.values
            )
            applyPairingSessionState(session, reason: "source-state-\(source.rawValue)")
        } catch {
            companionDebugLog(
                "CompanionAppModel",
                "pushCurrentSourceState failed source=\(source.rawValue) error=\(error.localizedDescription)"
            )
        }
    }

    private func pushAllCurrentSourceStatesIfNeeded() async {
        guard pairing != nil else {
            return
        }
        for source in CompanionSourceKey.allCases {
            await pushCurrentSourceState(source)
        }
    }
}

private struct PersistedSyncReport: Codable {
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

    private enum CodingKeys: String, CodingKey {
        case syncedAt
        case sleepSessions
        case sleepNights
        case sleepSegments
        case sleepRawRecords
        case workouts
        case createdCount
        case updatedCount
        case mergedCount
        case movementStays
        case movementTrips
        case movementKnownPlaces
        case vitalsDaySummaries
        case vitalsMetricEntries
        case screenTimeDaySummaries
        case screenTimeHourlySegments
        case screenTimeTotalActivitySeconds
    }

    init(report: SyncReport) {
        syncedAt = report.syncedAt
        sleepSessions = report.sleepSessions
        sleepNights = report.sleepNights
        sleepSegments = report.sleepSegments
        sleepRawRecords = report.sleepRawRecords
        workouts = report.workouts
        createdCount = report.createdCount
        updatedCount = report.updatedCount
        mergedCount = report.mergedCount
        movementStays = report.movementStays
        movementTrips = report.movementTrips
        movementKnownPlaces = report.movementKnownPlaces
        vitalsDaySummaries = report.vitalsDaySummaries
        vitalsMetricEntries = report.vitalsMetricEntries
        screenTimeDaySummaries = report.screenTimeDaySummaries
        screenTimeHourlySegments = report.screenTimeHourlySegments
        screenTimeTotalActivitySeconds = report.screenTimeTotalActivitySeconds
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        syncedAt = try container.decode(Date.self, forKey: .syncedAt)
        sleepSessions = try container.decode(Int.self, forKey: .sleepSessions)
        sleepNights = try container.decodeIfPresent(Int.self, forKey: .sleepNights) ?? sleepSessions
        sleepSegments = try container.decodeIfPresent(Int.self, forKey: .sleepSegments) ?? 0
        sleepRawRecords = try container.decodeIfPresent(Int.self, forKey: .sleepRawRecords) ?? 0
        workouts = try container.decode(Int.self, forKey: .workouts)
        createdCount = try container.decode(Int.self, forKey: .createdCount)
        updatedCount = try container.decode(Int.self, forKey: .updatedCount)
        mergedCount = try container.decode(Int.self, forKey: .mergedCount)
        movementStays = try container.decodeIfPresent(Int.self, forKey: .movementStays) ?? 0
        movementTrips = try container.decodeIfPresent(Int.self, forKey: .movementTrips) ?? 0
        movementKnownPlaces = try container.decodeIfPresent(Int.self, forKey: .movementKnownPlaces) ?? 0
        vitalsDaySummaries = try container.decodeIfPresent(Int.self, forKey: .vitalsDaySummaries) ?? 0
        vitalsMetricEntries = try container.decodeIfPresent(Int.self, forKey: .vitalsMetricEntries) ?? 0
        screenTimeDaySummaries = try container.decodeIfPresent(Int.self, forKey: .screenTimeDaySummaries) ?? 0
        screenTimeHourlySegments = try container.decodeIfPresent(Int.self, forKey: .screenTimeHourlySegments) ?? 0
        screenTimeTotalActivitySeconds = try container.decodeIfPresent(Int.self, forKey: .screenTimeTotalActivitySeconds) ?? 0
    }

    var asSyncReport: SyncReport {
        SyncReport(
            syncedAt: syncedAt,
            sleepSessions: sleepSessions,
            sleepNights: sleepNights,
            sleepSegments: sleepSegments,
            sleepRawRecords: sleepRawRecords,
            workouts: workouts,
            createdCount: createdCount,
            updatedCount: updatedCount,
            mergedCount: mergedCount,
            movementStays: movementStays,
            movementTrips: movementTrips,
            movementKnownPlaces: movementKnownPlaces,
            vitalsDaySummaries: vitalsDaySummaries,
            vitalsMetricEntries: vitalsMetricEntries,
            screenTimeDaySummaries: screenTimeDaySummaries,
            screenTimeHourlySegments: screenTimeHourlySegments,
            screenTimeTotalActivitySeconds: screenTimeTotalActivitySeconds
        )
    }
}
