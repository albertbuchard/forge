import CryptoKit
import Foundation
import WebKit

struct PeerTransportRequest {
    let route: PeerAPIRoute
    let pathParameters: [String: String]
    let queryItems: [URLQueryItem]
    let requestTarget: String
    let headers: [String: String]
    let body: Data?
    let pairing: PairingPayload
}

struct PeerTransportResponse {
    let statusCode: Int
    let headers: [String: String]
    let data: Data

    func header(named name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

protocol PeerTransporting: AnyObject {
    func send(_ request: PeerTransportRequest) async throws -> PeerTransportResponse
}

final class LivePeerTransport: PeerTransporting {
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.waitsForConnectivity = false
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 45
            self.session = URLSession(configuration: configuration)
        }
    }

    func send(_ request: PeerTransportRequest) async throws -> PeerTransportResponse {
        if request.pairing.usesIrohTransportForActiveApiUrl,
           let transport = request.pairing.transport
        {
            let result = try await ForgeIrohTransportClient.send(
                method: request.route.method.rawValue,
                path: request.requestTarget,
                headers: request.headers,
                body: request.body,
                transport: transport,
                timeoutInterval: 30
            )
            return PeerTransportResponse(
                statusCode: result.statusCode,
                headers: result.headers,
                data: result.data
            )
        }

        guard var components = URLComponents(string: request.pairing.apiBaseUrl) else {
            throw PeerAPIError.invalidConfiguration
        }
        guard let target = URLComponents(string: request.requestTarget) else {
            throw PeerAPIError.invalidConfiguration
        }
        components.user = nil
        components.password = nil
        components.percentEncodedPath = target.percentEncodedPath
        components.percentEncodedQuery = target.percentEncodedQuery
        guard let url = components.url else {
            throw PeerAPIError.invalidConfiguration
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.route.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.timeoutInterval = 30
        for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PeerAPIError.invalidResponse
        }
        let headers = httpResponse.allHeaderFields.reduce(into: [String: String]()) { result, entry in
            guard let name = entry.key as? String else { return }
            result[name] = String(describing: entry.value)
        }
        return PeerTransportResponse(
            statusCode: httpResponse.statusCode,
            headers: headers,
            data: data
        )
    }

}

struct PeopleWatchOperatorRequest {
    let method: String
    let requestTarget: String
    let headers: [String: String]
    let body: Data?
    let pairing: PairingPayload
}

struct PeopleWatchOperatorResponse {
    let statusCode: Int
    let data: Data
}

@MainActor
protocol PeopleWatchOperatorTransporting: AnyObject {
    func send(_ request: PeopleWatchOperatorRequest) async throws -> PeopleWatchOperatorResponse
}

enum PeopleWatchPinError: Error, Equatable {
    case invalidConfiguration
    case operatorSessionRequired
    case unavailableTransport
    case targetUnavailable
    case invalidResponse
    case offline
    case server(code: String, message: String, status: Int)

    var userMessage: String {
        switch self {
        case .invalidConfiguration:
            return "The paired Forge host is not ready for Watch selection."
        case .operatorSessionRequired:
            return "Open the authenticated Forge web view before changing the Watch Person."
        case .unavailableTransport:
            return "This paired transport cannot yet prove the web operator session for pin changes."
        case .targetUnavailable:
            return "That Person is no longer visible and cannot be shown on Apple Watch."
        case .invalidResponse:
            return "Forge returned an unreadable Watch selection response."
        case .offline:
            return "Forge is unreachable. The last Watch selection remains unchanged."
        case .server(_, let message, _):
            return PeerPrivacyRedactor.redacted(message)
        }
    }

    static func map(_ error: Error) -> PeopleWatchPinError {
        if let pinError = error as? PeopleWatchPinError {
            return pinError
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost,
                 .dnsLookupFailed, .networkConnectionLost, .timedOut:
                return .offline
            default:
                break
            }
        }
        return .invalidResponse
    }
}

@MainActor
final class LivePeopleWatchOperatorTransport: PeopleWatchOperatorTransporting {
    private let session: URLSession
    private let cookieStore: WKHTTPCookieStore

    init(
        session: URLSession? = nil,
        cookieStore: WKHTTPCookieStore? = nil
    ) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = false
            configuration.httpCookieAcceptPolicy = .never
            configuration.waitsForConnectivity = false
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 30
            self.session = URLSession(configuration: configuration)
        }
        self.cookieStore = cookieStore ?? WKWebsiteDataStore.default().httpCookieStore
    }

    func send(_ request: PeopleWatchOperatorRequest) async throws -> PeopleWatchOperatorResponse {
        guard request.pairing.usesIrohTransportForActiveApiUrl == false else {
            throw PeopleWatchPinError.unavailableTransport
        }
        guard var base = URLComponents(string: request.pairing.apiBaseUrl),
              ["http", "https"].contains(base.scheme?.lowercased() ?? ""),
              let target = URLComponents(string: request.requestTarget)
        else {
            throw PeopleWatchPinError.invalidConfiguration
        }
        base.user = nil
        base.password = nil
        base.fragment = nil
        base.percentEncodedPath = target.percentEncodedPath
        base.percentEncodedQuery = target.percentEncodedQuery
        guard let url = base.url else {
            throw PeopleWatchPinError.invalidConfiguration
        }

        let cookies = await matchingCookies(for: url)
        guard cookies.isEmpty == false else {
            throw PeopleWatchPinError.operatorSessionRequired
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body
        urlRequest.httpShouldHandleCookies = false
        for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }

        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PeopleWatchPinError.invalidResponse
        }
        return PeopleWatchOperatorResponse(statusCode: httpResponse.statusCode, data: data)
    }

    private func matchingCookies(for url: URL) async -> [HTTPCookie] {
        let cookies = await withCheckedContinuation { continuation in
            cookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        return cookies.filter { Self.cookie($0, matches: url) }
    }

    static func cookie(_ cookie: HTTPCookie, matches url: URL, now: Date = Date()) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let domainMatches = host == domain || host.hasSuffix(".\(domain)")
        let pathMatches = (url.path.isEmpty ? "/" : url.path).hasPrefix(cookie.path)
        let secureMatches = cookie.isSecure == false || url.scheme?.lowercased() == "https"
        let unexpired = cookie.expiresDate.map { $0 > now } ?? true
        return domainMatches && pathMatches && secureMatches && unexpired
    }
}

@MainActor
final class PeopleWatchPinClient {
    private let transport: PeopleWatchOperatorTransporting
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(transport: PeopleWatchOperatorTransporting? = nil) {
        self.transport = transport ?? LivePeopleWatchOperatorTransport()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    }

    func listPins(pairing: PairingPayload) async throws -> PeopleEntityNavigationEnvelope {
        try await request(
            method: "GET",
            requestTarget: "/api/v1/entity-navigation?pinnedLimit=25&recentLimit=0",
            pairing: pairing
        )
    }

    func pinPerson(
        personId: String,
        ownerUserId: String,
        pairing: PairingPayload
    ) async throws -> PeopleEntityNavigationItem {
        let body = PeopleWatchPinBody(
            entityType: "person",
            entityId: personId,
            ownerUserId: ownerUserId
        )
        let response: PeopleEntityNavigationPinEnvelope = try await request(
            method: "PUT",
            requestTarget: "/api/v1/entity-navigation/pins",
            body: try encoder.encode(body),
            pairing: pairing
        )
        return response.pin
    }

    func unpin(
        pinId: String,
        pairing: PairingPayload
    ) async throws {
        let target = "/api/v1/entity-navigation/pins/\(try encodedPathSegment(pinId))"
        let response: PeopleEntityNavigationUnpinEnvelope = try await request(
            method: "DELETE",
            requestTarget: target,
            pairing: pairing,
            treatingMissingDeleteAsSuccess: true
        )
        guard response.unpinned, response.pinId == pinId else {
            throw PeopleWatchPinError.invalidResponse
        }
    }

    private func request<Response: Decodable>(
        method: String,
        requestTarget: String,
        body: Data? = nil,
        pairing: PairingPayload,
        treatingMissingDeleteAsSuccess: Bool = false
    ) async throws -> Response {
        var headers = ["Accept": "application/json"]
        if body != nil {
            headers["Content-Type"] = "application/json"
        }
        let response: PeopleWatchOperatorResponse
        do {
            response = try await transport.send(PeopleWatchOperatorRequest(
                method: method,
                requestTarget: requestTarget,
                headers: headers,
                body: body,
                pairing: pairing
            ))
        } catch {
            throw PeopleWatchPinError.map(error)
        }

        if treatingMissingDeleteAsSuccess, response.statusCode == 404,
           let pinId = requestTarget.split(separator: "/").last.map(String.init),
           let decodedPinId = pinId.removingPercentEncoding,
           let synthetic = try? decoder.decode(
                Response.self,
                from: try encoder.encode(PeopleEntityNavigationUnpinEnvelope(
                    unpinned: true,
                    pinId: decodedPinId
                ))
           )
        {
            return synthetic
        }
        guard (200..<300).contains(response.statusCode) else {
            throw mapServerError(response)
        }
        do {
            return try decoder.decode(Response.self, from: response.data)
        } catch {
            throw PeopleWatchPinError.invalidResponse
        }
    }

    private func mapServerError(_ response: PeopleWatchOperatorResponse) -> PeopleWatchPinError {
        let envelope = try? decoder.decode(PeerErrorEnvelope.self, from: response.data)
        let code = envelope?.code ?? envelope?.error ?? "entity_navigation_failed"
        let message = envelope?.message ?? envelope?.error ?? "Forge rejected the Watch selection request."
        switch response.statusCode {
        case 401, 403:
            return .operatorSessionRequired
        case 404:
            return .targetUnavailable
        default:
            return .server(code: code, message: message, status: response.statusCode)
        }
    }

    private func encodedPathSegment(_ value: String) throws -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#%")
        guard value.isEmpty == false,
              let encoded = value.addingPercentEncoding(withAllowedCharacters: allowed)
        else {
            throw PeopleWatchPinError.invalidConfiguration
        }
        return encoded
    }
}

enum PeerRequestTarget {
    static func make(path: String, queryItems: [URLQueryItem]) throws -> String {
        guard queryItems.isEmpty == false else { return path }
        var components = URLComponents()
        components.percentEncodedPath = path
        components.queryItems = queryItems
        guard let value = components.string else {
            throw PeerAPIError.invalidConfiguration
        }
        return value
    }
}

enum PeerAPIError: Error, Equatable {
    case invalidConfiguration
    case invalidResponse
    case decodingFailed
    case offline
    case expired
    case replayed
    case revoked
    case companionConsentUnavailable
    case secureEnrollmentRequired
    case secureEnclaveUnavailable
    case operatorSessionRequired
    case secureStorage
    case localAuthentication(PeerUserPresenceError)
    case server(code: String, message: String, status: Int)

    var userMessage: String {
        switch self {
        case .invalidConfiguration:
            return "The current companion session is not ready for People."
        case .invalidResponse, .decodingFailed:
            return "Forge returned an unreadable People response."
        case .offline:
            return "Forge is unreachable. Cached on-screen status is unchanged."
        case .expired:
            return "This invitation or approval has expired."
        case .replayed:
            return "This one-use invitation or approval was already used."
        case .revoked:
            return "This peer relationship has been revoked."
        case .companionConsentUnavailable:
            return "This Forge host does not currently provide companion approval for People."
        case .secureEnrollmentRequired:
            return "People access requires explicit secure enrollment on this iPhone."
        case .secureEnclaveUnavailable:
            return "Secure Enclave enrollment is unavailable on this device."
        case .operatorSessionRequired:
            return "Open the authenticated Forge web view before enrolling People access."
        case .secureStorage:
            return "Secure People recovery storage is unavailable. No new action was sent."
        case .localAuthentication(let error):
            switch error {
            case .cancelled:
                return "Approval was cancelled. No peer action was sent."
            case .denied:
                return "Device authentication failed. No peer action was sent."
            case .unavailable:
                return "Device authentication is unavailable."
            }
        case .server(_, let message, _):
            return PeerPrivacyRedactor.redacted(message)
        }
    }

    static func map(_ error: Error) -> PeerAPIError {
        if let peerError = error as? PeerAPIError {
            return peerError
        }
        if let identityError = error as? PeerDeviceIdentityError {
            switch identityError {
            case .notEnrolled:
                return .secureEnrollmentRequired
            case .secureEnclaveUnavailable:
                return .secureEnclaveUnavailable
            case .userPresenceCancelled:
                return .localAuthentication(.cancelled)
            case .userPresenceDenied, .userPresenceRequired:
                return .localAuthentication(.denied)
            case .userPresenceUnavailable:
                return .localAuthentication(.unavailable)
            case .invalidStoredKey, .signingFailed:
                return .secureStorage
            }
        }
        if error is PeerCompanionEnrollmentVaultError {
            return .secureStorage
        }
        let urlError = error as? URLError
        switch urlError?.code {
        case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost,
             .dnsLookupFailed, .networkConnectionLost, .timedOut:
            return .offline
        default:
            return .invalidResponse
        }
    }
}

private struct PeerErrorEnvelope: Decodable {
    let code: String?
    let error: String?
    let message: String?
}

struct PeerPresenceAction: Codable, Hashable {
    let ownerUserId: String
    let method: PeerHTTPMethod
    let routePath: String
    let pathParams: [String: String]
    let expectedVersion: String?
    let body: PeerJSONValue
}

private struct PeerPresenceOptionsBody: Encodable {
    let ceremony = "companion_consent"
    let action: PeerPresenceAction
    let companionDeviceId: String
}

private struct PeerPresenceVerifyBody: Encodable {
    struct Verification: Encodable {
        let kind = "companion_signature"
        let deviceId: String
        let challenge: String
        let signature: String
        let algorithm: String
        let keyId: String
    }

    let challengeId: String
    let action: PeerPresenceAction
    let verification: Verification
}

private struct PeerCompanionRequestProof: Encodable {
    let bodySha256: String
    let deviceId: String
    let enrollmentId: String
    let issuedAt: String
    let keyId: String
    let method: String
    let nonce: String
    let ownerUserId: String
    let path: String
    let protocolName: String
    let sessionId: String

    private enum CodingKeys: String, CodingKey {
        case bodySha256
        case deviceId
        case enrollmentId
        case issuedAt
        case keyId
        case method
        case nonce
        case ownerUserId
        case path
        case protocolName = "protocol"
        case sessionId
    }
}

private struct PeerConsentChallenge: Decodable {
    let protocolName: String
    let challengeId: String
    let challenge: String
    let actionDigest: String
    let deviceId: String
    let ownerUserId: String
    let principalId: String
    let issuedAt: String
    let expiresAt: String

    private enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case challengeId
        case challenge
        case actionDigest
        case deviceId
        case ownerUserId
        case principalId
        case issuedAt
        case expiresAt
    }
}

private struct PeerConsentSignatureProof: Encodable {
    let actionDigest: String
    let algorithm: String
    let challenge: String
    let challengeId: String
    let deviceId: String
    let expiresAt: String
    let issuedAt: String
    let keyId: String
    let ownerUserId: String
    let principalId: String
    let protocolName: String

    private enum CodingKeys: String, CodingKey {
        case actionDigest
        case algorithm
        case challenge
        case challengeId
        case deviceId
        case expiresAt
        case issuedAt
        case keyId
        case ownerUserId
        case principalId
        case protocolName = "protocol"
    }
}

private struct PeerPresenceCapability {
    let id: String
    let secret: String
    let expiresAt: String

    var cookie: String {
        "forge_peer_presence=\(id).\(secret)"
    }

    static func parse(response: PeerTransportResponse) -> PeerPresenceCapability? {
        guard
            let raw = try? JSONDecoder().decode(PeerJSONValue.self, from: response.data),
            let object = raw.objectValue,
            let expiresAt = object["expiresAt"]?.stringValue,
            let expiry = PeerDateParser.date(from: expiresAt),
            expiry > Date()
        else {
            return nil
        }
        if let setCookie = response.header(named: "set-cookie") {
            let first = setCookie.split(separator: ";", maxSplits: 1).first.map(String.init) ?? ""
            let prefix = "forge_peer_presence="
            if first.hasPrefix(prefix) {
                let value = String(first.dropFirst(prefix.count))
                let pieces = value.split(separator: ".", maxSplits: 1).map(String.init)
                if pieces.count == 2, pieces[0].isEmpty == false, pieces[1].count == 43 {
                    return PeerPresenceCapability(
                        id: pieces[0],
                        secret: pieces[1],
                        expiresAt: expiresAt
                    )
                }
            }
        }
        guard let id = object["capabilityId"]?.stringValue,
              let secret = object["secret"]?.stringValue
        else {
            return nil
        }
        return PeerPresenceCapability(id: id, secret: secret, expiresAt: expiresAt)
    }
}

enum PeerCompanionSecurityContract {
    // Enrollment endpoints accept only the authenticated human operator cookie.
    // Pairing tokens and companion request headers are intentionally absent.
    static let enrollmentProtocol = "forge-peer-companion-enrollment/v2"
    static let requestProtocol = "forge-peer-companion-request/v2"
    static let consentProtocol = "forge-peer-companion-consent/v2"
    static let scopes: Set<String> = [
        "peer:grants:manage",
        "peer:query",
        "peer:status"
    ]
    static let capabilities: Set<String> = [
        enrollmentProtocol,
        requestProtocol,
        consentProtocol
    ]
    static var authorizedOperations: Set<String> {
        Set(PeerAPIRoute.allCases.map(\.rawValue))
    }
    static func isValidChallenge(_ value: String) -> Bool {
        value.count == 43 && PeerBase64URL.decode(value)?.count == 32
    }
    static let enrollmentOptionsPath =
        "/api/v1/peers/companion-enrollments/options"
    static let enrollmentVerifyPath =
        "/api/v1/peers/companion-enrollments/verify"
}

private struct PeerCompanionEnrollmentOptionsBody: Encodable {
    let protocolName = PeerCompanionSecurityContract.enrollmentProtocol
    let enrollmentAttemptId: String
    let pairingSessionId: String
    let device: PeerDeviceIdentityRecord

    private enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case enrollmentAttemptId
        case pairingSessionId
        case device
    }
}

private struct PeerCompanionEnrollmentChallenge: Decodable {
    let protocolName: String
    let challengeId: String
    let challenge: String
    let enrollmentAttemptId: String
    let pairingSessionId: String
    let ownerUserId: String
    let device: PeerDeviceIdentityRecord
    let issuedAt: String
    let expiresAt: String

    private enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case challengeId
        case challenge
        case enrollmentAttemptId
        case pairingSessionId
        case ownerUserId
        case device
        case issuedAt
        case expiresAt
    }
}

private struct PeerCompanionEnrollmentProof: Encodable {
    let algorithm: String
    let challenge: String
    let challengeId: String
    let deviceId: String
    let enrollmentAttemptId: String
    let expiresAt: String
    let issuedAt: String
    let ownerUserId: String
    let pairingSessionId: String
    let protocolName: String
    let publicKey: String
    let publicKeyFormat: String
    let protection: String

    private enum CodingKeys: String, CodingKey {
        case algorithm
        case challenge
        case challengeId
        case deviceId
        case enrollmentAttemptId
        case expiresAt
        case issuedAt
        case ownerUserId
        case pairingSessionId
        case protocolName = "protocol"
        case publicKey
        case publicKeyFormat
        case protection
    }
}

private struct PeerCompanionEnrollmentVerifyBody: Encodable {
    let protocolName = PeerCompanionSecurityContract.enrollmentProtocol
    let challengeId: String
    let enrollmentAttemptId: String
    let pairingSessionId: String
    let signature: String

    private enum CodingKeys: String, CodingKey {
        case protocolName = "protocol"
        case challengeId
        case enrollmentAttemptId
        case pairingSessionId
        case signature
    }
}

final class PeerAPIClient {
    private let transport: PeerTransporting
    private let capabilityVault: PeerActionCapabilityVault
    private let enrollmentVault: PeerCompanionEnrollmentVault
    private let enrollmentTransport: PeopleWatchOperatorTransporting?
    let identityStore: PeerDeviceIdentityStore
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(
        transport: PeerTransporting = LivePeerTransport(),
        identityStore: PeerDeviceIdentityStore = PeerDeviceIdentityStore(),
        capabilityVault: PeerActionCapabilityVault = PeerActionCapabilityVault(),
        enrollmentVault: PeerCompanionEnrollmentVault = PeerCompanionEnrollmentVault(),
        enrollmentTransport: PeopleWatchOperatorTransporting? = nil
    ) {
        self.transport = transport
        self.identityStore = identityStore
        self.capabilityVault = capabilityVault
        self.enrollmentVault = enrollmentVault
        self.enrollmentTransport = enrollmentTransport
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    }

    func hasSecureEnrollment(
        pairing: PairingPayload,
        ownerUserId: String
    ) throws -> Bool {
        let context = enrollmentContext(pairing: pairing, ownerUserId: ownerUserId)
        guard let receipt = try enrollmentVault.receipt(context: context) else {
            return false
        }
        let identity = try identityStore.identity()
        return receiptMatches(
            receipt,
            identity: identity,
            pairing: pairing,
            ownerUserId: ownerUserId
        )
    }

    @MainActor
    func enrollCompanion(
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerCompanionEnrollmentReceipt {
        guard pairing.usesIrohTransportForActiveApiUrl == false else {
            throw PeerAPIError.operatorSessionRequired
        }
        let context = enrollmentContext(pairing: pairing, ownerUserId: ownerUserId)
        let identity = try identityStore.prepareEnrollmentIdentity()
        let pending: PeerPendingCompanionEnrollment
        if let retained = try enrollmentVault.pending(context: context) {
            guard retained.identity.identity == identity else {
                throw PeerAPIError.secureStorage
            }
            pending = retained
        } else {
            pending = PeerPendingCompanionEnrollment(
                attemptId: UUID().uuidString.lowercased(),
                identity: PeerDeviceIdentityRecord(identity),
                createdAt: ISO8601DateFormatter().string(from: Date())
            )
            try enrollmentVault.savePending(pending, context: context)
        }

        let optionsBody = try encoder.encode(PeerCompanionEnrollmentOptionsBody(
            enrollmentAttemptId: pending.attemptId,
            pairingSessionId: pairing.sessionId,
            device: pending.identity
        ))
        let options = try await enrollmentRequest(
            path: PeerCompanionSecurityContract.enrollmentOptionsPath,
            body: optionsBody,
            pairing: pairing
        )
        let challenge: PeerCompanionEnrollmentChallenge
        do {
            challenge = try decoder.decode(
                PeerCompanionEnrollmentChallenge.self,
                from: options.data
            )
        } catch {
            throw PeerAPIError.decodingFailed
        }
        let now = Date()
        guard
            challenge.protocolName == PeerCompanionSecurityContract.enrollmentProtocol,
            challenge.challengeId.isEmpty == false,
            PeerCompanionSecurityContract.isValidChallenge(challenge.challenge),
            challenge.enrollmentAttemptId == pending.attemptId,
            challenge.pairingSessionId == pairing.sessionId,
            challenge.ownerUserId == ownerUserId,
            challenge.device == pending.identity,
            let issuedAt = PeerDateParser.date(from: challenge.issuedAt),
            let expiresAt = PeerDateParser.date(from: challenge.expiresAt),
            issuedAt <= now.addingTimeInterval(30),
            expiresAt > now,
            expiresAt > issuedAt,
            expiresAt.timeIntervalSince(issuedAt) <= 5 * 60
        else {
            throw PeerAPIError.invalidResponse
        }
        let proof = PeerCompanionEnrollmentProof(
            algorithm: identity.algorithm,
            challenge: challenge.challenge,
            challengeId: challenge.challengeId,
            deviceId: identity.deviceId,
            enrollmentAttemptId: pending.attemptId,
            expiresAt: challenge.expiresAt,
            issuedAt: challenge.issuedAt,
            ownerUserId: challenge.ownerUserId,
            pairingSessionId: pairing.sessionId,
            protocolName: challenge.protocolName,
            publicKey: identity.publicKey,
            publicKeyFormat: identity.publicKeyFormat,
            protection: identity.protection
        )
        let signature: String
        do {
            signature = try identityStore.sign(
                data: encoder.encode(proof),
                reason: "Enroll this iPhone for Forge People"
            )
        } catch {
            throw PeerAPIError.map(error)
        }
        let verifyBody = try encoder.encode(PeerCompanionEnrollmentVerifyBody(
            challengeId: challenge.challengeId,
            enrollmentAttemptId: pending.attemptId,
            pairingSessionId: pairing.sessionId,
            signature: signature
        ))
        let verification = try await enrollmentRequest(
            path: PeerCompanionSecurityContract.enrollmentVerifyPath,
            body: verifyBody,
            pairing: pairing
        )
        let receipt: PeerCompanionEnrollmentReceipt
        do {
            receipt = try decoder.decode(
                PeerCompanionEnrollmentReceipt.self,
                from: verification.data
            )
        } catch {
            throw PeerAPIError.decodingFailed
        }
        guard receiptMatches(
            receipt,
            identity: identity,
            pairing: pairing,
            ownerUserId: ownerUserId
        ),
            receipt.protocolName == PeerCompanionSecurityContract.enrollmentProtocol,
            Set(receipt.scopes) == PeerCompanionSecurityContract.scopes,
            Set(receipt.capabilities) == PeerCompanionSecurityContract.capabilities,
            Set(receipt.authorizedOperations) ==
                PeerCompanionSecurityContract.authorizedOperations,
            receipt.legacyBootstrapAccepted == false,
            PeerDateParser.date(from: receipt.legacyBootstrapDisabledAt) != nil
        else {
            throw PeerAPIError.invalidResponse
        }
        try enrollmentVault.saveReceipt(receipt, context: context)
        identityStore.retireLegacySigningKey()
        return receipt
    }

    func presenceStatus(pairing: PairingPayload) async throws -> PeerPresenceStatusEnvelope {
        try await request(route: .getPeerHumanPresenceStatus, pairing: pairing)
    }

    func listRelationships(
        pairing: PairingPayload,
        cursor: String? = nil
    ) async throws -> PeerRelationshipsEnvelope {
        var queryItems = [URLQueryItem(name: "limit", value: "100")]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await request(
            route: .listPeerRelationships,
            queryItems: queryItems,
            pairing: pairing
        )
    }

    func listRequests(
        pairing: PairingPayload,
        cursor: String? = nil
    ) async throws -> PeerRequestsEnvelope {
        var queryItems = [
            URLQueryItem(name: "status", value: "pending"),
            URLQueryItem(name: "limit", value: "100")
        ]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await request(
            route: .listPeerRequests,
            queryItems: queryItems,
            pairing: pairing
        )
    }

    func relationship(
        id: String,
        pairing: PairingPayload
    ) async throws -> PeerRelationshipEnvelope {
        try await request(
            route: .getPeerRelationship,
            pathParameters: ["relationshipId": id],
            pairing: pairing
        )
    }

    func devices(
        relationshipId: String,
        pairing: PairingPayload
    ) async throws -> PeerDevicesEnvelope {
        try await request(
            route: .listPeerDevices,
            pathParameters: ["relationshipId": relationshipId],
            pairing: pairing
        )
    }

    func grants(
        relationshipId: String,
        pairing: PairingPayload,
        cursor: String? = nil
    ) async throws -> PeerGrantsEnvelope {
        var queryItems = [URLQueryItem(name: "limit", value: "100")]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await request(
            route: .listPeerGrants,
            pathParameters: ["relationshipId": relationshipId],
            queryItems: queryItems,
            pairing: pairing
        )
    }

    func previewGrant(
        draft: PeerGrantDraft,
        relationship: PeerRelationship,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerGrantPreviewEnvelope {
        try await approvedRequest(
            route: .previewPeerGrant,
            pathParameters: ["relationshipId": relationship.id],
            expectedVersion: relationship.updatedAt,
            body: PreviewPeerGrantBody(
                draft: draft,
                sampleLimit: 25,
                includeWorstCase: true
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Preview this exact sharing grant"
        )
    }

    func proposeGrant(
        draft: PeerGrantDraft,
        preview: PeerGrantPreview,
        relationship: PeerRelationship,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerGrantMutationEnvelope {
        guard preview.relationshipVersion == relationship.updatedAt else {
            throw PeerAPIError.invalidResponse
        }
        let idempotencyKey = try idempotencyKey(
            route: .proposePeerGrant,
            expectedVersion: preview.relationshipVersion,
            payload: PeerGrantDraftIdempotencyMaterial(
                previewHash: preview.hash,
                draft: draft
            )
        )
        return try await approvedRequest(
            route: .proposePeerGrant,
            pathParameters: ["relationshipId": relationship.id],
            expectedVersion: preview.relationshipVersion,
            body: ProposePeerGrantBody(
                expectedRelationshipVersion: preview.relationshipVersion,
                previewHash: preview.hash,
                idempotencyKey: idempotencyKey,
                draft: draft
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Propose this reviewed sharing grant"
        )
    }

    func diagnostics(
        relationshipId: String,
        pairing: PairingPayload,
        cursor: String? = nil
    ) async throws -> PeerDiagnosticsEnvelope {
        var queryItems = [URLQueryItem(name: "limit", value: "100")]
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await request(
            route: .getPeerDiagnostics,
            pathParameters: ["relationshipId": relationshipId],
            queryItems: queryItems,
            pairing: pairing
        )
    }

    func syncStatus(
        relationshipId: String,
        pairing: PairingPayload
    ) async throws -> PeerSyncEnvelope {
        try await request(
            route: .getPeerSyncStatus,
            pathParameters: ["relationshipId": relationshipId],
            pairing: pairing
        )
    }

    func acceptScannedInvitation(
        review: PeerPairingReview,
        localPeerDeviceId: String,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerPairingAcceptanceEnvelope {
        guard
            let scannedAt = review.scannedAt,
            let idempotencyKey = review.acceptIdempotencyKey
        else {
            throw PeerAPIError.invalidConfiguration
        }
        let body = AcceptPeerPairingBody(
            invitation: review.envelope.invitation,
            scannedAt: scannedAt,
            localDeviceId: localPeerDeviceId,
            privacyMode: "fastest",
            idempotencyKey: idempotencyKey
        )
        return try await approvedRequest(
            route: .acceptScannedPeerPairing,
            expectedVersion: nil,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Review this Forge peer invitation"
        )
    }

    func confirmPairing(
        review: PeerPairingReview,
        personName: String,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerPairingConfirmationEnvelope {
        guard
            let pairingId = review.pairingId,
            let expectedVersion = review.expectedVersion,
            let transcriptHash = review.transcriptHash,
            let verificationPhrase = review.verificationPhrase
        else {
            throw PeerAPIError.invalidResponse
        }
        let body = ConfirmPeerPairingBody(
            expectedVersion: expectedVersion,
            transcriptHash: transcriptHash,
            verificationPhrase: verificationPhrase,
            personId: nil,
            createPersonDisplayName: personName,
            idempotencyKey: review.confirmIdempotencyKey ?? ""
        )
        guard body.idempotencyKey.isEmpty == false else {
            throw PeerAPIError.invalidConfiguration
        }
        return try await approvedRequest(
            route: .confirmPeerPairing,
            pathParameters: ["pairingId": pairingId],
            expectedVersion: expectedVersion,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Confirm this verified Forge relationship"
        )
    }

    func createInvitation(
        label: String,
        idempotencyKey: String,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerInvitationEnvelope {
        let body = CreatePeerInvitationBody(
            label: label,
            expiresInSeconds: 300,
            privacyMode: "fastest",
            transportKinds: ["local_direct"],
            idempotencyKey: idempotencyKey
        )
        return try await approvedRequest(
            route: .createPeerInvitation,
            expectedVersion: nil,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Create a one-use Forge peer invitation"
        )
    }

    func invitationStatus(
        invitationId: String,
        pairing: PairingPayload
    ) async throws -> PeerInvitationStatusEnvelope {
        try await request(
            route: .getPeerInvitationStatus,
            pathParameters: ["invitationId": invitationId],
            pairing: pairing
        )
    }

    func cancelInvitation(
        _ status: PeerInvitationStatus,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerInvitationCancellationEnvelope {
        try await approvedRequest(
            route: .cancelPeerInvitation,
            pathParameters: ["invitationId": status.id],
            expectedVersion: status.updatedAt,
            body: PeerInvitationCancellationBody(
                expectedVersion: status.updatedAt
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Cancel this one-use Forge peer invitation"
        )
    }

    func decideRequest(
        _ request: PeerPendingRequest,
        accept: Bool,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerRequestMutationEnvelope {
        let body = PeerRequestDecisionBody(
            expectedVersion: String(request.version),
            reason: accept
                ? "Accepted from Forge Companion"
                : "Rejected from Forge Companion"
        )
        return try await approvedRequest(
            route: accept ? .acceptPeerRequest : .rejectPeerRequest,
            pathParameters: ["requestId": request.id],
            expectedVersion: String(request.version),
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: accept
                ? "Accept this exact \(request.kind) request"
                : "Reject this exact \(request.kind) request"
        )
    }

    func mutateDevice(
        route: PeerAPIRoute,
        relationship: PeerRelationship,
        device: PeerDevice,
        reason: String,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerDeviceMutationEnvelope {
        guard route == .approvePeerDevice || route == .removePeerDevice else {
            throw PeerAPIError.invalidConfiguration
        }
        let body = PeerDeviceMutationBody(
            expectedVersion: relationship.updatedAt,
            label: route == .approvePeerDevice ? device.label : nil,
            reason: reason
        )
        return try await approvedRequest(
            route: route,
            pathParameters: [
                "relationshipId": relationship.id,
                "deviceId": device.deviceId
            ],
            expectedVersion: relationship.updatedAt,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: route == .approvePeerDevice
                ? "Approve this exact peer device"
                : "Remove this exact peer device"
        )
    }

    func revokeRelationship(
        _ relationship: PeerRelationship,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerRelationshipMutationEnvelope {
        let body = RevokePeerRelationshipBody(
            expectedVersion: relationship.updatedAt,
            reason: "Revoked from Forge Companion",
            purgeManagedCache: true
        )
        return try await approvedRequest(
            route: .revokePeerRelationship,
            pathParameters: ["relationshipId": relationship.id],
            expectedVersion: relationship.updatedAt,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Revoke this Forge peer relationship"
        )
    }

    func revokeGrant(
        _ grant: PeerGrant,
        expectedVersionHash: String,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerGrantMutationEnvelope {
        let body = RevokePeerGrantBody(
            expectedVersionHash: expectedVersionHash,
            reason: "Revoked from Forge Companion",
            purgeManagedCache: true
        )
        return try await approvedRequest(
            route: .revokePeerGrant,
            pathParameters: ["grantId": grant.id],
            expectedVersion: expectedVersionHash,
            body: body,
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Revoke this exact sharing grant"
        )
    }

    func acceptGrant(
        _ grant: PeerGrant,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerGrantMutationEnvelope {
        guard let versionHash = grant.versionHash else {
            throw PeerAPIError.invalidConfiguration
        }
        let idempotencyKey = try idempotencyKey(
            route: .acceptPeerGrant,
            expectedVersion: versionHash,
            payload: PeerGrantIdentityIdempotencyMaterial(grantId: grant.id)
        )
        return try await approvedRequest(
            route: .acceptPeerGrant,
            pathParameters: ["grantId": grant.id],
            expectedVersion: versionHash,
            body: AcceptPeerGrantBody(
                expectedVersionHash: versionHash,
                idempotencyKey: idempotencyKey
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Accept this exact sharing grant"
        )
    }

    func counterGrant(
        _ grant: PeerGrant,
        draft: PeerGrantDraft,
        preview: PeerGrantPreview,
        relationship: PeerRelationship,
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerGrantMutationEnvelope {
        guard
            let versionHash = grant.versionHash,
            grant.relationshipId == relationship.id,
            preview.relationshipVersion == relationship.updatedAt
        else {
            throw PeerAPIError.invalidConfiguration
        }
        let idempotencyKey = try idempotencyKey(
            route: .counterPeerGrant,
            expectedVersion: versionHash,
            payload: PeerGrantDraftIdempotencyMaterial(
                previewHash: preview.hash,
                draft: draft
            )
        )
        return try await approvedRequest(
            route: .counterPeerGrant,
            pathParameters: ["grantId": grant.id],
            expectedVersion: versionHash,
            body: CounterPeerGrantBody(
                expectedVersionHash: versionHash,
                previewHash: preview.hash,
                idempotencyKey: idempotencyKey,
                draft: draft
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Send this reviewed narrower counter-proposal"
        )
    }

    func requestResync(
        relationship: PeerRelationship,
        projectionIds: [String],
        pairing: PairingPayload,
        ownerUserId: String
    ) async throws -> PeerResyncEnvelope {
        let boundedProjectionIds = Array(Set(projectionIds)).sorted()
        guard (1...8).contains(boundedProjectionIds.count) else {
            throw PeerAPIError.invalidConfiguration
        }
        let idempotencyKey = try idempotencyKey(
            route: .requestPeerResync,
            expectedVersion: relationship.updatedAt,
            payload: PeerResyncIdempotencyMaterial(
                relationshipId: relationship.id,
                projectionIds: boundedProjectionIds
            )
        )
        return try await approvedRequest(
            route: .requestPeerResync,
            pathParameters: ["relationshipId": relationship.id],
            expectedVersion: relationship.updatedAt,
            body: RequestPeerResyncBody(
                expectedRelationshipVersion: relationship.updatedAt,
                projectionIds: boundedProjectionIds,
                idempotencyKey: idempotencyKey
            ),
            pairing: pairing,
            ownerUserId: ownerUserId,
            reason: "Request this bounded peer resync"
        )
    }

    private func request<Response: Decodable>(
        route: PeerAPIRoute,
        pathParameters: [String: String] = [:],
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        pairing: PairingPayload,
        capability: PeerPresenceCapability? = nil,
        signingReason: String? = nil
    ) async throws -> Response {
        let response = try await rawRequest(
            route: route,
            pathParameters: pathParameters,
            queryItems: queryItems,
            body: body,
            pairing: pairing,
            capability: capability,
            signingReason: signingReason
        )
        do {
            return try decoder.decode(Response.self, from: response.data)
        } catch {
            throw PeerAPIError.decodingFailed
        }
    }

    private func approvedRequest<Body: Encodable, Response: Decodable>(
        route: PeerAPIRoute,
        pathParameters: [String: String] = [:],
        expectedVersion: String?,
        body: Body,
        pairing: PairingPayload,
        ownerUserId: String,
        reason: String
    ) async throws -> Response {
        guard route.requiresHumanApproval else {
            throw PeerAPIError.invalidConfiguration
        }
        let identity: PeerDeviceIdentity
        let enrollment: PeerCompanionEnrollmentReceipt
        do {
            identity = try identityStore.identity()
            enrollment = try secureEnrollmentReceipt(
                pairing: pairing,
                identity: identity
            )
        } catch {
            throw PeerAPIError.map(error)
        }
        guard enrollment.ownerUserId == ownerUserId else {
            throw PeerAPIError.secureEnrollmentRequired
        }
        let bodyData = try encoder.encode(body)
        let bodyJSON = try decoder.decode(PeerJSONValue.self, from: bodyData)
        let action = PeerPresenceAction(
            ownerUserId: ownerUserId,
            method: route.method,
            routePath: route.pathTemplate,
            pathParams: pathParameters,
            expectedVersion: expectedVersion,
            body: bodyJSON
        )
        let actionDigest = try presenceActionDigest(action)
        let capabilityContext = PeerActionCapabilityVaultContext(
            sessionId: pairing.sessionId,
            ownerUserId: ownerUserId,
            apiBaseURL: pairing.apiBaseUrl,
            deviceId: identity.deviceId
        )
        do {
            if let stored = try capabilityVault.load(
                actionDigest: actionDigest,
                context: capabilityContext
            ) {
                let retained = PeerPresenceCapability(
                    id: stored.id,
                    secret: stored.secret,
                    expiresAt: stored.expiresAt
                )
                do {
                    let response: Response = try await request(
                        route: route,
                        pathParameters: pathParameters,
                        body: bodyData,
                        pairing: pairing,
                        capability: retained,
                        signingReason: reason
                    )
                    capabilityVault.delete()
                    return response
                } catch let error as PeerAPIError {
                    if case .server(let code, _, _) = error,
                       code == "peer_human_approval_invalid"
                    {
                        capabilityVault.delete()
                    } else {
                        throw error
                    }
                }
            }
        } catch is PeerActionCapabilityVaultError {
            throw PeerAPIError.secureStorage
        }
        let optionsData = try encoder.encode(
            PeerPresenceOptionsBody(
                action: action,
                companionDeviceId: identity.deviceId
            )
        )
        let optionsResponse = try await rawRequest(
            route: .createPeerHumanPresenceOptions,
            body: optionsData,
            pairing: pairing,
            signingReason: reason
        )
        try Task.checkCancellation()
        let challenge: PeerConsentChallenge
        do {
            challenge = try decoder.decode(PeerConsentChallenge.self, from: optionsResponse.data)
        } catch {
            throw PeerAPIError.decodingFailed
        }
        let now = Date()
        guard
            challenge.protocolName == PeerCompanionSecurityContract.consentProtocol,
            challenge.challengeId.isEmpty == false,
            PeerCompanionSecurityContract.isValidChallenge(challenge.challenge),
            challenge.deviceId == identity.deviceId,
            challenge.ownerUserId == ownerUserId,
            challenge.principalId == pairing.sessionId,
            challenge.actionDigest == actionDigest,
            let issuedAt = PeerDateParser.date(from: challenge.issuedAt),
            let expiry = PeerDateParser.date(from: challenge.expiresAt),
            issuedAt <= now.addingTimeInterval(30),
            expiry > now,
            expiry > issuedAt,
            expiry.timeIntervalSince(issuedAt) <= 5 * 60
        else {
            throw PeerAPIError.invalidResponse
        }
        let consentProof = PeerConsentSignatureProof(
            actionDigest: challenge.actionDigest,
            algorithm: identity.algorithm,
            challenge: challenge.challenge,
            challengeId: challenge.challengeId,
            deviceId: challenge.deviceId,
            expiresAt: challenge.expiresAt,
            issuedAt: challenge.issuedAt,
            keyId: enrollment.keyId,
            ownerUserId: challenge.ownerUserId,
            principalId: challenge.principalId,
            protocolName: challenge.protocolName
        )
        let verificationData = try encoder.encode(
            PeerPresenceVerifyBody(
                challengeId: challenge.challengeId,
                action: action,
                verification: .init(
                    deviceId: identity.deviceId,
                    challenge: challenge.challenge,
                    signature: try identityStore.sign(
                        data: encoder.encode(consentProof),
                        reason: reason
                    ),
                    algorithm: identity.algorithm,
                    keyId: enrollment.keyId
                )
            )
        )
        let verificationResponse = try await rawRequest(
            route: .verifyPeerHumanPresence,
            body: verificationData,
            pairing: pairing,
            signingReason: reason
        )
        try Task.checkCancellation()
        guard let capability = PeerPresenceCapability.parse(response: verificationResponse) else {
            throw PeerAPIError.companionConsentUnavailable
        }
        try Task.checkCancellation()
        do {
            try capabilityVault.save(
                PeerStoredActionCapability(
                    id: capability.id,
                    secret: capability.secret,
                    expiresAt: capability.expiresAt
                ),
                actionDigest: actionDigest,
                context: capabilityContext
            )
        } catch {
            throw PeerAPIError.secureStorage
        }
        let response: Response = try await request(
            route: route,
            pathParameters: pathParameters,
            body: bodyData,
            pairing: pairing,
            capability: capability,
            signingReason: reason
        )
        capabilityVault.delete()
        return response
    }

    private func presenceActionDigest(_ action: PeerPresenceAction) throws -> String {
        var data = Data("forge-peer/human-presence-action/v1\0".utf8)
        data.append(try encoder.encode(action))
        return SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func idempotencyKey<Payload: Encodable>(
        route: PeerAPIRoute,
        expectedVersion: String,
        payload: Payload
    ) throws -> String {
        var data = Data("forge-peer/ios-idempotency/v1\0".utf8)
        data.append(Data(route.rawValue.utf8))
        data.append(0)
        data.append(Data(expectedVersion.utf8))
        data.append(0)
        data.append(try encoder.encode(payload))
        let digest = SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
        return "ios-\(route.rawValue)-\(digest)"
    }

    private func rawRequest(
        route: PeerAPIRoute,
        pathParameters: [String: String] = [:],
        queryItems: [URLQueryItem] = [],
        body: Data? = nil,
        pairing: PairingPayload,
        capability: PeerPresenceCapability? = nil,
        signingReason: String? = nil
    ) async throws -> PeerTransportResponse {
        try Task.checkCancellation()
        let identity: PeerDeviceIdentity
        let enrollment: PeerCompanionEnrollmentReceipt
        let requestTarget: String
        let requestSignature: String
        let bodyDigest: String
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let issuedAt = ISO8601DateFormatter().string(from: Date())
        do {
            identity = try identityStore.identity()
            enrollment = try secureEnrollmentReceipt(
                pairing: pairing,
                identity: identity
            )
            let path = try route.resolvedPath(parameters: pathParameters)
            requestTarget = try PeerRequestTarget.make(path: path, queryItems: queryItems)
            bodyDigest = SHA256.hash(data: body ?? Data())
                .map { String(format: "%02x", $0) }
                .joined()
            let proof = PeerCompanionRequestProof(
                bodySha256: bodyDigest,
                deviceId: identity.deviceId,
                enrollmentId: enrollment.enrollmentId,
                issuedAt: issuedAt,
                keyId: enrollment.keyId,
                method: route.method.rawValue,
                nonce: nonce,
                ownerUserId: enrollment.ownerUserId,
                path: requestTarget,
                protocolName: PeerCompanionSecurityContract.requestProtocol,
                sessionId: pairing.sessionId
            )
            requestSignature = try identityStore.sign(
                data: encoder.encode(proof),
                reason: signingReason ?? "Access Forge People on this iPhone"
            )
        } catch let error as PeerAPIError {
            throw error
        } catch {
            throw PeerAPIError.map(error)
        }
        var headers = [
            "Accept": "application/json",
            "X-Forge-Companion-Session-Id": pairing.sessionId,
            "X-Forge-Companion-Device-Id": identity.deviceId,
            "X-Forge-Companion-Enrollment-Id": enrollment.enrollmentId,
            "X-Forge-Companion-Key-Id": enrollment.keyId,
            "X-Forge-Companion-Key-Algorithm": identity.algorithm,
            "X-Forge-Companion-Request-Protocol": PeerCompanionSecurityContract.requestProtocol,
            "X-Forge-Companion-Request-Nonce": nonce,
            "X-Forge-Companion-Request-Issued-At": issuedAt,
            "X-Forge-Companion-Body-SHA256": bodyDigest,
            "X-Forge-Companion-Request-Signature": requestSignature
        ]
        if body != nil {
            headers["Content-Type"] = "application/json"
        }
        if let capability {
            headers["Cookie"] = capability.cookie
        }
        let response: PeerTransportResponse
        do {
            response = try await transport.send(
                PeerTransportRequest(
                    route: route,
                    pathParameters: pathParameters,
                    queryItems: queryItems,
                    requestTarget: requestTarget,
                    headers: headers,
                    body: body,
                    pairing: pairing
                )
            )
        } catch {
            throw PeerAPIError.map(error)
        }
        try Task.checkCancellation()
        guard (200..<300).contains(response.statusCode) else {
            throw Self.serverError(response)
        }
        return response
    }

    private func enrollmentContext(
        pairing: PairingPayload,
        ownerUserId: String
    ) -> PeerCompanionEnrollmentContext {
        PeerCompanionEnrollmentContext(
            sessionId: pairing.sessionId,
            ownerUserId: ownerUserId,
            apiBaseURL: pairing.apiBaseUrl
        )
    }

    private func secureEnrollmentReceipt(
        pairing: PairingPayload,
        identity: PeerDeviceIdentity
    ) throws -> PeerCompanionEnrollmentReceipt {
        guard let receipt = try enrollmentVault.receipt(
            sessionId: pairing.sessionId,
            apiBaseURL: pairing.apiBaseUrl
        ), receiptMatches(
            receipt,
            identity: identity,
            pairing: pairing,
            ownerUserId: receipt.ownerUserId
        ) else {
            throw PeerAPIError.secureEnrollmentRequired
        }
        return receipt
    }

    private func receiptMatches(
        _ receipt: PeerCompanionEnrollmentReceipt,
        identity: PeerDeviceIdentity,
        pairing: PairingPayload,
        ownerUserId: String
    ) -> Bool {
        receipt.protocolName == PeerCompanionSecurityContract.enrollmentProtocol &&
            receipt.pairingSessionId == pairing.sessionId &&
            receipt.ownerUserId == ownerUserId &&
            receipt.identity.identity == identity &&
            receipt.enrollmentId.isEmpty == false &&
            receipt.keyId.isEmpty == false &&
            receipt.legacyBootstrapAccepted == false &&
            PeerDateParser.date(from: receipt.legacyBootstrapDisabledAt) != nil &&
            Set(receipt.scopes) == PeerCompanionSecurityContract.scopes &&
            Set(receipt.capabilities) == PeerCompanionSecurityContract.capabilities &&
            Set(receipt.authorizedOperations) ==
                PeerCompanionSecurityContract.authorizedOperations
    }

    @MainActor
    private func enrollmentRequest(
        path: String,
        body: Data,
        pairing: PairingPayload
    ) async throws -> PeopleWatchOperatorResponse {
        let selectedTransport = enrollmentTransport ?? LivePeopleWatchOperatorTransport()
        let response: PeopleWatchOperatorResponse
        do {
            response = try await selectedTransport.send(PeopleWatchOperatorRequest(
                method: "POST",
                requestTarget: path,
                headers: [
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                ],
                body: body,
                pairing: pairing
            ))
        } catch let error as PeopleWatchPinError {
            switch error {
            case .operatorSessionRequired, .unavailableTransport:
                throw PeerAPIError.operatorSessionRequired
            case .offline:
                throw PeerAPIError.offline
            case .server(let code, let message, let status):
                throw PeerAPIError.server(code: code, message: message, status: status)
            case .invalidConfiguration, .targetUnavailable, .invalidResponse:
                throw PeerAPIError.invalidResponse
            }
        } catch {
            throw PeerAPIError.map(error)
        }
        guard (200..<300).contains(response.statusCode) else {
            let envelope = try? decoder.decode(PeerErrorEnvelope.self, from: response.data)
            let code = envelope?.code ?? envelope?.error ?? "peer_companion_enrollment_failed"
            let message = envelope?.message ?? envelope?.error ??
                "Forge rejected secure companion enrollment."
            switch response.statusCode {
            case 401, 403:
                throw PeerAPIError.operatorSessionRequired
            case 409:
                throw PeerAPIError.replayed
            default:
                throw PeerAPIError.server(
                    code: code,
                    message: message,
                    status: response.statusCode
                )
            }
        }
        return response
    }

    private static func serverError(_ response: PeerTransportResponse) -> PeerAPIError {
        let envelope = try? JSONDecoder().decode(PeerErrorEnvelope.self, from: response.data)
        let code = envelope?.code ?? "peer_request_failed"
        let message = envelope?.message ?? envelope?.error ?? "Forge could not complete the peer request."
        if code.contains("expired") || code.contains("stale") {
            return .expired
        }
        if code.contains("replay") || code.contains("already_used") || code.contains("consumed") {
            return .replayed
        }
        if code.contains("revoked") {
            return .revoked
        }
        if code == "peer_companion_consent_unavailable" ||
            code == "peer_human_approval_required"
        {
            return .companionConsentUnavailable
        }
        return .server(
            code: code,
            message: PeerPrivacyRedactor.redacted(message),
            status: response.statusCode
        )
    }

}

private struct AcceptPeerPairingBody: Encodable {
    let invitation: PeerPairingInvite
    let scannedAt: String
    let localDeviceId: String
    let privacyMode: String
    let idempotencyKey: String
}

private struct ConfirmPeerPairingBody: Encodable {
    let expectedVersion: String
    let transcriptHash: String
    let verificationPhrase: String
    let personId: String?
    let createPersonDisplayName: String
    let idempotencyKey: String
}

private struct CreatePeerInvitationBody: Encodable {
    let label: String
    let expiresInSeconds: Int
    let privacyMode: String
    let transportKinds: [String]
    let idempotencyKey: String
}

private struct PeerRequestDecisionBody: Encodable {
    let expectedVersion: String
    let reason: String
}

private struct PeerInvitationCancellationBody: Encodable {
    let expectedVersion: String
}

private struct PeerDeviceMutationBody: Encodable {
    let expectedVersion: String
    let label: String?
    let reason: String
}

private struct RevokePeerRelationshipBody: Encodable {
    let expectedVersion: String
    let reason: String
    let purgeManagedCache: Bool
}

private struct RevokePeerGrantBody: Encodable {
    let expectedVersionHash: String
    let reason: String
    let purgeManagedCache: Bool
}

private struct PreviewPeerGrantBody: Encodable {
    let draft: PeerGrantDraft
    let sampleLimit: Int
    let includeWorstCase: Bool
}

private struct ProposePeerGrantBody: Encodable {
    let expectedRelationshipVersion: String
    let previewHash: String
    let idempotencyKey: String
    let draft: PeerGrantDraft
}

private struct AcceptPeerGrantBody: Encodable {
    let expectedVersionHash: String
    let idempotencyKey: String
}

private struct CounterPeerGrantBody: Encodable {
    let expectedVersionHash: String
    let previewHash: String
    let idempotencyKey: String
    let draft: PeerGrantDraft
}

private struct RequestPeerResyncBody: Encodable {
    let expectedRelationshipVersion: String
    let projectionIds: [String]
    let idempotencyKey: String
}

private struct PeerGrantDraftIdempotencyMaterial: Encodable {
    let previewHash: String
    let draft: PeerGrantDraft
}

private struct PeerGrantIdentityIdempotencyMaterial: Encodable {
    let grantId: String
}

private struct PeerResyncIdempotencyMaterial: Encodable {
    let relationshipId: String
    let projectionIds: [String]
}
