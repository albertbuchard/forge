import CryptoKit
import Foundation
import LocalAuthentication
import Security

protocol PeerSecretStoring: AnyObject {
    @discardableResult
    func save(_ data: Data, forKey key: String) -> Bool
    func load(forKey key: String) -> Data?
    func delete(forKey key: String)
}

protocol PeerKeychainOperating: AnyObject {
    func update(
        query: [CFString: Any],
        attributes: [CFString: Any]
    ) -> OSStatus
    func add(attributes: [CFString: Any]) -> OSStatus
    func load(query: [CFString: Any]) -> (status: OSStatus, data: Data?)
    func delete(query: [CFString: Any])
}

final class SystemPeerKeychainOperations: PeerKeychainOperating {
    func update(
        query: [CFString: Any],
        attributes: [CFString: Any]
    ) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    func add(attributes: [CFString: Any]) -> OSStatus {
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func load(query: [CFString: Any]) -> (status: OSStatus, data: Data?) {
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return (status, item as? Data)
    }

    func delete(query: [CFString: Any]) {
        SecItemDelete(query as CFDictionary)
    }
}

final class PeerKeychainStore: PeerSecretStoring {
    private let service: String
    private let operations: PeerKeychainOperating

    init(
        service: String = "com.aurel.forgecompanion.people",
        operations: PeerKeychainOperating = SystemPeerKeychainOperations()
    ) {
        self.service = service
        self.operations = operations
    }

    @discardableResult
    func save(_ data: Data, forKey key: String) -> Bool {
        let lookup: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key
        ]
        let updateStatus = operations.update(
            query: lookup,
            attributes: [kSecValueData: data]
        )
        if updateStatus == errSecSuccess {
            return true
        }
        guard updateStatus == errSecItemNotFound else {
            return false
        }
        var addition = lookup
        addition[kSecValueData] = data
        addition[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = operations.add(attributes: addition)
        if addStatus == errSecDuplicateItem {
            return operations.update(
                query: lookup,
                attributes: [kSecValueData: data]
            ) == errSecSuccess
        }
        return addStatus == errSecSuccess
    }

    func load(forKey key: String) -> Data? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        let result = operations.load(query: query)
        guard result.status == errSecSuccess else {
            return nil
        }
        return result.data
    }

    func delete(forKey key: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key
        ]
        operations.delete(query: query)
    }
}

enum PeerBase64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }
}

struct PeerDeviceIdentity: Equatable {
    let deviceId: String
    let publicKey: String
    let algorithm: String
    let publicKeyFormat: String
    let protection: String
}

enum PeerDeviceIdentityError: Error, Equatable {
    case notEnrolled
    case invalidStoredKey
    case secureEnclaveUnavailable
    case userPresenceCancelled
    case userPresenceDenied
    case userPresenceUnavailable
    case userPresenceRequired
    case signingFailed
}

enum PeerDeviceSigningAuthorization: Equatable {
    case userPresence(reason: String)
    case nonInteractive
}

protocol PeerDeviceKeyOperating: AnyObject {
    func identity() throws -> PeerDeviceIdentity?
    func createIdentity() throws -> PeerDeviceIdentity
    func sign(
        data: Data,
        authorization: PeerDeviceSigningAuthorization
    ) throws -> Data
}

final class SystemPeerSecureEnclaveKeyOperations: PeerDeviceKeyOperating {
    static let applicationTag = Data(
        "com.aurel.forgecompanion.people.secure-enclave-p256.v2".utf8
    )
    static let accessControlFlags: SecAccessControlCreateFlags = [
        .privateKeyUsage,
        .userPresence
    ]

    func identity() throws -> PeerDeviceIdentity? {
        guard let key = try loadPrivateKey(additionalQuery: [:]) else { return nil }
        return try Self.identity(for: key)
    }

    func createIdentity() throws -> PeerDeviceIdentity {
        if let existing = try identity() {
            return existing
        }

        var accessControlError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            Self.accessControlFlags,
            &accessControlError
        ) else {
            throw Self.map(error: accessControlError?.takeRetainedValue())
        }
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits: 256,
            kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs: [
                kSecAttrIsPermanent: true,
                kSecAttrApplicationTag: Self.applicationTag,
                kSecAttrAccessControl: accessControl
            ]
        ]
        var creationError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(
            attributes as CFDictionary,
            &creationError
        ) else {
            if let existing = try identity() {
                return existing
            }
            throw Self.map(error: creationError?.takeRetainedValue())
        }
        return try Self.identity(for: key)
    }

    func sign(
        data: Data,
        authorization: PeerDeviceSigningAuthorization
    ) throws -> Data {
        let context = try Self.authenticationContext(for: authorization)
        let query: [CFString: Any] = [kSecUseAuthenticationContext: context]

        guard let key = try loadPrivateKey(additionalQuery: query) else {
            throw PeerDeviceIdentityError.notEnrolled
        }
        guard SecKeyIsAlgorithmSupported(
            key,
            .sign,
            .ecdsaSignatureMessageX962SHA256
        ) else {
            throw PeerDeviceIdentityError.signingFailed
        }
        var signingError: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            key,
            .ecdsaSignatureMessageX962SHA256,
            data as CFData,
            &signingError
        ) else {
            throw Self.map(error: signingError?.takeRetainedValue())
        }
        return signature as Data
    }

    private func loadPrivateKey(
        additionalQuery: [CFString: Any]
    ) throws -> SecKey? {
        var query: [CFString: Any] = [
            kSecClass: kSecClassKey,
            kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag: Self.applicationTag,
            kSecReturnRef: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        query.merge(additionalQuery) { _, replacement in replacement }
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let item else {
            throw Self.map(status: status)
        }
        return (item as! SecKey)
    }

    static func authenticationContext(
        for authorization: PeerDeviceSigningAuthorization
    ) throws -> LAContext {
        let context = LAContext()
        switch authorization {
        case .userPresence(let reason):
            guard reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
                throw PeerDeviceIdentityError.userPresenceRequired
            }
            context.localizedCancelTitle = "Cancel"
            context.localizedReason = reason
        case .nonInteractive:
            context.interactionNotAllowed = true
        }
        return context
    }

    private static func identity(for privateKey: SecKey) throws -> PeerDeviceIdentity {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw PeerDeviceIdentityError.invalidStoredKey
        }
        var representationError: Unmanaged<CFError>?
        guard let representation = SecKeyCopyExternalRepresentation(
            publicKey,
            &representationError
        ) else {
            throw map(error: representationError?.takeRetainedValue())
        }
        return try PeerDeviceIdentityStore.identity(
            publicKeyX963: representation as Data
        )
    }

    private static func map(error: CFError?) -> PeerDeviceIdentityError {
        guard let error else { return .secureEnclaveUnavailable }
        let value = error as Error as NSError
        if value.domain == LAError.errorDomain,
           let code = LAError.Code(rawValue: value.code)
        {
            switch code {
            case .userCancel, .appCancel, .systemCancel:
                return .userPresenceCancelled
            case .biometryNotAvailable, .passcodeNotSet:
                return .userPresenceUnavailable
            default:
                return .userPresenceDenied
            }
        }
        return map(status: OSStatus(value.code))
    }

    private static func map(status: OSStatus) -> PeerDeviceIdentityError {
        switch status {
        case errSecUserCanceled:
            return .userPresenceCancelled
        case errSecAuthFailed:
            return .userPresenceDenied
        case errSecInteractionNotAllowed:
            return .userPresenceRequired
        case errSecNotAvailable, errSecUnimplemented:
            return .secureEnclaveUnavailable
        default:
            return .signingFailed
        }
    }
}

final class PeerDeviceIdentityStore {
    static let legacyPrivateKeyKey = "forge_peer_device_ed25519_private_key_v1"

    private let keys: PeerDeviceKeyOperating
    private let legacySecrets: PeerSecretStoring
    private let lock = NSLock()

    init(
        keys: PeerDeviceKeyOperating = SystemPeerSecureEnclaveKeyOperations(),
        legacySecrets: PeerSecretStoring = PeerKeychainStore()
    ) {
        self.keys = keys
        self.legacySecrets = legacySecrets
    }

    func identity() throws -> PeerDeviceIdentity {
        lock.lock()
        defer { lock.unlock() }
        guard let identity = try keys.identity() else {
            throw PeerDeviceIdentityError.notEnrolled
        }
        return identity
    }

    func prepareEnrollmentIdentity() throws -> PeerDeviceIdentity {
        lock.lock()
        defer { lock.unlock() }
        return try keys.createIdentity()
    }

    func sign(data: Data, reason: String) throws -> String {
        try sign(data: data, authorization: .userPresence(reason: reason))
    }

    func sign(
        data: Data,
        authorization: PeerDeviceSigningAuthorization
    ) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        return PeerBase64URL.encode(
            try keys.sign(data: data, authorization: authorization)
        )
    }

    func verify(signature: String, data: Data) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard
            let identity = try keys.identity(),
            let publicKeyData = PeerBase64URL.decode(identity.publicKey),
            let signatureData = PeerBase64URL.decode(signature),
            let publicKey = try? P256.Signing.PublicKey(
                x963Representation: publicKeyData
            ),
            let p256Signature = try? P256.Signing.ECDSASignature(
                derRepresentation: signatureData
            )
        else {
            return false
        }
        return publicKey.isValidSignature(p256Signature, for: data)
    }

    func retireLegacySigningKey() {
        lock.lock()
        defer { lock.unlock() }
        legacySecrets.delete(forKey: Self.legacyPrivateKeyKey)
    }

    static func identity(publicKeyX963: Data) throws -> PeerDeviceIdentity {
        guard publicKeyX963.count == 65, publicKeyX963.first == 0x04 else {
            throw PeerDeviceIdentityError.invalidStoredKey
        }
        var identityInput = Data(
            "forge-peer/companion-device/p256-secure-enclave/v2\0".utf8
        )
        identityInput.append(publicKeyX963)
        let digest = SHA256.hash(data: identityInput)
        let identifier = digest.prefix(16).map { String(format: "%02x", $0) }.joined()
        return PeerDeviceIdentity(
            deviceId: "ios_\(identifier)",
            publicKey: PeerBase64URL.encode(publicKeyX963),
            algorithm: "ES256",
            publicKeyFormat: "ansi-x963",
            protection: "secure-enclave-user-presence"
        )
    }
}

struct PeerCompanionEnrollmentContext: Codable, Equatable, Hashable {
    let sessionId: String
    let ownerUserId: String
    let apiBaseURL: String
}

struct PeerPendingCompanionEnrollment: Codable, Equatable {
    let attemptId: String
    let identity: PeerDeviceIdentityRecord
    let createdAt: String
}

struct PeerDeviceIdentityRecord: Codable, Equatable {
    let deviceId: String
    let publicKey: String
    let algorithm: String
    let publicKeyFormat: String
    let protection: String

    init(_ identity: PeerDeviceIdentity) {
        deviceId = identity.deviceId
        publicKey = identity.publicKey
        algorithm = identity.algorithm
        publicKeyFormat = identity.publicKeyFormat
        protection = identity.protection
    }

    var identity: PeerDeviceIdentity {
        PeerDeviceIdentity(
            deviceId: deviceId,
            publicKey: publicKey,
            algorithm: algorithm,
            publicKeyFormat: publicKeyFormat,
            protection: protection
        )
    }
}

struct PeerCompanionEnrollmentReceipt: Codable, Equatable {
    let protocolName: String
    let enrollmentId: String
    let keyId: String
    let pairingSessionId: String
    let ownerUserId: String
    let identity: PeerDeviceIdentityRecord
    let scopes: [String]
    let capabilities: [String]
    let authorizedOperations: [String]
    let enrolledAt: String
    let legacyBootstrapDisabledAt: String
    let legacyBootstrapAccepted: Bool

    private enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case enrollmentId
        case keyId
        case pairingSessionId
        case ownerUserId
        case identity = "device"
        case scopes
        case capabilities
        case authorizedOperations
        case enrolledAt
        case legacyBootstrapDisabledAt
        case legacyBootstrapAccepted
    }
}

private struct PeerCompanionEnrollmentVaultEntry: Codable {
    let context: PeerCompanionEnrollmentContext
    var pending: PeerPendingCompanionEnrollment?
    var receipt: PeerCompanionEnrollmentReceipt?
}

enum PeerCompanionEnrollmentVaultError: Error, Equatable {
    case encodingFailed
    case keychainWriteFailed
    case corrupted
}

final class PeerCompanionEnrollmentVault {
    static let storageKey = "forge_peer_companion_secure_enrollment_v2"

    private let secrets: PeerSecretStoring
    private let lock = NSLock()

    init(secrets: PeerSecretStoring = PeerKeychainStore()) {
        self.secrets = secrets
    }

    func pending(
        context: PeerCompanionEnrollmentContext
    ) throws -> PeerPendingCompanionEnrollment? {
        lock.lock()
        defer { lock.unlock() }
        return try entries().first { $0.context == context }?.pending
    }

    func receipt(
        context: PeerCompanionEnrollmentContext
    ) throws -> PeerCompanionEnrollmentReceipt? {
        lock.lock()
        defer { lock.unlock() }
        return try entries().first { $0.context == context }?.receipt
    }

    func receipt(
        sessionId: String,
        apiBaseURL: String
    ) throws -> PeerCompanionEnrollmentReceipt? {
        lock.lock()
        defer { lock.unlock() }
        let matches = try entries().filter {
            $0.context.sessionId == sessionId &&
                $0.context.apiBaseURL == apiBaseURL &&
                $0.receipt != nil
        }
        guard matches.count == 1 else { return nil }
        return matches[0].receipt
    }

    func savePending(
        _ pending: PeerPendingCompanionEnrollment,
        context: PeerCompanionEnrollmentContext
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        var records = try entries()
        if let index = records.firstIndex(where: { $0.context == context }) {
            records[index].pending = pending
        } else {
            records.append(PeerCompanionEnrollmentVaultEntry(
                context: context,
                pending: pending,
                receipt: nil
            ))
        }
        try save(records)
    }

    func saveReceipt(
        _ receipt: PeerCompanionEnrollmentReceipt,
        context: PeerCompanionEnrollmentContext
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        var records = try entries()
        if let index = records.firstIndex(where: { $0.context == context }) {
            records[index].pending = nil
            records[index].receipt = receipt
        } else {
            records.append(PeerCompanionEnrollmentVaultEntry(
                context: context,
                pending: nil,
                receipt: receipt
            ))
        }
        try save(records)
    }

    private func entries() throws -> [PeerCompanionEnrollmentVaultEntry] {
        guard let data = secrets.load(forKey: Self.storageKey) else { return [] }
        do {
            return try JSONDecoder().decode(
                [PeerCompanionEnrollmentVaultEntry].self,
                from: data
            )
        } catch {
            throw PeerCompanionEnrollmentVaultError.corrupted
        }
    }

    private func save(_ entries: [PeerCompanionEnrollmentVaultEntry]) throws {
        guard let data = try? JSONEncoder().encode(entries) else {
            throw PeerCompanionEnrollmentVaultError.encodingFailed
        }
        guard secrets.save(data, forKey: Self.storageKey) else {
            throw PeerCompanionEnrollmentVaultError.keychainWriteFailed
        }
    }
}

private struct PeerReplayRecord: Codable, Equatable {
    let invitationId: String
    let acceptedAt: Date
}

enum PeerReplayLedgerError: Error {
    case keychainWriteFailed
    case corrupted
}

final class PeerReplayLedger {
    private static let storageKey = "forge_peer_invitation_replay_ledger_v1"
    private static let retention: TimeInterval = 30 * 24 * 60 * 60
    private static let maximumCount = 256

    private let secrets: PeerSecretStoring
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let lock = NSLock()

    init(
        secrets: PeerSecretStoring = PeerKeychainStore()
    ) {
        self.secrets = secrets
    }

    func contains(invitationId: String, now: Date = Date()) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let cutoff = now.addingTimeInterval(-Self.retention)
        return try loadRecords().contains {
            $0.invitationId == invitationId && $0.acceptedAt >= cutoff
        }
    }

    func recordAccepted(invitationId: String, now: Date = Date()) throws {
        lock.lock()
        defer { lock.unlock() }
        let cutoff = now.addingTimeInterval(-Self.retention)
        var records = try loadRecords().filter {
            $0.acceptedAt >= cutoff && $0.invitationId != invitationId
        }
        records.append(PeerReplayRecord(invitationId: invitationId, acceptedAt: now))
        records = Array(records.suffix(Self.maximumCount))
        guard
            let data = try? encoder.encode(records),
            secrets.save(data, forKey: Self.storageKey)
        else {
            throw PeerReplayLedgerError.keychainWriteFailed
        }
    }

    private func loadRecords() throws -> [PeerReplayRecord] {
        guard let data = secrets.load(forKey: Self.storageKey) else {
            return []
        }
        do {
            return try decoder.decode([PeerReplayRecord].self, from: data)
        } catch {
            throw PeerReplayLedgerError.corrupted
        }
    }
}

struct PeerPairingReviewVaultContext: Codable, Equatable {
    let sessionId: String
    let ownerUserId: String
    let apiBaseURL: String
}

private struct PeerPairingReviewVaultRecord: Codable {
    let context: PeerPairingReviewVaultContext?
    let sessionId: String?
    let review: PeerPairingReview

    init(context: PeerPairingReviewVaultContext, review: PeerPairingReview) {
        self.context = context
        sessionId = nil
        self.review = review
    }
}

enum PeerPairingReviewVaultError: Error {
    case encodingFailed
    case keychainWriteFailed
    case corrupted
}

final class PeerPairingReviewVault {
    private static let storageKey = "forge_peer_pending_review_v1"

    private let secrets: PeerSecretStoring
    private let lock = NSLock()

    init(
        secrets: PeerSecretStoring = PeerKeychainStore()
    ) {
        self.secrets = secrets
    }

    func save(_ review: PeerPairingReview, context: PeerPairingReviewVaultContext) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONEncoder().encode(
            PeerPairingReviewVaultRecord(context: context, review: review)
        ) else {
            throw PeerPairingReviewVaultError.encodingFailed
        }
        guard secrets.save(data, forKey: Self.storageKey) else {
            throw PeerPairingReviewVaultError.keychainWriteFailed
        }
    }

    func load(context: PeerPairingReviewVaultContext) throws -> PeerPairingReview? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = secrets.load(forKey: Self.storageKey) else {
            return nil
        }
        let record: PeerPairingReviewVaultRecord
        do {
            record = try JSONDecoder().decode(PeerPairingReviewVaultRecord.self, from: data)
        } catch {
            throw PeerPairingReviewVaultError.corrupted
        }
        if record.context == context ||
            (record.context == nil && record.sessionId == context.sessionId)
        {
            return record.review
        }
        return nil
    }

    func delete() {
        lock.lock()
        defer { lock.unlock() }
        secrets.delete(forKey: Self.storageKey)
    }
}

struct PeerActionCapabilityVaultContext: Codable, Equatable {
    let sessionId: String
    let ownerUserId: String
    let apiBaseURL: String
    let deviceId: String
}

struct PeerStoredActionCapability: Codable, Equatable {
    let id: String
    let secret: String
    let expiresAt: String
}

private struct PeerActionCapabilityVaultRecord: Codable {
    let context: PeerActionCapabilityVaultContext
    let actionDigest: String
    let capability: PeerStoredActionCapability
}

enum PeerActionCapabilityVaultError: Error {
    case encodingFailed
    case keychainWriteFailed
    case corrupted
}

final class PeerActionCapabilityVault {
    private static let storageKey = "forge_peer_pending_action_capability_v1"

    private let secrets: PeerSecretStoring
    private let lock = NSLock()

    init(secrets: PeerSecretStoring = PeerKeychainStore()) {
        self.secrets = secrets
    }

    func save(
        _ capability: PeerStoredActionCapability,
        actionDigest: String,
        context: PeerActionCapabilityVaultContext
    ) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? JSONEncoder().encode(
            PeerActionCapabilityVaultRecord(
                context: context,
                actionDigest: actionDigest,
                capability: capability
            )
        ) else {
            throw PeerActionCapabilityVaultError.encodingFailed
        }
        guard secrets.save(data, forKey: Self.storageKey) else {
            throw PeerActionCapabilityVaultError.keychainWriteFailed
        }
    }

    func load(
        actionDigest: String,
        context: PeerActionCapabilityVaultContext,
        now: Date = Date()
    ) throws -> PeerStoredActionCapability? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = secrets.load(forKey: Self.storageKey) else { return nil }
        let record: PeerActionCapabilityVaultRecord
        do {
            record = try JSONDecoder().decode(PeerActionCapabilityVaultRecord.self, from: data)
        } catch {
            throw PeerActionCapabilityVaultError.corrupted
        }
        guard record.context == context, record.actionDigest == actionDigest else {
            return nil
        }
        guard
            let expiry = PeerDateParser.date(from: record.capability.expiresAt),
            expiry > now
        else {
            return nil
        }
        return record.capability
    }

    func delete() {
        lock.lock()
        defer { lock.unlock() }
        secrets.delete(forKey: Self.storageKey)
    }
}

enum PeerUserPresenceError: Error, Equatable {
    case unavailable
    case denied
    case cancelled
}
