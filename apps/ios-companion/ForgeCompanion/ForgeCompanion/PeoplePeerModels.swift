import Foundation

enum PeerHTTPMethod: String, Codable {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

enum PeerAPIRoute: String, CaseIterable {
    case getPeerHumanPresenceStatus
    case createPeerHumanPresenceOptions
    case verifyPeerHumanPresence
    case createPeerInvitation
    case getPeerInvitationStatus
    case cancelPeerInvitation
    case acceptScannedPeerPairing
    case confirmPeerPairing
    case listPeerRequests
    case acceptPeerRequest
    case rejectPeerRequest
    case listPeerRelationships
    case getPeerRelationship
    case revokePeerRelationship
    case listPeerDevices
    case approvePeerDevice
    case removePeerDevice
    case previewPeerGrant
    case proposePeerGrant
    case listPeerGrants
    case acceptPeerGrant
    case counterPeerGrant
    case revokePeerGrant
    case getPeerSyncStatus
    case requestPeerResync
    case getPeerDiagnostics

    var method: PeerHTTPMethod {
        switch self {
        case .getPeerHumanPresenceStatus, .getPeerInvitationStatus,
             .listPeerRequests, .listPeerRelationships, .getPeerRelationship,
             .listPeerDevices, .listPeerGrants, .getPeerSyncStatus,
             .getPeerDiagnostics:
            return .get
        case .cancelPeerInvitation:
            return .delete
        default:
            return .post
        }
    }

    var pathTemplate: String {
        switch self {
        case .getPeerHumanPresenceStatus:
            return "/api/v1/peers/human-presence"
        case .createPeerHumanPresenceOptions:
            return "/api/v1/peers/human-presence/options"
        case .verifyPeerHumanPresence:
            return "/api/v1/peers/human-presence/verify"
        case .createPeerInvitation:
            return "/api/v1/peers/invitations"
        case .getPeerInvitationStatus, .cancelPeerInvitation:
            return "/api/v1/peers/invitations/:invitationId"
        case .acceptScannedPeerPairing:
            return "/api/v1/peers/pairings/accept"
        case .confirmPeerPairing:
            return "/api/v1/peers/pairings/:pairingId/confirm"
        case .listPeerRequests:
            return "/api/v1/peers/requests"
        case .acceptPeerRequest:
            return "/api/v1/peers/requests/:requestId/accept"
        case .rejectPeerRequest:
            return "/api/v1/peers/requests/:requestId/reject"
        case .listPeerRelationships:
            return "/api/v1/peers/relationships"
        case .getPeerRelationship:
            return "/api/v1/peers/relationships/:relationshipId"
        case .revokePeerRelationship:
            return "/api/v1/peers/relationships/:relationshipId/revoke"
        case .listPeerDevices:
            return "/api/v1/peers/relationships/:relationshipId/devices"
        case .approvePeerDevice:
            return "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/approve"
        case .removePeerDevice:
            return "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove"
        case .previewPeerGrant:
            return "/api/v1/peers/relationships/:relationshipId/grants/preview"
        case .proposePeerGrant:
            return "/api/v1/peers/relationships/:relationshipId/grants/propose"
        case .listPeerGrants:
            return "/api/v1/peers/relationships/:relationshipId/grants"
        case .acceptPeerGrant:
            return "/api/v1/peers/grants/:grantId/accept"
        case .counterPeerGrant:
            return "/api/v1/peers/grants/:grantId/counter"
        case .revokePeerGrant:
            return "/api/v1/peers/grants/:grantId/revoke"
        case .getPeerSyncStatus:
            return "/api/v1/peers/relationships/:relationshipId/sync"
        case .requestPeerResync:
            return "/api/v1/peers/relationships/:relationshipId/resync"
        case .getPeerDiagnostics:
            return "/api/v1/peers/relationships/:relationshipId/diagnostics"
        }
    }

    var requiresHumanApproval: Bool {
        switch self {
        case .createPeerInvitation, .cancelPeerInvitation, .acceptScannedPeerPairing,
             .confirmPeerPairing, .acceptPeerRequest, .rejectPeerRequest,
             .revokePeerRelationship, .approvePeerDevice, .removePeerDevice,
             .previewPeerGrant, .proposePeerGrant, .acceptPeerGrant,
             .counterPeerGrant, .revokePeerGrant, .requestPeerResync:
            return true
        default:
            return false
        }
    }

    func resolvedPath(parameters: [String: String] = [:]) throws -> String {
        let required = Self.pathParameterNames(in: pathTemplate)
        guard Set(required) == Set(parameters.keys) else {
            throw PeerRouteResolutionError.parameterMismatch
        }
        var result = pathTemplate
        for name in required {
            guard let value = parameters[name], let encoded = Self.encodePathComponent(value) else {
                throw PeerRouteResolutionError.invalidPathComponent
            }
            result = result.replacingOccurrences(of: ":\(name)", with: encoded)
        }
        return result
    }

    private static func pathParameterNames(in template: String) -> [String] {
        guard let expression = try? NSRegularExpression(pattern: #":([A-Za-z][A-Za-z0-9]*)"#) else {
            return []
        }
        let range = NSRange(template.startIndex..<template.endIndex, in: template)
        return expression.matches(in: template, range: range).compactMap { match in
            guard let range = Range(match.range(at: 1), in: template) else { return nil }
            return String(template[range])
        }
    }

    private static func encodePathComponent(_ value: String) -> String? {
        guard value.isEmpty == false, value.count <= 240 else { return nil }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }
}

enum PeerRouteResolutionError: Error {
    case parameterMismatch
    case invalidPathComponent
}

enum PeerJSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: PeerJSONValue])
    case array([PeerJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: PeerJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([PeerJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported peer JSON value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var objectValue: [String: PeerJSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }
}

struct PeerPairingInvite: Codable, Hashable, Identifiable {
    let id: String
    let ownerUserId: String
    let inviterPrincipalId: String
    let inviterDeviceId: String
    let fingerprint: String
    let expiresAt: String
    let protocolVersion: String
    let transportKinds: [String]
    let bootstrap: String
    let signature: String
}

struct PeerInviteQREnvelope: Codable, Hashable, Identifiable {
    static let expectedKind = "forge-peer-invite"
    static let currentVersion = 1

    let kind: String
    let version: Int
    let invitation: PeerPairingInvite

    var id: String { invitation.id }

    init(invitation: PeerPairingInvite) {
        kind = Self.expectedKind
        version = Self.currentVersion
        self.invitation = invitation
    }

    static func decode(_ text: String, now: Date = Date()) throws -> PeerInviteQREnvelope {
        guard let data = text.data(using: .utf8), data.count <= 8_192 else {
            throw PeerInviteValidationError.invalidEncoding
        }
        let envelope: PeerInviteQREnvelope
        do {
            envelope = try JSONDecoder().decode(PeerInviteQREnvelope.self, from: data)
        } catch {
            throw PeerInviteValidationError.invalidEncoding
        }
        guard envelope.kind == expectedKind, envelope.version == currentVersion else {
            throw PeerInviteValidationError.wrongKindOrVersion
        }
        try envelope.invitation.validate(now: now)
        return envelope
    }

    func encodedText() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

enum PeerInviteValidationError: Error, Equatable {
    case invalidEncoding
    case wrongKindOrVersion
    case invalidProtocol
    case invalidIdentity
    case invalidSignature
    case expired
}

extension PeerPairingInvite {
    func validate(now: Date) throws {
        guard protocolVersion == "forge-peer/1" else {
            throw PeerInviteValidationError.invalidProtocol
        }
        guard
            id.isEmpty == false,
            ownerUserId.isEmpty == false,
            inviterPrincipalId.isEmpty == false,
            inviterDeviceId.isEmpty == false,
            Self.matches(fingerprint, pattern: #"^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3,7}$"#)
        else {
            throw PeerInviteValidationError.invalidIdentity
        }
        guard
            Self.matches(bootstrap, pattern: #"^[A-Za-z0-9_-]{32,1024}$"#),
            Self.matches(signature, pattern: #"^[A-Za-z0-9_-]{64,256}$"#)
        else {
            throw PeerInviteValidationError.invalidSignature
        }
        guard let expiry = PeerDateParser.date(from: expiresAt), expiry > now else {
            throw PeerInviteValidationError.expired
        }
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return false }
        return expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..<value.endIndex, in: value)
        ) != nil
    }
}

enum NativeQRCodeKind: Equatable {
    case ownerCompanion
    case peerInvite
    case unsupported
}

enum NativeQRCodeClassifier {
    static func classify(_ text: String, now: Date = Date()) -> NativeQRCodeKind {
        if (try? PeerInviteQREnvelope.decode(text, now: now)) != nil {
            return .peerInvite
        }
        if (try? PairingPayload.decodePairingText(text)) != nil {
            return .ownerCompanion
        }
        return .unsupported
    }
}

enum PeerDateParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct PeerPage: Decodable, Hashable {
    let limit: Int
    let hasMore: Bool
    let nextCursor: String?
}

struct PeerCompanionConsentAvailability: Decodable, Hashable {
    let available: Bool
    let protocolName: String?
    let requestProtocol: String?
    let deviceId: String?
    let scopes: [String]
    let capabilities: [String]
    let authorizedOperations: [String]

    private enum CodingKeys: String, CodingKey {
        case available
        case protocolName = "protocol"
        case requestProtocol
        case deviceId
        case scopes
        case capabilities
        case authorizedOperations
    }
}

struct PeerPresenceStatusEnvelope: Decodable, Hashable {
    struct Methods: Decodable, Hashable {
        let companionConsent: PeerCompanionConsentAvailability
    }

    struct PeerCore: Decodable, Hashable {
        let enabled: Bool
        let healthy: Bool
        let protocolVersion: String?
        let reason: String?
        let localDeviceId: String?
    }

    let methods: Methods
    let peerCore: PeerCore
}

struct PeerInvitationStatus: Decodable, Hashable, Identifiable {
    let id: String
    let status: String
    let fingerprint: String
    let protocolVersion: String
    let transportKinds: [String]
    let failedAttemptCount: Int
    let maximumAttempts: Int
    let expiresAt: String
    let claimedAt: String?
    let consumedAt: String?
    let canceledAt: String?
    let createdAt: String
    let updatedAt: String

    var isActive: Bool { status == "active" || status == "claimed" }
}

struct PeerInvitationStatusEnvelope: Decodable, Hashable {
    let invitation: PeerInvitationStatus
}

struct PeerRelationship: Codable, Hashable, Identifiable {
    let id: String
    let ownerUserId: String
    let localPrincipalId: String
    let remotePrincipalId: String
    let localPersonId: String?
    let status: String
    let negotiatedProtocolVersion: String
    let transportPrivacyMode: String
    let highestReceivedSequence: Int
    let highestSentSequence: Int
    let establishedAt: String?
    let lastConnectedAt: String?
    let revokedAt: String?
    let createdAt: String
    let updatedAt: String
    let remoteDisplayLabel: String
    let remoteTrustState: String

    var isRevoked: Bool { status == "revoked" }
}

struct PeopleEntityNavigationItem: Codable, Hashable, Identifiable {
    let pinId: String?
    let entityType: String
    let entityId: String
    let title: String
    let detail: String
    let category: String
    let targetPath: String
    let ownerUserId: String?
    let availability: String
    let pinnedAt: String?

    var id: String { pinId ?? "\(entityType):\(entityId)" }
}

struct PeopleEntityNavigationEnvelope: Decodable {
    let generatedAt: String
    let pinnedTotal: Int
    let pinned: [PeopleEntityNavigationItem]
}

struct PeopleEntityNavigationPinEnvelope: Decodable {
    let pin: PeopleEntityNavigationItem
}

struct PeopleEntityNavigationUnpinEnvelope: Codable {
    let unpinned: Bool
    let pinId: String
}

struct PeopleWatchPinBody: Encodable {
    let entityType: String
    let entityId: String
    let ownerUserId: String
}

struct PeopleWatchGlanceResolution: Hashable {
    let snapshot: ForgeWatchPeopleGlanceSnapshot
    let selectedPinId: String?
    let pinsByPersonId: [String: PeopleEntityNavigationItem]
}

enum PeopleWatchGlanceSelector {
    static func resolve(
        pins: [PeopleEntityNavigationItem],
        relationships: [PeerRelationship],
        ownerUserId: String,
        generatedAt: String,
        sharedEventsByPersonId: [String: ForgeWatchPeopleGlanceSnapshot.SharedEvent] = [:]
    ) -> PeopleWatchGlanceResolution {
        let activeRelationships = relationships
            .filter {
                $0.ownerUserId == ownerUserId &&
                    $0.status == "active" &&
                    $0.localPersonId?.isEmpty == false
            }
            .sorted { left, right in
                let leftDate = PeerDateParser.date(from: left.updatedAt) ?? .distantPast
                let rightDate = PeerDateParser.date(from: right.updatedAt) ?? .distantPast
                if leftDate != rightDate { return leftDate > rightDate }
                return left.id < right.id
            }
        var relationshipByPersonId: [String: PeerRelationship] = [:]
        for relationship in activeRelationships {
            guard let personId = relationship.localPersonId,
                  relationshipByPersonId[personId] == nil
            else { continue }
            relationshipByPersonId[personId] = relationship
        }

        let eligiblePins = pins
            .filter {
                $0.entityType == "person" &&
                    $0.ownerUserId == ownerUserId &&
                    $0.availability == "available" &&
                    $0.pinId?.isEmpty == false &&
                    relationshipByPersonId[$0.entityId] != nil
            }
            .sorted { left, right in
                let leftDate = left.pinnedAt.flatMap(PeerDateParser.date(from:)) ?? .distantPast
                let rightDate = right.pinnedAt.flatMap(PeerDateParser.date(from:)) ?? .distantPast
                if leftDate != rightDate { return leftDate > rightDate }
                return left.id < right.id
            }
        let pinsByPersonId = eligiblePins.reduce(into: [String: PeopleEntityNavigationItem]()) {
            if $0[$1.entityId] == nil { $0[$1.entityId] = $1 }
        }
        guard let selectedPin = eligiblePins.first,
              let relationship = relationshipByPersonId[selectedPin.entityId]
        else {
            return PeopleWatchGlanceResolution(
                snapshot: .chooseOnIPhone(generatedAt: generatedAt),
                selectedPinId: nil,
                pinsByPersonId: pinsByPersonId
            )
        }

        return PeopleWatchGlanceResolution(
            snapshot: ForgeWatchPeopleGlanceSnapshot(
                selection: .selected,
                generatedAt: generatedAt,
                personName: selectedPin.title,
                lastConnectedAt: relationship.lastConnectedAt,
                nextSharedEvent: sharedEventsByPersonId[selectedPin.entityId]
            ),
            selectedPinId: selectedPin.pinId,
            pinsByPersonId: pinsByPersonId
        )
    }
}

struct PeerDevice: Codable, Hashable, Identifiable {
    let relationshipId: String
    let deviceId: String
    let principalRole: String
    let status: String
    let label: String
    let deviceType: String
    let lastSeenAt: String?
    let approvedAt: String?
    let removedAt: String?
    let createdAt: String
    let updatedAt: String

    var id: String { deviceId }
}

struct PeerGrantFieldPolicy: Codable, Hashable {
    let include: [String]
    let exclude: [String]
}

struct PeerGrantEntitySelector: Codable, Hashable {
    let mode: String
    let entityType: String?
    let entityIds: [String]
}

struct PeerGrantTimePolicy: Codable, Hashable {
    let startsAt: String?
    let endsAt: String?
    let rollingPastDays: Int?
    let rollingFutureDays: Int?

    static let unbounded = PeerGrantTimePolicy(
        startsAt: nil,
        endsAt: nil,
        rollingPastDays: nil,
        rollingFutureDays: nil
    )
}

struct PeerGrantAggregationPolicy: Codable, Hashable {
    let minimumRecords: Int
    let granularity: String
    let privacyBudget: Double
    let maximumQueriesPerDay: Int
}

struct PeerGrantCachePolicy: Codable, Hashable {
    let mode: String
    let maximumRetentionSeconds: Int
    let purgeOnRevocation: Bool

    static let none = PeerGrantCachePolicy(
        mode: "none",
        maximumRetentionSeconds: 0,
        purgeOnRevocation: true
    )
}

struct PeerGrantRule: Codable, Hashable, Identifiable {
    let id: String
    let effect: String
    let projectionId: String
    let entitySelector: PeerGrantEntitySelector?
    let fields: PeerGrantFieldPolicy
    let time: PeerGrantTimePolicy
    let precision: String
    let aggregation: PeerGrantAggregationPolicy?
    let approvedDeviceIds: [String]
    let devicePolicy: String
    let maximumResultCount: Int
    let maximumPayloadBytes: Int

    init(
        id: String,
        effect: String,
        projectionId: String,
        entitySelector: PeerGrantEntitySelector? = nil,
        fields: PeerGrantFieldPolicy,
        time: PeerGrantTimePolicy = .unbounded,
        precision: String,
        aggregation: PeerGrantAggregationPolicy? = nil,
        approvedDeviceIds: [String],
        devicePolicy: String,
        maximumResultCount: Int,
        maximumPayloadBytes: Int
    ) {
        self.id = id
        self.effect = effect
        self.projectionId = projectionId
        self.entitySelector = entitySelector
        self.fields = fields
        self.time = time
        self.precision = precision
        self.aggregation = aggregation
        self.approvedDeviceIds = approvedDeviceIds
        self.devicePolicy = devicePolicy
        self.maximumResultCount = maximumResultCount
        self.maximumPayloadBytes = maximumPayloadBytes
    }

    private enum CodingKeys: String, CodingKey {
        case id, effect, projectionId, entitySelector, fields, time, precision
        case aggregation, approvedDeviceIds, devicePolicy, maximumResultCount
        case maximumPayloadBytes
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        effect = try values.decode(String.self, forKey: .effect)
        projectionId = try values.decode(String.self, forKey: .projectionId)
        entitySelector = try values.decodeIfPresent(
            PeerGrantEntitySelector.self,
            forKey: .entitySelector
        )
        fields = try values.decode(PeerGrantFieldPolicy.self, forKey: .fields)
        time = try values.decodeIfPresent(
            PeerGrantTimePolicy.self,
            forKey: .time
        ) ?? .unbounded
        precision = try values.decode(String.self, forKey: .precision)
        aggregation = try values.decodeIfPresent(
            PeerGrantAggregationPolicy.self,
            forKey: .aggregation
        )
        approvedDeviceIds = try values.decode([String].self, forKey: .approvedDeviceIds)
        devicePolicy = try values.decode(String.self, forKey: .devicePolicy)
        maximumResultCount = try values.decode(Int.self, forKey: .maximumResultCount)
        maximumPayloadBytes = try values.decode(Int.self, forKey: .maximumPayloadBytes)
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(effect, forKey: .effect)
        try values.encode(projectionId, forKey: .projectionId)
        try values.encode(entitySelector, forKey: .entitySelector)
        try values.encode(fields, forKey: .fields)
        try values.encode(time, forKey: .time)
        try values.encode(precision, forKey: .precision)
        try values.encode(aggregation, forKey: .aggregation)
        try values.encode(approvedDeviceIds, forKey: .approvedDeviceIds)
        try values.encode(devicePolicy, forKey: .devicePolicy)
        try values.encode(maximumResultCount, forKey: .maximumResultCount)
        try values.encode(maximumPayloadBytes, forKey: .maximumPayloadBytes)
    }
}

struct PeerGrantDraftRule: Encodable, Hashable, Identifiable {
    let id: String
    let effect: String
    let projectionId: String
    let entitySelector: PeerGrantEntitySelector?
    let fields: PeerGrantFieldPolicy
    let time: PeerGrantTimePolicy
    let precision: String
    let aggregation: PeerGrantAggregationPolicy?
    let approvedDeviceIds: [String]
    let devicePolicy: String
    let maximumResultCount: Int
    let maximumPayloadBytes: Int

    init(rule: PeerGrantRule, narrowLimits: Bool) {
        id = rule.id
        effect = rule.effect
        projectionId = rule.projectionId
        entitySelector = rule.entitySelector
        fields = rule.fields
        time = rule.time
        precision = rule.precision
        aggregation = rule.aggregation
        approvedDeviceIds = rule.approvedDeviceIds
        devicePolicy = rule.devicePolicy
        maximumResultCount = narrowLimits
            ? max(1, rule.maximumResultCount / 2)
            : rule.maximumResultCount
        maximumPayloadBytes = narrowLimits
            ? max(256, rule.maximumPayloadBytes / 2)
            : rule.maximumPayloadBytes
    }

    init(
        id: String,
        projectionId: String,
        fields: PeerGrantFieldPolicy,
        time: PeerGrantTimePolicy,
        precision: String,
        approvedDeviceIds: [String],
        maximumPayloadBytes: Int
    ) {
        self.id = id
        effect = "allow"
        self.projectionId = projectionId
        entitySelector = nil
        self.fields = fields
        self.time = time
        self.precision = precision
        aggregation = nil
        self.approvedDeviceIds = approvedDeviceIds
        devicePolicy = "explicit"
        maximumResultCount = 100
        self.maximumPayloadBytes = maximumPayloadBytes
    }
}

struct PeerGrantDraft: Encodable, Hashable {
    let direction: String
    let label: String
    let purpose: String
    let effectiveAt: String?
    let expiresAt: String?
    let cachePolicy: PeerGrantCachePolicy
    let rules: [PeerGrantDraftRule]

    static func proposal(
        label: String,
        purpose: String,
        projections: [PeerGrantProjectionPreset],
        approvedDeviceIds: [String],
        rollingFutureDays: Int,
        retentionSeconds: Int,
        expiresAt: String?
    ) -> PeerGrantDraft {
        PeerGrantDraft(
            direction: "local_to_remote",
            label: label,
            purpose: purpose,
            effectiveAt: nil,
            expiresAt: expiresAt,
            cachePolicy: retentionSeconds == 0
                ? .none
                : PeerGrantCachePolicy(
                    mode: "duration",
                    maximumRetentionSeconds: retentionSeconds,
                    purgeOnRevocation: true
                ),
            rules: projections.map {
                $0.rule(
                    approvedDeviceIds: approvedDeviceIds,
                    rollingFutureDays: rollingFutureDays
                )
            }
        )
    }

    static func countering(
        _ grant: PeerGrant,
        retainedAllowRuleIds: Set<String>
    ) -> PeerGrantDraft? {
        let retained = grant.rules.filter { rule in
            rule.effect == "deny" || retainedAllowRuleIds.contains(rule.id)
        }
        guard retained.contains(where: { $0.effect == "allow" }) else {
            return nil
        }
        return PeerGrantDraft(
            direction: grant.direction,
            label: grant.label,
            purpose: grant.purpose,
            effectiveAt: nil,
            expiresAt: grant.expiresAt,
            cachePolicy: grant.cachePolicy ?? .none,
            rules: retained.map {
                PeerGrantDraftRule(rule: $0, narrowLimits: $0.effect == "allow")
            }
        )
    }
}

enum PeerGrantProjectionPreset: String, CaseIterable, Identifiable {
    case availability = "calendar.availability.v1"
    case goals = "goals.horizon_summary.v1"
    case profile = "person.profile.v1"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .availability: return "Availability"
        case .goals: return "Goal horizon"
        case .profile: return "Profile"
        }
    }

    fileprivate func rule(
        approvedDeviceIds: [String],
        rollingFutureDays: Int
    ) -> PeerGrantDraftRule {
        let fields: PeerGrantFieldPolicy
        let excluded: [String]
        let precision: String
        let maximumPayloadBytes: Int
        switch self {
        case .availability:
            fields = PeerGrantFieldPolicy(include: ["start", "end", "busyState"], exclude: [])
            excluded = ["description", "participants", "linkedEntities", "providerRaw"]
            precision = "fifteen_minutes"
            maximumPayloadBytes = 262_144
        case .goals:
            fields = PeerGrantFieldPolicy(
                include: ["goalTitle", "goalSummary", "goalState", "goalProgress"],
                exclude: []
            )
            excluded = ["privateNotes", "psycheLinks", "agentHistory"]
            precision = "exact"
            maximumPayloadBytes = 262_144
        case .profile:
            fields = PeerGrantFieldPolicy(
                include: [
                    "displayName", "preferredName", "pronouns",
                    "relationshipLabel", "shortDescription"
                ],
                exclude: []
            )
            excluded = ["privateNotes", "actorBinding", "peerAudit"]
            precision = "exact"
            maximumPayloadBytes = 131_072
        }
        return PeerGrantDraftRule(
            id: "ios_\(rawValue.replacingOccurrences(of: ".", with: "_"))",
            projectionId: rawValue,
            fields: PeerGrantFieldPolicy(
                include: fields.include,
                exclude: excluded
            ),
            time: self == .availability
                ? PeerGrantTimePolicy(
                    startsAt: nil,
                    endsAt: nil,
                    rollingPastDays: 0,
                    rollingFutureDays: rollingFutureDays
                )
                : .unbounded,
            precision: precision,
            approvedDeviceIds: approvedDeviceIds,
            maximumPayloadBytes: maximumPayloadBytes
        )
    }
}

struct PeerGrantSignature: Codable, Hashable {
    let deviceId: String
    let party: String
    let algorithm: String
    let signedAt: String
    let signature: String
}

struct PeerGrant: Codable, Hashable, Identifiable {
    let id: String
    let relationshipId: String
    let direction: String
    let sequence: Int
    let previousVersionHash: String?
    let status: String
    let label: String
    let purpose: String
    let issuedAt: String
    let effectiveAt: String?
    let expiresAt: String?
    let revokedAt: String?
    let cachePolicy: PeerGrantCachePolicy?
    let rules: [PeerGrantRule]
    let signatures: [PeerGrantSignature]?
    let protocolVersion: String
    let schemaVersion: Int
    let versionHash: String?

    init(
        id: String,
        relationshipId: String,
        direction: String,
        sequence: Int,
        status: String,
        label: String,
        purpose: String,
        issuedAt: String,
        effectiveAt: String?,
        expiresAt: String?,
        revokedAt: String?,
        rules: [PeerGrantRule],
        protocolVersion: String,
        schemaVersion: Int,
        versionHash: String?,
        previousVersionHash: String? = nil,
        cachePolicy: PeerGrantCachePolicy? = nil,
        signatures: [PeerGrantSignature]? = nil
    ) {
        self.id = id
        self.relationshipId = relationshipId
        self.direction = direction
        self.sequence = sequence
        self.previousVersionHash = previousVersionHash
        self.status = status
        self.label = label
        self.purpose = purpose
        self.issuedAt = issuedAt
        self.effectiveAt = effectiveAt
        self.expiresAt = expiresAt
        self.revokedAt = revokedAt
        self.cachePolicy = cachePolicy
        self.rules = rules
        self.signatures = signatures
        self.protocolVersion = protocolVersion
        self.schemaVersion = schemaVersion
        self.versionHash = versionHash
    }

    var canRevoke: Bool {
        ["draft", "proposed", "active", "countered"].contains(status)
    }

    var canReviewIncomingProposal: Bool {
        direction == "remote_to_local" && ["proposed", "countered"].contains(status)
    }
}

struct PeerGrantPreviewEnvelope: Decodable, Hashable {
    let preview: PeerGrantPreview
}

struct PeerGrantPreview: Decodable, Hashable {
    let hash: String
    let relationshipVersion: String
    let exact: PeerGrantPreviewExact
    let worstCase: PeerGrantPreviewWorstCase
    let samples: [PeerGrantPreviewSample]
}

struct PeerGrantPreviewExact: Decodable, Hashable {
    let direction: String
    let rules: [PeerGrantRule]
    let cachePolicy: PeerGrantCachePolicy
    let effectiveAt: String?
    let expiresAt: String?
}

struct PeerGrantPreviewWorstCase: Decodable, Hashable {
    let projectionIds: [String]
    let maximumResultCount: Int
    let maximumPayloadBytes: Int
    let maximumRetentionSeconds: Int
    let allShareableRuleCount: Int
    let currentApprovedDeviceCount: Int
}

struct PeerGrantPreviewSample: Decodable, Hashable, Identifiable {
    let ruleId: String
    let projectionId: String
    let fields: [String]
    let excludedFields: [String]
    let precision: String
    let entitySelector: PeerGrantEntitySelector?
    let time: PeerGrantTimePolicy

    var id: String { ruleId }
}

enum PeerGrantReviewIntent: Hashable {
    case proposal(relationshipId: String)
    case counter(grantId: String, versionHash: String)
}

struct PeerGrantReview: Hashable {
    let intent: PeerGrantReviewIntent
    let draft: PeerGrantDraft
    let preview: PeerGrantPreview
}

struct PeerSyncStatus: Decodable, Hashable {
    let relationship: PeerRelationship
    let pendingOutbox: Int
    let pendingInbox: Int
    let currentRemoteRecords: Int
    let staleRemoteRecords: Int
}

struct PeerSyncEnvelope: Decodable, Hashable {
    let sync: PeerSyncStatus
}

struct PeerResyncEnvelope: Decodable, Hashable {
    let requested: Bool
    let envelopeIds: [String]
}

struct PeerDiagnostic: Decodable, Hashable, Identifiable {
    let id: String
    let eventType: String
    let actorClass: String
    let outcome: String
    let createdAt: String
}

struct PeerPendingRequest: Decodable, Hashable, Identifiable {
    let id: String
    let relationshipId: String?
    let kind: String
    let status: String
    let version: Int
    let payload: [String: PeerJSONValue]
    let expiresAt: String
    let createdAt: String
    let updatedAt: String
}

struct PeerRelationshipsEnvelope: Decodable {
    let relationships: [PeerRelationship]
    let page: PeerPage
}

struct PeerRequestsEnvelope: Decodable {
    let requests: [PeerPendingRequest]
    let page: PeerPage
}

struct PeerRelationshipEnvelope: Decodable {
    let relationship: PeerRelationship
    let devices: [PeerDevice]
    let grants: [PeerGrant]
    let sync: PeerSyncStatus?
}

struct PeerDevicesEnvelope: Decodable {
    let devices: [PeerDevice]
}

struct PeerGrantsEnvelope: Decodable {
    let grants: [PeerGrant]
    let page: PeerPage
}

struct PeerDiagnosticsEnvelope: Decodable {
    let diagnostics: [PeerDiagnostic]
    let page: PeerPage
}

struct PeerPairingAcceptanceEnvelope: Decodable {
    let request: PeerPendingRequest
}

struct PeerPairingConfirmationEnvelope: Decodable {
    let relationshipId: String
    let request: PeerPendingRequest
}

struct PeerRequestMutationEnvelope: Decodable {
    let request: PeerPendingRequest
}

struct PeerInvitationEnvelope: Decodable {
    let invitation: PeerPairingInvite
}

struct PeerInvitationCancellationEnvelope: Decodable {
    let canceled: Bool
    let invitationId: String
}

struct PeerRelationshipMutationEnvelope: Decodable {
    let relationship: PeerRelationship
}

struct PeerDeviceMutationEnvelope: Decodable {
    let device: PeerDevice
}

struct PeerGrantMutationEnvelope: Decodable {
    let grant: PeerGrant
    let versionHash: String
}

struct PeerPairingReview: Identifiable, Hashable, Codable {
    enum Stage: Hashable, Codable {
        case scanned
        case submitting
        case verified
        case confirming
        case completed
        case expired
        case replayed
        case failed(String)
    }

    let envelope: PeerInviteQREnvelope
    var pairingId: String?
    var expectedVersion: String?
    var transcriptHash: String?
    var remoteLabel: String
    var deviceLabel: String
    var verificationPhrase: String?
    var initialProjections: [String]
    var initialFields: [String]
    var scannedAt: String?
    var acceptIdempotencyKey: String?
    var confirmIdempotencyKey: String?
    var confirmationPersonName: String?
    var reviewExpiresAt: String?
    var stage: Stage

    var id: String { envelope.invitation.id }
    var fingerprint: String { envelope.invitation.fingerprint }
    var expiresAt: String { reviewExpiresAt ?? envelope.invitation.expiresAt }

    static func scanned(
        _ envelope: PeerInviteQREnvelope,
        now: Date = Date()
    ) -> PeerPairingReview {
        PeerPairingReview(
            envelope: envelope,
            pairingId: nil,
            expectedVersion: nil,
            transcriptHash: nil,
            remoteLabel: envelope.invitation.inviterPrincipalId,
            deviceLabel: envelope.invitation.inviterDeviceId,
            verificationPhrase: nil,
            initialProjections: [],
            initialFields: [],
            scannedAt: ISO8601DateFormatter().string(from: now),
            acceptIdempotencyKey: operationKey(prefix: "peer-accept"),
            confirmIdempotencyKey: operationKey(prefix: "peer-confirm"),
            confirmationPersonName: nil,
            reviewExpiresAt: envelope.invitation.expiresAt,
            stage: .scanned
        )
    }

    mutating func ensureOperationIdentity(now: Date) {
        if scannedAt == nil {
            scannedAt = ISO8601DateFormatter().string(from: now)
        }
        if acceptIdempotencyKey == nil {
            acceptIdempotencyKey = Self.operationKey(prefix: "peer-accept")
        }
        if confirmIdempotencyKey == nil {
            confirmIdempotencyKey = Self.operationKey(prefix: "peer-confirm")
        }
        if reviewExpiresAt == nil {
            reviewExpiresAt = envelope.invitation.expiresAt
        }
    }

    func applying(_ request: PeerPendingRequest) -> PeerPairingReview {
        var next = self
        next.pairingId = request.id
        next.expectedVersion = String(request.version)
        next.transcriptHash = request.payload["transcriptHash"]?.stringValue
        next.remoteLabel = request.payload["remoteLabel"]?.stringValue ?? remoteLabel
        next.deviceLabel = request.payload["deviceLabel"]?.stringValue ?? deviceLabel
        next.verificationPhrase = request.payload["verificationPhrase"]?.stringValue
        next.reviewExpiresAt = request.expiresAt
        next.initialProjections = Self.collectedStrings(
            keys: ["projectionId", "projections", "requestedProjections"],
            in: .object(request.payload)
        )
        next.initialFields = Self.collectedStrings(
            keys: ["fields", "include", "requestedFields"],
            in: .object(request.payload)
        )
        next.stage = .verified
        return next
    }

    private static func operationKey(prefix: String) -> String {
        "\(prefix)-\(UUID().uuidString.lowercased())"
    }

    var presentationStrings: [String] {
        [remoteLabel, deviceLabel, fingerprint, expiresAt, verificationPhrase]
            .compactMap { $0 } + initialProjections + initialFields
    }

    private static func collectedStrings(
        keys: Set<String>,
        in value: PeerJSONValue,
        depth: Int = 0
    ) -> [String] {
        guard depth <= 6 else { return [] }
        var result: [String] = []
        switch value {
        case .object(let object):
            for (key, nested) in object {
                if keys.contains(key) {
                    switch nested {
                    case .string(let string):
                        result.append(string)
                    case .array(let values):
                        result.append(contentsOf: values.compactMap(\.stringValue))
                    default:
                        break
                    }
                }
                result.append(contentsOf: collectedStrings(keys: keys, in: nested, depth: depth + 1))
            }
        case .array(let values):
            for nested in values {
                result.append(contentsOf: collectedStrings(keys: keys, in: nested, depth: depth + 1))
            }
        default:
            break
        }
        return Array(Set(result.filter { $0.isEmpty == false })).sorted().prefix(32).map { $0 }
    }
}

enum PeerDeepLinkDestination: Equatable {
    case people

    static func parse(_ url: URL) -> PeerDeepLinkDestination? {
        guard
            url.user == nil,
            url.password == nil,
            url.query == nil,
            url.fragment == nil
        else {
            return nil
        }
        let scheme = url.scheme?.lowercased()
        if scheme == "forge-companion" {
            let components = [url.host, url.path]
                .compactMap { $0 }
                .joined(separator: "/")
                .split(separator: "/")
                .map(String.init)
            return components == ["people"] ? .people : nil
        }
        if scheme == "https" || scheme == "http" || scheme == "forge-iroh" {
            let components = url.path.split(separator: "/").map(String.init)
            return components.last == "people" ? .people : nil
        }
        return nil
    }
}

enum PeerCameraAuthorizationState: Equatable {
    case authorized
    case request
    case denied
    case restricted
}

enum PeerPrivacyRedactor {
    private static let sensitiveKeys = [
        "bootstrap", "signature", "pairingtoken", "secret", "challenge",
        "capability", "privatekey", "authorization", "cookie",
        "idempotencykey", "requestnonce", "sessionid", "publickey"
    ]

    static func redacted(_ value: String) -> String {
        var result = value
        for key in sensitiveKeys {
            let escaped = NSRegularExpression.escapedPattern(for: key)
            result = result.replacingOccurrences(
                of: "(?i)([\"']?\(escaped)[\"']?\\s*[:=]\\s*[\"']?)[^\"',;\\s}]+",
                with: "$1[redacted]",
                options: .regularExpression
            )
        }
        result = result.replacingOccurrences(
            of: #"(?i)bearer\s+[A-Za-z0-9._-]+"#,
            with: "Bearer [redacted]",
            options: .regularExpression
        )
        return result
    }

    static func presentationIsSafe(_ review: PeerPairingReview) -> Bool {
        let combined = review.presentationStrings.joined(separator: " ").lowercased()
        return sensitiveKeys.allSatisfy { combined.contains($0) == false }
            && combined.contains(review.envelope.invitation.bootstrap.lowercased()) == false
            && combined.contains(review.envelope.invitation.signature.lowercased()) == false
    }
}
