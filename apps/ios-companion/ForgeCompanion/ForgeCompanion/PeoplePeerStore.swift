import Foundation

@MainActor
final class PeoplePeerStore: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case offline
        case failed
    }

    enum SecureEnrollmentState: Equatable {
        case unavailable
        case required
        case enrolling
        case enrolled
    }

    private enum RetryAction {
        case enroll
        case load
        case detail(String)
        case checkReplay
        case submitInvite
        case recordReplay
        case confirmPairing(String)
        case createInvitation(label: String, idempotencyKey: String)
        case refreshOutgoingInvitation
        case cancelOutgoingInvitation
        case requestDecision(id: String, accept: Bool)
    }

    private struct ConfigurationKey: Equatable {
        let sessionId: String?
        let pairingToken: String?
        let apiBaseURL: String?
        let ownerUserId: String?
    }

    private struct OutgoingInvitationOperation {
        let label: String
        let idempotencyKey: String
    }

    private enum WatchPinRetryAction {
        case refresh
        case pin(personId: String)
        case unpin(pinId: String, personId: String)
    }

    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var secureEnrollmentState: SecureEnrollmentState = .unavailable
    @Published private(set) var relationships: [PeerRelationship] = []
    @Published private(set) var requests: [PeerPendingRequest] = []
    @Published private(set) var selectedRelationship: PeerRelationship?
    @Published private(set) var devices: [PeerDevice] = []
    @Published private(set) var grants: [PeerGrant] = []
    @Published private(set) var diagnostics: [PeerDiagnostic] = []
    @Published private(set) var syncStatus: PeerSyncStatus?
    @Published private(set) var grantReview: PeerGrantReview?
    @Published private(set) var peerCoreStatus: PeerPresenceStatusEnvelope.PeerCore?
    @Published private(set) var authorizedOperations: Set<String> = []
    @Published private(set) var lastUpdatedAt: Date?
    @Published private(set) var operationInFlight = false
    @Published private(set) var outgoingInvitationStatus: PeerInvitationStatus?
    @Published var errorMessage: String?
    @Published var pairingReview: PeerPairingReview?
    @Published var outgoingInvitation: PeerInviteQREnvelope?
    @Published var managementRequested = false
    @Published private(set) var resumablePairingId: String?
    @Published private(set) var watchGlance: ForgeWatchPeopleGlanceSnapshot
    @Published private(set) var selectedWatchPinId: String?
    @Published private(set) var watchPinErrorMessage: String?
    @Published private(set) var watchPinOperationInFlight = false

    var canRetry: Bool { retryAction != nil }

    var outgoingInvitationIsDisplayable: Bool {
        guard let invitation = outgoingInvitation?.invitation else { return false }
        if let status = outgoingInvitationStatus {
            return status.isActive && (PeerDateParser.date(from: status.expiresAt) ?? .distantPast) > now()
        }
        return (PeerDateParser.date(from: invitation.expiresAt) ?? .distantPast) > now()
    }

    var approvedRemoteDeviceIds: [String] {
        devices
            .filter { $0.principalRole == "remote" && $0.status == "approved" }
            .map(\.deviceId)
            .sorted()
    }

    var resyncProjectionIds: [String] {
        var seen: Set<String> = []
        return grants
            .flatMap(\.rules)
            .filter { $0.effect == "allow" && seen.insert($0.projectionId).inserted }
            .prefix(8)
            .map(\.projectionId)
    }

    let foregroundRefreshSeconds: Int

    private let client: PeerAPIClient
    private let replayLedger: PeerReplayLedger
    private let reviewVault: PeerPairingReviewVault
    private let watchPinClient: PeopleWatchPinClient
    private let now: () -> Date
    private let pollingNanoseconds: UInt64
    private var pairing: PairingPayload?
    private var ownerUserId: String?
    private var configurationKey: ConfigurationKey?
    private var retryAction: RetryAction?
    private var outgoingOperation: OutgoingInvitationOperation?
    private var generation: UInt64 = 0
    private var ownedTasks: [UUID: Task<Void, Never>] = [:]
    private var pollingTask: Task<Void, Never>?
    private var managementVisible = false
    private var foregroundActive = true
    private var operationCount = 0
    private var detailTargetId: String?
    private var watchPins: [PeopleEntityNavigationItem] = []
    private var watchPinsByPersonId: [String: PeopleEntityNavigationItem] = [:]
    private var watchPinRetryAction: WatchPinRetryAction?
    private var watchRelay: ((ForgeWatchPeopleGlanceSnapshot) -> Void)?
#if DEBUG
    private var didApplyUITestFixture = false
#endif

    init(
        client: PeerAPIClient = PeerAPIClient(),
        replayLedger: PeerReplayLedger = PeerReplayLedger(),
        reviewVault: PeerPairingReviewVault = PeerPairingReviewVault(),
        watchPinClient: PeopleWatchPinClient? = nil,
        now: @escaping () -> Date = Date.init,
        foregroundRefreshSeconds: Int = 15
    ) {
        self.client = client
        self.replayLedger = replayLedger
        self.reviewVault = reviewVault
        self.watchPinClient = watchPinClient ?? PeopleWatchPinClient()
        self.now = now
        self.watchGlance = .chooseOnIPhone(
            generatedAt: ISO8601DateFormatter().string(from: now())
        )
        self.foregroundRefreshSeconds = max(1, foregroundRefreshSeconds)
        pollingNanoseconds = UInt64(max(1, foregroundRefreshSeconds)) * 1_000_000_000
    }

    func configure(pairing: PairingPayload?, ownerUserId: String?) {
        let nextKey = Self.configurationKey(pairing: pairing, ownerUserId: ownerUserId)
        guard nextKey != configurationKey else {
            self.pairing = pairing
            self.ownerUserId = ownerUserId
#if DEBUG
            applyUITestFixtureIfNeeded()
#endif
            return
        }

        cancelOwnedWork()
        generation &+= 1
#if DEBUG
        didApplyUITestFixture = false
#endif
        configurationKey = nextKey
        self.pairing = pairing
        self.ownerUserId = ownerUserId
        relationships = []
        requests = []
        clearSelectedRelationship()
        peerCoreStatus = nil
        authorizedOperations = []
        loadState = .idle
        secureEnrollmentState = .unavailable
        lastUpdatedAt = nil
        operationCount = 0
        operationInFlight = false
        errorMessage = nil
        pairingReview = nil
        outgoingInvitation = nil
        outgoingInvitationStatus = nil
        grantReview = nil
        outgoingOperation = nil
        retryAction = nil
        resumablePairingId = nil
        managementRequested = false
        watchPins = []
        watchPinsByPersonId = [:]
        selectedWatchPinId = nil
        watchPinErrorMessage = nil
        watchPinOperationInFlight = false
        watchPinRetryAction = nil
        watchGlance = .chooseOnIPhone(
            generatedAt: ISO8601DateFormatter().string(from: now())
        )
        watchRelay?(watchGlance)

        if let context = vaultContext {
            do {
                resumablePairingId = try reviewVault.load(context: context)?.pairingId
            } catch {
                errorMessage = "Secure pairing recovery data is unreadable. It was preserved for recovery."
                loadState = .failed
            }
        }
        if let pairing, let ownerUserId {
            do {
                secureEnrollmentState = try client.hasSecureEnrollment(
                    pairing: pairing,
                    ownerUserId: ownerUserId
                ) ? .enrolled : .required
            } catch {
                secureEnrollmentState = .required
                errorMessage = PeerAPIError.map(error).userMessage
                loadState = .failed
            }
        }
#if DEBUG
        applyUITestFixtureIfNeeded()
#endif
        startPollingIfNeeded()
    }

    func managementDidAppear() {
        managementVisible = true
        startPollingIfNeeded()
    }

    func managementDidDisappear() {
        managementVisible = false
        pollingTask?.cancel()
        pollingTask = nil
    }

    func sceneDidBecomeActive() {
        foregroundActive = true
        if managementVisible {
            startPollingIfNeeded()
            Task { await load(showLoading: false) }
        } else {
            Task { await refreshWatchGlance() }
        }
    }

    func sceneDidLeaveForeground() {
        foregroundActive = false
        pollingTask?.cancel()
        pollingTask = nil
    }

    func supports(_ route: PeerAPIRoute) -> Bool {
        let authorized = secureEnrollmentState == .enrolled &&
            authorizedOperations.contains(route.rawValue) &&
            (route.requiresHumanApproval == false ||
                (authorizedOperations.contains(PeerAPIRoute.createPeerHumanPresenceOptions.rawValue) &&
                    authorizedOperations.contains(PeerAPIRoute.verifyPeerHumanPresence.rawValue)))
        if route == .acceptScannedPeerPairing {
            return authorized && peerCoreStatus?.localDeviceId?.isEmpty == false
        }
        return authorized
    }

    func configureWatchRelay(
        _ relay: @escaping (ForgeWatchPeopleGlanceSnapshot) -> Void
    ) {
        watchRelay = relay
        relay(watchGlance)
    }

    func watchPin(for relationship: PeerRelationship) -> PeopleEntityNavigationItem? {
        guard let personId = relationship.localPersonId else { return nil }
#if DEBUG
        if watchPinUITestFixtureState != nil {
            return watchPinsByPersonId[personId]
        }
#endif
        guard relationship.ownerUserId == ownerUserId else { return nil }
        return watchPinsByPersonId[personId]
    }

    func isSelectedForWatch(_ relationship: PeerRelationship) -> Bool {
        watchPin(for: relationship)?.pinId == selectedWatchPinId
    }

    func refreshWatchGlance() async {
#if DEBUG
        if watchPinUITestFixtureState != nil {
            applyUITestFixtureIfNeeded()
            return
        }
#endif
        await runOwned { [weak self] capturedGeneration in
            await self?.performStandaloneWatchGlanceRefresh(generation: capturedGeneration)
        }
    }

    func chooseForWatch(_ relationship: PeerRelationship) async {
        guard let personId = relationship.localPersonId else {
            watchPinErrorMessage = PeopleWatchPinError.targetUnavailable.userMessage
            return
        }
        await runOwned { [weak self] capturedGeneration in
            await self?.performPinPerson(personId: personId, generation: capturedGeneration)
        }
    }

    func removeFromWatch(_ relationship: PeerRelationship) async {
        guard let personId = relationship.localPersonId,
              let pinId = watchPin(for: relationship)?.pinId
        else {
            watchPinErrorMessage = PeopleWatchPinError.targetUnavailable.userMessage
            return
        }
        await runOwned { [weak self] capturedGeneration in
            await self?.performUnpinPerson(
                pinId: pinId,
                personId: personId,
                generation: capturedGeneration
            )
        }
    }

    func retryWatchPinAction() async {
        let action = watchPinRetryAction ?? .refresh
        await runOwned { [weak self] capturedGeneration in
            guard let self else { return }
            switch action {
            case .refresh:
                await self.performStandaloneWatchGlanceRefresh(generation: capturedGeneration)
            case .pin(let personId):
                await self.performPinPerson(personId: personId, generation: capturedGeneration)
            case .unpin(let pinId, let personId):
                await self.performUnpinPerson(
                    pinId: pinId,
                    personId: personId,
                    generation: capturedGeneration
                )
            }
        }
    }

    func handleDeepLink(_ url: URL) {
        guard PeerDeepLinkDestination.parse(url) == .people else { return }
        managementRequested = true
    }

    func consumeManagementRequest() -> Bool {
        guard managementRequested else { return false }
        managementRequested = false
        return true
    }

    @discardableResult
    func stageScannedInvitation(_ text: String) -> Bool {
        do {
            let envelope = try PeerInviteQREnvelope.decode(text, now: now())
            var review = PeerPairingReview.scanned(envelope, now: now())
            do {
                if try replayLedger.contains(invitationId: envelope.invitation.id, now: now()) {
                    review.stage = .replayed
                    pairingReview = review
                    errorMessage = PeerAPIError.replayed.userMessage
                    return false
                }
            } catch {
                review.stage = .failed("Secure replay history is unreadable. No peer action was sent.")
                pairingReview = review
                errorMessage = "Secure replay history is unreadable. No peer action was sent."
                retryAction = .checkReplay
                return true
            }
            pairingReview = review
            errorMessage = nil
            retryAction = nil
            if let context = vaultContext {
                do {
                    try reviewVault.save(review, context: context)
                } catch {
                    errorMessage = "Secure review storage is unavailable. Continue will retry without sending first."
                    retryAction = .submitInvite
                }
            }
            return true
        } catch PeerInviteValidationError.expired {
            errorMessage = PeerAPIError.expired.userMessage
        } catch PeerInviteValidationError.wrongKindOrVersion {
            errorMessage = "This QR is not a versioned Forge peer invitation."
        } catch {
            errorMessage = "This Forge peer invitation is invalid."
        }
        return false
    }

    func closePairingReview() {
        pairingReview = nil
        switch retryAction {
        case .checkReplay, .submitInvite, .recordReplay, .confirmPairing(_):
            retryAction = nil
        default:
            break
        }
        errorMessage = nil
    }

    func load(showLoading: Bool = true) async {
#if DEBUG
        if watchPinUITestFixtureState != nil {
            applyUITestFixtureIfNeeded()
            return
        }
#endif
        await runOwned { [weak self] capturedGeneration in
            await self?.performLoad(generation: capturedGeneration, showLoading: showLoading)
        }
    }

    func enrollCompanion() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performSecureEnrollment(generation: capturedGeneration)
        }
    }

    func loadDetail(relationshipId: String, showLoading: Bool = true) async {
        detailTargetId = relationshipId
#if DEBUG
        if applyWatchPinDetailUITestFixtureIfNeeded(relationshipId: relationshipId) {
            return
        }
#endif
        await runOwned { [weak self] capturedGeneration in
            await self?.performLoadDetail(
                relationshipId: relationshipId,
                generation: capturedGeneration,
                showLoading: showLoading
            )
        }
    }

    func clearSelectedRelationship() {
        detailTargetId = nil
        selectedRelationship = nil
        devices = []
        grants = []
        diagnostics = []
        syncStatus = nil
        grantReview = nil
    }

    func submitScannedInvitationForReview() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performSubmitScannedInvitation(generation: capturedGeneration)
        }
    }

    func confirmPairing(personName: String) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performConfirmPairing(
                personName: personName,
                generation: capturedGeneration
            )
        }
    }

    func createInvitation(label: String) async {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedLabel.isEmpty == false else {
            errorMessage = "Enter a label for the peer invitation."
            return
        }
        let operation: OutgoingInvitationOperation
        if let current = outgoingOperation, current.label == trimmedLabel,
           outgoingInvitation == nil
        {
            operation = current
        } else {
            operation = OutgoingInvitationOperation(
                label: trimmedLabel,
                idempotencyKey: "peer-invite-\(UUID().uuidString.lowercased())"
            )
            outgoingOperation = operation
        }
        await runOwned { [weak self] capturedGeneration in
            await self?.performCreateInvitation(operation, generation: capturedGeneration)
        }
    }

    func refreshOutgoingInvitation() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performRefreshOutgoingInvitation(generation: capturedGeneration)
        }
    }

    func cancelOutgoingInvitation() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performCancelOutgoingInvitation(generation: capturedGeneration)
        }
    }

    func decideRequest(_ request: PeerPendingRequest, accept: Bool) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performRequestDecision(
                request,
                accept: accept,
                generation: capturedGeneration
            )
        }
    }

    func mutateDevice(_ device: PeerDevice, approve: Bool) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performMutateDevice(
                device,
                approve: approve,
                generation: capturedGeneration
            )
        }
    }

    func revokeSelectedRelationship() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performRevokeSelectedRelationship(generation: capturedGeneration)
        }
    }

    func revokeGrant(_ grant: PeerGrant) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performRevokeGrant(grant, generation: capturedGeneration)
        }
    }

    func previewGrant(
        _ draft: PeerGrantDraft,
        countering grant: PeerGrant? = nil
    ) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performPreviewGrant(
                draft,
                countering: grant,
                generation: capturedGeneration
            )
        }
    }

    func submitGrantReview() async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performSubmitGrantReview(generation: capturedGeneration)
        }
    }

    func acceptGrant(_ grant: PeerGrant) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performAcceptGrant(grant, generation: capturedGeneration)
        }
    }

    func requestResync(projectionIds: [String]) async {
        await runOwned { [weak self] capturedGeneration in
            await self?.performRequestResync(
                projectionIds: projectionIds,
                generation: capturedGeneration
            )
        }
    }

    func clearGrantReview() {
        grantReview = nil
    }

    func retry() async {
        let action = retryAction
        switch action {
        case .enroll:
            await enrollCompanion()
        case .load:
            await load()
        case .detail(let id):
            await loadDetail(relationshipId: id)
        case .checkReplay:
            retryReplayCheck()
        case .submitInvite:
            if var review = pairingReview {
                review.stage = .scanned
                pairingReview = review
            }
            await submitScannedInvitationForReview()
        case .recordReplay:
            await retryReplayPersistence()
        case .confirmPairing(let name):
            if var review = pairingReview {
                review.stage = .verified
                pairingReview = review
            }
            await confirmPairing(personName: name)
        case .createInvitation(let label, let idempotencyKey):
            outgoingOperation = OutgoingInvitationOperation(
                label: label,
                idempotencyKey: idempotencyKey
            )
            await createInvitation(label: label)
        case .refreshOutgoingInvitation:
            await refreshOutgoingInvitation()
        case .cancelOutgoingInvitation:
            await cancelOutgoingInvitation()
        case .requestDecision(let id, let accept):
            guard let request = requests.first(where: { $0.id == id }) else {
                retryAction = .load
                await load()
                return
            }
            await decideRequest(request, accept: accept)
        case nil:
            break
        }
    }

    func canResume(_ request: PeerPendingRequest) -> Bool {
        request.kind == "pairing" && request.status == "pending" && request.id == resumablePairingId
    }

    func resume(_ request: PeerPendingRequest) {
        guard canResume(request), let context = vaultContext else {
            errorMessage = "This pending pairing cannot be resumed from this device."
            return
        }
        do {
            guard var stored = try reviewVault.load(context: context),
                  stored.pairingId == request.id
            else {
                errorMessage = "This pending pairing cannot be resumed from this device."
                return
            }
            guard let expiry = PeerDateParser.date(from: request.expiresAt), expiry > now() else {
                reviewVault.delete()
                resumablePairingId = nil
                errorMessage = PeerAPIError.expired.userMessage
                return
            }
            stored.ensureOperationIdentity(now: now())
            let resumed = stored.applying(request)
            try reviewVault.save(resumed, context: context)
            pairingReview = resumed
            errorMessage = nil
            retryAction = nil
        } catch {
            errorMessage = "Secure pairing recovery data is unavailable. It was not erased."
        }
    }

    private func retryReplayCheck() {
        guard var review = pairingReview, let context = vaultContext else { return }
        do {
            if try replayLedger.contains(invitationId: review.id, now: now()) {
                review.stage = .replayed
                pairingReview = review
                errorMessage = PeerAPIError.replayed.userMessage
                retryAction = nil
                return
            }
            review.stage = .scanned
            try reviewVault.save(review, context: context)
            pairingReview = review
            errorMessage = nil
            retryAction = nil
        } catch {
            errorMessage = "Secure replay history remains unavailable. No peer action was sent."
            retryAction = .checkReplay
        }
    }

    private func performLoad(generation: UInt64, showLoading: Bool) async {
        guard let pairing, let ownerUserId, isCurrent(generation) else {
            fail(.invalidConfiguration, retry: .load, generation: generation)
            return
        }
        if showLoading {
            loadState = .loading
        }
        errorMessage = nil
        do {
            guard try client.hasSecureEnrollment(
                pairing: pairing,
                ownerUserId: ownerUserId
            ) else {
                secureEnrollmentState = .required
                throw PeerAPIError.secureEnrollmentRequired
            }
            secureEnrollmentState = .enrolled
            let presence = try await client.presenceStatus(pairing: pairing)
            guard isCurrent(generation) else { return }
            let availability = presence.methods.companionConsent
            let identity = try client.identityStore.identity()
            guard
                availability.available,
                availability.protocolName == PeerCompanionSecurityContract.consentProtocol,
                availability.requestProtocol == PeerCompanionSecurityContract.requestProtocol,
                availability.deviceId == identity.deviceId,
                Set(availability.capabilities) == PeerCompanionSecurityContract.capabilities,
                Set(availability.scopes) == PeerCompanionSecurityContract.scopes,
                Set(availability.authorizedOperations) ==
                    PeerCompanionSecurityContract.authorizedOperations
            else {
                throw PeerAPIError.companionConsentUnavailable
            }

            let nextRelationships = try await fetchAllRelationships(
                pairing: pairing,
                generation: generation
            )
            guard isCurrent(generation) else { return }
            let nextRequests = try await fetchAllPendingRequests(
                pairing: pairing,
                generation: generation
            )
            guard isCurrent(generation) else { return }

            peerCoreStatus = presence.peerCore
            authorizedOperations = Set(availability.authorizedOperations)
            relationships = nextRelationships
            requests = nextRequests
            await performWatchGlanceRefresh(
                pairing: pairing,
                ownerUserId: ownerUserId,
                relationships: nextRelationships,
                generation: generation
            )
            guard isCurrent(generation) else { return }
            refreshResumableReview()
            if outgoingInvitation != nil {
                try await refreshOutgoingStatus(pairing: pairing, generation: generation)
                guard isCurrent(generation) else { return }
            }
            lastUpdatedAt = now()
            loadState = .loaded
            retryAction = nil
        } catch {
            guard isCurrent(generation) else { return }
            let mapped = PeerAPIError.map(error)
            if mapped == .secureEnrollmentRequired {
                secureEnrollmentState = .required
                fail(mapped, retry: nil, generation: generation)
            } else {
                fail(mapped, retry: .load, generation: generation)
            }
        }
    }

    private func performSecureEnrollment(generation: UInt64) async {
        guard let pairing, let ownerUserId, isCurrent(generation) else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        secureEnrollmentState = .enrolling
        errorMessage = nil
        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            secureEnrollmentState = .enrolled
            retryAction = nil
            await performLoad(generation: generation, showLoading: true)
        } catch {
            guard isCurrent(generation) else { return }
            secureEnrollmentState = .required
            fail(PeerAPIError.map(error), retry: .enroll, generation: generation)
        }
    }

    private func performLoadDetail(
        relationshipId: String,
        generation: UInt64,
        showLoading: Bool
    ) async {
        guard let pairing, isCurrent(generation), detailTargetId == relationshipId else {
            fail(.invalidConfiguration, retry: .detail(relationshipId), generation: generation)
            return
        }
        guard
            supports(.getPeerRelationship), supports(.listPeerDevices),
            supports(.listPeerGrants), supports(.getPeerDiagnostics),
            supports(.getPeerSyncStatus)
        else {
            fail(.companionConsentUnavailable, retry: nil, generation: generation)
            return
        }
        if showLoading {
            loadState = .loading
        }
        errorMessage = nil
        do {
            let detail = try await client.relationship(id: relationshipId, pairing: pairing)
            guard isCurrent(generation), detailTargetId == relationshipId else { return }
            let nextDevices = try await client.devices(
                relationshipId: relationshipId,
                pairing: pairing
            ).devices
            guard isCurrent(generation), detailTargetId == relationshipId else { return }
            let nextGrants = try await fetchAllGrants(
                relationshipId: relationshipId,
                pairing: pairing,
                generation: generation
            )
            guard isCurrent(generation), detailTargetId == relationshipId else { return }
            let nextDiagnostics = try await fetchAllDiagnostics(
                relationshipId: relationshipId,
                pairing: pairing,
                generation: generation
            )
            guard isCurrent(generation), detailTargetId == relationshipId else { return }
            let nextSync = try await client.syncStatus(
                relationshipId: relationshipId,
                pairing: pairing
            ).sync
            guard isCurrent(generation), detailTargetId == relationshipId else { return }

            selectedRelationship = detail.relationship
            devices = nextDevices
            grants = nextGrants
            diagnostics = nextDiagnostics
            syncStatus = nextSync
            lastUpdatedAt = now()
            loadState = .loaded
            retryAction = nil
        } catch {
            guard isCurrent(generation), detailTargetId == relationshipId else { return }
            fail(PeerAPIError.map(error), retry: .detail(relationshipId), generation: generation)
        }
    }

    private func performSubmitScannedInvitation(generation: UInt64) async {
        guard var review = pairingReview, let pairing, let ownerUserId,
              let context = vaultContext,
              let localPeerDeviceId = peerCoreStatus?.localDeviceId,
              localPeerDeviceId.isEmpty == false,
              isCurrent(generation)
        else {
            fail(.invalidConfiguration, retry: .submitInvite, generation: generation)
            return
        }
        guard let expiry = PeerDateParser.date(from: review.expiresAt), expiry > now() else {
            review.stage = .expired
            pairingReview = review
            fail(.expired, retry: nil, generation: generation)
            return
        }
        switch review.stage {
        case .scanned, .failed:
            break
        default:
            return
        }
        review.ensureOperationIdentity(now: now())
        do {
            try reviewVault.save(review, context: context)
        } catch {
            review.stage = .failed("Secure review storage failed. No peer action was sent.")
            pairingReview = review
            errorMessage = "Secure review storage failed. No peer action was sent."
            retryAction = .submitInvite
            return
        }
        review.stage = .submitting
        pairingReview = review
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response = try await client.acceptScannedInvitation(
                review: review,
                localPeerDeviceId: localPeerDeviceId,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            var verified = review.applying(response.request)
            do {
                try reviewVault.save(verified, context: context)
            } catch {
                verified.stage = .failed("The verified response is recoverable, but secure resume storage must be retried.")
                pairingReview = verified
                errorMessage = "Secure resume storage failed. Retry uses the same accepted operation."
                retryAction = .submitInvite
                return
            }
            do {
                try replayLedger.recordAccepted(invitationId: review.id, now: now())
            } catch {
                verified.stage = .failed("Secure replay protection must be retried before confirmation.")
                pairingReview = verified
                errorMessage = "Secure replay protection could not be saved."
                retryAction = .recordReplay
                return
            }
            pairingReview = verified
            resumablePairingId = verified.pairingId
            retryAction = nil
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            review.stage = peerError == .expired
                ? .expired
                : peerError == .replayed
                    ? .replayed
                    : .failed(peerError.userMessage)
            pairingReview = review
            fail(
                peerError,
                retry: peerError == .offline ? .submitInvite : nil,
                generation: generation
            )
        }
    }

    private func retryReplayPersistence() async {
        guard var review = pairingReview, let context = vaultContext else { return }
        do {
            try replayLedger.recordAccepted(invitationId: review.id, now: now())
            review.stage = .verified
            try reviewVault.save(review, context: context)
            pairingReview = review
            resumablePairingId = review.pairingId
            errorMessage = nil
            retryAction = nil
        } catch {
            errorMessage = "Secure replay protection remains unavailable."
            retryAction = .recordReplay
        }
    }

    private func performConfirmPairing(personName: String, generation: UInt64) async {
        guard var review = pairingReview, let pairing, let ownerUserId,
              let context = vaultContext, isCurrent(generation)
        else {
            fail(.invalidConfiguration, retry: .confirmPairing(personName), generation: generation)
            return
        }
        let trimmedName = personName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedName.isEmpty == false else {
            errorMessage = "Enter the Person name to create after confirmation."
            return
        }
        if let committedName = review.confirmationPersonName, committedName != trimmedName {
            errorMessage = "This confirmation was already prepared for \(committedName)."
            return
        }
        guard let expiry = PeerDateParser.date(from: review.expiresAt), expiry > now() else {
            review.stage = .expired
            pairingReview = review
            reviewVault.delete()
            resumablePairingId = nil
            fail(.expired, retry: nil, generation: generation)
            return
        }
        guard
            review.verificationPhrase?.isEmpty == false,
            review.transcriptHash?.isEmpty == false
        else {
            errorMessage = "Forge has not supplied the verification material required to confirm."
            return
        }
        review.ensureOperationIdentity(now: now())
        review.confirmationPersonName = trimmedName
        review.stage = .verified
        do {
            try reviewVault.save(review, context: context)
        } catch {
            errorMessage = "Secure confirmation storage failed. No confirmation was sent."
            retryAction = .confirmPairing(trimmedName)
            return
        }
        var confirming = review
        confirming.stage = .confirming
        pairingReview = confirming
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            _ = try await client.confirmPairing(
                review: review,
                personName: trimmedName,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            review.stage = .completed
            pairingReview = review
            reviewVault.delete()
            resumablePairingId = nil
            retryAction = nil
            await performLoad(generation: generation, showLoading: false)
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            review.stage = peerError == .expired ? .expired : .failed(peerError.userMessage)
            pairingReview = review
            fail(
                peerError,
                retry: peerError == .offline ? .confirmPairing(trimmedName) : nil,
                generation: generation
            )
        }
    }

    private func performCreateInvitation(
        _ operation: OutgoingInvitationOperation,
        generation: UInt64
    ) async {
        guard let pairing, let ownerUserId, isCurrent(generation), supports(.createPeerInvitation) else {
            fail(.companionConsentUnavailable, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response = try await client.createInvitation(
                label: operation.label,
                idempotencyKey: operation.idempotencyKey,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            outgoingInvitation = PeerInviteQREnvelope(invitation: response.invitation)
            outgoingOperation = nil
            retryAction = nil
            do {
                try await refreshOutgoingStatus(pairing: pairing, generation: generation)
            } catch {
                guard isCurrent(generation) else { return }
                errorMessage = "The invite was created, but its live status is temporarily unavailable."
                retryAction = .refreshOutgoingInvitation
            }
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline
                    ? .createInvitation(
                        label: operation.label,
                        idempotencyKey: operation.idempotencyKey
                    )
                    : nil,
                generation: generation
            )
        }
    }

    private func performRefreshOutgoingInvitation(generation: UInt64) async {
        guard let pairing, isCurrent(generation) else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        do {
            try await refreshOutgoingStatus(pairing: pairing, generation: generation)
            guard isCurrent(generation) else { return }
            errorMessage = nil
            retryAction = nil
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline ? .refreshOutgoingInvitation : nil,
                generation: generation
            )
        }
    }

    private func performCancelOutgoingInvitation(generation: UInt64) async {
        guard let pairing, let ownerUserId, isCurrent(generation),
              supports(.cancelPeerInvitation), outgoingInvitation != nil
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        do {
            if outgoingInvitationStatus == nil {
                try await refreshOutgoingStatus(pairing: pairing, generation: generation)
            }
            guard isCurrent(generation), let status = outgoingInvitationStatus else { return }
            guard status.isActive else {
                errorMessage = "This invitation is already \(status.status)."
                return
            }
            guard beginOperation(generation) else { return }
            defer { finishOperation(generation) }
            _ = try await client.cancelInvitation(
                status,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            outgoingInvitationStatus = PeerInvitationStatus(
                id: status.id,
                status: "canceled",
                fingerprint: status.fingerprint,
                protocolVersion: status.protocolVersion,
                transportKinds: status.transportKinds,
                failedAttemptCount: status.failedAttemptCount,
                maximumAttempts: status.maximumAttempts,
                expiresAt: status.expiresAt,
                claimedAt: status.claimedAt,
                consumedAt: status.consumedAt,
                canceledAt: ISO8601DateFormatter().string(from: now()),
                createdAt: status.createdAt,
                updatedAt: ISO8601DateFormatter().string(from: now())
            )
            errorMessage = nil
            retryAction = nil
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline ? .cancelOutgoingInvitation : nil,
                generation: generation
            )
        }
    }

    private func performRequestDecision(
        _ request: PeerPendingRequest,
        accept: Bool,
        generation: UInt64
    ) async {
        let route: PeerAPIRoute = accept ? .acceptPeerRequest : .rejectPeerRequest
        guard ["device", "grant"].contains(request.kind), request.status == "pending",
              let pairing, let ownerUserId, isCurrent(generation), supports(route)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            _ = try await client.decideRequest(
                request,
                accept: accept,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            await performLoad(generation: generation, showLoading: false)
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline
                    ? .requestDecision(id: request.id, accept: accept)
                    : nil,
                generation: generation
            )
        }
    }

    private func performMutateDevice(
        _ device: PeerDevice,
        approve: Bool,
        generation: UInt64
    ) async {
        let route: PeerAPIRoute = approve ? .approvePeerDevice : .removePeerDevice
        guard let relationship = selectedRelationship, let pairing, let ownerUserId,
              isCurrent(generation), supports(route)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            _ = try await client.mutateDevice(
                route: route,
                relationship: relationship,
                device: device,
                reason: approve
                    ? "Approved from Forge Companion"
                    : "Removed from Forge Companion",
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            await performLoadDetail(
                relationshipId: relationship.id,
                generation: generation,
                showLoading: false
            )
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline ? .detail(relationship.id) : nil,
                generation: generation
            )
        }
    }

    private func performRevokeSelectedRelationship(generation: UInt64) async {
        guard let relationship = selectedRelationship, let pairing, let ownerUserId,
              isCurrent(generation), supports(.revokePeerRelationship)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response = try await client.revokeRelationship(
                relationship,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            selectedRelationship = response.relationship
            await performLoad(generation: generation, showLoading: false)
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline ? .detail(relationship.id) : nil,
                generation: generation
            )
        }
    }

    private func performRevokeGrant(_ grant: PeerGrant, generation: UInt64) async {
        guard let pairing, let ownerUserId,
              let relationshipId = selectedRelationship?.id,
              let versionHash = grant.versionHash,
              isCurrent(generation), supports(.revokePeerGrant)
        else {
            errorMessage = "Reload this grant before revoking it."
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            _ = try await client.revokeGrant(
                grant,
                expectedVersionHash: versionHash,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation) else { return }
            await performLoadDetail(
                relationshipId: relationshipId,
                generation: generation,
                showLoading: false
            )
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            fail(
                peerError,
                retry: peerError == .offline ? .detail(relationshipId) : nil,
                generation: generation
            )
        }
    }

    private func performPreviewGrant(
        _ draft: PeerGrantDraft,
        countering grant: PeerGrant?,
        generation: UInt64
    ) async {
        guard let pairing, let ownerUserId, let relationship = selectedRelationship,
              isCurrent(generation), supports(.previewPeerGrant)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        if let grant {
            guard grant.relationshipId == relationship.id,
                  let versionHash = grant.versionHash,
                  ["proposed", "countered"].contains(grant.status)
            else {
                fail(.invalidConfiguration, retry: nil, generation: generation)
                return
            }
            grantReview = nil
            guard beginOperation(generation) else { return }
            defer { finishOperation(generation) }
            errorMessage = nil
            do {
                let preview = try await client.previewGrant(
                    draft: draft,
                    relationship: relationship,
                    pairing: pairing,
                    ownerUserId: ownerUserId
                ).preview
                guard isCurrent(generation),
                      preview.relationshipVersion == relationship.updatedAt
                else { return }
                grantReview = PeerGrantReview(
                    intent: .counter(grantId: grant.id, versionHash: versionHash),
                    draft: draft,
                    preview: preview
                )
            } catch {
                guard isCurrent(generation) else { return }
                fail(PeerAPIError.map(error), retry: nil, generation: generation)
            }
            return
        }

        grantReview = nil
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let preview = try await client.previewGrant(
                draft: draft,
                relationship: relationship,
                pairing: pairing,
                ownerUserId: ownerUserId
            ).preview
            guard isCurrent(generation),
                  preview.relationshipVersion == relationship.updatedAt
            else { return }
            grantReview = PeerGrantReview(
                intent: .proposal(relationshipId: relationship.id),
                draft: draft,
                preview: preview
            )
        } catch {
            guard isCurrent(generation) else { return }
            fail(PeerAPIError.map(error), retry: nil, generation: generation)
        }
    }

    private func performSubmitGrantReview(generation: UInt64) async {
        guard let review = grantReview, let pairing, let ownerUserId,
              let relationship = selectedRelationship, isCurrent(generation)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response: PeerGrantMutationEnvelope
            switch review.intent {
            case .proposal(let relationshipId):
                guard relationshipId == relationship.id,
                      supports(.proposePeerGrant)
                else { throw PeerAPIError.invalidConfiguration }
                response = try await client.proposeGrant(
                    draft: review.draft,
                    preview: review.preview,
                    relationship: relationship,
                    pairing: pairing,
                    ownerUserId: ownerUserId
                )
            case .counter(let grantId, let versionHash):
                guard supports(.counterPeerGrant),
                      let grant = grants.first(where: {
                          $0.id == grantId && $0.versionHash == versionHash
                      })
                else { throw PeerAPIError.invalidConfiguration }
                response = try await client.counterGrant(
                    grant,
                    draft: review.draft,
                    preview: review.preview,
                    relationship: relationship,
                    pairing: pairing,
                    ownerUserId: ownerUserId
                )
            }
            guard isCurrent(generation), response.versionHash.count == 64 else {
                throw PeerAPIError.invalidResponse
            }
            grantReview = nil
            await performLoadDetail(
                relationshipId: relationship.id,
                generation: generation,
                showLoading: false
            )
        } catch {
            guard isCurrent(generation) else { return }
            fail(PeerAPIError.map(error), retry: nil, generation: generation)
        }
    }

    private func performAcceptGrant(_ grant: PeerGrant, generation: UInt64) async {
        guard let pairing, let ownerUserId, let relationship = selectedRelationship,
              grant.relationshipId == relationship.id,
              grant.canReviewIncomingProposal,
              isCurrent(generation), supports(.acceptPeerGrant)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response = try await client.acceptGrant(
                grant,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation), response.versionHash.count == 64 else {
                throw PeerAPIError.invalidResponse
            }
            await performLoadDetail(
                relationshipId: relationship.id,
                generation: generation,
                showLoading: false
            )
        } catch {
            guard isCurrent(generation) else { return }
            fail(PeerAPIError.map(error), retry: nil, generation: generation)
        }
    }

    private func performRequestResync(
        projectionIds: [String],
        generation: UInt64
    ) async {
        guard let pairing, let ownerUserId, let relationship = selectedRelationship,
              isCurrent(generation), supports(.requestPeerResync)
        else {
            fail(.invalidConfiguration, retry: nil, generation: generation)
            return
        }
        guard beginOperation(generation) else { return }
        defer { finishOperation(generation) }
        errorMessage = nil
        do {
            let response = try await client.requestResync(
                relationship: relationship,
                projectionIds: projectionIds,
                pairing: pairing,
                ownerUserId: ownerUserId
            )
            guard isCurrent(generation), response.requested else {
                throw PeerAPIError.invalidResponse
            }
            await performLoadDetail(
                relationshipId: relationship.id,
                generation: generation,
                showLoading: false
            )
        } catch {
            guard isCurrent(generation) else { return }
            fail(PeerAPIError.map(error), retry: nil, generation: generation)
        }
    }

    private func performStandaloneWatchGlanceRefresh(generation: UInt64) async {
        guard let pairing, let ownerUserId, isCurrent(generation) else {
            setWatchPinFailure(.invalidConfiguration, retry: .refresh, generation: generation)
            return
        }
        do {
            let nextRelationships = try await fetchAllRelationships(
                pairing: pairing,
                generation: generation
            )
            guard isCurrent(generation) else { return }
            await performWatchGlanceRefresh(
                pairing: pairing,
                ownerUserId: ownerUserId,
                relationships: nextRelationships,
                generation: generation
            )
        } catch {
            guard isCurrent(generation) else { return }
            let peerError = PeerAPIError.map(error)
            watchPinErrorMessage = peerError.userMessage
            watchPinRetryAction = .refresh
        }
    }

    private func performWatchGlanceRefresh(
        pairing: PairingPayload,
        ownerUserId: String,
        relationships: [PeerRelationship],
        generation: UInt64
    ) async {
        do {
            let envelope = try await watchPinClient.listPins(pairing: pairing)
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            applyWatchPins(
                envelope.pinned,
                relationships: relationships,
                ownerUserId: ownerUserId,
                generatedAt: envelope.generatedAt
            )
            if envelope.pinnedTotal > envelope.pinned.count,
               selectedWatchPinId == nil
            {
                watchPinErrorMessage = "Forge returned a truncated pin set. Person selection needs the owner-scoped Person pin query."
                watchPinRetryAction = .refresh
            } else {
                watchPinErrorMessage = nil
                watchPinRetryAction = nil
            }
        } catch {
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            setWatchPinFailure(
                PeopleWatchPinError.map(error),
                retry: .refresh,
                generation: generation
            )
        }
    }

    private func performPinPerson(personId: String, generation: UInt64) async {
        guard let pairing, let ownerUserId, isCurrent(generation),
              watchPinOperationInFlight == false,
              relationships.contains(where: {
                  $0.ownerUserId == ownerUserId &&
                      $0.localPersonId == personId &&
                      $0.status == "active"
              })
        else {
            setWatchPinFailure(.targetUnavailable, retry: nil, generation: generation)
            return
        }
        watchPinOperationInFlight = true
        defer {
            if isCurrent(generation) { watchPinOperationInFlight = false }
        }
        do {
            let pin = try await watchPinClient.pinPerson(
                personId: personId,
                ownerUserId: ownerUserId,
                pairing: pairing
            )
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            guard pin.entityType == "person", pin.entityId == personId,
                  pin.ownerUserId == ownerUserId, pin.availability == "available",
                  pin.pinId?.isEmpty == false
            else {
                throw PeopleWatchPinError.invalidResponse
            }
            var nextPins = watchPins.filter {
                !($0.ownerUserId == ownerUserId &&
                    $0.entityType == "person" &&
                    $0.entityId == personId)
            }
            nextPins.append(pin)
            applyWatchPins(
                nextPins,
                relationships: relationships,
                ownerUserId: ownerUserId,
                generatedAt: ISO8601DateFormatter().string(from: now())
            )
            await performWatchGlanceRefresh(
                pairing: pairing,
                ownerUserId: ownerUserId,
                relationships: relationships,
                generation: generation
            )
        } catch {
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            setWatchPinFailure(
                PeopleWatchPinError.map(error),
                retry: .pin(personId: personId),
                generation: generation
            )
        }
    }

    private func performUnpinPerson(
        pinId: String,
        personId: String,
        generation: UInt64
    ) async {
        guard let pairing, let ownerUserId, isCurrent(generation),
              watchPinOperationInFlight == false,
              watchPinsByPersonId[personId]?.pinId == pinId
        else {
            setWatchPinFailure(.targetUnavailable, retry: nil, generation: generation)
            return
        }
        watchPinOperationInFlight = true
        defer {
            if isCurrent(generation) { watchPinOperationInFlight = false }
        }
        do {
            try await watchPinClient.unpin(pinId: pinId, pairing: pairing)
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            let nextPins = watchPins.filter { $0.pinId != pinId }
            applyWatchPins(
                nextPins,
                relationships: relationships,
                ownerUserId: ownerUserId,
                generatedAt: ISO8601DateFormatter().string(from: now())
            )
            await performWatchGlanceRefresh(
                pairing: pairing,
                ownerUserId: ownerUserId,
                relationships: relationships,
                generation: generation
            )
        } catch {
            guard isCurrent(generation), self.ownerUserId == ownerUserId else { return }
            setWatchPinFailure(
                PeopleWatchPinError.map(error),
                retry: .unpin(pinId: pinId, personId: personId),
                generation: generation
            )
        }
    }

    private func applyWatchPins(
        _ pins: [PeopleEntityNavigationItem],
        relationships: [PeerRelationship],
        ownerUserId: String,
        generatedAt: String
    ) {
        let resolution = PeopleWatchGlanceSelector.resolve(
            pins: pins,
            relationships: relationships,
            ownerUserId: ownerUserId,
            generatedAt: generatedAt
        )
        watchPins = pins
        watchPinsByPersonId = resolution.pinsByPersonId
        selectedWatchPinId = resolution.selectedPinId
        watchGlance = resolution.snapshot
        watchRelay?(resolution.snapshot)
    }

    private func setWatchPinFailure(
        _ error: PeopleWatchPinError,
        retry: WatchPinRetryAction?,
        generation: UInt64
    ) {
        guard isCurrent(generation) else { return }
        watchPinErrorMessage = error.userMessage
        watchPinRetryAction = retry
    }

    private func fetchAllRelationships(
        pairing: PairingPayload,
        generation: UInt64
    ) async throws -> [PeerRelationship] {
        var result: [PeerRelationship] = []
        var cursor: String?
        var seen: Set<String> = []
        for _ in 0..<100 {
            let page = try await client.listRelationships(pairing: pairing, cursor: cursor)
            guard isCurrent(generation) else { throw CancellationError() }
            result.append(contentsOf: page.relationships)
            guard page.page.hasMore else { return result }
            guard let next = page.page.nextCursor, seen.insert(next).inserted else {
                throw PeerAPIError.invalidResponse
            }
            cursor = next
        }
        throw PeerAPIError.invalidResponse
    }

    private func fetchAllPendingRequests(
        pairing: PairingPayload,
        generation: UInt64
    ) async throws -> [PeerPendingRequest] {
        var result: [PeerPendingRequest] = []
        var cursor: String?
        var seen: Set<String> = []
        for _ in 0..<100 {
            let page = try await client.listRequests(pairing: pairing, cursor: cursor)
            guard isCurrent(generation) else { throw CancellationError() }
            result.append(contentsOf: page.requests)
            guard page.page.hasMore else { return result }
            guard let next = page.page.nextCursor, seen.insert(next).inserted else {
                throw PeerAPIError.invalidResponse
            }
            cursor = next
        }
        throw PeerAPIError.invalidResponse
    }

    private func fetchAllGrants(
        relationshipId: String,
        pairing: PairingPayload,
        generation: UInt64
    ) async throws -> [PeerGrant] {
        var result: [PeerGrant] = []
        var cursor: String?
        var seen: Set<String> = []
        for _ in 0..<100 {
            let page = try await client.grants(
                relationshipId: relationshipId,
                pairing: pairing,
                cursor: cursor
            )
            guard isCurrent(generation) else { throw CancellationError() }
            result.append(contentsOf: page.grants)
            guard page.page.hasMore else { return result }
            guard let next = page.page.nextCursor, seen.insert(next).inserted else {
                throw PeerAPIError.invalidResponse
            }
            cursor = next
        }
        throw PeerAPIError.invalidResponse
    }

    private func fetchAllDiagnostics(
        relationshipId: String,
        pairing: PairingPayload,
        generation: UInt64
    ) async throws -> [PeerDiagnostic] {
        var result: [PeerDiagnostic] = []
        var cursor: String?
        var seen: Set<String> = []
        for _ in 0..<100 {
            let page = try await client.diagnostics(
                relationshipId: relationshipId,
                pairing: pairing,
                cursor: cursor
            )
            guard isCurrent(generation) else { throw CancellationError() }
            result.append(contentsOf: page.diagnostics)
            guard page.page.hasMore else { return result }
            guard let next = page.page.nextCursor, seen.insert(next).inserted else {
                throw PeerAPIError.invalidResponse
            }
            cursor = next
        }
        throw PeerAPIError.invalidResponse
    }

    private func refreshOutgoingStatus(
        pairing: PairingPayload,
        generation: UInt64
    ) async throws {
        guard let invitationId = outgoingInvitation?.id else { return }
        let response = try await client.invitationStatus(
            invitationId: invitationId,
            pairing: pairing
        )
        guard isCurrent(generation), outgoingInvitation?.id == invitationId else { return }
        outgoingInvitationStatus = response.invitation
    }

    private func refreshResumableReview() {
        guard let context = vaultContext else {
            resumablePairingId = nil
            return
        }
        do {
            guard let stored = try reviewVault.load(context: context),
                  let pairingId = stored.pairingId
            else {
                resumablePairingId = nil
                return
            }
            resumablePairingId = pairingId
            if let pending = requests.first(where: { $0.id == pairingId }),
               let expiry = PeerDateParser.date(from: pending.expiresAt),
               expiry <= now()
            {
                reviewVault.delete()
                resumablePairingId = nil
            }
        } catch {
            errorMessage = "Secure pairing recovery data is unreadable. It was preserved for recovery."
        }
    }

    private func runOwned(
        _ operation: @escaping @MainActor (UInt64) async -> Void
    ) async {
        let id = UUID()
        let capturedGeneration = generation
        let task = Task { await operation(capturedGeneration) }
        ownedTasks[id] = task
        await task.value
        ownedTasks[id] = nil
    }

    private func startPollingIfNeeded() {
        guard managementVisible, foregroundActive, configurationKey != nil,
              secureEnrollmentState == .enrolled,
              pollingTask == nil
        else { return }
        let capturedGeneration = generation
        pollingTask = Task { [weak self] in
            while Task.isCancelled == false {
                do {
                    try await Task.sleep(nanoseconds: self?.pollingNanoseconds ?? 15_000_000_000)
                } catch {
                    return
                }
                guard let self, self.isCurrent(capturedGeneration),
                      self.managementVisible, self.foregroundActive
                else { return }
                await self.performLoad(generation: capturedGeneration, showLoading: false)
                guard self.isCurrent(capturedGeneration) else { return }
                if let relationshipId = self.detailTargetId {
                    await self.performLoadDetail(
                        relationshipId: relationshipId,
                        generation: capturedGeneration,
                        showLoading: false
                    )
                }
            }
        }
    }

    private func cancelOwnedWork() {
        for task in ownedTasks.values {
            task.cancel()
        }
        ownedTasks.removeAll()
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func beginOperation(_ generation: UInt64) -> Bool {
        guard isCurrent(generation) else { return false }
        operationCount += 1
        operationInFlight = true
        return true
    }

    private func finishOperation(_ generation: UInt64) {
        guard isCurrent(generation) else { return }
        operationCount = max(0, operationCount - 1)
        operationInFlight = operationCount > 0
    }

    private func isCurrent(_ capturedGeneration: UInt64) -> Bool {
        capturedGeneration == generation && Task.isCancelled == false
    }

    private func fail(
        _ error: PeerAPIError,
        retry: RetryAction?,
        generation capturedGeneration: UInt64
    ) {
        guard capturedGeneration == generation else { return }
        errorMessage = error.userMessage
        retryAction = retry
        loadState = error == .offline ? .offline : .failed
    }

    private var vaultContext: PeerPairingReviewVaultContext? {
        guard let pairing, let ownerUserId else { return nil }
        return PeerPairingReviewVaultContext(
            sessionId: pairing.sessionId,
            ownerUserId: ownerUserId,
            apiBaseURL: pairing.apiBaseUrl
        )
    }

    private static func configurationKey(
        pairing: PairingPayload?,
        ownerUserId: String?
    ) -> ConfigurationKey {
        ConfigurationKey(
            sessionId: pairing?.sessionId,
            pairingToken: pairing?.pairingToken,
            apiBaseURL: pairing?.apiBaseUrl,
            ownerUserId: ownerUserId
        )
    }

#if DEBUG
    private var watchPinUITestFixtureState: String? {
        guard
            let state = ProcessInfo.processInfo.environment["FORGE_UI_TEST_PEOPLE_WATCH_PIN_STATE"],
            ["pinned", "unpinned"].contains(state)
        else { return nil }
        return state
    }

    private func applyUITestFixtureIfNeeded() {
        guard didApplyUITestFixture == false else { return }
        let reviewState = ProcessInfo.processInfo.environment["FORGE_UI_TEST_PEER_REVIEW_STATE"]
        let validReviewState = reviewState.flatMap {
            ["scanned", "verified"].contains($0) ? $0 : nil
        }
        guard validReviewState != nil || watchPinUITestFixtureState != nil else { return }
        didApplyUITestFixture = true
        secureEnrollmentState = .enrolled
        authorizedOperations = Set(PeerAPIRoute.allCases.map(\.rawValue))
        peerCoreStatus = PeerPresenceStatusEnvelope.PeerCore(
            enabled: true,
            healthy: true,
            protocolVersion: "forge-peer/1",
            reason: nil,
            localDeviceId: "peer-device-ui-test"
        )
        loadState = .loaded
        lastUpdatedAt = now()

        if let watchPinUITestFixtureState {
            let relationship = PeerRelationship(
                id: "relationship-ui-watch",
                ownerUserId: ownerUserId ?? "user_ui_test",
                localPrincipalId: "principal-ui-local",
                remotePrincipalId: "principal-ui-remote",
                localPersonId: "person-ui-watch",
                status: "active",
                negotiatedProtocolVersion: "forge-peer/1",
                transportPrivacyMode: "fastest",
                highestReceivedSequence: 2,
                highestSentSequence: 3,
                establishedAt: "2026-07-16T08:00:00Z",
                lastConnectedAt: "2026-07-16T08:02:00Z",
                revokedAt: nil,
                createdAt: "2026-07-16T08:00:00Z",
                updatedAt: "2026-07-16T08:02:00Z",
                remoteDisplayLabel: "Ada's Forge",
                remoteTrustState: "verified"
            )
            relationships = [relationship]
            let pins: [PeopleEntityNavigationItem]
            if watchPinUITestFixtureState == "pinned" {
                pins = [PeopleEntityNavigationItem(
                    pinId: "pin-ui-watch",
                    entityType: "person",
                    entityId: "person-ui-watch",
                    title: "Ada Example",
                    detail: "",
                    category: "Person",
                    targetPath: "/people/person-ui-watch",
                    ownerUserId: relationship.ownerUserId,
                    availability: "available",
                    pinnedAt: "2026-07-16T08:03:00Z"
                )]
            } else {
                pins = []
            }
            applyWatchPins(
                pins,
                relationships: [relationship],
                ownerUserId: relationship.ownerUserId,
                generatedAt: ISO8601DateFormatter().string(from: now())
            )
            managementRequested = true
            return
        }

        guard let value = validReviewState else { return }
        let invitation = PeerPairingInvite(
            id: "peer-invite-ui-test",
            ownerUserId: "user_ui_test",
            inviterPrincipalId: "Ada's Forge",
            inviterDeviceId: "Ada's iPhone",
            fingerprint: "ABCD-EFGH-JKLM-NPQR",
            expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(600)),
            protocolVersion: "forge-peer/1",
            transportKinds: ["local_direct"],
            bootstrap: String(repeating: "B", count: 48),
            signature: String(repeating: "S", count: 86)
        )
        var review = PeerPairingReview.scanned(PeerInviteQREnvelope(invitation: invitation))
        if value == "verified" {
            review.pairingId = "pairing-ui-test"
            review.expectedVersion = "1"
            review.transcriptHash = String(repeating: "a", count: 64)
            review.verificationPhrase = "violet harbor seven"
            review.initialProjections = ["calendar.availability.v1"]
            review.initialFields = ["startsAt", "endsAt"]
            review.stage = .verified
        }
        pairingReview = review
        managementRequested = true
    }

    private func applyWatchPinDetailUITestFixtureIfNeeded(
        relationshipId: String
    ) -> Bool {
        guard watchPinUITestFixtureState != nil else { return false }
        applyUITestFixtureIfNeeded()
        guard let relationship = relationships.first(where: { $0.id == relationshipId }) else {
            return false
        }
        selectedRelationship = relationship
        devices = [PeerDevice(
            relationshipId: relationship.id,
            deviceId: "device-ui-remote",
            principalRole: "remote",
            status: "approved",
            label: "Ada's iPhone",
            deviceType: "iphone",
            lastSeenAt: "2026-07-16T08:02:00Z",
            approvedAt: "2026-07-16T08:01:00Z",
            removedAt: nil,
            createdAt: "2026-07-16T08:00:00Z",
            updatedAt: "2026-07-16T08:02:00Z"
        )]
        grants = [PeerGrant(
            id: "grant-ui-incoming",
            relationshipId: relationship.id,
            direction: "remote_to_local",
            sequence: 1,
            status: "proposed",
            label: "Availability",
            purpose: "Coordinate time",
            issuedAt: "2026-07-16T08:01:00Z",
            effectiveAt: nil,
            expiresAt: "2099-01-01T00:00:00Z",
            revokedAt: nil,
            rules: [PeerGrantRule(
                id: "grant-ui-availability",
                effect: "allow",
                projectionId: "calendar.availability.v1",
                fields: PeerGrantFieldPolicy(
                    include: ["start", "end", "busyState"],
                    exclude: ["description", "participants", "providerRaw"]
                ),
                time: PeerGrantTimePolicy(
                    startsAt: nil,
                    endsAt: nil,
                    rollingPastDays: 0,
                    rollingFutureDays: 30
                ),
                precision: "fifteen_minutes",
                approvedDeviceIds: ["device-ui-remote"],
                devicePolicy: "explicit",
                maximumResultCount: 100,
                maximumPayloadBytes: 262_144
            )],
            protocolVersion: "forge-peer/1",
            schemaVersion: 1,
            versionHash: String(repeating: "b", count: 64),
            cachePolicy: PeerGrantCachePolicy(
                mode: "duration",
                maximumRetentionSeconds: 86_400,
                purgeOnRevocation: true
            )
        )]
        diagnostics = []
        syncStatus = PeerSyncStatus(
            relationship: relationship,
            pendingOutbox: 0,
            pendingInbox: 0,
            currentRemoteRecords: 3,
            staleRemoteRecords: 1
        )
        loadState = .loaded
        errorMessage = nil
        return true
    }
#endif
}
