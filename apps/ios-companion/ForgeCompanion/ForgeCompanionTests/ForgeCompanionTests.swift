//
//  ForgeCompanionTests.swift
//  ForgeCompanionTests
//
//  Created by Omar Claw on 05.04.2026.
//

import XCTest
import AVFoundation
import CoreLocation
import HealthKit
import CryptoKit
import Security
import WebKit
@testable import ForgeCompanion

private struct SharedMovementFixtureCatalog: Decodable {
    let scenarios: [SharedMovementFixtureScenario]
}

private struct SharedMovementFixtureScenario: Decodable {
    let id: String
    let title: String
    let projectedTimeline: [ForgeMovementTimelineSegment]
}

private let sharedMovementFixtureDateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

private final class PeerMemorySecretStore: PeerSecretStoring {
    private(set) var values: [String: Data] = [:]
    private(set) var saveCount = 0
    var failingSaveCounts: Set<Int> = []

    @discardableResult
    func save(_ data: Data, forKey key: String) -> Bool {
        saveCount += 1
        guard failingSaveCounts.contains(saveCount) == false else { return false }
        values[key] = data
        return true
    }

    func load(forKey key: String) -> Data? {
        values[key]
    }

    func delete(forKey key: String) {
        values.removeValue(forKey: key)
    }

    func seed(_ data: Data, forKey key: String) {
        values[key] = data
    }
}

private final class PeerTestDeviceKeyOperations: PeerDeviceKeyOperating {
    private let privateKey: P256.Signing.PrivateKey
    var identityAvailable: Bool
    var signingError: PeerDeviceIdentityError?
    var substitutedIdentity: PeerDeviceIdentity?
    private(set) var createCount = 0
    private(set) var signCount = 0
    private(set) var authorizations: [PeerDeviceSigningAuthorization] = []

    init(
        privateKey: P256.Signing.PrivateKey = P256.Signing.PrivateKey(),
        identityAvailable: Bool = true
    ) {
        self.privateKey = privateKey
        self.identityAvailable = identityAvailable
    }

    func identity() throws -> PeerDeviceIdentity? {
        guard identityAvailable else { return nil }
        if let substitutedIdentity { return substitutedIdentity }
        return try PeerDeviceIdentityStore.identity(
            publicKeyX963: privateKey.publicKey.x963Representation
        )
    }

    func createIdentity() throws -> PeerDeviceIdentity {
        createCount += 1
        identityAvailable = true
        return try XCTUnwrap(identity())
    }

    func sign(
        data: Data,
        authorization: PeerDeviceSigningAuthorization
    ) throws -> Data {
        signCount += 1
        authorizations.append(authorization)
        guard case .userPresence(let reason) = authorization,
              reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        else {
            throw PeerDeviceIdentityError.userPresenceRequired
        }
        if let signingError { throw signingError }
        guard identityAvailable else { throw PeerDeviceIdentityError.notEnrolled }
        return try privateKey.signature(for: data).derRepresentation
    }
}

private final class PeerTestKeychainOperations: PeerKeychainOperating {
    var storedData: Data?
    var forcedUpdateStatus: OSStatus?
    private(set) var updateCount = 0
    private(set) var addCount = 0
    private(set) var deleteCount = 0

    func update(
        query: [CFString: Any],
        attributes: [CFString: Any]
    ) -> OSStatus {
        updateCount += 1
        if let forcedUpdateStatus { return forcedUpdateStatus }
        guard storedData != nil else { return errSecItemNotFound }
        storedData = attributes[kSecValueData] as? Data
        return errSecSuccess
    }

    func add(attributes: [CFString: Any]) -> OSStatus {
        addCount += 1
        guard storedData == nil else { return errSecDuplicateItem }
        storedData = attributes[kSecValueData] as? Data
        return storedData == nil ? errSecParam : errSecSuccess
    }

    func load(query: [CFString: Any]) -> (status: OSStatus, data: Data?) {
        guard let storedData else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, storedData)
    }

    func delete(query: [CFString: Any]) {
        deleteCount += 1
        storedData = nil
    }
}

private enum PeerTestTransportStep {
    case response(PeerTransportResponse)
    case failure(Error)
    case handler((PeerTransportRequest) async throws -> PeerTransportResponse)
}

private final class PeerTestTransport: PeerTransporting {
    private(set) var requests: [PeerTransportRequest] = []
    var steps: [PeerTestTransportStep]

    init(steps: [PeerTestTransportStep] = []) {
        self.steps = steps
    }

    func send(_ request: PeerTransportRequest) async throws -> PeerTransportResponse {
        requests.append(request)
        guard steps.isEmpty == false else {
            throw URLError(.badServerResponse)
        }
        switch steps.removeFirst() {
        case .response(let response):
            return response
        case .failure(let error):
            throw error
        case .handler(let handler):
            return try await handler(request)
        }
    }
}

private struct PeerTestPresenceOptionsBody: Decodable {
    let action: PeerPresenceAction
    let companionDeviceId: String
}

private struct PeerTestConsentChallenge: Encodable {
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

private struct PeerTestRequestSignatureProof: Encodable {
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

private struct PeerTestPresenceVerifyBody: Decodable {
    struct Verification: Decodable {
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

private struct PeerTestConsentSignatureProof: Encodable {
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

private struct PeerTestEnrollmentOptionsBody: Decodable {
    let protocolName: String
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

private struct PeerTestEnrollmentChallenge: Encodable {
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

private struct PeerTestEnrollmentProof: Encodable {
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

private struct PeerTestEnrollmentVerifyBody: Decodable {
    let protocolName: String
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

private final class PeerAsyncResponseGate {
    private var continuation: CheckedContinuation<PeerTransportResponse, Never>?

    func wait() async -> PeerTransportResponse {
        await withCheckedContinuation { continuation = $0 }
    }

    func release(_ response: PeerTransportResponse) {
        continuation?.resume(returning: response)
        continuation = nil
    }
}

private enum PeopleWatchTestTransportStep {
    case response(PeopleWatchOperatorResponse)
    case failure(Error)
    case handler((PeopleWatchOperatorRequest) async throws -> PeopleWatchOperatorResponse)
}

@MainActor
private final class PeopleWatchTestTransport: PeopleWatchOperatorTransporting {
    private(set) var requests: [PeopleWatchOperatorRequest] = []
    var steps: [PeopleWatchTestTransportStep]

    init(steps: [PeopleWatchTestTransportStep] = []) {
        self.steps = steps
    }

    func send(_ request: PeopleWatchOperatorRequest) async throws -> PeopleWatchOperatorResponse {
        requests.append(request)
        guard steps.isEmpty == false else { throw URLError(.badServerResponse) }
        switch steps.removeFirst() {
        case .response(let response):
            return response
        case .failure(let error):
            throw error
        case .handler(let handler):
            return try await handler(request)
        }
    }
}

@MainActor
private final class PeopleWatchAsyncResponseGate {
    private var continuation: CheckedContinuation<PeopleWatchOperatorResponse, Never>?

    func wait() async -> PeopleWatchOperatorResponse {
        await withCheckedContinuation { continuation = $0 }
    }

    func release(_ response: PeopleWatchOperatorResponse) {
        continuation?.resume(returning: response)
        continuation = nil
    }
}

private final class PeopleWatchURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    nonisolated(unsafe) private static var capturedRequests: [URLRequest] = []
    nonisolated(unsafe) private static var capturedBodies: [Data?] = []
    private static let lock = NSLock()

    static var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return capturedRequests
    }

    static var bodies: [Data?] {
        lock.lock()
        defer { lock.unlock() }
        return capturedBodies
    }

    static func reset() {
        lock.lock()
        capturedRequests = []
        capturedBodies = []
        handler = nil
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let handler = Self.handler,
                  let url = request.url
            else { throw URLError(.badServerResponse) }
            Self.lock.lock()
            Self.capturedRequests.append(request)
            Self.capturedBodies.append(Self.bodyData(from: request))
            Self.lock.unlock()
            let (status, data) = try handler(request)
            let response = HTTPURLResponse(
                url: url,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func bodyData(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            result.append(buffer, count: count)
        }
        return result.isEmpty ? nil : result
    }
}

private final class PeerTestConsentState {
    var challenge: PeerTestConsentChallenge?
    var action: PeerPresenceAction?
}

private final class PeerTestEnrollmentState {
    private let lock = NSLock()
    private var storedChallenge: PeerTestEnrollmentChallenge?

    func store(_ challenge: PeerTestEnrollmentChallenge) {
        lock.lock()
        storedChallenge = challenge
        lock.unlock()
    }

    func challenge() -> PeerTestEnrollmentChallenge? {
        lock.lock()
        defer { lock.unlock() }
        return storedChallenge
    }
}

private struct PeerTestPageBody: Encodable {
    let limit: Int
    let hasMore: Bool
    let nextCursor: String?
}

private struct PeerTestRelationshipsBody: Encodable {
    let relationships: [PeerRelationship]
    let page: PeerTestPageBody
}

private struct PeerTestGrantsBody: Encodable {
    let grants: [PeerGrant]
    let page: PeerTestPageBody
}

private struct PeerTestRelationshipBody: Encodable {
    let relationship: PeerRelationship
    let devices: [PeerDevice]
    let grants: [PeerGrant]

    private enum CodingKeys: String, CodingKey {
        case relationship
        case devices
        case grants
        case sync
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(relationship, forKey: .relationship)
        try container.encode(devices, forKey: .devices)
        try container.encode(grants, forKey: .grants)
        try container.encodeNil(forKey: .sync)
    }
}

private actor ForgeIrohWebViewAuthProbeRecorder {
    struct ObservedRequest: Equatable {
        let path: String
        let cookieHeader: String?
    }

    private var requests: [ObservedRequest] = []

    func append(path: String, cookieHeader: String?) {
        requests.append(ObservedRequest(path: path, cookieHeader: cookieHeader))
    }

    func snapshot() -> [ObservedRequest] {
        requests
    }
}

private final class ForgeIrohWebViewAuthProbeSchemeHandler: NSObject, WKURLSchemeHandler {
    private let cookieJar = ForgeIrohURLSchemeCookieJar()
    private let recorder = ForgeIrohWebViewAuthProbeRecorder()

    var observedRequests: [ForgeIrohWebViewAuthProbeRecorder.ObservedRequest] {
        get async {
            await recorder.snapshot()
        }
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        Task {
            guard let url = request.url else {
                await fail(urlSchemeTask, with: URLError(.badURL))
                return
            }
            let path = ForgeIrohURLSchemeHandler.proxyPath(for: url)
            let requestHeaders = await cookieJar.headersByAddingStoredCookies(
                to: request.allHTTPHeaderFields ?? [:]
            )
            await recorder.append(
                path: path,
                cookieHeader: Self.headerValue("cookie", in: requestHeaders)
            )
            let result = Self.result(for: path, requestHeaders: requestHeaders)
            await cookieJar.storeCookies(from: result.headers)
            await finish(urlSchemeTask, url: url, path: path, result: result)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func finish(
        _ urlSchemeTask: WKURLSchemeTask,
        url: URL,
        path: String,
        result: ForgeIrohTransportResult
    ) async {
        let response = ForgeIrohURLSchemeHandler.response(for: url, path: path, result: result)
        await MainActor.run {
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(result.data)
            urlSchemeTask.didFinish()
        }
    }

    private func fail(_ urlSchemeTask: WKURLSchemeTask, with error: Error) async {
        await MainActor.run {
            urlSchemeTask.didFailWithError(error)
        }
    }

    private static func result(
        for path: String,
        requestHeaders: [String: String]
    ) -> ForgeIrohTransportResult {
        switch path {
        case "/forge/":
            return ForgeIrohTransportResult(
                data: Data(authBootstrapHTML.utf8),
                statusCode: 200,
                headers: ["content-type": "text/html; charset=utf-8"]
            )
        case "/api/v1/auth/operator-session":
            return ForgeIrohTransportResult(
                data: Data(#"{"session":{"active":true}}"#.utf8),
                statusCode: 200,
                headers: [
                    "content-type": "application/json; charset=utf-8",
                    "set-cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800"
                ]
            )
        case "/api/v1/settings":
            let cookieHeader = headerValue("cookie", in: requestHeaders) ?? ""
            if cookieHeader.contains("forge_operator_session=fg_session_cookie") {
                return ForgeIrohTransportResult(
                    data: Data(#"{"settings":{"loaded":true}}"#.utf8),
                    statusCode: 200,
                    headers: ["content-type": "application/json; charset=utf-8"]
                )
            }
            return ForgeIrohTransportResult(
                data: Data(#"{"code":"auth_required","error":"A token or operator session is required."}"#.utf8),
                statusCode: 401,
                headers: ["content-type": "application/json; charset=utf-8"]
            )
        default:
            return ForgeIrohTransportResult(
                data: Data(#"{"code":"not_found"}"#.utf8),
                statusCode: 404,
                headers: ["content-type": "application/json; charset=utf-8"]
            )
        }
    }

    private static let authBootstrapHTML = """
    <!doctype html>
    <html>
      <head><title>Forge Auth Probe</title></head>
      <body>
        <div id="root">FORGE_BOOTING</div>
        <script>
          async function loadSettings() {
            let response = await fetch('/api/v1/settings', { credentials: 'same-origin' });
            if (response.status === 401) {
              await fetch('/api/v1/auth/operator-session', { credentials: 'same-origin' });
              response = await fetch('/api/v1/settings', { credentials: 'same-origin' });
            }
            if (!response.ok) {
              document.body.textContent = 'FORGE_FAILED ' + response.status;
              return;
            }
            document.body.textContent = 'FORGE_LOADED';
          }
          loadSettings().catch((error) => {
            document.body.textContent = 'FORGE_ERROR ' + error.message;
          });
        </script>
      </body>
    </html>
    """

    private static func headerValue(_ name: String, in headers: [String: String]) -> String? {
        headers.first {
            $0.key.caseInsensitiveCompare(name) == .orderedSame
        }?.value
    }
}

@MainActor
final class ForgeCompanionTests: XCTestCase {
    private func makeDate(_ value: String) -> Date {
        guard let date = sharedMovementFixtureDateFormatter.date(from: value) else {
            XCTFail("Invalid test date \(value)")
            return Date(timeIntervalSince1970: 0)
        }
        return date
    }

    private func loadSharedMovementFixture(id: String) throws -> SharedMovementFixtureScenario {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("tests")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("movement-canonical-box-fixtures.json")
        let data = try Data(contentsOf: fixtureURL)
        let catalog = try JSONDecoder().decode(SharedMovementFixtureCatalog.self, from: data)
        guard let scenario = catalog.scenarios.first(where: { $0.id == id }) else {
            throw NSError(
                domain: "ForgeCompanionTests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Missing shared movement fixture \(id)"]
            )
        }
        return scenario
    }

    private func makeReadySourceState() -> CompanionSourceState {
        CompanionSourceState(
            desiredEnabled: true,
            appliedEnabled: true,
            authorizationStatus: "approved",
            syncEligible: true,
            lastObservedAt: "2026-04-07T10:00:00Z",
            metadata: LooseJSONObject(values: [:])
        )
    }

    private func makePairingSessionState(
        id: String,
        expiresAt: String,
        capabilities: [String]
    ) -> CompanionPairingSessionState {
        let state = makeReadySourceState()
        return CompanionPairingSessionState(
            id: id,
            userId: "user_1",
            label: "iPhone",
            status: "paired",
            capabilities: capabilities,
            deviceName: "iPhone",
            platform: "ios",
            appVersion: "1.0",
            apiBaseUrl: "https://forge.example/api/v1",
            lastSeenAt: "2026-04-07T10:00:00Z",
            lastSyncAt: nil,
            lastSyncError: nil,
            pairedAt: "2026-04-07T09:00:00Z",
            sourceStates: CompanionSourceStates(
                health: state,
                movement: state,
                screenTime: state
            ),
            expiresAt: expiresAt,
            createdAt: "2026-04-07T09:00:00Z",
            updatedAt: "2026-04-07T10:00:00Z"
        )
    }

    func testForgeWebViewDefaultRequestPreservesProtocolCacheAndExistingQuery() throws {
        let url = URL(string: "https://forge.example/forge/?tab=settings")!

        let request = ForgeWebView.freshRequest(for: url)
        let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false))

        XCTAssertEqual(request.cachePolicy, .useProtocolCachePolicy)
        XCTAssertNil(request.value(forHTTPHeaderField: "Cache-Control"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Pragma"))
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "tab" })?.value, "settings")
        XCTAssertNil(components.queryItems?.first(where: { $0.name == "forgeWebRefresh" }))
    }

    func testForgeWebViewHardRefreshRequestBypassesCacheAndAddsRefreshToken() throws {
        let token = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let url = URL(string: "https://forge.example/forge/?tab=settings")!

        let request = ForgeWebView.freshRequest(
            for: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            reloadToken: token
        )
        let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
        let queryItems = components.queryItems ?? []

        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-cache")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Pragma"), "no-cache")
        XCTAssertEqual(queryItems.first(where: { $0.name == "tab" })?.value, "settings")
        XCTAssertEqual(
            queryItems.first(where: { $0.name == "forgeWebRefresh" })?.value,
            token.uuidString
        )
    }

    func testForgeWebViewHardRefreshClearsOnlyWebCachesAndServiceWorkers() {
        XCTAssertTrue(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeDiskCache))
        XCTAssertTrue(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeMemoryCache))
        XCTAssertTrue(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeOfflineWebApplicationCache))
        if #available(iOS 11.3, *) {
            XCTAssertTrue(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeFetchCache))
            XCTAssertTrue(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeServiceWorkerRegistrations))
        }
        XCTAssertFalse(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeCookies))
        XCTAssertFalse(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeLocalStorage))
        XCTAssertFalse(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeSessionStorage))
        XCTAssertFalse(ForgeWebView.cacheDataTypesForHardRefresh.contains(WKWebsiteDataTypeIndexedDBDatabases))
    }

    func testForgeWebViewBootstrapDoesNotOverrideForgeThemeBackgrounds() {
        let script = ForgeWebView.companionBootstrapScript

        XCTAssertTrue(script.contains("__forgeCompanionApplyLayout"))
        XCTAssertTrue(script.contains("__forgeCompanionSyncVisualViewport"))
        XCTAssertTrue(script.contains("--forge-safe-area-top"))
        XCTAssertTrue(script.contains("--forge-safe-area-right"))
        XCTAssertTrue(script.contains("--forge-safe-area-bottom"))
        XCTAssertTrue(script.contains("--forge-safe-area-left"))
        XCTAssertTrue(script.contains("--forge-keyboard-inset-bottom"))
        XCTAssertFalse(script.contains("!important"))
        XCTAssertFalse(script.contains("document.body.style.background"))
        XCTAssertFalse(script.contains("root.style.background"))
        XCTAssertFalse(script.contains("html, body, #root"))
    }

    func testForgeWebLayoutMetricsPreserveAllSafeAreaEdgesAndClampNegativeInsets() throws {
        let metrics = try XCTUnwrap(
            ForgeWebLayoutMetrics.resolve(
                bounds: CGRect(x: 0, y: 0, width: 393.9, height: 759.8),
                safeAreaInsets: UIEdgeInsets(top: 1.9, left: -4, bottom: 33.8, right: 2.7)
            )
        )

        XCTAssertEqual(
            metrics,
            ForgeWebLayoutMetrics(width: 393, height: 759, top: 1, right: 2, bottom: 33, left: 0)
        )
        XCTAssertNil(
            ForgeWebLayoutMetrics.resolve(
                bounds: .zero,
                safeAreaInsets: .zero
            )
        )
    }

    func testForgeWebViewConfiguresNavigationGesturesAndInteractiveKeyboardDismissal() {
        let webView = WKWebView(frame: .zero)

        ForgeWebView.configureEmbeddedInteraction(on: webView)

        XCTAssertTrue(webView.allowsBackForwardNavigationGestures)
        XCTAssertEqual(webView.scrollView.keyboardDismissMode, .interactive)
        XCTAssertEqual(webView.scrollView.contentInsetAdjustmentBehavior, .never)
        XCTAssertTrue(webView.scrollView.alwaysBounceVertical)
    }

    func testForgeWebNavigationPolicyKeepsForgeRoutesEmbeddedAndRequiresExplicitExternalLinks() throws {
        let httpsRoot = try XCTUnwrap(URL(string: "https://forge.example:8443/forge/"))
        let irohRoot = try XCTUnwrap(URL(string: "forge-iroh://node-id/forge/"))

        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://forge.example:8443/forge/tasks/1")),
                relativeTo: httpsRoot,
                isUserActivated: false,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .allow
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "forge-iroh://node-id/forge/calendar")),
                relativeTo: irohRoot,
                isUserActivated: false,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .allow
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://forge.example/forge/")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .openExternally
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://external.example/resource")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .openExternally
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://external.example/redirect")),
                relativeTo: httpsRoot,
                isUserActivated: false,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .cancel
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "blob:https://forge.example:8443/download")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .download
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "blob:null/iroh-export")),
                relativeTo: irohRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .download
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "blob:null/http-export")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .cancel
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://forge.example:8443/forge/export.csv")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .download
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://forge.example:8443/forge/export.csv")),
                relativeTo: httpsRoot,
                isUserActivated: false,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .cancel
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "blob:https://external.example/download")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .cancel
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "blob:https://forge.example:8443/document")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: false
            ),
            .cancel
        )
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "data:text/plain,export")),
                relativeTo: httpsRoot,
                isUserActivated: true,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .cancel
        )
        for blockedURL in ["blob:https://forge.example/document", "data:text/html,unsafe", "javascript:alert(1)"] {
            XCTAssertEqual(
                ForgeWebNavigationPolicy.disposition(
                    for: try XCTUnwrap(URL(string: blockedURL)),
                    relativeTo: httpsRoot,
                    isUserActivated: false,
                    isPrimaryNavigation: true,
                    shouldPerformDownload: false
                ),
                .cancel
            )
        }
        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "about:blank")),
                relativeTo: httpsRoot,
                isUserActivated: false,
                isPrimaryNavigation: false,
                shouldPerformDownload: false
            ),
            .allow
        )
    }

    func testForgeWebDownloadPolicySanitizesAndBoundsSuggestedFilenames() {
        XCTAssertEqual(
            ForgeWebDownloadPolicy.safeFilename("../../private/report.json"),
            "report.json"
        )
        XCTAssertEqual(
            ForgeWebDownloadPolicy.safeFilename(#"..\private\report.json"#),
            "report.json"
        )
        XCTAssertEqual(
            ForgeWebDownloadPolicy.safeFilename("<script>alert(1)</script>.csv"),
            "script_.csv"
        )
        XCTAssertEqual(ForgeWebDownloadPolicy.safeFilename(".."), "Forge download")
        XCTAssertEqual(
            ForgeWebDownloadPolicy.safeFilename(String(repeating: "a", count: 200)).count,
            160
        )
    }

    func testForgeWebFailuresUseActionableCopyWithoutEchoingSensitiveNetworkErrors() {
        let offline = ForgeWebFailure.from(URLError(.notConnectedToInternet))
        let sensitive = ForgeWebFailure.from(
            NSError(
                domain: "ForgeWeb",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "https://user:secret@forge.example/?token=private"]
            )
        )

        XCTAssertEqual(offline.title, "Forge is offline")
        XCTAssertTrue(offline.isOffline)
        XCTAssertEqual(sensitive.title, "Forge could not load")
        XCTAssertFalse(sensitive.detail.contains("secret"))
        XCTAssertFalse(sensitive.detail.contains("token"))
    }

    func testForgeIrohWebViewSchemeHandlerPreservesForgePathAndRefreshQuery() throws {
        let url = try XCTUnwrap(
            URL(string: "forge-iroh://fakednodeid/forge/?forgeWebRefresh=abc&tab=today")
        )

        XCTAssertEqual(
            ForgeIrohURLSchemeHandler.proxyPath(for: url),
            "/forge/?forgeWebRefresh=abc&tab=today"
        )
    }

    func testForgeIrohWebViewSchemeHandlerDerivesWebMimeTypes() throws {
        XCTAssertEqual(
            ForgeIrohURLSchemeHandler.mimeType(
                from: ["content-type": "text/html; charset=utf-8"],
                fallbackURL: try XCTUnwrap(URL(string: "forge-iroh://fakednodeid/forge/"))
            ),
            "text/html"
        )
        XCTAssertEqual(
            ForgeIrohURLSchemeHandler.mimeType(
                from: [:],
                fallbackURL: try XCTUnwrap(URL(string: "forge-iroh://fakednodeid/forge/src/main.tsx"))
            ),
            "text/javascript"
        )
        XCTAssertEqual(
            ForgeIrohURLSchemeHandler.mimeType(
                from: [:],
                fallbackURL: try XCTUnwrap(URL(string: "forge-iroh://fakednodeid/forge/assets/app.woff2"))
            ),
            "font/woff2"
        )
    }

    func testForgeIrohWebViewSchemeHandlerUsesHTTPResponseForApiRequests() throws {
        let url = try XCTUnwrap(
            URL(string: "forge-iroh://fakednodeid/api/v1/auth/operator-session")
        )
        let result = ForgeIrohTransportResult(
            data: Data(#"{"session":{"active":true}}"#.utf8),
            statusCode: 201,
            headers: [
                "content-type": "application/json; charset=utf-8",
                "transfer-encoding": "chunked"
            ]
        )

        let response = ForgeIrohURLSchemeHandler.response(
            for: url,
            path: "/api/v1/auth/operator-session",
            result: result
        )
        let httpResponse = try XCTUnwrap(response as? HTTPURLResponse)

        XCTAssertEqual(httpResponse.statusCode, 201)
        XCTAssertEqual(httpResponse.mimeType, "application/json")
        XCTAssertNil(httpResponse.allHeaderFields["transfer-encoding"])
    }

    func testForgeIrohWebViewSchemeHandlerUsesPlainResponseForForgeDocumentsAndAssets() throws {
        let documentURL = try XCTUnwrap(
            URL(string: "forge-iroh://fakednodeid/forge/?forgeWebRefresh=abc")
        )
        let assetURL = try XCTUnwrap(
            URL(string: "forge-iroh://fakednodeid/forge/assets/index.js")
        )
        let documentResponse = ForgeIrohURLSchemeHandler.response(
            for: documentURL,
            path: "/forge/?forgeWebRefresh=abc",
            result: ForgeIrohTransportResult(
                data: Data("<!doctype html>".utf8),
                statusCode: 200,
                headers: ["content-type": "text/html; charset=utf-8"]
            )
        )
        let assetResponse = ForgeIrohURLSchemeHandler.response(
            for: assetURL,
            path: "/forge/assets/index.js",
            result: ForgeIrohTransportResult(
                data: Data("console.log('forge')".utf8),
                statusCode: 200,
                headers: [:]
            )
        )

        XCTAssertFalse(documentResponse is HTTPURLResponse)
        XCTAssertEqual(documentResponse.mimeType, "text/html")
        XCTAssertFalse(assetResponse is HTTPURLResponse)
        XCTAssertEqual(assetResponse.mimeType, "text/javascript")
    }

    func testForgeIrohCookieJarStoresOperatorSessionCookieForRetries() async {
        let jar = ForgeIrohURLSchemeCookieJar()

        let storedNames = await jar.storeCookies(
            from: [
                "set-cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800"
            ]
        )
        let headers = await jar.headersByAddingStoredCookies(
            to: ["x-forge-source": "ui"]
        )

        XCTAssertEqual(storedNames, ["forge_operator_session"])
        XCTAssertEqual(headers["Cookie"], "forge_operator_session=fg_session_cookie")
        XCTAssertEqual(headers["x-forge-source"], "ui")
    }

    func testForgeIrohCookieJarMergesStoredCookieWithExistingCookieHeader() async {
        let jar = ForgeIrohURLSchemeCookieJar()

        await jar.storeCookies(
            from: [
                "Set-Cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
            ]
        )
        let headers = await jar.headersByAddingStoredCookies(
            to: ["Cookie": "other=value"]
        )

        XCTAssertEqual(
            headers["Cookie"],
            "forge_operator_session=fg_session_cookie; other=value"
        )
    }

    func testForgeIrohCookieJarDeletesExpiredCookies() async {
        let jar = ForgeIrohURLSchemeCookieJar()

        await jar.storeCookies(
            from: [
                "set-cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
            ]
        )
        await jar.storeCookies(
            from: [
                "set-cookie": "forge_operator_session=; Path=/; Max-Age=0"
            ]
        )
        let headers = await jar.headersByAddingStoredCookies(to: [:])

        XCTAssertNil(headers["Cookie"])
    }

    func testForgeIrohWebViewCanBootstrapAuthAndRenderThroughCustomScheme() async throws {
        let schemeHandler = ForgeIrohWebViewAuthProbeSchemeHandler()
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "forge-iroh-test")
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        let url = try XCTUnwrap(URL(string: "forge-iroh-test://fakednodeid/forge/"))

        webView.load(URLRequest(url: url))

        let loaded = try await waitForWebViewText(
            webView,
            expectedText: "FORGE_LOADED",
            timeout: 8
        )
        let observedRequests = await schemeHandler.observedRequests

        XCTAssertTrue(loaded.contains("FORGE_LOADED"))
        XCTAssertEqual(
            observedRequests.map(\.path),
            [
                "/forge/",
                "/api/v1/settings",
                "/api/v1/auth/operator-session",
                "/api/v1/settings"
            ]
        )
        XCTAssertNil(observedRequests[1].cookieHeader)
        XCTAssertEqual(
            observedRequests[3].cookieHeader,
            "forge_operator_session=fg_session_cookie"
        )
    }

    private func waitForWebViewText(
        _ webView: WKWebView,
        expectedText: String,
        timeout: TimeInterval
    ) async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let result = try? await webView.evaluateJavaScript("document.body ? document.body.textContent : ''")
            if let text = result as? String, text.contains(expectedText) {
                return text
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let finalText = (try? await webView.evaluateJavaScript("document.body ? document.body.textContent : ''")) as? String
        if let finalText, finalText.contains(expectedText) {
            return finalText
        }
        XCTFail("Timed out waiting for \(expectedText). Final body text: \(finalText ?? "nil")")
        return finalText ?? ""
    }

    func testNormalizedPayloadPreservesPreferredUiBaseUrl() {
        let payload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "http://127.0.0.1:4317",
            uiBaseUrl: nil,
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )

        let normalized = CompanionPairingURLResolver.normalizedPayload(
            payload,
            preferredUiBaseUrl: "http://127.0.0.1:3027/forge"
        )

        XCTAssertEqual(normalized.apiBaseUrl, "http://127.0.0.1:4317/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "http://127.0.0.1:3027/forge/")
    }

    func testNormalizeUiBaseUrlRemovesApiSuffix() {
        XCTAssertEqual(
            CompanionPairingURLResolver.normalizeUiBaseUrl(
                "http://127.0.0.1:3027/forge/api/v1"
            ),
            "http://127.0.0.1:3027/forge/"
        )
    }

    func testPairingPayloadRefreshesServerExtendedExpiry() {
        let payload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2026-04-07T10:05:00Z",
            capabilities: ["healthkit.sleep"]
        )
        let session = makePairingSessionState(
            id: "pair_test",
            expiresAt: "2026-05-07T10:00:00Z",
            capabilities: ["healthkit.sleep", "healthkit.fitness", "watch-ready"]
        )

        let refreshed = CompanionPairingURLResolver.payload(payload, refreshedBy: session)

        XCTAssertEqual(refreshed.sessionId, payload.sessionId)
        XCTAssertEqual(refreshed.pairingToken, payload.pairingToken)
        XCTAssertEqual(refreshed.apiBaseUrl, payload.apiBaseUrl)
        XCTAssertEqual(refreshed.uiBaseUrl, payload.uiBaseUrl)
        XCTAssertEqual(refreshed.expiresAt, "2026-05-07T10:00:00Z")
        XCTAssertEqual(refreshed.capabilities, ["healthkit.sleep", "healthkit.fitness", "watch-ready"])
    }

    func testPairingPayloadRefreshNormalizesStaleIrohMetadataForTailscaleUrl() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2026-04-07T10:05:00Z",
            capabilities: ["healthkit.sleep"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )
        let session = makePairingSessionState(
            id: "pair_test",
            expiresAt: payload.expiresAt,
            capabilities: payload.capabilities
        )

        let refreshed = CompanionPairingURLResolver.payload(payload, refreshedBy: session)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: refreshed,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(refreshed.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(refreshed.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertEqual(refreshed.transportMode, "tailscale")
        XCTAssertNil(refreshed.transport)
        XCTAssertFalse(refreshed.usesIrohTransportForActiveApiUrl)
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(route.label, "Tailscale direct")
    }

    func testPairingHeartbeatDecoderAcceptsEnvelopeAndLegacyRawSession() throws {
        let rawSession = """
        {
          "id": "pair_test",
          "userId": "user_1",
          "label": "iPhone",
          "status": "paired",
          "capabilities": ["healthkit.sleep", "watch-ready"],
          "deviceName": "iPhone",
          "platform": "ios",
          "appVersion": "1.0",
          "apiBaseUrl": "https://forge.example/api/v1",
          "lastSeenAt": "2026-04-07T10:00:00Z",
          "lastSyncAt": null,
          "lastSyncError": null,
          "pairedAt": "2026-04-07T09:00:00Z",
          "sourceStates": {
            "health": {
              "desiredEnabled": true,
              "appliedEnabled": true,
              "authorizationStatus": "approved",
              "syncEligible": true,
              "lastObservedAt": "2026-04-07T10:00:00Z",
              "metadata": {}
            },
            "movement": {
              "desiredEnabled": true,
              "appliedEnabled": true,
              "authorizationStatus": "approved",
              "syncEligible": true,
              "lastObservedAt": "2026-04-07T10:00:00Z",
              "metadata": {}
            },
            "screenTime": {
              "desiredEnabled": true,
              "appliedEnabled": true,
              "authorizationStatus": "approved",
              "syncEligible": true,
              "lastObservedAt": "2026-04-07T10:00:00Z",
              "metadata": {}
            }
          },
          "expiresAt": "2026-05-07T10:00:00Z",
          "createdAt": "2026-04-07T09:00:00Z",
          "updatedAt": "2026-04-07T10:00:00Z"
        }
        """
        let enveloped = """
        {
          "pairingSession": \(rawSession)
        }
        """

        let legacy = try ForgeSyncClient.pairingHeartbeatSessionStateForTesting(
            from: Data(rawSession.utf8)
        )
        let current = try ForgeSyncClient.pairingHeartbeatSessionStateForTesting(
            from: Data(enveloped.utf8)
        )

        XCTAssertEqual(legacy.id, "pair_test")
        XCTAssertEqual(current.id, "pair_test")
        XCTAssertEqual(legacy.capabilities, ["healthkit.sleep", "watch-ready"])
        XCTAssertEqual(current.sourceStates.movement.authorizationStatus, "approved")
    }

    func testPairingPayloadNormalizesStaleIrohMetadataOffTailscaleUrls() throws {
        let json = """
        {
          "kind": "forge-companion-pairing",
          "apiBaseUrl": "https://macbook-pro.example.ts.net/api/v1",
          "uiBaseUrl": "https://macbook-pro.example.ts.net/forge/",
          "transportMode": "iroh",
          "transport": {
            "protocol": "iroh",
            "provider": "forge-companion-iroh",
            "status": "ready",
            "publicBaseUrl": "https://macbook-pro.example.ts.net/api/v1",
            "localBaseUrl": "http://127.0.0.1:4317",
            "nodeId": "fakednodeid",
            "relay": "https://relay.example.com",
            "alpn": "forge-companion/1",
            "agent": "forge",
            "pairPayload": {
              "v": 1,
              "node_id": "fakednodeid",
              "token": "hosttoken",
              "host_name": "test-host",
              "relay": "https://relay.example.com"
            },
            "recreateCommand": "forge-companion-iroh host --state-dir ~/.forge/companion-iroh --local-base-url http://127.0.0.1:4317",
            "startedAt": "2026-04-07T10:00:00Z",
            "notes": ["Iroh transport is active."]
          },
          "sessionId": "pair_test",
          "pairingToken": "token",
          "expiresAt": "2099-01-01T00:00:00Z",
          "capabilities": ["healthkit.sleep"]
        }
        """
        let payload = try JSONDecoder().decode(
            PairingPayload.self,
            from: Data(json.utf8)
        )

        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(payload.transportMode, "iroh")
        XCTAssertEqual(payload.transport?.protocolName, "iroh")
        XCTAssertFalse(payload.usesIrohTransportForActiveApiUrl)
        XCTAssertEqual(normalized.transportMode, "tailscale")
        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertNil(normalized.transport)
        XCTAssertFalse(normalized.usesIrohTransportForActiveApiUrl)
    }

    func testLegacyIrohOnlyPairingPayloadStillDecodes() throws {
        let json = """
        {
          "kind": "forge-companion-pairing",
          "apiBaseUrl": "forge-iroh://fakednodeid/api/v1",
          "uiBaseUrl": "forge-iroh://fakednodeid/forge/",
          "transportMode": "iroh",
          "transport": {
            "protocol": "iroh",
            "provider": "forge-companion-iroh",
            "status": "ready",
            "localBaseUrl": "http://127.0.0.1:4317",
            "pairPayload": {
              "v": 1,
              "node_id": "fakednodeid",
              "token": "hosttoken"
            }
          },
          "sessionId": "pair_test",
          "pairingToken": "token",
          "expiresAt": "2099-01-01T00:00:00Z",
          "capabilities": ["healthkit.sleep"]
        }
        """

        let payload = try JSONDecoder().decode(
            PairingPayload.self,
            from: Data(json.utf8)
        )
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(normalized.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "forge-iroh://fakednodeid/forge/")
        XCTAssertEqual(normalized.transport?.pairPayload?.token, "hosttoken")
    }

    func testLoopbackIrohPairingPayloadNormalizesToIrohLogicalUrls() throws {
        let json = """
        {
          "kind": "forge-companion-pairing",
          "apiBaseUrl": "http://127.0.0.1:4317/api/v1",
          "uiBaseUrl": "http://127.0.0.1:4317/forge/",
          "transportMode": "iroh",
          "transport": {
            "protocol": "iroh",
            "provider": "forge-companion-iroh",
            "status": "ready",
            "publicBaseUrl": "http://127.0.0.1:4317/api/v1",
            "localBaseUrl": "http://127.0.0.1:4317",
            "pairPayload": {
              "v": 1,
              "node_id": "fakednodeid",
              "token": "hosttoken"
            }
          },
          "sessionId": "pair_test",
          "pairingToken": "token",
          "expiresAt": "2099-01-01T00:00:00Z",
          "capabilities": ["healthkit.sleep"]
        }
        """

        let payload = try JSONDecoder().decode(PairingPayload.self, from: Data(json.utf8))
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(normalized.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "forge-iroh://fakednodeid/forge/")
    }

    func testLoopbackIrohPairingPayloadCanUseNonLoopbackPublicFallback() throws {
        let json = """
        {
          "kind": "forge-companion-pairing",
          "apiBaseUrl": "http://127.0.0.1:4317/api/v1",
          "uiBaseUrl": "http://127.0.0.1:4317/forge/",
          "transportMode": "iroh",
          "transport": {
            "protocol": "iroh",
            "provider": "forge-companion-iroh",
            "status": "ready",
            "publicBaseUrl": "https://macbook-pro.example.ts.net/api/v1",
            "localBaseUrl": "http://127.0.0.1:4317",
            "pairPayload": {
              "v": 1,
              "node_id": "fakednodeid",
              "token": "hosttoken"
            }
          },
          "sessionId": "pair_test",
          "pairingToken": "token",
          "expiresAt": "2099-01-01T00:00:00Z",
          "capabilities": ["healthkit.sleep"]
        }
        """

        let payload = try JSONDecoder().decode(PairingPayload.self, from: Data(json.utf8))
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertEqual(normalized.transportMode, "tailscale")
        XCTAssertNil(normalized.transport)
    }

    func testIrohOnlyPairingDoesNotRememberNodeIdAsHost() throws {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.sleep"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: nil,
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        XCTAssertNil(CompanionPairingURLResolver.rememberableHost(for: payload))
    }

    func testRememberedIrohTransportBecomesPairableDiscoveryCandidate() throws {
        ForgeServerDiscovery.clearRememberedIrohEndpointsForTesting()
        defer { ForgeServerDiscovery.clearRememberedIrohEndpointsForTesting() }
        let transport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "fakednodeid",
            relay: "https://relay.example.com",
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "fakednodeid",
                token: "hosttoken",
                hostName: "test-host",
                relay: "https://relay.example.com"
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )

        ForgeServerDiscovery.rememberSuccessfulIrohTransport(
            transport,
            publicBaseUrl: nil
        )
        let servers = ForgeServerDiscovery.rememberedIrohServersForTesting()
        let server = try XCTUnwrap(servers.first)

        XCTAssertEqual(server.source, .iroh)
        XCTAssertEqual(server.host, "fakednodeid")
        XCTAssertEqual(server.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertEqual(server.uiBaseUrl, "forge-iroh://fakednodeid/forge/")
        XCTAssertTrue(server.canBootstrapPairing)
        XCTAssertEqual(server.transport?.pairPayload?.nodeId, "fakednodeid")
        XCTAssertEqual(server.transport?.pairPayload?.token, "hosttoken")
    }

    func testIrohPairingWithPublicFallbackRemembersTailscaleHost() throws {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.sleep"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        XCTAssertEqual(
            CompanionPairingURLResolver.rememberableHost(for: payload),
            "macbook-pro.example.ts.net"
        )
    }

    func testTailscaleApiUrlWithStaleIrohMetadataUsesDirectHttpPolicy() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertFalse(payload.usesIrohTransportForActiveApiUrl)
        XCTAssertEqual(ForgeSyncClient.healthSyncChunkingVersion(for: payload), ForgeSyncClient.httpBackgroundHealthSyncChunkingVersion)
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(pairing: payload, useBackgroundUpload: false),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
        )
        XCTAssertEqual(route.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(route.label, "Tailscale direct")
    }

    func testTailscaleApiUrlWithManualModeNormalizesToTailscaleMode() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "manual-http",
            transport: nil
        )

        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: normalized,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(normalized.transportMode, "tailscale")
        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertFalse(normalized.usesIrohTransportForActiveApiUrl)
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(route.label, "Tailscale direct")
        XCTAssertEqual(
            CompanionAppModel.healthSyncTransportLabel(for: normalized),
            "Tailscale direct"
        )
    }

    func testDiscoveryRanksTailscaleAheadOfIroh() {
        XCTAssertLessThan(
            ForgeServerDiscovery.sourceRankForTesting(.tailscale),
            ForgeServerDiscovery.sourceRankForTesting(.iroh)
        )
    }

    func testIrohPairingWithTailscalePublicFallbackNormalizesBeforeChunkRouting() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let rawRoute = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: normalized,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(rawRoute.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertTrue(rawRoute.usesIroh)
        XCTAssertEqual(rawRoute.label, "Iroh primary")
        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertEqual(normalized.transportMode, "tailscale")
        XCTAssertNil(normalized.transport)
        XCTAssertFalse(normalized.usesIrohTransportForActiveApiUrl)
        XCTAssertEqual(route.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(route.label, "Tailscale direct")
        XCTAssertNil(
            ForgeSyncClient.effectiveIrohTransportProtocolForTesting(
                apiBaseUrl: route.apiBaseUrl,
                transport: payload.transport
            )
        )
    }

    func testHealthSyncChunkRouteNormalizesRootTailscalePublicUrlToApi() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: normalized,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(normalized.transportMode, "tailscale")
        XCTAssertNil(normalized.transport)
        XCTAssertEqual(route.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
    }

    func testHealthSyncTransportLabelUsesOnlyActivePairingRoute() {
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "fakednodeid",
            relay: "https://relay.example.com",
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "fakednodeid",
                token: "hosttoken",
                hostName: "test-host",
                relay: "https://relay.example.com"
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let activeIrohPairing = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: irohTransport
        )
        let activeTailscalePairing = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "tailscale",
            transport: irohTransport
        )

        XCTAssertEqual(CompanionAppModel.healthSyncTransportLabel(for: activeIrohPairing), "Iroh primary")
        XCTAssertEqual(CompanionAppModel.healthSyncTransportLabel(for: activeTailscalePairing), "Tailscale direct")
        XCTAssertEqual(CompanionAppModel.healthSyncTransportLabel(for: nil), "HTTP")
    }

    func testHealthSyncChunkRouteSkipsInsecurePublicFallbackWhenSecurePairingUrlExists() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "http://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(route.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(route.label, "Tailscale direct")
    }

    func testHealthSyncChunkRouteKeepsIrohWhenOnlyInsecurePublicFallbackExists() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "http://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(route.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertTrue(route.usesIroh)
        XCTAssertEqual(route.label, "Iroh primary")
    }

    func testHealthSyncChunkRouteKeepsIrohWhenNoHttpFallbackExists() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: nil,
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(route.apiBaseUrl, "forge-iroh://fakednodeid/api/v1")
        XCTAssertTrue(route.usesIroh)
        XCTAssertEqual(route.label, "Iroh primary")
    }

    func testWatchDirectConnectionUsesTailscalePairingUrlEvenWhenIrohMetadataExists() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_watch_tailscale",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "http://127.0.0.1:4317/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: nil,
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let connection = WatchSessionManager.directWatchConnectionForTesting(for: payload)

        XCTAssertEqual(connection?.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(connection?.uiBaseUrl, "https://macbook-pro.example.ts.net/forge/")
        XCTAssertEqual(connection?.transportLabel, "Tailscale")
        XCTAssertEqual(connection?.sessionId, "pair_watch_tailscale")
        XCTAssertTrue(connection?.directNetworkingEnabled == true)
    }

    func testWatchDirectConnectionNormalizesTailscaleFallbackForIrohPairing() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_watch_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: nil,
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        let connection = WatchSessionManager.directWatchConnectionForTesting(for: payload)

        XCTAssertEqual(connection?.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertEqual(connection?.transportLabel, "Tailscale")
    }

    func testWatchDirectConnectionDoesNotMixGenericPublicFallbackForIrohPairing() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_watch_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://forge.example.com/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: nil,
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        XCTAssertNil(WatchSessionManager.directWatchConnectionForTesting(for: payload))
    }

    func testWatchDirectConnectionRejectsLoopbackAndPlainHttpUrls() {
        let loopbackPayload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "http://127.0.0.1:4317/api/v1",
            uiBaseUrl: "http://127.0.0.1:4317/forge/",
            sessionId: "pair_watch_loopback",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "manual-http",
            transport: nil
        )
        let insecureFallbackPayload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_watch_http",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "http://forge.local:4317/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: nil,
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )

        XCTAssertNil(WatchSessionManager.directWatchConnectionForTesting(for: loopbackPayload))
        XCTAssertNil(WatchSessionManager.directWatchConnectionForTesting(for: insecureFallbackPayload))
    }

    func testWatchDirectRoutePolicyOnlyAllowsSecureNonLoopbackDirectUrls() {
        XCTAssertTrue(
            ForgeWatchDirectRoutePolicy.canUseDirectNetworking(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                directNetworkingEnabled: true
            )
        )
        XCTAssertFalse(
            ForgeWatchDirectRoutePolicy.canUseDirectNetworking(
                apiBaseUrl: "http://macbook-pro.example.ts.net/api/v1",
                directNetworkingEnabled: true
            )
        )
        XCTAssertFalse(
            ForgeWatchDirectRoutePolicy.canUseDirectNetworking(
                apiBaseUrl: "https://127.0.0.1:4317/api/v1",
                directNetworkingEnabled: true
            )
        )
        XCTAssertFalse(
            ForgeWatchDirectRoutePolicy.canUseDirectNetworking(
                apiBaseUrl: "forge-iroh://node/api/v1",
                directNetworkingEnabled: true
            )
        )
    }

    func testWatchDirectRouteTestingStatusDoesNotClaimReadyBeforeVerification() {
        let status = ForgeWatchDirectRoutePolicy.directRouteTestingStatus(
            transportLabel: "Tailscale"
        )

        XCTAssertEqual(status, "Testing Tailscale direct route")
        XCTAssertFalse(status.localizedCaseInsensitiveContains("ready"))
        XCTAssertFalse(status.localizedCaseInsensitiveContains("Iroh"))
    }

    func testWatchDirectMetricUsesTailscaleBackupWordingWithoutIrohOrQueueJargon() {
        let metric = ForgeWatchDirectSyncMetric(
            operation: "actions",
            transportLabel: "Tailscale",
            requestBytes: 1536,
            responseBytes: 512,
            durationMs: 240,
            itemCount: 3,
            succeeded: false,
            fallbackUsed: true,
            errorDescription: "timed out"
        )

        XCTAssertTrue(metric.summary.contains("Tailscale"))
        XCTAssertTrue(metric.summary.contains("paired iPhone backup"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("phone fallback"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("Iroh"))
        XCTAssertFalse(metric.summary.localizedCaseInsensitiveContains("queued"))
    }

    func testWatchQueueReconciliationPreservesActionsCreatedDuringDirectUpload() {
        let acknowledgedBeforeUpload = makeWatchEnvelope(id: "action_before_upload")
        let createdDuringUpload = makeWatchEnvelope(id: "action_created_during_upload")
        let latestQueue = [acknowledgedBeforeUpload, createdDuringUpload]

        let remaining = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
            afterAcknowledging: [acknowledgedBeforeUpload.id],
            in: latestQueue
        )

        XCTAssertEqual(remaining.map(\.id), [createdDuringUpload.id])
    }

    func testWatchQueueReconciliationPreservesUnacknowledgedAndNewRelayActions() {
        let acknowledgedBeforeRelay = makeWatchEnvelope(id: "action_acknowledged_before_relay")
        let unacknowledgedBeforeRelay = makeWatchEnvelope(id: "action_unacknowledged_before_relay")
        let createdDuringRelay = makeWatchEnvelope(id: "action_created_during_relay")
        let latestQueue = [acknowledgedBeforeRelay, unacknowledgedBeforeRelay, createdDuringRelay]

        let remaining = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
            afterAcknowledging: [acknowledgedBeforeRelay.id],
            in: latestQueue
        )

        XCTAssertEqual(
            remaining.map(\.id),
            [unacknowledgedBeforeRelay.id, createdDuringRelay.id]
        )
    }

    func testWatchQueueReconciliationRemovesLiveAckFromDurableRelayQueue() {
        let liveAckedDuplicate = makeWatchEnvelope(id: "action_sent_live_and_stored")
        let durableOnlyPending = makeWatchEnvelope(id: "action_only_in_durable_queue")
        let latestQueue = [liveAckedDuplicate, durableOnlyPending]

        let remaining = ForgeWatchActionQueueReconciliation.remainingEnvelopes(
            afterAcknowledging: [liveAckedDuplicate.id],
            in: latestQueue
        )

        XCTAssertEqual(remaining.map(\.id), [durableOnlyPending.id])
    }

    func testWatchActionBatchPolicyBoundsExchangeWithoutDroppingOutboxItems() {
        let outbox = (0..<47).map { makeWatchEnvelope(id: "action_\($0)") }

        let batch = ForgeWatchActionBatchPolicy.nextBatch(from: outbox)

        XCTAssertEqual(batch.count, ForgeWatchActionBatchPolicy.maximumActionCount)
        XCTAssertEqual(batch.map(\.id), Array(outbox.prefix(20)).map(\.id))
        XCTAssertEqual(outbox.count, 47)
    }

    func testWatchDurableQueueRejectsCountOverflowWithoutDroppingStoredActions() {
        let stored = [
            makeWatchEnvelope(id: "stored_1"),
            makeWatchEnvelope(id: "stored_2")
        ]

        let admission = ForgeWatchDurableQueuePolicy.appending(
            makeWatchEnvelope(id: "rejected"),
            to: stored,
            maximumActionCount: 2,
            maximumEncodedBytes: ForgeWatchDurableQueuePolicy.maximumEncodedBytes
        )

        XCTAssertFalse(admission.inserted)
        XCTAssertNil(admission.encodedData)
        XCTAssertEqual(admission.queue, stored)
        XCTAssertEqual(admission.backpressure, .actionCount(maximum: 2))
        XCTAssertTrue(
            admission.backpressure?.message(storageName: "Watch").contains("full") == true
        )
    }

    func testWatchDurableQueueRejectsEncodedByteOverflowWithoutDroppingStoredActions() throws {
        let stored = [makeWatchEnvelope(id: "stored")]
        let storedByteCount = try JSONEncoder().encode(stored).count

        let admission = ForgeWatchDurableQueuePolicy.appending(
            makeWatchEnvelope(id: "rejected"),
            to: stored,
            maximumActionCount: 10,
            maximumEncodedBytes: storedByteCount
        )

        XCTAssertFalse(admission.inserted)
        XCTAssertNil(admission.encodedData)
        XCTAssertEqual(admission.queue, stored)
        XCTAssertEqual(admission.backpressure, .encodedBytes(maximum: storedByteCount))
        XCTAssertTrue(
            admission.backpressure?.message(storageName: "iPhone").contains("full") == true
        )
    }

    func testWatchSnapshotFreshnessHandlesStaleOfflineAndClockSkewStates() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-11T12:00:00Z"))

        XCTAssertEqual(
            ForgeWatchSnapshotFreshness.evaluate(
                generatedAt: "2026-07-11T11:55:00Z",
                hasSnapshot: true,
                now: now
            ).state,
            .fresh
        )
        XCTAssertEqual(
            ForgeWatchSnapshotFreshness.evaluate(
                generatedAt: "2026-07-11T11:40:00Z",
                hasSnapshot: true,
                now: now
            ).state,
            .stale
        )
        XCTAssertEqual(
            ForgeWatchSnapshotFreshness.evaluate(
                generatedAt: "2026-07-11T12:06:00Z",
                hasSnapshot: true,
                now: now
            ).state,
            .clockSkew
        )
        XCTAssertEqual(
            ForgeWatchSnapshotFreshness.evaluate(
                generatedAt: "not-a-date",
                hasSnapshot: false,
                now: now
            ).state,
            .unavailable
        )
    }

    func testWatchSnapshotNoticeKeepsFreshNowSurfaceUnobstructed() {
        XCTAssertNil(
            ForgeWatchSnapshotNotice.make(
                freshness: ForgeWatchSnapshotFreshness(state: .fresh, ageSeconds: 120),
                source: .direct
            )
        )
    }

    func testWatchSnapshotNoticeExplainsStaleCachedContextBeforeActions() throws {
        let notice = try XCTUnwrap(
            ForgeWatchSnapshotNotice.make(
                freshness: ForgeWatchSnapshotFreshness(state: .stale, ageSeconds: 20 * 60),
                source: .cache
            )
        )

        XCTAssertEqual(notice.title, "Refresh current context")
        XCTAssertTrue(notice.message.contains("Stale 20m"))
        XCTAssertTrue(notice.message.contains("On-device cache"))
        XCTAssertTrue(notice.message.contains("task status"))
    }

    func testWatchSnapshotNoticeProvidesRecoveryForClockSkewAndMissingSnapshot() throws {
        let clockSkew = try XCTUnwrap(
            ForgeWatchSnapshotNotice.make(
                freshness: ForgeWatchSnapshotFreshness(state: .clockSkew, ageSeconds: -600),
                source: .phone
            )
        )
        let unavailable = try XCTUnwrap(
            ForgeWatchSnapshotNotice.make(
                freshness: ForgeWatchSnapshotFreshness(state: .unavailable, ageSeconds: nil),
                source: .unavailable
            )
        )

        XCTAssertEqual(clockSkew.title, "Snapshot time mismatch")
        XCTAssertTrue(clockSkew.message.contains("Refresh"))
        XCTAssertEqual(unavailable.title, "Current context unavailable")
        XCTAssertTrue(unavailable.message.contains("paired iPhone"))
    }

    func testWatchReceiptHistoryIsBoundedAndDeduplicated() {
        let existing = (0..<30).map {
            ForgeWatchStoredReceipt(
                actionId: "action_\($0)",
                kind: "capture_event",
                status: "processed",
                processedAt: "2026-07-11T10:00:00Z",
                errorMessage: nil
            )
        }
        let replacement = ForgeWatchStoredReceipt(
            actionId: "action_5",
            kind: "capture_event",
            status: "failed",
            processedAt: "2026-07-11T10:05:00Z",
            errorMessage: "Forge rejected this action"
        )

        let merged = ForgeWatchReceiptHistoryPolicy.merging([replacement], into: existing)

        XCTAssertEqual(merged.count, ForgeWatchReceiptHistoryPolicy.maximumReceiptCount)
        XCTAssertEqual(merged.first, replacement)
        XCTAssertEqual(merged.filter { $0.actionId == replacement.actionId }.count, 1)
    }

    func testAsynchronousSingleAckPersistsReceiptAndContinuesWithNextBoundedBatch() throws {
        let acknowledged = makeWatchEnvelope(id: "acknowledged")
        let remaining = (0..<25).map { makeWatchEnvelope(id: "remaining_\($0)") }
        let queue = [acknowledged] + remaining
        let ack = ForgeWatchAckEnvelope(
            actionId: acknowledged.id,
            kind: acknowledged.kind.rawValue,
            processedAt: "2026-07-11T10:01:00Z",
            status: "processed",
            error: nil,
            bootstrap: nil
        )

        let update = ForgeWatchReceiptLifecycle.applying(
            ack,
            to: queue,
            receiptHistory: []
        )
        let nextBatch = ForgeWatchActionBatchPolicy.nextBatch(from: update.remainingQueue)
        let persistedData = try JSONEncoder().encode(update.receiptHistory)
        let restoredReceipts = try JSONDecoder().decode(
            [ForgeWatchStoredReceipt].self,
            from: persistedData
        )

        XCTAssertEqual(update.remainingQueue, remaining)
        XCTAssertEqual(update.completedReceipt?.actionId, acknowledged.id)
        XCTAssertEqual(restoredReceipts.first?.actionId, acknowledged.id)
        XCTAssertTrue(update.shouldContinueFlushing)
        XCTAssertEqual(nextBatch.count, ForgeWatchActionBatchPolicy.maximumActionCount)
        XCTAssertEqual(nextBatch.map(\.id), Array(remaining.prefix(20)).map(\.id))
    }

    func testDeferredReceiptKeepsDurableActionAndDoesNotStartAnotherFlush() {
        let pending = makeWatchEnvelope(id: "pending")
        let ack = ForgeWatchAckEnvelope(
            actionId: pending.id,
            kind: pending.kind.rawValue,
            processedAt: "2026-07-11T10:01:00Z",
            status: "deferred",
            error: ["message": "Forge pairing is not ready"],
            bootstrap: nil
        )

        let update = ForgeWatchReceiptLifecycle.applying(
            ack,
            to: [pending],
            receiptHistory: []
        )

        XCTAssertEqual(update.remainingQueue, [pending])
        XCTAssertTrue(update.receiptHistory.isEmpty)
        XCTAssertNil(update.completedReceipt)
        XCTAssertFalse(update.shouldContinueFlushing)
    }

    func testPlan17PhoneRelayPreservesExactStructuredWatchReceiptError() throws {
        let receipt = ForgeWatchCommandReceipt(
            actionId: "plan-17-stable-operation",
            kind: ForgeWatchActionKind.taskRunComplete.rawValue,
            status: "failed",
            processedAt: "2026-07-16T10:00:00Z",
            error: [
                "statusCode": 404,
                "code": "watch_task_run_not_found",
                "message": "Task run not found",
                "details": .object([
                    "retryable": false,
                    "operationId": "plan-17-stable-operation"
                ])
            ]
        )

        let ack = WatchSessionManager.ackEnvelope(for: receipt, bootstrap: nil)
        let decoded = try JSONDecoder().decode(
            ForgeWatchAckEnvelope.self,
            from: JSONEncoder().encode(ack)
        )

        XCTAssertEqual(decoded.actionId, receipt.actionId)
        XCTAssertEqual(decoded.status, "failed")
        XCTAssertEqual(decoded.error, receipt.error)
        XCTAssertEqual(decoded.error?["statusCode"]?.integerValue, 404)
        XCTAssertEqual(decoded.error?["code"]?.stringValue, "watch_task_run_not_found")
    }

    func testWatchDirectRouteCooldownOnlyAppliesToRecoverableNetworkErrors() {
        XCTAssertEqual(ForgeWatchDirectRoutePolicy.failureFallbackCooldownSeconds, 3)
        XCTAssertEqual(ForgeWatchDirectRoutePolicy.directRetryAfterFailureDelaySeconds, 3.25)
        XCTAssertEqual(ForgeWatchDirectRoutePolicy.directRequestTimeoutSeconds, 3)
        XCTAssertTrue(
            ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(forceUserRetry: false)
        )
        XCTAssertFalse(
            ForgeWatchDirectRoutePolicy.shouldRespectFailureCooldown(forceUserRetry: true)
        )
        XCTAssertTrue(ForgeWatchDirectRoutePolicy.isRecoverableNetworkError(URLError(.timedOut)))
        XCTAssertTrue(ForgeWatchDirectRoutePolicy.isRecoverableNetworkError(URLError(.cannotConnectToHost)))
        XCTAssertTrue(ForgeWatchDirectRoutePolicy.isRecoverableNetworkError(URLError(.notConnectedToInternet)))

        let serverRejection = NSError(
            domain: "ForgeWatchDirect",
            code: 409,
            userInfo: [NSLocalizedDescriptionKey: "Forge rejected the action."]
        )
        XCTAssertFalse(ForgeWatchDirectRoutePolicy.isRecoverableNetworkError(serverRejection))
    }

    private func makeWatchEnvelope(id: String) -> ForgeWatchOutboundEnvelope {
        ForgeWatchOutboundEnvelope(
            id: id,
            createdAt: "2026-06-12T08:00:00Z",
            device: ForgeWatchDeviceDescriptor(
                name: "Test Watch",
                platform: "watchOS",
                appVersion: "test",
                sourceDevice: "watch"
            ),
            kind: .captureEvent,
            habitCheckIn: nil,
            captureEvent: ForgeWatchCaptureEventAction(
                eventType: "mark_moment",
                recordedAt: "2026-06-12T08:00:00Z",
                promptId: nil,
                linkedContext: .empty,
                payload: ["source": "test"]
            ),
            command: nil
        )
    }

    func testReachablePhoneFallbackBatchesWatchActionsIntoOneExchange() throws {
        let actionCount = 5
        let previousExchangeCount = actionCount

        XCTAssertEqual(
            ForgeWatchPhoneFallbackBatchPolicy.reachablePhoneExchangeCount(forActionCount: actionCount),
            1
        )
        XCTAssertLessThan(
            ForgeWatchPhoneFallbackBatchPolicy.reachablePhoneExchangeCount(forActionCount: actionCount),
            previousExchangeCount
        )
        XCTAssertEqual(
            ForgeWatchPhoneFallbackBatchPolicy.reachablePhoneExchangeCount(forActionCount: 0),
            0
        )
    }

    func testWatchRelayBatchEnvelopesRoundTrip() throws {
        let device = ForgeWatchDeviceDescriptor(
            name: "Apple Watch",
            platform: "watchos",
            appVersion: "1.0",
            sourceDevice: "Apple Watch"
        )
        let action = ForgeWatchOutboundEnvelope(
            id: "watch_action_1",
            createdAt: "2026-06-12T12:00:00Z",
            device: device,
            kind: .habitCheckIn,
            habitCheckIn: ForgeWatchHabitCheckInAction(
                habitId: "habit_1",
                dateKey: "2026-06-12",
                status: "done",
                note: ""
            ),
            captureEvent: nil,
            command: nil
        )
        let encodedBatch = try JSONEncoder().encode(
            ForgeWatchOutboundBatchEnvelope(envelopes: [action])
        )
        let decodedBatch = try JSONDecoder().decode(
            ForgeWatchOutboundBatchEnvelope.self,
            from: encodedBatch
        )
        XCTAssertEqual(decodedBatch.envelopes.map(\.id), ["watch_action_1"])

        let ack = ForgeWatchAckEnvelope(
            actionId: action.id,
            processedAt: "2026-06-12T12:00:01Z",
            status: "processed",
            error: nil,
            bootstrap: nil
        )
        let encodedSingleAck = try JSONEncoder().encode(ack)
        let decodedSingleAck = try JSONDecoder().decode(
            ForgeWatchAckEnvelope.self,
            from: encodedSingleAck
        )
        XCTAssertEqual(decodedSingleAck.actionId, "watch_action_1")

        let encodedAckBatch = try JSONEncoder().encode(ForgeWatchAckBatchEnvelope(acks: [ack]))
        let decodedAckBatch = try JSONDecoder().decode(
            ForgeWatchAckBatchEnvelope.self,
            from: encodedAckBatch
        )
        XCTAssertEqual(decodedAckBatch.acks.map(\.actionId), ["watch_action_1"])
    }

    func testForegroundDirectBulkRouteUsesAggressiveDirectTimeout() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: normalized,
            preferDirectBulkTransfer: true
        )
        let timeout = ForgeSyncClient.healthSyncChunkRequestTimeoutForTesting(
            pairing: normalized,
            route: route,
            useBackgroundUpload: false,
            appIsForegroundActive: true
        )

        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(timeout, ForgeSyncClient.foregroundDirectBulkHealthSyncChunkTimeout)
        XCTAssertEqual(ForgeSyncClient.standardHealthSyncChunkTimeout / timeout, 10)
    }

    func testBackgroundDirectBulkRouteKeepsStandardTimeout() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: normalized,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(normalized.apiBaseUrl, "https://macbook-pro.example.ts.net/api/v1")
        XCTAssertFalse(route.usesIroh)
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkRequestTimeoutForTesting(
                pairing: normalized,
                route: route,
                useBackgroundUpload: true,
                appIsForegroundActive: false
            ),
            120
        )
    }

    func testForegroundDirectHttpRouteUsesShortHealthSyncTimeout() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "manual-http",
            transport: nil
        )
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkRequestTimeoutForTesting(
                pairing: payload,
                route: route,
                useBackgroundUpload: false,
                appIsForegroundActive: true
            ),
            ForgeSyncClient.foregroundDirectBulkHealthSyncChunkTimeout
        )
    }

    func testIrohPrimaryRouteKeepsStandardHealthSyncTimeout() {
        let payload = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
            uiBaseUrl: "forge-iroh://fakednodeid/forge/",
            sessionId: "pair_test",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["healthkit.fitness"],
            transportMode: "iroh",
            transport: PairingTransport(
                protocolName: "iroh",
                provider: "forge-companion-iroh",
                status: "ready",
                publicBaseUrl: nil,
                localBaseUrl: "http://127.0.0.1:4317",
                nodeId: "fakednodeid",
                relay: "https://relay.example.com",
                alpn: "forge-companion/1",
                agent: "forge",
                pairPayload: PairingTransportPairPayload(
                    v: 1,
                    nodeId: "fakednodeid",
                    token: "hosttoken",
                    hostName: "test-host",
                    relay: "https://relay.example.com"
                ),
                recreateCommand: nil,
                startedAt: nil,
                lastError: nil,
                notes: []
            )
        )
        let route = ForgeSyncClient.healthSyncChunkTransportRouteForTesting(
            pairing: payload,
            preferDirectBulkTransfer: true
        )

        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkRequestTimeoutForTesting(
                pairing: payload,
                route: route,
                useBackgroundUpload: false,
                appIsForegroundActive: true
            ),
            120
        )
    }

    func testHealthSyncChunkTransportTimingLabelsDirectRoutes() {
        XCTAssertEqual(
            ForgeSyncClient.requestTransportTimingSummaryForTesting(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                transportProtocolName: nil,
                elapsedMs: 842
            ),
            "Tailscale request 842 ms"
        )
        XCTAssertEqual(
            ForgeSyncClient.requestTransportTimingSummaryForTesting(
                apiBaseUrl: "https://forge.example.com/api/v1",
                transportProtocolName: nil,
                elapsedMs: 1_245
            ),
            "HTTP request 1.2s"
        )
        XCTAssertEqual(
            ForgeSyncClient.requestTransportTimingSummaryForTesting(
                apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
                transportProtocolName: "iroh",
                elapsedMs: 21_400
            ),
            "Iroh request 21.4s"
        )
    }

    func testIrohTransportTimeoutDoesNotFallbackForTailscaleDirectUrls() {
        XCTAssertFalse(
            ForgeSyncClient.shouldFallbackFromIrohToUrlSessionForTesting(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                errorDomain: "ForgeIrohTransport",
                errorCode: URLError.timedOut.rawValue,
                errorDescription: "Forge Iroh request timed out."
            )
        )
        XCTAssertFalse(
            ForgeSyncClient.shouldFallbackFromIrohToUrlSessionForTesting(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                errorDomain: "ForgeIrohTransport",
                errorCode: -1,
                errorDescription: "connecting over Forge Iroh bridge: timed out"
            )
        )
        XCTAssertFalse(
            ForgeSyncClient.shouldFallbackFromIrohToUrlSessionForTesting(
                apiBaseUrl: "forge-iroh://fakednodeid/api/v1",
                errorDomain: "ForgeIrohTransport",
                errorCode: URLError.timedOut.rawValue,
                errorDescription: "Forge Iroh request timed out."
            )
        )
        XCTAssertFalse(
            ForgeSyncClient.shouldFallbackFromIrohToUrlSessionForTesting(
                apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
                errorDomain: "ForgeIrohTransport",
                errorCode: 401,
                errorDescription: "Unauthorized"
            )
        )
    }

    func testIrohTransportErrorEnvelopeCanOmitHeaders() throws {
        let decoded = try ForgeIrohTransportClient.decodedResponseEnvelopeForTesting(
            """
            {
              "ok": false,
              "status": -1001,
              "error": "Forge Iroh request timed out."
            }
            """
        )

        XCTAssertFalse(decoded.ok)
        XCTAssertEqual(decoded.status, -1001)
        XCTAssertEqual(decoded.error, "Forge Iroh request timed out.")
        XCTAssertEqual(decoded.headers.count, 0)
        XCTAssertEqual(decoded.body.count, 0)
    }

    func testPairingPayloadDecodesShortCliQrPayload() throws {
        let json = """
        {
          "k": "fcp1",
          "a": "forge-iroh://shortnodeid/api/v1",
          "m": "iroh",
          "t": {
            "p": "iroh",
            "pp": {
              "v": 1,
              "n": "shortnodeid",
              "t": "hosttoken",
              "h": "test-host",
              "r": "https://relay.example.com"
            }
          },
          "s": "pair_short",
          "pt": "pairing-token",
          "e": "2099-01-01T00:00:00Z",
          "c": ["health-sync"]
        }
        """

        let payload = try JSONDecoder().decode(
            PairingPayload.self,
            from: Data(json.utf8)
        )
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(payload.kind, "forge-companion-pairing")
        XCTAssertEqual(normalized.apiBaseUrl, "forge-iroh://shortnodeid/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "forge-iroh://shortnodeid/forge/")
        XCTAssertEqual(normalized.transportMode, "iroh")
        XCTAssertEqual(normalized.transport?.protocolName, "iroh")
        XCTAssertEqual(normalized.transport?.provider, "forge-companion-iroh")
        XCTAssertEqual(normalized.transport?.status, "ready")
        XCTAssertEqual(normalized.transport?.notes, [])
        XCTAssertEqual(normalized.transport?.pairPayload?.nodeId, "shortnodeid")
        XCTAssertEqual(normalized.transport?.pairPayload?.token, "hosttoken")
        XCTAssertEqual(normalized.sessionId, "pair_short")
        XCTAssertEqual(normalized.pairingToken, "pairing-token")
    }

    func testPairingPayloadDecoderAcceptsCliJsonEnvelope() throws {
        let json = """
        {
          "qrPayload": {
            "kind": "forge-companion-pairing",
            "apiBaseUrl": "forge-iroh://envelopednode/api/v1",
            "transportMode": "iroh",
            "transport": {
              "protocol": "iroh",
              "provider": "forge-companion-iroh",
              "pairPayload": {
                "v": 1,
                "node_id": "envelopednode",
                "token": "hosttoken"
              }
            },
            "sessionId": "pair_envelope",
            "pairingToken": "pairing-token",
            "expiresAt": "2099-01-01T00:00:00Z",
            "capabilities": ["health-sync"]
          }
        }
        """

        let payload = try PairingPayload.decodePairingText(json)
        let normalized = CompanionPairingURLResolver.normalizedPayload(payload)

        XCTAssertEqual(normalized.sessionId, "pair_envelope")
        XCTAssertEqual(normalized.apiBaseUrl, "forge-iroh://envelopednode/api/v1")
        XCTAssertEqual(normalized.uiBaseUrl, "forge-iroh://envelopednode/forge/")
        XCTAssertEqual(normalized.transport?.pairPayload?.nodeId, "envelopednode")
    }

    func testWatchBootstrapDecodesCompactHabitPayload() throws {
        let json = """
        {
          "generatedAt": "2026-04-07T10:00:00Z",
          "habits": [
            {
              "id": "habit_1",
              "title": "Morning planning",
              "polarity": "positive",
              "frequency": "daily",
              "targetCount": 1,
              "weekDays": [],
              "streakCount": 3,
              "dueToday": true,
              "cadenceLabel": "1x daily",
              "alignedActionLabel": "Done",
              "unalignedActionLabel": "Missed",
              "currentPeriodStatus": "unknown",
              "last7History": [
                { "id": "1", "label": "S", "periodKey": "2026-04-01", "current": false, "state": "aligned" },
                { "id": "2", "label": "M", "periodKey": "2026-04-02", "current": false, "state": "aligned" },
                { "id": "3", "label": "T", "periodKey": "2026-04-03", "current": false, "state": "unknown" },
                { "id": "4", "label": "W", "periodKey": "2026-04-04", "current": false, "state": "aligned" },
                { "id": "5", "label": "T", "periodKey": "2026-04-05", "current": false, "state": "aligned" },
                { "id": "6", "label": "F", "periodKey": "2026-04-06", "current": false, "state": "unknown" },
                { "id": "7", "label": "S", "periodKey": "2026-04-07", "current": true, "state": "unknown" }
              ]
            }
          ],
          "checkInOptions": {
            "activities": ["Working"],
            "emotions": ["Focused"],
            "triggers": ["Conflict"],
            "placeCategories": ["Home"],
            "routinePrompts": ["Medication taken?"],
            "recentPeople": ["Julien"]
          },
          "pendingPrompts": []
        }
        """

        let bootstrap = try JSONDecoder().decode(
            ForgeWatchBootstrap.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(bootstrap.habits.count, 1)
        XCTAssertEqual(bootstrap.habits.first?.alignedActionLabel, "Done")
        XCTAssertEqual(bootstrap.habits.first?.last7History.count, 7)
        XCTAssertEqual(bootstrap.checkInOptions.recentPeople.first, "Julien")
    }

    func testWatchBootstrapDecodesCompactAttentionPayload() throws {
        let json = """
        {
          "schemaVersion": 2,
          "generatedAt": "2026-07-09T22:00:00Z",
          "inbox": {
            "prompts": [],
            "attention": {
              "activeCount": 4,
              "blockingCount": 1,
              "importantCount": 2,
              "items": [
                {
                  "id": "attn:task:task_1",
                  "title": "Resolve the blocked import",
                  "reason": "This task is blocked and needs a next move.",
                  "source": "task",
                  "severity": "blocking",
                  "targetLabel": "Open task",
                  "targetPath": "/forge/tasks/task_1",
                  "updatedAt": "2026-07-09T21:55:00Z"
                }
              ]
            }
          },
          "habits": [],
          "checkInOptions": {
            "activities": [],
            "emotions": [],
            "triggers": [],
            "placeCategories": [],
            "routinePrompts": [],
            "recentPeople": []
          },
          "pendingPrompts": []
        }
        """

        let bootstrap = try JSONDecoder().decode(
            ForgeWatchBootstrap.self,
            from: Data(json.utf8)
        )

        XCTAssertEqual(bootstrap.inbox?.attention?.activeCount, 4)
        XCTAssertEqual(bootstrap.inbox?.attention?.blockingCount, 1)
        XCTAssertEqual(bootstrap.inbox?.attention?.items.first?.id, "attn:task:task_1")
        XCTAssertEqual(bootstrap.inbox?.attention?.items.first?.targetPath, "/forge/tasks/task_1")
    }

    func testWatchTaskStatusCommandEnvelopeEncodesBlockedPayload() throws {
        let envelope = ForgeWatchOutboundEnvelope(
            id: "watch-action-blocked-1",
            createdAt: "2026-04-07T08:02:00.000Z",
            device: ForgeWatchDeviceDescriptor(
                name: "Omar Watch",
                platform: "watchos",
                appVersion: "1.0.78",
                sourceDevice: "Apple Watch"
            ),
            kind: .taskStatusUpdate,
            habitCheckIn: nil,
            captureEvent: nil,
            command: ForgeWatchCommandAction(
                payload: ["taskId": "task_watch_blocked", "status": "blocked"]
            )
        )

        let decoded = try JSONDecoder().decode(
            ForgeWatchOutboundEnvelope.self,
            from: JSONEncoder().encode(envelope)
        )

        XCTAssertEqual(decoded.kind, .taskStatusUpdate)
        XCTAssertEqual(decoded.command?.payload["taskId"], "task_watch_blocked")
        XCTAssertEqual(decoded.command?.payload["status"], "blocked")
        XCTAssertNil(decoded.habitCheckIn)
        XCTAssertNil(decoded.captureEvent)
    }

    func testCompanionOperationalSummaryFlagsMissingAuthorizationAsWarning() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .permissionDenied,
            latestError: nil,
            healthSyncEnabled: true,
            healthAccessStatus: .notSet,
            movementEnabled: true,
            movementPermissionStatus: "not_determined",
            movementBackgroundReady: false,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "not_determined"
        )

        XCTAssertEqual(summary.status, .warning)
        XCTAssertEqual(summary.detail, "Missing authorization")
    }

    func testCompanionOperationalSummaryReturnsOkWhenSignalsAreReady() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .healthy,
            latestError: nil,
            healthSyncEnabled: true,
            healthAccessStatus: .fullAccess,
            movementEnabled: true,
            movementPermissionStatus: "authorized_always",
            movementBackgroundReady: true,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "approved"
        )

        XCTAssertEqual(summary.status, .ok)
        XCTAssertEqual(summary.detail, "All core signals ready")
    }

    func testCompanionOperationalSummaryDoesNotCallStaleSyncMissingAuthorization() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .stale,
            latestError: nil,
            healthSyncEnabled: true,
            healthAccessStatus: .customAccess,
            movementEnabled: true,
            movementPermissionStatus: "always",
            movementBackgroundReady: true,
            screenTimeEnabled: false,
            screenTimeAuthorizationStatus: "disabled"
        )

        XCTAssertEqual(summary.status, .warning)
        XCTAssertEqual(summary.detail, "Needs refresh")
    }

    func testCompanionOperationalSummaryPromotesErrorsAboveAuthorizationWarnings() {
        let summary = CompanionOperationalSummary.derive(
            syncState: .healthy,
            latestError: "Upload failed",
            healthSyncEnabled: true,
            healthAccessStatus: .fullAccess,
            movementEnabled: true,
            movementPermissionStatus: "authorized_always",
            movementBackgroundReady: true,
            screenTimeEnabled: true,
            screenTimeAuthorizationStatus: "approved"
        )

        XCTAssertEqual(summary.status, .error)
        XCTAssertEqual(summary.detail, "Upload failed")
    }

    func testSleepInferenceCountsShortInternalGapsWhenInBedIsMissing() async {
        let store = HealthSyncStore()
        let segments = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T23:10:00.000Z"),
                endDate: makeDate("2026-04-05T00:00:00.000Z"),
                stageLabel: "rem",
                bucket: .asleep,
                sourceValue: 5
            )
        ]

        let inferredGap = await store.inferredGapDuration(for: segments, threshold: 15 * 60)

        XCTAssertEqual(inferredGap, 600)
    }

    func testSleepInferenceMergesOverlappingStageSegments() async {
        let store = HealthSyncStore()
        let segments = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T22:30:00.000Z"),
                endDate: makeDate("2026-04-04T23:30:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            )
        ]

        let breakdown = await store.mergedStageBreakdown(for: segments)

        XCTAssertEqual(breakdown.count, 1)
        XCTAssertEqual(breakdown.first?.stage, "core")
        XCTAssertEqual(breakdown.first?.seconds, 5_400)
    }

    func testSleepInferenceSelectsLongestOvernightEpisodePerWakeDate() async {
        let store = HealthSyncStore()
        let episodes = [
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-05T05:30:00.000Z"),
                localDateKey: "2026-04-05",
                sourceTimezone: "UTC",
                rawSegmentCount: 6,
                timeInBedSeconds: 27_000,
                asleepSeconds: 25_800,
                awakeSeconds: 1_200,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            ),
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-05T12:00:00.000Z"),
                endDate: makeDate("2026-04-05T13:00:00.000Z"),
                localDateKey: "2026-04-05",
                sourceTimezone: "UTC",
                rawSegmentCount: 2,
                timeInBedSeconds: 3_600,
                asleepSeconds: 3_000,
                awakeSeconds: 600,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            ),
            HealthSyncStore.SleepEpisode(
                startDate: makeDate("2026-04-05T23:00:00.000Z"),
                endDate: makeDate("2026-04-06T06:00:00.000Z"),
                localDateKey: "2026-04-06",
                sourceTimezone: "UTC",
                rawSegmentCount: 5,
                timeInBedSeconds: 25_200,
                asleepSeconds: 24_000,
                awakeSeconds: 1_200,
                stageBreakdown: [],
                recoveryMetrics: [:],
                sourceMetrics: [:],
                links: [],
                annotations: .init(qualitySummary: "", notes: "", tags: [])
            )
        ]

        let canonical = await store.selectCanonicalNights(from: episodes)

        XCTAssertEqual(canonical.count, 2)
        XCTAssertEqual(canonical[0].localDateKey, "2026-04-06")
        XCTAssertEqual(canonical[1].localDateKey, "2026-04-05")
        XCTAssertEqual(canonical[1].timeInBedSeconds, 27_000)
    }

    func testSleepInferenceClusteringSplitsOnlyOnRealLongGaps() async {
        let store = HealthSyncStore()
        let anchors = [
            HealthSyncStore.SleepSegment(
                externalUid: "seg_1",
                startDate: makeDate("2026-04-04T22:00:00.000Z"),
                endDate: makeDate("2026-04-04T23:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_2",
                startDate: makeDate("2026-04-04T23:20:00.000Z"),
                endDate: makeDate("2026-04-05T00:00:00.000Z"),
                stageLabel: "deep",
                bucket: .asleep,
                sourceValue: 4
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_3",
                startDate: makeDate("2026-04-05T05:10:00.000Z"),
                endDate: makeDate("2026-04-05T06:00:00.000Z"),
                stageLabel: "core",
                bucket: .asleep,
                sourceValue: 3
            ),
            HealthSyncStore.SleepSegment(
                externalUid: "seg_4",
                startDate: makeDate("2026-04-05T06:10:00.000Z"),
                endDate: makeDate("2026-04-05T06:40:00.000Z"),
                stageLabel: "rem",
                bucket: .asleep,
                sourceValue: 5
            )
        ]

        let clusters = await store.clusterSleepAnchorSegments(anchors)

        XCTAssertEqual(clusters.count, 2)
        XCTAssertEqual(clusters[0].count, 2)
        XCTAssertEqual(clusters[1].count, 2)
    }

    func testCompanionSyncPayloadEncodesRawSleepRecordsAlongsideSegmentsAndNights() throws {
        let payload = CompanionSyncPayload(
            sessionId: "pair_1",
            pairingToken: "token",
            device: .init(
                name: "Omar iPhone",
                platform: "ios",
                appVersion: "1.0",
                sourceDevice: "iPhone"
            ),
            permissions: .init(
                healthKitAuthorized: true,
                backgroundRefreshEnabled: true,
                motionReady: false,
                locationReady: false,
                screenTimeReady: false
            ),
            sourceStates: .init(
                health: .init(
                    desiredEnabled: true,
                    appliedEnabled: true,
                    authorizationStatus: "approved",
                    syncEligible: true,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                movement: .init(
                    desiredEnabled: false,
                    appliedEnabled: false,
                    authorizationStatus: "not_determined",
                    syncEligible: false,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                screenTime: .init(
                    desiredEnabled: false,
                    appliedEnabled: false,
                    authorizationStatus: "not_determined",
                    syncEligible: false,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                )
            ),
            sleepSessions: [],
            sleepNights: [
                .init(
                    externalUid: "night_1",
                    startedAt: "2026-04-04T22:00:00.000Z",
                    endedAt: "2026-04-05T06:00:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    timeInBedSeconds: 28_800,
                    asleepSeconds: 27_000,
                    awakeSeconds: 1_800,
                    rawSegmentCount: 2,
                    stageBreakdown: [.init(stage: "core", seconds: 18_000)],
                    recoveryMetrics: [:],
                    sourceMetrics: [:],
                    links: [],
                    annotations: .init(qualitySummary: "", notes: "", tags: [])
                )
            ],
            sleepSegments: [
                .init(
                    externalUid: "seg_1",
                    startedAt: "2026-04-04T22:15:00.000Z",
                    endedAt: "2026-04-05T01:15:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    stage: "core",
                    bucket: "asleep",
                    sourceValue: 3,
                    metadata: [:]
                )
            ],
            sleepRawRecords: [
                .init(
                    externalUid: "seg_1",
                    startedAt: "2026-04-04T22:15:00.000Z",
                    endedAt: "2026-04-05T01:15:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-04-05",
                    providerRecordType: "healthkit_sleep_sample",
                    rawStage: "core",
                    rawValue: 3,
                    payload: ["source": .string("unit-test")],
                    metadata: [:]
                )
            ],
            workouts: [],
            vitals: .init(daySummaries: []),
            movement: .init(
                settings: .init(
                    trackingEnabled: false,
                    publishMode: "disabled",
                    retentionMode: "device_only",
                    locationPermissionStatus: "not_determined",
                    motionPermissionStatus: "not_determined",
                    backgroundTrackingReady: false,
                    metadata: [:]
                ),
                knownPlaces: [],
                stays: [],
                trips: []
            ),
            screenTime: .init(
                settings: .init(
                    trackingEnabled: false,
                    syncEnabled: false,
                    authorizationStatus: "not_determined",
                    captureState: "disabled",
                    lastCapturedDayKey: nil,
                    lastCaptureStartedAt: nil,
                    lastCaptureEndedAt: nil,
                    metadata: [:]
                ),
                daySummaries: [],
                hourlySegments: []
            )
        )

        let encoded = try JSONEncoder().encode(payload)
        let json = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]

        XCTAssertEqual((json?["sleepRawRecords"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((json?["sleepSegments"] as? [[String: Any]])?.count, 1)
        XCTAssertEqual((json?["sleepNights"] as? [[String: Any]])?.count, 1)
    }

    func testPermissionSyncPhaseUsesBusyLabelsForLiveWork() {
        XCTAssertTrue(CompanionPermissionSyncPhase.requestingHealth.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.requestingHealth.buttonLabel, "Requesting Health…")
        XCTAssertEqual(CompanionPermissionSyncPhase.requestingHealth.progressDetail, "Waiting for Health access.")

        XCTAssertTrue(CompanionPermissionSyncPhase.syncing.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.syncing.buttonLabel, "Syncing now…")
        XCTAssertEqual(CompanionPermissionSyncPhase.syncing.progressDetail, "Sending the latest payload to Forge.")
    }

    func testPermissionSyncPhaseFallsBackToRetryAfterFailure() {
        XCTAssertFalse(CompanionPermissionSyncPhase.failed.isBusy)
        XCTAssertEqual(CompanionPermissionSyncPhase.failed.buttonLabel, "Try again")
        XCTAssertEqual(CompanionPermissionSyncPhase.failed.progressDetail, "The action did not finish. You can retry.")
    }

    func testManualProbeCandidatesPreferTailscaleServeForMagicDNSHosts() {
        let candidates = ForgeServerDiscovery.manualProbeCandidates(
            for: "macbook-pro.tail47ba04.ts.net"
        )

        XCTAssertTrue(
            candidates.contains {
                $0.apiBaseUrl == "https://macbook-pro.tail47ba04.ts.net/api/v1"
                    && $0.uiBaseUrl == "https://macbook-pro.tail47ba04.ts.net/forge/"
                    && $0.source == .tailscale
                    && $0.canBootstrapPairing
            }
        )
    }

    func testManualProbeCandidatesNormalizeExplicitLocalApiUrl() {
        let candidates = ForgeServerDiscovery.manualProbeCandidates(
            for: "http://192.168.1.42:4317"
        )

        XCTAssertTrue(
            candidates.contains {
                $0.apiBaseUrl == "http://192.168.1.42:4317/api/v1"
                    && $0.uiBaseUrl == "http://192.168.1.42:4317/forge/"
                    && $0.source == .lan
            }
        )
    }

    func testPassiveStationaryClusterRepairsShortMoveIntoRetroactiveStay() throws {
        let store = MovementSyncStore(testingState: nil)
        store.debugSetTrackingEnabled(true)

        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let locations = stride(from: 0, through: 11, by: 1).map { minute in
            makeLocation(
                latitude: 46.5191,
                longitude: 6.6323,
                timestamp: start.addingTimeInterval(Double(minute) * 60)
            )
        }

        store.debugProcessLocations(locations)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertNotNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.stays.count, 1)
        let activeStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(activeStayStart.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 61)
        XCTAssertEqual(snapshot.activeStay?.status, "active")
        XCTAssertEqual(snapshot.latestLocationSummary, "Current state: staying")
    }

    func testValidMovePersistsWhenDurationAndDistanceExceedThresholds() {
        let store = MovementSyncStore(testingState: nil)
        store.debugSetTrackingEnabled(true)

        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let locations = [
            makeLocation(latitude: 46.5191, longitude: 6.6323, timestamp: start),
            makeLocation(latitude: 46.5196, longitude: 6.6334, timestamp: start.addingTimeInterval(60)),
            makeLocation(latitude: 46.5201, longitude: 6.6348, timestamp: start.addingTimeInterval(120)),
            makeLocation(latitude: 46.5207, longitude: 6.6362, timestamp: start.addingTimeInterval(180)),
            makeLocation(latitude: 46.5213, longitude: 6.6377, timestamp: start.addingTimeInterval(240)),
            makeLocation(latitude: 46.5218, longitude: 6.6391, timestamp: start.addingTimeInterval(300)),
            makeLocation(latitude: 46.5224, longitude: 6.6405, timestamp: start.addingTimeInterval(360))
        ]

        store.debugProcessLocations(locations)
        let snapshot = store.debugSnapshot()

        XCTAssertNotNil(snapshot.activeTrip)
        XCTAssertNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertGreaterThan(snapshot.activeTrip?.distanceMeters ?? 0, 100)
        XCTAssertEqual(snapshot.latestLocationSummary, "Current state: moving")
    }

    func testPersistedInvalidActiveTripRepairsToStayOnLoad() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(6.2 * 3600)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_bad",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 42,
                    movingSeconds: Int(6.2 * 3600),
                    idleSeconds: 0,
                    averageSpeedMps: 0.2,
                    maxSpeedMps: 0.3,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "point_a",
                            externalUid: "point_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_b",
                            externalUid: "point_b",
                            recordedAt: end,
                            latitude: 46.5192,
                            longitude: 6.63235,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.1,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 0)
        XCTAssertEqual(snapshot.stays.count, 1)
        let repairedStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(repairedStayStart.timeIntervalSince1970, start.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.activeStay?.status, "active")
        XCTAssertTrue(snapshot.activeStay?.tags.contains("invalid_trip_replaced") ?? false)
    }

    func testRepairRemovesOverlappingSameKindSegmentsFromLocalState() {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_a",
                    label: "Stay A",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start,
                    endedAt: start.addingTimeInterval(3600),
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 3,
                    placeExternalUid: "",
                    placeLabel: "",
                    tags: [],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_b",
                    label: "Stay B",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start.addingTimeInterval(1800),
                    endedAt: start.addingTimeInterval(5400),
                    centerLatitude: 46.5192,
                    centerLongitude: 6.6324,
                    radiusMeters: 100,
                    sampleCount: 3,
                    placeExternalUid: "",
                    placeLabel: "",
                    tags: [],
                    metadata: [:]
                )
            ],
            trips: []
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: start.addingTimeInterval(7200))
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.stays.first?.id, "stay_a")
    }

    func testPersistedActiveTripWithStationaryTailRepairsIntoTripPlusStay() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let tailStart = start.addingTimeInterval(9 * 60)
        let end = start.addingTimeInterval(20 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_tail",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 650,
                    movingSeconds: Int(20 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.4,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "point_a",
                            externalUid: "point_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.1,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_b",
                            externalUid: "point_b",
                            recordedAt: start.addingTimeInterval(5 * 60),
                            latitude: 46.5212,
                            longitude: 6.6378,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_c",
                            externalUid: "point_c",
                            recordedAt: tailStart,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.1,
                            isStopAnchor: true
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_d",
                            externalUid: "point_d",
                            recordedAt: start.addingTimeInterval(14 * 60),
                            latitude: 46.52345,
                            longitude: 6.64125,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "point_e",
                            externalUid: "point_e",
                            recordedAt: end,
                            latitude: 46.52341,
                            longitude: 6.64119,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.trips.first?.status, "completed")
        let repairedTripEnd = try XCTUnwrap(snapshot.trips.first?.endedAt)
        XCTAssertEqual(repairedTripEnd.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(snapshot.stays.count, 1)
        let tailStayStart = try XCTUnwrap(snapshot.activeStay?.startedAt)
        XCTAssertEqual(tailStayStart.timeIntervalSince1970, tailStart.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(snapshot.activeStay?.tags.contains("repaired_from_trip") ?? false)
    }

    func testCompletedRecentStayDoesNotReviveWithoutFreshLocationSignal() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(2 * 3600)
        let repairDate = end.addingTimeInterval(4 * 3600)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_recent",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start,
                    endedAt: end,
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 12,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: []
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertNil(snapshot.activeStay)
        XCTAssertEqual(snapshot.stays.first?.id, "stay_recent")
        XCTAssertEqual(snapshot.stays.first?.status, "completed")
        let preservedStayEnd = try XCTUnwrap(snapshot.stays.first?.endedAt)
        XCTAssertEqual(preservedStayEnd.timeIntervalSince1970, end.timeIntervalSince1970, accuracy: 1)
    }

    func testCompletedTripDoesNotPersistGapSmoothedDestinationStayWithoutFreshLocation() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(42 * 60)
        let repairDate = end.addingTimeInterval(30 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_done",
                    label: "Travel",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 900,
                    movingSeconds: Int(42 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_a",
                            externalUid: "trip_done_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_b",
                            externalUid: "trip_done_b",
                            recordedAt: end,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.stays.count, 0)
        XCTAssertNil(snapshot.activeStay)
    }

    func testCompletedTripDoesNotCreateGapSmoothedStayAcrossLongMissingGap() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let end = start.addingTimeInterval(42 * 60)
        let repairDate = end.addingTimeInterval((60 * 60) + 1)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_done",
                    label: "Travel",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: end,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 900,
                    movingSeconds: Int(42 * 60),
                    idleSeconds: 0,
                    averageSpeedMps: 1.1,
                    maxSpeedMps: 1.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_a",
                            externalUid: "trip_done_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_done_b",
                            externalUid: "trip_done_b",
                            recordedAt: end,
                            latitude: 46.5234,
                            longitude: 6.6412,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertEqual(snapshot.trips.count, 1)
        XCTAssertEqual(snapshot.stays.count, 0)
        XCTAssertNil(snapshot.activeStay)
    }

    func testQuietBogusMoveRepairsToActiveStayUsingCurrentTimeNotLastPointTime() throws {
        let start = Date(timeIntervalSince1970: 1_775_563_200)
        let lastPointAt = start.addingTimeInterval(60)
        let repairDate = start.addingTimeInterval(15 * 60)
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_before_trip",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: start.addingTimeInterval(-3 * 3600),
                    endedAt: start,
                    centerLatitude: 46.5191,
                    centerLongitude: 6.6323,
                    radiusMeters: 100,
                    sampleCount: 20,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_stuck",
                    label: "Travel",
                    status: "active",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: start,
                    endedAt: lastPointAt,
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 12,
                    movingSeconds: 60,
                    idleSeconds: 0,
                    averageSpeedMps: 0.2,
                    maxSpeedMps: 0.3,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_stuck_a",
                            externalUid: "trip_stuck_a",
                            recordedAt: start,
                            latitude: 46.5191,
                            longitude: 6.6323,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_stuck_b",
                            externalUid: "trip_stuck_b",
                            recordedAt: lastPointAt,
                            latitude: 46.51915,
                            longitude: 6.63231,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: repairDate)
        let snapshot = store.debugSnapshot()

        XCTAssertNil(snapshot.activeTrip)
        XCTAssertEqual(snapshot.trips.count, 0)
        XCTAssertNotNil(snapshot.activeStay)
        let repairedCurrentStayEnd = try XCTUnwrap(snapshot.activeStay?.endedAt)
        XCTAssertEqual(repairedCurrentStayEnd.timeIntervalSince1970, repairDate.timeIntervalSince1970, accuracy: 1)
    }

    func testHistoricalTimelineSynthesizesRepairedGapsAndMissingTail() {
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let office = CLLocationCoordinate2D(latitude: 46.5252, longitude: 6.6492)
        let park = CLLocationCoordinate2D(latitude: 46.5236, longitude: 6.6458)
        let cafe = CLLocationCoordinate2D(latitude: 46.5218, longitude: 6.6418)
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-05T12:30:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_home_1",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T07:00:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:00:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 8,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_home_2",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:20:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:40:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 6,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                ),
                MovementSyncStore.StoredStay(
                    id: "stay_cafe",
                    label: "Cafe",
                    status: "completed",
                    classification: "stationary",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:30:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T10:00:00Z") ?? Date(),
                    centerLatitude: cafe.latitude,
                    centerLongitude: cafe.longitude,
                    radiusMeters: 90,
                    sampleCount: 4,
                    placeExternalUid: "",
                    placeLabel: "Cafe",
                    tags: ["cafe"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_office_park",
                    label: "Office to park",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:44:00Z") ?? Date(),
                    endedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:10:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 1600,
                    movingSeconds: 1300,
                    idleSeconds: 60,
                    averageSpeedMps: 1.3,
                    maxSpeedMps: 2.1,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_start",
                            externalUid: "trip_start",
                            recordedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:44:00Z") ?? Date(),
                            latitude: office.latitude,
                            longitude: office.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_end",
                            externalUid: "trip_end",
                            recordedAt: ISO8601DateFormatter().date(from: "2026-04-05T09:10:00Z") ?? Date(),
                            latitude: park.latitude,
                            longitude: park.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.4,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)

        XCTAssertGreaterThanOrEqual(timeline.filter { $0.origin == .recorded }.count, 1)
        XCTAssertEqual(
            timeline.filter { $0.origin == .repairedGap && $0.kind == .stay }.count,
            1
        )
        XCTAssertEqual(
            timeline.filter { $0.origin == .repairedGap && $0.kind == .trip }.count,
            1
        )
        XCTAssertEqual(
            timeline.filter { $0.origin == .missing && $0.kind == .missing }.count,
            1
        )
        XCTAssertTrue(
            timeline.contains(where: {
                $0.origin == .repairedGap
                    && $0.kind == .stay
                    && $0.tags.contains("suppressed-short-jump")
                    && $0.editable == false
            })
        )
        XCTAssertTrue(
            timeline.allSatisfy { segment in
                segment.origin == .recorded ? segment.editable : segment.editable == false
            }
        )
        let sortedTimeline = timeline.sorted { $0.startedAt < $1.startedAt }
        XCTAssertEqual(sortedTimeline.first?.startedAt, ISO8601DateFormatter().date(from: "2026-04-05T07:00:00Z"))
        XCTAssertEqual(sortedTimeline.last?.endedAt, referenceDate)
        for index in 1..<sortedTimeline.count {
            XCTAssertEqual(sortedTimeline[index - 1].endedAt, sortedTimeline[index].startedAt)
        }
        XCTAssertTrue(
            sortedTimeline
                .filter { $0.kind == .missing }
                .allSatisfy { $0.endedAt.timeIntervalSince($0.startedAt) >= (60 * 60) }
        )
    }

    func testHistoricalTimelineMakesLongOvernightGapsExplicitInsteadOfBlank() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let tripStart = CLLocationCoordinate2D(latitude: 46.5216, longitude: 6.6404)
        let tripEnd = CLLocationCoordinate2D(latitude: 46.5226, longitude: 6.6424)
        let referenceDate = formatter.date(from: "2026-04-06T02:40:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [
                MovementSyncStore.StoredStay(
                    id: "stay_home_evening",
                    label: "Home",
                    status: "completed",
                    classification: "stationary",
                    startedAt: formatter.date(from: "2026-04-05T21:15:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-05T21:30:00Z") ?? Date(),
                    centerLatitude: home.latitude,
                    centerLongitude: home.longitude,
                    radiusMeters: 100,
                    sampleCount: 5,
                    placeExternalUid: "",
                    placeLabel: "Home",
                    tags: ["home"],
                    metadata: [:]
                )
            ],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_night_move",
                    label: "Night move",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T02:34:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T02:40:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 650,
                    movingSeconds: 300,
                    idleSeconds: 60,
                    averageSpeedMps: 1.8,
                    maxSpeedMps: 2.5,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_start",
                            externalUid: "trip_start",
                            recordedAt: formatter.date(from: "2026-04-06T02:34:00Z") ?? Date(),
                            latitude: tripStart.latitude,
                            longitude: tripStart.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.6,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "trip_end",
                            externalUid: "trip_end",
                            recordedAt: formatter.date(from: "2026-04-06T02:40:00Z") ?? Date(),
                            latitude: tripEnd.latitude,
                            longitude: tripEnd.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.9,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)
        let sortedTimeline = timeline.sorted { $0.startedAt < $1.startedAt }

        XCTAssertEqual(sortedTimeline.count, 3)
        XCTAssertEqual(sortedTimeline[0].kind, .stay)
        XCTAssertEqual(sortedTimeline[0].origin, .recorded)
        XCTAssertEqual(sortedTimeline[1].kind, .missing)
        XCTAssertEqual(sortedTimeline[1].origin, .missing)
        XCTAssertEqual(
            Int(sortedTimeline[1].endedAt.timeIntervalSince(sortedTimeline[1].startedAt)),
            Int((5 * 60 * 60) + (4 * 60))
        )
        XCTAssertEqual(sortedTimeline[2].kind, .trip)
        XCTAssertEqual(sortedTimeline[2].origin, .recorded)
        for index in 1..<sortedTimeline.count {
            XCTAssertEqual(sortedTimeline[index - 1].endedAt, sortedTimeline[index].startedAt)
        }
    }

    func testHistoricalTimelineKeepsLoopTripWhenCumulativeDistanceIsValid() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let loopMid = CLLocationCoordinate2D(latitude: 46.5217, longitude: 6.6376)
        let referenceDate = formatter.date(from: "2026-04-06T10:10:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_loop_valid",
                    label: "Loop walk",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T10:08:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 340,
                    movingSeconds: 420,
                    idleSeconds: 30,
                    averageSpeedMps: 1.2,
                    maxSpeedMps: 1.8,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_start",
                            externalUid: "loop_start",
                            recordedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.2,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_mid",
                            externalUid: "loop_mid",
                            recordedAt: formatter.date(from: "2026-04-06T10:04:00Z") ?? Date(),
                            latitude: loopMid.latitude,
                            longitude: loopMid.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.4,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "loop_end",
                            externalUid: "loop_end",
                            recordedAt: formatter.date(from: "2026-04-06T10:08:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 1.0,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        let timeline = store.buildHistoricalTimelineSegments(referenceDate: referenceDate)

        XCTAssertEqual(timeline.filter { $0.kind == .trip && $0.origin == .recorded }.count, 1)
        XCTAssertFalse(timeline.contains(where: { $0.kind == .stay && $0.tags.contains("invalid_trip_replaced") }))
    }

    func testInvalidCompletedTripRepairsIntoStayUsingCumulativeDistanceRule() {
        let formatter = ISO8601DateFormatter()
        let home = CLLocationCoordinate2D(latitude: 46.5191, longitude: 6.6323)
        let referenceDate = formatter.date(from: "2026-04-06T11:00:00Z") ?? Date()
        let initialState = MovementSyncStore.PersistedState(
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            knownPlaces: [],
            stays: [],
            trips: [
                MovementSyncStore.StoredTrip(
                    id: "trip_tiny_invalid_completed",
                    label: "Tiny move",
                    status: "completed",
                    travelMode: "travel",
                    activityType: "walking",
                    startedAt: formatter.date(from: "2026-04-06T10:20:00Z") ?? Date(),
                    endedAt: formatter.date(from: "2026-04-06T10:32:00Z") ?? Date(),
                    startPlaceExternalUid: "",
                    endPlaceExternalUid: "",
                    distanceMeters: 80,
                    movingSeconds: 720,
                    idleSeconds: 0,
                    averageSpeedMps: 0.5,
                    maxSpeedMps: 0.8,
                    caloriesKcal: nil,
                    expectedMet: nil,
                    tags: ["movement"],
                    metadata: [:],
                    points: [
                        MovementSyncStore.StoredTripPoint(
                            id: "tiny_start",
                            externalUid: "tiny_start",
                            recordedAt: formatter.date(from: "2026-04-06T10:20:00Z") ?? Date(),
                            latitude: home.latitude,
                            longitude: home.longitude,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.5,
                            isStopAnchor: false
                        ),
                        MovementSyncStore.StoredTripPoint(
                            id: "tiny_end",
                            externalUid: "tiny_end",
                            recordedAt: formatter.date(from: "2026-04-06T10:32:00Z") ?? Date(),
                            latitude: home.latitude + 0.0002,
                            longitude: home.longitude + 0.0002,
                            accuracyMeters: 8,
                            altitudeMeters: nil,
                            speedMps: 0.4,
                            isStopAnchor: true
                        )
                    ],
                    stops: []
                )
            ]
        )

        let store = MovementSyncStore(testingState: initialState)
        store.debugRepair(referenceDate: referenceDate)
        let snapshot = store.debugSnapshot()

        XCTAssertTrue(snapshot.trips.isEmpty)
        XCTAssertEqual(snapshot.stays.count, 1)
        XCTAssertEqual(snapshot.timeline.filter { $0.kind == .trip }.count, 0)
        XCTAssertTrue(
            snapshot.stays.contains(where: {
                $0.metadata["derivedFrom"] == "invalid_trip"
                    && $0.metadata["invalidTripReason"] == "under_cumulative_distance_threshold"
            })
        )
    }

    func testDisplayNormalizerCollapsesTinyTailTripIntoOneOngoingStay() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-06T10:02:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-home",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "tiny-trip",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:15Z") ?? Date(),
                durationSeconds: 15,
                distanceMeters: 12,
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineDisplayNormalizer.normalize(items: items, referenceDate: referenceDate)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Home")
        XCTAssertTrue(normalized.first?.isCurrent ?? false)
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testDisplayNormalizerCollapsesTinyTripBetweenSamePlaceStays() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-06T10:03:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-home-a",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "tiny-trip",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-06T10:01:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:01:20Z") ?? Date(),
                durationSeconds: 20,
                distanceMeters: 18,
                origin: .recorded
            ),
            makeDisplayItem(
                id: "stay-home-b",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-06T10:01:20Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-06T10:02:00Z") ?? Date(),
                origin: .recorded,
                isCurrent: true
            )
        ]

        let normalized = MovementTimelineDisplayNormalizer.normalize(items: items, referenceDate: referenceDate)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Home")
        XCTAssertFalse(normalized.contains(where: { $0.kind == .trip }))
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testCanonicalNormalizerKeepsSharedBackendMissingBoxVisible() throws {
        let scenario = try loadSharedMovementFixture(id: "overnight_gap_before_move")
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-06T02:40:00Z") ?? Date()
        let items = scenario.projectedTimeline.compactMap(MovementLifeTimelineItem.init(remote:))

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: referenceDate
        )

        XCTAssertEqual(normalized.count, 3)
        XCTAssertEqual(normalized[1].kind, .missing)
        XCTAssertEqual(normalized[1].origin, .missing)
        XCTAssertEqual(
            normalized[1].startedAtDate,
            sharedMovementFixtureDateFormatter.date(from: "2026-04-05T21:30:00.000Z")
        )
        XCTAssertEqual(
            normalized[1].endedAtDate,
            sharedMovementFixtureDateFormatter.date(from: "2026-04-06T02:34:00.000Z")
        )
    }

    func testCanonicalNormalizerExtendsLastCanonicalStayToNowWithoutInventingExtraBoxes() throws {
        let referenceDate = ISO8601DateFormatter().date(from: "2026-04-05T10:20:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "canonical-stay",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: ISO8601DateFormatter().date(from: "2026-04-05T08:00:00Z") ?? Date(),
                endedAt: ISO8601DateFormatter().date(from: "2026-04-05T10:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: referenceDate
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertTrue(normalized.first?.isCurrent ?? false)
        let normalizedEnd = try XCTUnwrap(normalized.first?.endedAtDate)
        XCTAssertEqual(normalizedEnd.timeIntervalSince1970, referenceDate.timeIntervalSince1970, accuracy: 1)
    }

    func testCanonicalNormalizerCoalescesTouchingSamePlaceStays() throws {
        let formatter = ISO8601DateFormatter()
        let firstStart = try XCTUnwrap(formatter.date(from: "2026-04-22T13:51:00Z"))
        let secondEnd = try XCTUnwrap(formatter.date(from: "2026-04-22T15:05:00Z"))
        let items = [
            makeDisplayItem(
                id: "canonical-gym-a",
                kind: .stay,
                title: "Gym",
                placeLabel: "Gym",
                startedAt: firstStart,
                endedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "canonical-gym-b",
                kind: .stay,
                title: "Gym",
                placeLabel: "Gym",
                startedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
                endedAt: secondEnd,
                origin: .recorded
            )
        ]

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: items,
            liveOverlay: nil,
            referenceDate: secondEnd
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Gym")
        XCTAssertEqual(normalized.first?.startedAtDate, firstStart)
        XCTAssertEqual(normalized.first?.endedAtDate, secondEnd)
    }

    func testCanonicalNormalizerCoalescesTouchingStaysSharingRawStayIdsEvenWhenLabelsDiffer() throws {
        let formatter = ISO8601DateFormatter()
        let firstStart = try XCTUnwrap(formatter.date(from: "2026-04-22T13:51:00Z"))
        let secondEnd = try XCTUnwrap(formatter.date(from: "2026-04-22T15:05:00Z"))
        let first = makeDisplayItem(
            id: "canonical-stay-a",
            kind: .stay,
            title: "Stay",
            placeLabel: nil,
            startedAt: firstStart,
            endedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
            origin: .recorded
        ).copy(rawStayIds: ["stay_remote_1"])
        let second = makeDisplayItem(
            id: "canonical-stay-b",
            kind: .stay,
            title: "Gym",
            placeLabel: "Gym",
            startedAt: try XCTUnwrap(formatter.date(from: "2026-04-22T14:39:00Z")),
            endedAt: secondEnd,
            origin: .recorded
        ).copy(rawStayIds: ["remote_1"])

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: [first, second],
            liveOverlay: nil,
            referenceDate: secondEnd
        )

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(normalized.first?.kind, .stay)
        XCTAssertEqual(normalized.first?.title, "Gym")
        XCTAssertEqual(normalized.first?.rawStayIds, ["remote_1", "stay_remote_1"])
    }

    func testSleepOverlayNormalizerSlicesMovementItemsWithoutPersistingFragments() throws {
        let formatter = ISO8601DateFormatter()
        let referenceDate = formatter.date(from: "2026-04-20T08:00:00Z") ?? Date()
        let items = [
            makeDisplayItem(
                id: "stay-before",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T20:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-19T23:00:00Z") ?? Date(),
                origin: .recorded
            ),
            makeDisplayItem(
                id: "trip-after",
                kind: .trip,
                title: "Move",
                placeLabel: nil,
                startedAt: formatter.date(from: "2026-04-20T06:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-20T07:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T22:00:00Z",
                endedAt: "2026-04-20T06:30:00Z",
                localDateKey: "2026-04-20",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 28_800,
                timeInBedSeconds: 30_600,
                sleepScore: 84,
                regularityScore: 77,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: items,
            overlays: overlays,
            referenceDate: referenceDate
        )

        XCTAssertEqual(overlaid.count, 3)
        XCTAssertEqual(overlaid[0].startedAtDate, formatter.date(from: "2026-04-19T20:00:00Z"))
        XCTAssertEqual(overlaid[0].endedAtDate, formatter.date(from: "2026-04-19T21:59:59Z"))
        XCTAssertEqual(overlaid[0].durationSeconds, 7_199)
        XCTAssertTrue(overlaid[1].isSleepOverlay)
        XCTAssertEqual(overlaid[1].startedAtDate, formatter.date(from: "2026-04-19T22:00:00Z"))
        XCTAssertEqual(overlaid[1].endedAtDate, formatter.date(from: "2026-04-20T06:30:00Z"))
        XCTAssertEqual(overlaid[2].startedAtDate, formatter.date(from: "2026-04-20T06:30:01Z"))
        XCTAssertEqual(overlaid[2].endedAtDate, formatter.date(from: "2026-04-20T07:00:00Z"))
        XCTAssertEqual(overlaid[2].durationSeconds, 1_799)
    }

    func testSleepOverlaySlicesRecalculateDisplayDurationFromTrimmedDates() throws {
        let formatter = ISO8601DateFormatter()
        let sourceStay = makeDisplayItem(
            id: "long-source-stay",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-18T19:19:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-19T04:05:00Z") ?? Date(),
            durationSeconds: 86_400,
            origin: .recorded
        )
        let overlay = ForgeMovementTimelineSleepOverlay(
            id: "sleep-slice",
            externalUid: "sleep-slice",
            startedAt: "2026-04-19T01:43:00Z",
            endedAt: "2026-04-19T03:54:00Z",
            localDateKey: "2026-04-19",
            sourceTimezone: "Europe/Zurich",
            asleepSeconds: 7_860,
            timeInBedSeconds: 7_860,
            sleepScore: 84,
            regularityScore: 77,
            efficiency: 0.94,
            recoveryState: "rested"
        )

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: [sourceStay],
            overlays: [overlay],
            referenceDate: formatter.date(from: "2026-04-19T06:00:00Z") ?? Date()
        )

        XCTAssertEqual(overlaid.count, 3)
        XCTAssertEqual(overlaid[0].startedAtDate, formatter.date(from: "2026-04-18T19:19:00Z"))
        XCTAssertEqual(overlaid[0].endedAtDate, formatter.date(from: "2026-04-19T01:42:59Z"))
        XCTAssertEqual(overlaid[0].durationSeconds, 23_039)
        XCTAssertTrue(overlaid[1].isSleepOverlay)
        XCTAssertEqual(overlaid[2].startedAtDate, formatter.date(from: "2026-04-19T03:54:01Z"))
        XCTAssertEqual(overlaid[2].endedAtDate, formatter.date(from: "2026-04-19T04:05:00Z"))
        XCTAssertEqual(overlaid[2].durationSeconds, 659)
        XCTAssertEqual(overlaid[2].durationLabel, "10m")
    }

    func testSleepOverlayNormalizerHidesFullyCoveredBoxes() {
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T22:00:00Z",
                endedAt: "2026-04-20T06:30:00Z",
                localDateKey: "2026-04-20",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 28_800,
                timeInBedSeconds: 30_600,
                sleepScore: 84,
                regularityScore: 77,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]
        let formatter = ISO8601DateFormatter()
        let items = [
            makeDisplayItem(
                id: "covered-stay",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T23:00:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-20T01:00:00Z") ?? Date(),
                origin: .recorded
            )
        ]

        let overlaid = MovementTimelineSleepOverlayNormalizer.overlay(
            items: items,
            overlays: overlays,
            referenceDate: formatter.date(from: "2026-04-20T08:00:00Z") ?? Date()
        )

        XCTAssertEqual(overlaid.count, 1)
        XCTAssertTrue(overlaid[0].isSleepOverlay)
    }

    func testRenderManagerBuildsCanonicalPostOverlaySegmentsWithoutSyntheticBackgroundBands() {
        let formatter = ISO8601DateFormatter()
        let baseItems = [
            makeDisplayItem(
                id: "home-overnight",
                kind: .stay,
                title: "Home",
                placeLabel: "Home",
                startedAt: formatter.date(from: "2026-04-19T02:15:00Z") ?? Date(),
                endedAt: formatter.date(from: "2026-04-19T23:20:00Z") ?? Date(),
                origin: .recorded
            )
        ]
        let overlays = [
            ForgeMovementTimelineSleepOverlay(
                id: "sleep-1",
                externalUid: "sleep-1",
                startedAt: "2026-04-19T04:05:00Z",
                endedAt: "2026-04-19T11:08:00Z",
                localDateKey: "2026-04-19",
                sourceTimezone: "Europe/Zurich",
                asleepSeconds: 25_380,
                timeInBedSeconds: 26_040,
                sleepScore: 84,
                regularityScore: 78,
                efficiency: 0.94,
                recoveryState: "rested"
            )
        ]

        let renderState = MovementTimelineRenderManager.render(
            baseItems: baseItems,
            sleepOverlays: overlays,
            referenceDate: formatter.date(from: "2026-04-19T23:20:00Z") ?? Date(),
            sleepOverlayVisible: true
        )

        XCTAssertEqual(renderState.items.count, 3)
        XCTAssertTrue(renderState.items.contains(where: { $0.isSleepOverlay }))
        XCTAssertTrue(
            renderState.items.contains(where: { item in
                item.isSleepOverlay == false
                    && item.startedAtDate == formatter.date(from: "2026-04-19T11:08:01Z")
                    && item.endedAtDate == formatter.date(from: "2026-04-19T23:20:00Z")
            })
        )
    }

    func testLifeTimelineScreenshotFixtureUsesLongPostSleepState() {
        let state = CompanionScreenshotFixtures.movementState(for: .lifeTimeline)

        XCTAssertEqual(state.knownPlaces.count, 1)
        XCTAssertEqual(state.trips.count, 0)
        XCTAssertEqual(state.stays.count, 3)
        XCTAssertEqual(state.stays.last?.startedAt, makeDate("2026-04-19T09:08:00.000Z"))
        XCTAssertEqual(state.stays.last?.endedAt, CompanionScreenshotFixtures.lifeTimelineReferenceDate)
    }

    func testLifeTimelineScreenshotFixtureProvidesOvernightSleepOverlay() {
        let overlays = CompanionScreenshotFixtures.sleepTimelineOverlays(for: .lifeTimeline)

        XCTAssertEqual(overlays.count, 1)
        XCTAssertEqual(overlays.first?.startedAt, "2026-04-19T02:05:00.000Z")
        XCTAssertEqual(overlays.first?.endedAt, "2026-04-19T09:08:00.000Z")
    }

    func testViewportHourMarkersTrackCompressedSleepOverlayGeometry() throws {
        let formatter = ISO8601DateFormatter()
        let sleepItem = makeDisplayItem(
            id: "sleep-overlay",
            kind: .stay,
            title: "Sleep",
            placeLabel: nil,
            startedAt: formatter.date(from: "2026-04-19T22:00:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-20T06:30:00Z") ?? Date(),
            durationSeconds: 30_600,
            origin: .recorded
        )

        let layout = buildMovementViewportLayoutModel(
            items: [sleepItem],
            viewportHeight: 844,
            safeTopInset: 0,
            bottomPadding: 0,
            rangeEnd: sleepItem.endedAtDate
        )
        let row = try XCTUnwrap(layout.items.first)
        let rangeEnd = sleepItem.endedAtDate

        let startY = try XCTUnwrap(
            movementViewportYPosition(for: sleepItem.startedAtDate, layout: layout, rangeEnd: rangeEnd)
        )
        let midnightY = try XCTUnwrap(
            movementViewportYPosition(
                for: formatter.date(from: "2026-04-20T00:00:00Z") ?? Date(),
                layout: layout,
                rangeEnd: rangeEnd
            )
        )
        let fourAmY = try XCTUnwrap(
            movementViewportYPosition(
                for: formatter.date(from: "2026-04-20T04:00:00Z") ?? Date(),
                layout: layout,
                rangeEnd: rangeEnd
            )
        )
        let endY = try XCTUnwrap(
            movementViewportYPosition(for: sleepItem.endedAtDate, layout: layout, rangeEnd: rangeEnd)
        )

        XCTAssertEqual(startY, row.boxTop, accuracy: 0.5)
        XCTAssertEqual(endY, row.boxBottom, accuracy: 0.5)
        XCTAssertGreaterThan(midnightY, startY)
        XCTAssertGreaterThan(fourAmY, midnightY)
        XCTAssertLessThan(fourAmY, endY)

        let inBoxMarkers = buildMovementViewportHourMarkers(
            layout: layout,
            rangeEnd: rangeEnd
        )
        .filter { $0.y >= row.boxTop - 0.5 && $0.y <= row.boxBottom + 0.5 }

        XCTAssertFalse(inBoxMarkers.isEmpty)
        XCTAssertTrue(
            zip(inBoxMarkers, inBoxMarkers.dropFirst()).allSatisfy { previous, next in
                next.y > previous.y
            }
        )
    }

    func testViewportHourMarkerLinesUseExactFractionalHourCoordinates() throws {
        let formatter = ISO8601DateFormatter()
        let postSleepStay = makeDisplayItem(
            id: "post-sleep-home",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-19T03:54:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-19T04:05:00Z") ?? Date(),
            durationSeconds: 660,
            origin: .recorded
        )

        let rangeEnd = formatter.date(from: "2026-04-19T05:00:00Z") ?? Date()
        let fourAm = formatter.date(from: "2026-04-19T04:00:00Z") ?? Date()
        let layout = buildMovementViewportLayoutModel(
            items: [postSleepStay],
            viewportHeight: 844,
            safeTopInset: 0,
            bottomPadding: 0,
            rangeEnd: rangeEnd
        )
        let row = try XCTUnwrap(layout.items.first)
        let fourAmY = try XCTUnwrap(
            movementViewportYPosition(for: fourAm, layout: layout, rangeEnd: rangeEnd)
        )
        let fourAmMarker = try XCTUnwrap(
            buildMovementViewportHourMarkers(layout: layout, rangeEnd: rangeEnd)
                .first { $0.date == fourAm }
        )
        let expectedRatio = CGFloat(fourAm.timeIntervalSince(postSleepStay.startedAtDate) / postSleepStay.endedAtDate.timeIntervalSince(postSleepStay.startedAtDate))

        XCTAssertEqual(fourAmMarker.y, fourAmY, accuracy: 0.5)
        XCTAssertEqual(movementViewportHourMarkerLineOffset(for: fourAmMarker), fourAmY, accuracy: 0.5)
        XCTAssertEqual(fourAmY - row.boxTop, row.boxHeight * expectedRatio, accuracy: 0.5)
        XCTAssertEqual(row.boxBottom - fourAmY, row.boxHeight * (1 - expectedRatio), accuracy: 0.5)
        XCTAssertLessThan(row.boxTop, movementViewportHourMarkerLineOffset(for: fourAmMarker))
        XCTAssertGreaterThan(row.boxBottom, movementViewportHourMarkerLineOffset(for: fourAmMarker))
    }

    func testViewportVirtualizationUsesAbsoluteTimelineGeometry() throws {
        let formatter = ISO8601DateFormatter()
        let overnightStay = makeDisplayItem(
            id: "home-overnight",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-25T22:06:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T17:15:00Z") ?? Date(),
            durationSeconds: 68_940,
            origin: .recorded
        )
        let shortMove = makeDisplayItem(
            id: "move-after-home",
            kind: .trip,
            title: "Move",
            placeLabel: nil,
            startedAt: formatter.date(from: "2026-04-26T17:15:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T17:26:00Z") ?? Date(),
            durationSeconds: 660,
            distanceMeters: 2_900,
            origin: .recorded
        )
        let gymStay = makeDisplayItem(
            id: "gym-stay",
            kind: .stay,
            title: "Gym",
            placeLabel: "Gym",
            startedAt: formatter.date(from: "2026-04-26T17:26:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-26T19:52:00Z") ?? Date(),
            durationSeconds: 8_760,
            origin: .recorded
        )
        let laterStay = makeDisplayItem(
            id: "later-stay",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: formatter.date(from: "2026-04-29T01:00:00Z") ?? Date(),
            endedAt: formatter.date(from: "2026-04-29T03:00:00Z") ?? Date(),
            durationSeconds: 7_200,
            origin: .recorded
        )

        let layout = buildMovementViewportLayoutModel(
            items: [overnightStay, shortMove, gymStay, laterStay],
            viewportHeight: 844,
            safeTopInset: 47,
            bottomPadding: 114,
            rangeEnd: (formatter.date(from: "2026-04-29T04:00:00Z") ?? Date())
        )
        let rangeEnd = formatter.date(from: "2026-04-29T04:00:00Z") ?? Date()

        for metric in layout.items {
            let startY = try XCTUnwrap(
                movementViewportYPosition(for: metric.item.startedAtDate, layout: layout, rangeEnd: rangeEnd)
            )
            let endY = try XCTUnwrap(
                movementViewportYPosition(for: metric.item.endedAtDate, layout: layout, rangeEnd: rangeEnd)
            )

            XCTAssertEqual(startY, metric.boxTop, accuracy: 0.5)
            XCTAssertEqual(endY, metric.boxBottom, accuracy: 0.5)
        }

        let visibleAtTop = visibleMovementViewportItems(
            layout: layout,
            scrollTop: 0,
            viewportHeight: 844
        )
        XCTAssertTrue(visibleAtTop.contains(where: { $0.id == overnightStay.id }))
        XCTAssertTrue(visibleAtTop.contains(where: { $0.id == laterStay.id }))

        let gymMetric = try XCTUnwrap(layout.items.first(where: { $0.id == gymStay.id }))
        let visibleAroundGym = visibleMovementViewportItems(
            layout: layout,
            scrollTop: gymMetric.boxTop - 120,
            viewportHeight: 360
        )

        XCTAssertTrue(visibleAroundGym.contains(where: { $0.id == gymStay.id }))
        XCTAssertTrue(visibleAroundGym.allSatisfy { $0.boxBottom >= 0 })
    }

    func testMovementTimelineInitialScrollTargetsLatestRealItem() {
        let first = makeDisplayItem(
            id: "first-stay",
            kind: .stay,
            title: "Home",
            placeLabel: "Home",
            startedAt: Date(timeIntervalSince1970: 1_000),
            endedAt: Date(timeIntervalSince1970: 2_000),
            durationSeconds: 1_000,
            origin: .recorded
        )
        let current = makeDisplayItem(
            id: "current-stay",
            kind: .stay,
            title: "Office",
            placeLabel: "Office",
            startedAt: Date(timeIntervalSince1970: 2_000),
            endedAt: Date(timeIntervalSince1970: 3_000),
            durationSeconds: 1_000,
            origin: .recorded
        )
        let anchor = MovementLifeTimelineItem.currentAnchor(
            referenceDate: Date(timeIntervalSince1970: 3_000)
        )

        XCTAssertEqual(
            movementTimelineInitialScrollTargetId(items: [first, current, anchor]),
            current.id
        )
        XCTAssertEqual(
            movementTimelineInitialScrollTargetId(items: [anchor]),
            MovementLifeTimelineItem.currentAnchorId
        )
    }

    func testMovementStoreCachesCanonicalProjectedBoxesFromBootstrap() {
        let projected = try! loadSharedMovementFixture(
            id: "user_defined_missing_override"
        ).projectedTimeline

        let store = MovementSyncStore(testingState: nil)
        store.mergeBootstrap(
            SyncReceipt.MovementBootstrapEnvelope(
                stayOverrides: [],
                tripOverrides: [],
                deletedStayExternalUids: [],
                deletedTripExternalUids: [],
                settings: .init(
                    trackingEnabled: true,
                    publishMode: "auto_publish",
                    retentionMode: "aggregates_only",
                    locationPermissionStatus: "always",
                    motionPermissionStatus: "ready",
                    backgroundTrackingReady: true
                ),
                places: [],
                projectedBoxes: projected
            )
        )

        XCTAssertEqual(store.cachedProjectedBoxes.map(\.id), projected.map(\.id))
        XCTAssertTrue(
            store.cachedProjectedBoxes.contains(where: { box in
                box.sourceKind == "user_defined" && box.id == "user_missing_override_fixture"
            })
        )
    }

    func testMovementStoreDeduplicatesKnownPlacesFromTestingState() {
        let duplicateExternalUid = "user-place-work-ucpt"
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [
                    MovementSyncStore.StoredKnownPlace(
                        id: "place_a",
                        externalUid: duplicateExternalUid,
                        label: "Work",
                        aliases: [],
                        latitude: 46.5191,
                        longitude: 6.6323,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    ),
                    MovementSyncStore.StoredKnownPlace(
                        id: "place_b",
                        externalUid: duplicateExternalUid,
                        label: "Work Duplicate",
                        aliases: [],
                        latitude: 46.5192,
                        longitude: 6.6324,
                        radiusMeters: 120,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    )
                ],
                stays: [],
                trips: []
            )
        )

        let payload = store.buildMovementPayload()

        XCTAssertEqual(payload.knownPlaces.count, 1)
        XCTAssertEqual(payload.knownPlaces.first?.externalUid, duplicateExternalUid)
        XCTAssertEqual(payload.knownPlaces.first?.id, "place_a")
    }

    func testMovementStoreMergeBootstrapDeduplicatesLocalAndRemoteKnownPlaces() {
        let duplicateExternalUid = "user-place-work-ucpt"
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [
                    MovementSyncStore.StoredKnownPlace(
                        id: "local_place_a",
                        externalUid: duplicateExternalUid,
                        label: "Work",
                        aliases: ["Office"],
                        latitude: 46.5191,
                        longitude: 6.6323,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    ),
                    MovementSyncStore.StoredKnownPlace(
                        id: "local_place_b",
                        externalUid: duplicateExternalUid,
                        label: "Work Duplicate",
                        aliases: [],
                        latitude: 46.5192,
                        longitude: 6.6324,
                        radiusMeters: 100,
                        categoryTags: ["work"],
                        visibility: "shared",
                        wikiNoteId: nil,
                        metadata: [:]
                    )
                ],
                stays: [],
                trips: []
            )
        )

        store.mergeBootstrap(
            SyncReceipt.MovementBootstrapEnvelope(
                stayOverrides: [],
                tripOverrides: [],
                deletedStayExternalUids: [],
                deletedTripExternalUids: [],
                settings: .init(
                    trackingEnabled: true,
                    publishMode: "auto_publish",
                    retentionMode: "aggregates_only",
                    locationPermissionStatus: "always",
                    motionPermissionStatus: "ready",
                    backgroundTrackingReady: true
                ),
                places: [
                    .init(
                        id: "remote_place_a",
                        externalUid: duplicateExternalUid,
                        label: "Remote Work",
                        aliases: [],
                        latitude: 46.6,
                        longitude: 6.7,
                        radiusMeters: 90,
                        categoryTags: ["work"]
                    ),
                    .init(
                        id: "remote_place_b",
                        externalUid: duplicateExternalUid,
                        label: "Remote Work Duplicate",
                        aliases: [],
                        latitude: 46.61,
                        longitude: 6.71,
                        radiusMeters: 95,
                        categoryTags: ["work"]
                    )
                ],
                projectedBoxes: []
            )
        )

        let payload = store.buildMovementPayload()

        XCTAssertEqual(payload.knownPlaces.count, 1)
        XCTAssertEqual(payload.knownPlaces.first?.externalUid, duplicateExternalUid)
        XCTAssertEqual(payload.knownPlaces.first?.id, "local_place_a")
        XCTAssertEqual(payload.knownPlaces.first?.label, "Work")
    }

    func testWorkoutIntervalIndexMatchesLinearOverlapMatcher() {
        let baseDate = Date(timeIntervalSince1970: 0)
        func date(_ seconds: TimeInterval) -> Date {
            baseDate.addingTimeInterval(seconds)
        }
        let intervals = [
            HealthSyncStore.WorkoutInterval(uid: "workout-b", startDate: date(10), endDate: date(20)),
            HealthSyncStore.WorkoutInterval(uid: "workout-a", startDate: date(0), endDate: date(100)),
            HealthSyncStore.WorkoutInterval(uid: "workout-c", startDate: date(15), endDate: date(30))
        ]
        let index = HealthSyncStore.WorkoutIntervalIndex(intervals: intervals)

        func linearBestUid(startDate: Date, endDate: Date) -> String? {
            var bestUid: String?
            var bestOverlap: TimeInterval = 0
            for interval in intervals {
                let overlapStart = max(startDate, interval.startDate)
                let overlapEnd = min(endDate, interval.endDate)
                let overlap = overlapEnd.timeIntervalSince(overlapStart)
                if overlap > bestOverlap {
                    bestOverlap = overlap
                    bestUid = interval.uid
                }
            }
            if let bestUid, bestOverlap > 0 {
                return bestUid
            }
            return intervals.first { interval in
                startDate >= interval.startDate && startDate <= interval.endDate
            }?.uid
        }

        let probes: [(start: Date, end: Date)] = [
            (date(16), date(18)),
            (date(25), date(35)),
            (date(15), date(15)),
            (date(101), date(105))
        ]
        for probe in probes {
            XCTAssertEqual(
                index.bestWorkoutUid(forSampleStart: probe.start, endDate: probe.end),
                linearBestUid(startDate: probe.start, endDate: probe.end)
            )
        }
    }

    func testWorkoutEvidenceBatchPlanKeepsBatchWindowAndIntervals() throws {
        let intervals = [
            HealthSyncStore.WorkoutInterval(
                uid: "workout-late",
                startDate: makeDate("2026-04-05T10:00:00.000Z"),
                endDate: makeDate("2026-04-05T10:30:00.000Z")
            ),
            HealthSyncStore.WorkoutInterval(
                uid: "workout-early",
                startDate: makeDate("2026-04-05T08:00:00.000Z"),
                endDate: makeDate("2026-04-05T08:45:00.000Z")
            ),
            HealthSyncStore.WorkoutInterval(
                uid: "workout-long",
                startDate: makeDate("2026-04-05T09:00:00.000Z"),
                endDate: makeDate("2026-04-05T11:15:00.000Z")
            )
        ]

        let plan = try XCTUnwrap(HealthSyncStore.workoutEvidenceBatchPlanForTesting(intervals: intervals))

        XCTAssertEqual(plan.startDate, makeDate("2026-04-05T08:00:00.000Z"))
        XCTAssertEqual(plan.endDate, makeDate("2026-04-05T11:15:00.000Z"))
        XCTAssertEqual(plan.intervals.map(\.uid), ["workout-late", "workout-early", "workout-long"])
        XCTAssertNil(HealthSyncStore.workoutEvidenceBatchPlanForTesting(intervals: []))
    }

    func testWorkoutRoutePointIndexAllocatorPreservesPerWorkoutContinuity() {
        var allocator = HealthSyncStore.WorkoutRoutePointIndexAllocator()

        XCTAssertEqual(
            Array(allocator.reserveIndexes(forWorkoutUid: "workout-a", count: 3)),
            [0, 1, 2]
        )
        XCTAssertEqual(
            Array(allocator.reserveIndexes(forWorkoutUid: "workout-b", count: 2)),
            [0, 1]
        )
        XCTAssertEqual(
            Array(allocator.reserveIndexes(forWorkoutUid: "workout-a", count: 4)),
            [3, 4, 5, 6]
        )
        XCTAssertEqual(
            Array(allocator.reserveIndexes(forWorkoutUid: "workout-b", count: 0)),
            []
        )
        XCTAssertEqual(
            Array(allocator.reserveIndexes(forWorkoutUid: "workout-b", count: 1)),
            [2]
        )
    }

    func testWorkoutEvidenceTimestampFormatterKeepsFractionalIsoOutput() {
        let date = makeDate("2026-04-05T08:44:12.345Z")

        let rendered = HealthSyncStore.workoutEvidenceTimestampStringForTesting(date)

        XCTAssertEqual(rendered, "2026-04-05T08:44:12.345Z")
        XCTAssertEqual(
            HealthSyncStore.workoutEvidenceTimestampStringForTesting(date.addingTimeInterval(0.001)),
            "2026-04-05T08:44:12.346Z"
        )
    }

    @MainActor
    func testWorkoutUploadStatsCountsRawEvidenceWithoutLosingTotals() {
        func sample(_ metricKey: String, index: Int) -> CompanionSyncPayload.WorkoutTimeSeriesSample {
            CompanionSyncPayload.WorkoutTimeSeriesSample(
                sourceSampleUid: "sample-\(metricKey)-\(index)",
                seriesIndex: index,
                metricKey: metricKey,
                label: metricKey,
                category: "test",
                unit: "count",
                value: Double(index),
                startedAt: "2026-04-05T08:44:12.345Z",
                endedAt: "2026-04-05T08:44:13.345Z",
                sourceDevice: "Unit Test",
                sourceBundleIdentifier: "test.bundle",
                sourceProductType: "test",
                captureMethod: "unit_test",
                qualityFlags: [],
                metadata: [:],
                provenance: [:]
            )
        }

        func routePoint(_ index: Int) -> CompanionSyncPayload.WorkoutRoutePoint {
            CompanionSyncPayload.WorkoutRoutePoint(
                sourceRouteUid: "route-\(index)",
                pointIndex: index,
                recordedAt: "2026-04-05T08:44:12.345Z",
                latitude: 46.0,
                longitude: 6.0,
                altitudeMeters: nil,
                horizontalAccuracyMeters: nil,
                verticalAccuracyMeters: nil,
                speedMps: nil,
                courseDegrees: nil,
                metadata: [:],
                provenance: [:]
            )
        }

        func workout(
            id: String,
            averageHeartRate: Double?,
            maxHeartRate: Double?,
            stepCount: Int?,
            samples: [CompanionSyncPayload.WorkoutTimeSeriesSample],
            routePoints: [CompanionSyncPayload.WorkoutRoutePoint]
        ) -> CompanionSyncPayload.WorkoutSession {
            CompanionSyncPayload.WorkoutSession(
                externalUid: id,
                workoutType: "running",
                sourceSystem: "apple_health",
                sourceBundleIdentifier: "com.apple.Health",
                sourceProductType: "Watch",
                activity: .init(
                    sourceSystem: "apple_health",
                    providerActivityType: "hk_workout_activity_type",
                    providerRawValue: 52,
                    canonicalKey: "running",
                    canonicalLabel: "Running",
                    familyKey: "run",
                    familyLabel: "Run",
                    isFallback: false
                ),
                details: .init(sourceSystem: "apple_health", metrics: [], events: [], components: [], metadata: [:]),
                startedAt: "2026-04-05T08:00:00.000Z",
                endedAt: "2026-04-05T09:00:00.000Z",
                activeEnergyKcal: nil,
                totalEnergyKcal: nil,
                distanceMeters: nil,
                stepCount: stepCount,
                exerciseMinutes: nil,
                averageHeartRate: averageHeartRate,
                maxHeartRate: maxHeartRate,
                sourceDevice: "Unit Test",
                timeSeriesSamples: samples,
                routePoints: routePoints,
                captureQuality: .init(
                    status: "partial",
                    flags: [],
                    heartRateSamples: 0,
                    routePoints: routePoints.count,
                    associatedSampleQueryUsed: false,
                    fallbackTimeWindowUsed: false,
                    condensedSeriesExpanded: false
                ),
                syncCursor: [:],
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
        }

        let workouts = [
            workout(
                id: "workout-a",
                averageHeartRate: 142,
                maxHeartRate: 181,
                stepCount: 1_200,
                samples: [sample("heart_rate", index: 0), sample("distance", index: 1)],
                routePoints: [routePoint(0), routePoint(1), routePoint(2)]
            ),
            workout(
                id: "workout-b",
                averageHeartRate: nil,
                maxHeartRate: 170,
                stepCount: nil,
                samples: [sample("heart_rate", index: 2), sample("heart_rate", index: 3), sample("speed", index: 4)],
                routePoints: [routePoint(3)]
            )
        ]

        let stats = CompanionAppModel.workoutUploadStatsForTesting(for: workouts)

        XCTAssertEqual(stats.workouts, 2)
        XCTAssertEqual(stats.workoutsWithAverageHeartRate, 1)
        XCTAssertEqual(stats.workoutsWithMaxHeartRate, 2)
        XCTAssertEqual(stats.workoutsWithStepCount, 1)
        XCTAssertEqual(stats.rawHeartRateDatapoints, 3)
        XCTAssertEqual(stats.rawTimeSeriesDatapoints, 5)
        XCTAssertEqual(stats.routePoints, 4)
        XCTAssertEqual(stats.expectedUploadRecordCount, 11)
    }

    func testMovementPayloadUsesFrozenReferenceDateForResumeStableChunks() throws {
        func makeStore() -> MovementSyncStore {
            MovementSyncStore(
                testingState: MovementSyncStore.PersistedState(
                    trackingEnabled: true,
                    publishMode: "auto_publish",
                    retentionMode: "aggregates_only",
                    knownPlaces: [],
                    stays: [
                        MovementSyncStore.StoredStay(
                            id: "stay-active",
                            label: "Current stay",
                            status: "active",
                            classification: "stationary",
                            startedAt: makeDate("2026-06-08T08:00:00.000Z"),
                            endedAt: makeDate("2026-06-08T09:00:00.000Z"),
                            centerLatitude: 46.5191,
                            centerLongitude: 6.6323,
                            radiusMeters: 80,
                            sampleCount: 4,
                            placeExternalUid: "",
                            placeLabel: "",
                            tags: [],
                            metadata: [:]
                        )
                    ],
                    trips: []
                )
            )
        }

        let frozenReferenceDate = makeDate("2026-06-08T10:00:00.000Z")
        let wallClockReferenceDate = makeDate("2026-06-08T10:05:00.000Z")
        let firstPayload = makeStore().buildMovementPayload(
            referenceDate: frozenReferenceDate
        )
        let retryPayload = makeStore().buildMovementPayload(
            referenceDate: frozenReferenceDate
        )
        let wallClockPayload = makeStore().buildMovementPayload(
            referenceDate: wallClockReferenceDate
        )

        let firstWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(firstPayload)
        let retryWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(retryPayload)
        let wallClockWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(wallClockPayload)

        XCTAssertEqual(firstPayload.stays.first?.endedAt, "2026-06-08T10:00:00.000Z")
        XCTAssertEqual(wallClockPayload.stays.first?.endedAt, "2026-06-08T10:05:00.000Z")
        XCTAssertEqual(firstWirePayload.checksumSha256, retryWirePayload.checksumSha256)
        XCTAssertEqual(firstWirePayload.byteCount, retryWirePayload.byteCount)
        XCTAssertNotEqual(firstWirePayload.checksumSha256, wallClockWirePayload.checksumSha256)
    }

    func testRemoteMovementTimelineItemPreservesCanonicalUserDefinedBoxSemantics() throws {
        let segment = try loadSharedMovementFixture(
            id: "user_defined_missing_override"
        )
            .projectedTimeline
            .first(where: { $0.sourceKind == "user_defined" && $0.kind == "missing" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .missing)
        XCTAssertEqual(item.sourceKind, "user_defined")
        XCTAssertEqual(item.origin, .userInvalidated)
        XCTAssertEqual(item.overrideCount, 1)
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds.count, 0)
        XCTAssertEqual(item.rawPointCount, 0)
        XCTAssertTrue(item.editable)
        guard case .remoteUserBox(let boxId, _) = item.source else {
            return XCTFail("Expected a remote user-defined movement box source.")
        }
        XCTAssertEqual(boxId, "user_missing_override_fixture")
    }

    func testRemoteMovementTimelineItemPreservesCanonicalMissingCoverageSemantics() throws {
        let segment = try loadSharedMovementFixture(
            id: "overnight_gap_before_move"
        )
            .projectedTimeline
            .first(where: { $0.kind == "missing" && $0.sourceKind == "automatic" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .missing)
        XCTAssertEqual(item.sourceKind, "automatic")
        XCTAssertEqual(item.origin, .missing)
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds.count, 0)
        XCTAssertEqual(item.rawPointCount, 0)
        XCTAssertFalse(item.editable)
    }

    func testRemoteMovementTimelineItemPreservesCanonicalRawTripReferences() throws {
        let segment = try loadSharedMovementFixture(
            id: "overnight_gap_before_move"
        )
            .projectedTimeline
            .first(where: { $0.kind == "trip" && $0.sourceKind == "automatic" })
        let unwrappedSegment = try XCTUnwrap(segment)

        let item = try XCTUnwrap(MovementLifeTimelineItem(remote: unwrappedSegment))
        XCTAssertEqual(item.kind, .trip)
        XCTAssertEqual(item.sourceKind, "automatic")
        XCTAssertEqual(item.rawStayIds.count, 0)
        XCTAssertEqual(item.rawTripIds, ["trip_night_move"])
        XCTAssertEqual(item.rawPointCount, 3)
        XCTAssertFalse(item.editable)
    }

    func testMovementLifeTimelineItemLinkableStayIdsKeepRemoteRawStayIdsWithoutLocalCache() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        let store = MovementSyncStore(testingState: nil)
        XCTAssertEqual(item.linkableStayIds(using: store), ["stay_remote_1"])
    }

    func testPromotedCurrentTimelineItemResolvesToStoredStayIdentifier() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let endedAt = startedAt.addingTimeInterval(3600)
        let item = MovementLifeTimelineItem(
            id: "remote-current-stay-item",
            source: .remoteAutomatic(
                "box_remote_current_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: ["workplace"],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: endedAt,
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        let promoted = item.promotedToCurrent(referenceDate: endedAt.addingTimeInterval(1200))
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: endedAt,
                        centerLatitude: 46.5191,
                        centerLongitude: 6.6323,
                        radiusMeters: 85,
                        sampleCount: 4,
                        placeExternalUid: "",
                        placeLabel: "",
                        tags: ["workplace"],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )

        XCTAssertEqual(promoted.rawStayIds, ["stay_remote_1"])
        XCTAssertEqual(promoted.linkableStayIds(using: store), ["stay_remote_1"])
        XCTAssertTrue(promoted.isCurrent)
    }

    func testCanonicalNormalizerPreservesRawStayIdsWhenMergingLiveOverlay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let canonicalStay = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Remote canonical stay",
            placeLabel: "Work",
            tags: ["workplace"],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )
        let liveOverlay = MovementLifeTimelineItem(
            id: "live-stay-item",
            source: .liveStay(
                "remote_1",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Work",
            subtitle: "Current stay",
            placeLabel: "Work",
            tags: ["workplace"],
            syncSource: "local cache",
            startedAtDate: startedAt.addingTimeInterval(3600),
            endedAtDate: startedAt.addingTimeInterval(4200),
            durationSeconds: 600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: [],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )

        let normalized = MovementTimelineCanonicalNormalizer.normalize(
            items: [canonicalStay],
            liveOverlay: liveOverlay,
            referenceDate: startedAt.addingTimeInterval(4500)
        )
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: startedAt.addingTimeInterval(4200),
                        centerLatitude: 46.5191,
                        centerLongitude: 6.6323,
                        radiusMeters: 110,
                        sampleCount: 6,
                        placeExternalUid: "place_work",
                        placeLabel: "Work",
                        tags: ["workplace"],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )
        let merged = try? XCTUnwrap(normalized.first)

        XCTAssertEqual(normalized.count, 1)
        XCTAssertEqual(merged?.rawStayIds, ["stay_remote_1"])
        XCTAssertEqual(merged?.linkableStayIds(using: store), ["stay_remote_1"])
        XCTAssertTrue(merged?.isCurrent ?? false)
    }

    func testMovementLifeTimelineItemResolvedCoordinateFallsBackToStoredStayCenter() throws {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "derived-stay-item",
            source: .derived("derived-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Derived stay",
            placeLabel: nil,
            tags: [],
            syncSource: "local cache",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(1800),
            durationSeconds: 1800,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
        let store = MovementSyncStore(
            testingState: MovementSyncStore.PersistedState(
                trackingEnabled: true,
                publishMode: "auto_publish",
                retentionMode: "aggregates_only",
                knownPlaces: [],
                stays: [
                    MovementSyncStore.StoredStay(
                        id: "stay_remote_1",
                        label: "Work",
                        status: "active",
                        classification: "stationary",
                        startedAt: startedAt,
                        endedAt: startedAt.addingTimeInterval(1800),
                        centerLatitude: 46.5245,
                        centerLongitude: 6.6391,
                        radiusMeters: 95,
                        sampleCount: 8,
                        placeExternalUid: "",
                        placeLabel: "",
                        tags: [],
                        metadata: [:]
                    )
                ],
                trips: []
            )
        )

        let resolvedCoordinate = item.resolvedCoordinate(using: store)
        guard let coordinate = resolvedCoordinate else {
            return XCTFail("Expected a resolved coordinate from the stored stay center")
        }

        XCTAssertEqual(coordinate.latitude, 46.5245, accuracy: 0.000001)
        XCTAssertEqual(coordinate.longitude, 6.6391, accuracy: 0.000001)
        XCTAssertEqual(item.stayRadiusMeters(using: store), 95, accuracy: 0.000001)
    }

    func testMovementTimelinePlaceDraftAllowsManualCoordinatesWhenNoSeedCoordinateExists() throws {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "derived-stay-item",
            source: .derived("derived-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Derived stay",
            placeLabel: nil,
            tags: [],
            syncSource: "local cache",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(1800),
            durationSeconds: 1800,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: true
        )
        var draft = MovementTimelinePlaceDraft(
            item: item,
            label: "Gym",
            coordinate: nil,
            radiusMeters: 80,
            tags: ["fitness"]
        )

        XCTAssertNil(draft.coordinate)

        draft.latitudeText = "46.520000"
        draft.longitudeText = "6.630000"
        let latitude = try XCTUnwrap(draft.latitude)
        let longitude = try XCTUnwrap(draft.longitude)
        guard let coordinate = draft.coordinate else {
            return XCTFail("Expected manual latitude/longitude to produce a coordinate")
        }

        XCTAssertEqual(latitude, 46.52, accuracy: 0.000001)
        XCTAssertEqual(longitude, 6.63, accuracy: 0.000001)
        XCTAssertEqual(coordinate.latitude, 46.52, accuracy: 0.000001)
        XCTAssertEqual(coordinate.longitude, 6.63, accuracy: 0.000001)
    }

    func testPlaceLabelOperationCreatesUserBoxForAutomaticStay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "remote-stay-item",
            source: .remoteAutomatic(
                "box_remote_stay",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .recorded,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelinePlaceLabelOperation(for: item),
            .createUserBox
        )
    }

    func testPlaceLabelOperationPatchesExistingUserBoxStay() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "user-box-stay-item",
            source: .remoteUserBox(
                "mbx_stay_1",
                MovementTimelineCoordinate(latitude: 46.5191, longitude: 6.6323)
            ),
            kind: .stay,
            title: "Home",
            subtitle: "User-defined movement box",
            placeLabel: "Home",
            tags: [],
            syncSource: "canonical",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_remote_1"],
            origin: .userDefined,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelinePlaceLabelOperation(for: item),
            .patchUserBox("mbx_stay_1")
        )
    }

    func testSeededCategoryTagsForNewPlaceExcludesSystemRepairTags() {
        let startedAt = Date(timeIntervalSince1970: 1_775_000_000)
        let item = MovementLifeTimelineItem(
            id: "local-stay-item",
            source: .derived("repaired-gap-stay"),
            kind: .stay,
            title: "Stay",
            subtitle: "Repaired stay",
            placeLabel: nil,
            tags: ["movement", "stay", "repaired_from_trip", "boundary-incomplete", "home", "coffee"],
            syncSource: "local derived",
            startedAtDate: startedAt,
            endedAtDate: startedAt.addingTimeInterval(3600),
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            distanceMeters: nil,
            averageSpeedMps: nil,
            rawStayIds: ["stay_local_1"],
            origin: .repairedGap,
            editable: true,
            isCurrent: false
        )

        XCTAssertEqual(
            movementTimelineSeededCategoryTagsForNewPlace(from: item),
            ["home", "coffee"]
        )
    }

    func testMovementTimelineDetailSnapshotPreservesTimelineItemIdForRemoteActions() {
        let segment = ForgeMovementTimelineSegment(
            id: "box_remote_stay",
            boxId: "box_remote_stay",
            kind: "stay",
            sourceKind: "automatic",
            origin: "recorded",
            editable: false,
            startedAt: "2026-04-15T08:00:00.000Z",
            endedAt: "2026-04-15T09:00:00.000Z",
            trueStartedAt: nil,
            trueEndedAt: nil,
            visibleStartedAt: nil,
            visibleEndedAt: nil,
            durationSeconds: 3600,
            laneSide: .left,
            connectorFromLane: .left,
            connectorToLane: .left,
            title: "Stay",
            subtitle: "Remote canonical stay",
            placeLabel: nil,
            tags: [],
            syncSource: "canonical",
            cursor: "cursor_remote_stay",
            overrideCount: 0,
            overriddenAutomaticBoxIds: [],
            overriddenUserBoxIds: nil,
            isFullyHidden: nil,
            rawStayIds: ["stay_remote_1"],
            rawTripIds: [],
            rawPointCount: 0,
            hasLegacyCorrections: false,
            stay: nil,
            trip: nil
        )
        let detail = ForgeMovementBoxDetail(
            segment: segment,
            rawStays: [],
            rawTrips: [],
            stayDetail: nil,
            tripDetail: nil
        )

        let snapshot = MovementTimelineDetailSnapshot(
            detail: detail,
            itemId: "remote-stay-box_remote_stay"
        )

        XCTAssertEqual(snapshot.itemId, "remote-stay-box_remote_stay")
        XCTAssertFalse(snapshot.editable)
    }

    func testMovementStoreKeepsRemoteKnownPlaceIdentityWhenSavingCreatedLabel() {
        let store = MovementSyncStore(testingState: nil)
        let remotePlace = MovementSyncStore.StoredKnownPlace(
            id: "place_remote_1",
            externalUid: "remote-place-1",
            label: "Forge Office",
            aliases: [],
            latitude: 46.5191,
            longitude: 6.6323,
            radiusMeters: 120,
            categoryTags: ["work"],
            visibility: "shared",
            wikiNoteId: nil,
            metadata: [:]
        )

        store.storeKnownPlace(remotePlace)

        XCTAssertEqual(store.knownPlaces.count, 1)
        XCTAssertEqual(store.knownPlaces.first?.externalUid, "remote-place-1")
        XCTAssertEqual(store.knownPlaces.first?.label, "Forge Office")

        store.storeKnownPlace(
            MovementSyncStore.StoredKnownPlace(
                id: "place_remote_1_updated",
                externalUid: "remote-place-1",
                label: "Forge HQ",
                aliases: ["Office"],
                latitude: 46.5191,
                longitude: 6.6323,
                radiusMeters: 140,
                categoryTags: ["work", "hq"],
                visibility: "shared",
                wikiNoteId: nil,
                metadata: [:]
            )
        )

        XCTAssertEqual(store.knownPlaces.count, 1)
        XCTAssertEqual(store.knownPlaces.first?.externalUid, "remote-place-1")
        XCTAssertEqual(store.knownPlaces.first?.label, "Forge HQ")
        XCTAssertEqual(store.knownPlaces.first?.categoryTags, ["work", "hq"])
    }

    func testForgeSyncClientGeneratedMovementPlaceExternalUidUsesIosPrefix() {
        let externalUid = ForgeSyncClient.generatedMovementPlaceExternalUid()

        XCTAssertTrue(externalUid.hasPrefix("ios-place-"))
        XCTAssertGreaterThan(externalUid.count, "ios-place-".count)
    }

    func testHealthSyncUploadSessionDecodesLightweightStatusWithoutChunkIds() throws {
        let data = Data(
            """
            {
              "syncSessionId": "hms_light",
              "schemaVersion": "healthkit-sync-v2",
              "status": "running",
              "chunkTargetBytes": 500000,
              "chunkMaxBytes": 40000000,
              "chunkPayloadEncoding": "payload_json_base64",
              "acceptedPayloadEncodings": ["payload_json_base64"],
              "supportsCompression": true,
              "acceptedFamilies": ["workout_summaries"],
              "progress": {
                "chunkCount": 12,
                "receivedCounts": { "workout_summaries": 8 },
                "byteTotals": { "workout_summaries": 1200 },
                "receivedBytes": 1200
              }
            }
            """.utf8
        )

        let session = try JSONDecoder().decode(
            ForgeSyncClient.HealthSyncUploadSession.self,
            from: data
        )

        XCTAssertEqual(session.syncSessionId, "hms_light")
        XCTAssertEqual(session.receivedChunkIds, [])
        XCTAssertEqual(session.acceptedChunkCount, 12)
        XCTAssertEqual(session.progress?.receivedCounts?["workout_summaries"], 8)
    }

    func testHealthSyncUploadSessionPreservesChunkIdsAcrossLightweightStatus() throws {
        let previous = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: ["chunk-a", "chunk-b"],
            workoutImportState: nil,
            progress: nil
        )
        let lightweight = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: [],
            workoutImportState: nil,
            progress: nil
        )

        let preserved = lightweight.preservingReceivedChunkIds(from: previous)

        XCTAssertEqual(preserved.receivedChunkIds, ["chunk-a", "chunk-b"])
        XCTAssertEqual(preserved.receivedChunkIdSet, Set(["chunk-a", "chunk-b"]))
    }

    func testHealthSyncUploadSessionPreservesWorkoutImportUidsAcrossLightweightStatus() throws {
        let previous = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: ["chunk-a"],
            workoutImportState: ForgeSyncClient.HealthSyncWorkoutImportState(
                alreadyUploadedWorkoutExternalUids: ["workout-a", "workout-b"],
                incompleteWorkoutExternalUids: ["workout-c"],
                alreadyUploadedWorkoutCount: 2,
                existingWorkoutCount: 3,
                incompleteWorkoutCount: 1,
                staleEvidenceVersionWorkoutCount: 0,
                heartRateSampleCount: 120,
                timeSeriesSampleCount: 130,
                routePointCount: 44,
                capturedAt: "2026-06-08T18:00:00.000Z"
            ),
            progress: nil
        )
        let lightweight = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: [],
            workoutImportState: ForgeSyncClient.HealthSyncWorkoutImportState(
                alreadyUploadedWorkoutExternalUids: [],
                incompleteWorkoutExternalUids: [],
                alreadyUploadedWorkoutCount: 12,
                existingWorkoutCount: 14,
                incompleteWorkoutCount: 2,
                staleEvidenceVersionWorkoutCount: 1,
                heartRateSampleCount: 900,
                timeSeriesSampleCount: 950,
                routePointCount: 240,
                capturedAt: "2026-06-08T18:10:00.000Z"
            ),
            progress: nil
        )

        let preserved = lightweight
            .preservingReceivedChunkIds(from: previous)
            .preservingWorkoutImportExternalUids(from: previous)

        XCTAssertEqual(preserved.receivedChunkIds, ["chunk-a"])
        XCTAssertEqual(
            preserved.workoutImportState?.alreadyUploadedWorkoutExternalUids,
            ["workout-a", "workout-b"]
        )
        XCTAssertEqual(
            preserved.workoutImportState?.incompleteWorkoutExternalUids,
            ["workout-c"]
        )
        XCTAssertEqual(preserved.workoutImportState?.alreadyUploadedWorkoutCount, 12)
        XCTAssertEqual(preserved.workoutImportState?.existingWorkoutCount, 14)
        XCTAssertEqual(preserved.workoutImportState?.incompleteWorkoutCount, 2)
        XCTAssertEqual(preserved.workoutImportState?.timeSeriesSampleCount, 950)
    }

    func testHealthSyncUploadSessionPreservesWorkoutImportStateWhenStatusOmitsIt() throws {
        let previous = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: ["chunk-a"],
            workoutImportState: ForgeSyncClient.HealthSyncWorkoutImportState(
                alreadyUploadedWorkoutExternalUids: ["workout-a"],
                incompleteWorkoutExternalUids: ["workout-b"],
                alreadyUploadedWorkoutCount: 1,
                existingWorkoutCount: 2,
                incompleteWorkoutCount: 1,
                staleEvidenceVersionWorkoutCount: 0,
                heartRateSampleCount: 40,
                timeSeriesSampleCount: 50,
                routePointCount: 10,
                capturedAt: "2026-06-08T18:00:00.000Z"
            ),
            progress: nil
        )
        let progressOnly = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_light",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_summaries"],
            receivedChunkIds: [],
            workoutImportState: nil,
            progress: ForgeSyncClient.HealthSyncChunkProgress(
                receivedCounts: ["workout_summaries": 4],
                byteTotals: ["workout_summaries": 4000],
                chunkCount: 4,
                receivedBytes: 4000
            )
        )

        let preserved = progressOnly
            .preservingReceivedChunkIds(from: previous)
            .preservingWorkoutImportState(from: previous)

        XCTAssertEqual(preserved.receivedChunkIds, ["chunk-a"])
        XCTAssertEqual(
            preserved.workoutImportState?.alreadyUploadedWorkoutExternalUids,
            ["workout-a"]
        )
        XCTAssertEqual(preserved.workoutImportState?.existingWorkoutCount, 2)
        XCTAssertEqual(preserved.progress?.chunkCount, 4)
        XCTAssertEqual(preserved.progress?.receivedBytes, 4000)
    }

    func testHealthSyncChunkWirePayloadHashesBase64PayloadBytes() throws {
        struct DictionaryHeavyPayload: Encodable {
            let vitals: Vitals

            struct Vitals: Encodable {
                let daySummaries: [String]
                let metadata: [String: String]
            }
        }
        let payload = DictionaryHeavyPayload(
            vitals: .init(
                daySummaries: [],
                metadata: [
                    "zeta": "encoded first",
                    "alpha": "encoded second"
                ]
            )
        )

        let wirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(payload)
        let payloadJsonBase64 = try XCTUnwrap(wirePayload.payloadJsonBase64)
        let decodedPayloadData = try XCTUnwrap(Data(base64Encoded: payloadJsonBase64))
        let expectedChecksum = SHA256.hash(data: wirePayload.payloadData)
            .map { String(format: "%02x", $0) }
            .joined()

        XCTAssertEqual(decodedPayloadData, wirePayload.payloadData)
        XCTAssertEqual(wirePayload.byteCount, wirePayload.payloadData.count)
        XCTAssertEqual(wirePayload.checksumSha256, expectedChecksum)
    }

    func testHealthSyncChunkWirePayloadCanCompressPayloadBytes() throws {
        struct RepeatingPayload: Encodable {
            let samples: [String]
        }
        let payload = RepeatingPayload(
            samples: Array(repeating: "heart-rate-sample", count: 4_000)
        )

        let wirePayload = try ForgeSyncClient.compressedHealthSyncChunkWirePayloadForTesting(payload)
        let compressed = try XCTUnwrap(wirePayload.compressedPayloadData)
        let encodedCompressed = try XCTUnwrap(wirePayload.payloadJsonDeflateBase64)

        XCTAssertEqual(Data(base64Encoded: encodedCompressed), compressed)
        XCTAssertNil(wirePayload.payloadJsonBase64)
        XCTAssertLessThan(compressed.count, wirePayload.payloadData.count)
        XCTAssertEqual(wirePayload.compressedByteCount, compressed.count)
    }

    func testHealthSyncChunkWirePayloadSkipsCompressionWhenItWouldGrowPayload() throws {
        struct TinyPayload: Encodable {
            let samples: [String]
        }
        let payload = TinyPayload(samples: ["x"])

        let wirePayload = try ForgeSyncClient.compressedHealthSyncChunkWirePayloadForTesting(payload)
        let encodedRawPayload = try XCTUnwrap(wirePayload.payloadJsonBase64)

        XCTAssertNil(wirePayload.compressedPayloadData)
        XCTAssertNil(wirePayload.payloadJsonDeflateBase64)
        XCTAssertNil(wirePayload.compressedByteCount)
        XCTAssertEqual(Data(base64Encoded: encodedRawPayload), wirePayload.payloadData)
    }

    func testAcceptedHealthSyncChunkIdCanBeComputedBeforeWirePayloadBody() throws {
        struct AcceptedPayload: Encodable {
            let samples: [String]
        }
        let payload = AcceptedPayload(
            samples: Array(repeating: "accepted-resume-sample", count: 1_000)
        )
        let syncSessionId = "hms_fast_skip"
        let sequence = 42
        let family = "workout_time_series"

        let earlyChunkId = try ForgeSyncClient.healthSyncAcceptedChunkIdForTesting(
            syncSessionId: syncSessionId,
            sequence: sequence,
            family: family,
            payload: payload
        )
        let wirePayload = try ForgeSyncClient.compressedHealthSyncChunkWirePayloadForTesting(payload)
        let wirePayloadChunkId = "\(syncSessionId)-\(String(format: "%06d", sequence))-\(family)-\(String(wirePayload.checksumSha256.prefix(20)))"

        XCTAssertEqual(earlyChunkId, wirePayloadChunkId)
        XCTAssertNotNil(wirePayload.payloadJsonDeflateBase64)
    }

    func testHealthSyncChunkRangePlannerAvoidsLinearPayloadReencoding() {
        var optimizedSizingCalls = 0
        let ranges = ForgeSyncClient.healthSyncChunkRangesForTesting(
            recordCount: 12_000,
            targetBytes: 180_000
        ) { range in
            optimizedSizingCalls += 1
            return 100 + range.count * 800
        }
        let coveredRecords = ranges.reduce(0) { $0 + $1.count }
        let linearSizingCalls = 12_000 - ranges.count

        XCTAssertEqual(coveredRecords, 12_000)
        XCTAssertEqual(ranges.first, 0..<224)
        XCTAssertEqual(ranges.last?.upperBound, 12_000)
        XCTAssertEqual(ranges.count, 54)
        XCTAssertLessThan(optimizedSizingCalls, 1_000)
        XCTAssertLessThan(optimizedSizingCalls * 10, linearSizingCalls)

        let oversizedRecordRanges = ForgeSyncClient.healthSyncChunkRangesForTesting(
            recordCount: 3,
            targetBytes: 100
        ) { range in
            range.count * 1_000
        }
        XCTAssertEqual(oversizedRecordRanges, [0..<1, 1..<2, 2..<3])
    }

    func testPreparedHealthSyncChunkRangesCarrySelectedPayloadBytes() throws {
        var encodedRanges: [Range<Int>] = []
        let preparedRanges = try ForgeSyncClient.healthSyncPreparedChunkRangesForTesting(
            recordCount: 12_000,
            targetBytes: 180_000
        ) { range in
            encodedRanges.append(range)
            return Data(repeating: UInt8(range.count % 251), count: 100 + range.count * 800)
        }
        let ranges = preparedRanges.map(\.range)
        let coveredRecords = ranges.reduce(0) { $0 + $1.count }
        let selectedRangesEncodedDuringPlanning = ranges.filter { encodedRanges.contains($0) }

        XCTAssertEqual(coveredRecords, 12_000)
        XCTAssertEqual(ranges.first, 0..<224)
        XCTAssertEqual(ranges.last?.upperBound, 12_000)
        XCTAssertEqual(ranges.count, 54)
        XCTAssertEqual(selectedRangesEncodedDuringPlanning.count, ranges.count)
        XCTAssertEqual(preparedRanges.first?.byteCount, 179_300)
        XCTAssertEqual(
            preparedRanges.last?.byteCount,
            ranges.last.map { 100 + $0.count * 800 }
        )
    }

    func testBaseHealthSyncChunksArePreparedTogetherBeforeForegroundUpload() throws {
        let syncClient = ForgeSyncClient()
        let pairing = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_base",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )
        let uploadSession = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_base",
            schemaVersion: "healthkit-sync-v2",
            status: "running",
            chunkTargetBytes: 500_000,
            chunkMaxBytes: 40_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: [
                "sleep_nights",
                "sleep_segments",
                "sleep_raw_records",
                "vitals",
                "movement",
                "screen_time"
            ],
            receivedChunkIds: [],
            workoutImportState: nil,
            progress: nil
        )
        let payload = CompanionSyncPayload(
            sessionId: "pair_base",
            pairingToken: "token",
            device: .init(
                name: "Forge Test iPhone",
                platform: "ios",
                appVersion: "1.0",
                sourceDevice: "iPhone"
            ),
            permissions: .init(
                healthKitAuthorized: true,
                backgroundRefreshEnabled: true,
                motionReady: true,
                locationReady: true,
                screenTimeReady: true
            ),
            sourceStates: .init(
                health: .init(
                    desiredEnabled: true,
                    appliedEnabled: true,
                    authorizationStatus: "approved",
                    syncEligible: true,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                movement: .init(
                    desiredEnabled: true,
                    appliedEnabled: true,
                    authorizationStatus: "always",
                    syncEligible: true,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                ),
                screenTime: .init(
                    desiredEnabled: true,
                    appliedEnabled: true,
                    authorizationStatus: "approved",
                    syncEligible: true,
                    lastObservedAt: nil,
                    metadata: .init(values: [:])
                )
            ),
            sleepSessions: [],
            sleepNights: [
                .init(
                    externalUid: "night_1",
                    startedAt: "2026-06-10T22:00:00.000Z",
                    endedAt: "2026-06-11T06:00:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-06-11",
                    timeInBedSeconds: 28_800,
                    asleepSeconds: 27_000,
                    awakeSeconds: 1_800,
                    rawSegmentCount: 1,
                    stageBreakdown: [.init(stage: "core", seconds: 27_000)],
                    recoveryMetrics: [:],
                    sourceMetrics: [:],
                    links: [],
                    annotations: .init(qualitySummary: "", notes: "", tags: [])
                )
            ],
            sleepSegments: [
                .init(
                    externalUid: "segment_1",
                    startedAt: "2026-06-10T22:00:00.000Z",
                    endedAt: "2026-06-11T06:00:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-06-11",
                    stage: "core",
                    bucket: "asleep",
                    sourceValue: 3,
                    metadata: [:]
                )
            ],
            sleepRawRecords: [
                .init(
                    externalUid: "raw_1",
                    startedAt: "2026-06-10T22:00:00.000Z",
                    endedAt: "2026-06-11T06:00:00.000Z",
                    sourceTimezone: "Europe/Zurich",
                    localDateKey: "2026-06-11",
                    providerRecordType: "healthkit_sleep_sample",
                    rawStage: "core",
                    rawValue: 3,
                    payload: [:],
                    metadata: [:]
                )
            ],
            workouts: [],
            vitals: .init(daySummaries: [
                .init(
                    dateKey: "2026-06-11",
                    sourceTimezone: "Europe/Zurich",
                    metrics: [
                        .init(
                            metric: "heart_rate",
                            label: "Heart Rate",
                            category: "cardio",
                            unit: "count/min",
                            displayUnit: "bpm",
                            aggregation: "daily",
                            average: 62,
                            minimum: 50,
                            maximum: 120,
                            latest: 64,
                            total: nil,
                            sampleCount: 12,
                            latestSampleAt: "2026-06-11T06:00:00.000Z"
                        )
                    ]
                )
            ]),
            movement: .init(
                settings: .init(
                    trackingEnabled: true,
                    publishMode: "automatic",
                    retentionMode: "local_and_forge",
                    locationPermissionStatus: "authorizedAlways",
                    motionPermissionStatus: "ready",
                    backgroundTrackingReady: true,
                    metadata: [:]
                ),
                knownPlaces: [
                    .init(
                        id: "place_home",
                        externalUid: "ios-place-home",
                        label: "Home",
                        aliases: [],
                        latitude: 46.2,
                        longitude: 6.1,
                        radiusMeters: 80,
                        categoryTags: ["home"],
                        visibility: "private",
                        wikiNoteId: nil,
                        metadata: [:]
                    )
                ],
                stays: [],
                trips: []
            ),
            screenTime: .init(
                settings: .init(
                    trackingEnabled: true,
                    syncEnabled: true,
                    authorizationStatus: "approved",
                    captureState: "ready",
                    lastCapturedDayKey: "2026-06-11",
                    lastCaptureStartedAt: "2026-06-11T00:00:00.000Z",
                    lastCaptureEndedAt: "2026-06-11T23:59:59.000Z",
                    metadata: [:]
                ),
                daySummaries: [
                    .init(
                        dateKey: "2026-06-11",
                        totalActivitySeconds: 3600,
                        pickupCount: 12,
                        notificationCount: 24,
                        firstPickupAt: "2026-06-11T06:30:00.000Z",
                        longestActivitySeconds: 900,
                        topAppBundleIdentifiers: ["com.apple.MobileSafari"],
                        topCategoryLabels: ["Productivity"],
                        metadata: [:]
                    )
                ],
                hourlySegments: []
            )
        )

        let plan = try syncClient.baseHealthSyncPreparedChunkPlanForTesting(
            payload: payload,
            uploadSession: uploadSession,
            pairing: pairing,
            startingSequence: 7
        )

        XCTAssertEqual(
            plan.map(\.family),
            [
                "sleep_nights",
                "sleep_segments",
                "sleep_raw_records",
                "vitals",
                "movement",
                "screen_time"
            ]
        )
        XCTAssertEqual(plan.map(\.sequence), Array(7...12))
        XCTAssertEqual(plan.map(\.recordCount), [1, 1, 1, 1, 1, 1])
        XCTAssertTrue(plan.allSatisfy { $0.byteCount > 0 })
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: pairing,
                useBackgroundUpload: false
            ),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
        )
        XCTAssertEqual(
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency,
            ForgeSyncClient.foregroundHTTPMaximumConnectionsPerHost
        )
    }

    func testBackgroundHealthUploadWritesThrowawayChunkFilesDirectly() {
        XCTAssertEqual(ForgeBackgroundUploadCoordinator.uploadBodyWriteOptions, [])
    }

    func testWorkoutSyncCursorUsesFrozenExportTimestampForResumeStableChunks() throws {
        struct WorkoutChunkPayload: Encodable {
            let workouts: [Workout]

            struct Workout: Encodable {
                let externalUid: String
                let syncCursor: [String: CompanionSyncPayload.ScalarValue]
            }
        }

        let frozenExportedAt = "2026-06-08T10:00:00.000Z"
        let retryExportedAt = "2026-06-08T10:00:05.000Z"
        let firstPayload = WorkoutChunkPayload(
            workouts: [
                .init(
                    externalUid: "workout-byte-stable",
                    syncCursor: HealthSyncStore.workoutSyncCursor(
                        exportedAtIso: frozenExportedAt
                    )
                )
            ]
        )
        let retryPayload = WorkoutChunkPayload(
            workouts: [
                .init(
                    externalUid: "workout-byte-stable",
                    syncCursor: HealthSyncStore.workoutSyncCursor(
                        exportedAtIso: frozenExportedAt
                    )
                )
            ]
        )
        let wallClockPayload = WorkoutChunkPayload(
            workouts: [
                .init(
                    externalUid: "workout-byte-stable",
                    syncCursor: HealthSyncStore.workoutSyncCursor(
                        exportedAtIso: retryExportedAt
                    )
                )
            ]
        )

        let firstWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(firstPayload)
        let retryWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(retryPayload)
        let wallClockWirePayload = try ForgeSyncClient.healthSyncChunkWirePayloadForTesting(wallClockPayload)

        XCTAssertEqual(firstWirePayload.checksumSha256, retryWirePayload.checksumSha256)
        XCTAssertEqual(firstWirePayload.byteCount, retryWirePayload.byteCount)
        XCTAssertNotEqual(firstWirePayload.checksumSha256, wallClockWirePayload.checksumSha256)
    }

    func testHealthSyncUploadSessionRequiresByteStablePayloadEncoding() {
        let supported = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_supported",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 512_000,
            chunkMaxBytes: 1_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64", "legacy_payload_object"],
            supportsCompression: false,
            acceptedFamilies: ["vitals"],
            receivedChunkIds: []
        )
        XCTAssertTrue(supported.supportsByteStablePayloadEncoding)

        let staleRuntime = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_stale",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 512_000,
            chunkMaxBytes: 1_000_000,
            chunkPayloadEncoding: nil,
            acceptedPayloadEncodings: nil,
            supportsCompression: false,
            acceptedFamilies: ["vitals"],
            receivedChunkIds: []
        )
        XCTAssertFalse(staleRuntime.supportsByteStablePayloadEncoding)
    }

    func testHealthSyncUploadSessionDecodesBackendWorkoutImportState() throws {
        let payload = """
        {
          "syncSessionId": "hms_backend_state",
          "schemaVersion": "healthkit-sync-v2",
          "status": "running",
          "chunkTargetBytes": 512000,
          "chunkMaxBytes": 1000000,
          "chunkPayloadEncoding": "payload_json_base64",
          "acceptedPayloadEncodings": ["payload_json_base64"],
          "supportsCompression": true,
          "acceptedFamilies": ["workout_summaries", "workout_time_series", "workout_routes"],
          "receivedChunkIds": ["chunk-1", "chunk-2"],
          "workoutImportState": {
            "alreadyUploadedWorkoutExternalUids": ["workout-a", "workout-b"],
            "incompleteWorkoutExternalUids": ["workout-c"],
            "alreadyUploadedWorkoutCount": 2,
            "existingWorkoutCount": 3,
            "incompleteWorkoutCount": 1,
            "staleEvidenceVersionWorkoutCount": 1,
            "heartRateSampleCount": 180,
            "timeSeriesSampleCount": 240,
            "routePointCount": 40,
            "capturedAt": "2026-05-26T19:02:54.205Z"
          },
          "progress": {
            "chunkCount": 2,
            "receivedBytes": 8192
          }
        }
        """

        let session = try JSONDecoder().decode(
            ForgeSyncClient.HealthSyncUploadSession.self,
            from: Data(payload.utf8)
        )

        XCTAssertEqual(session.receivedChunkIdSet, Set(["chunk-1", "chunk-2"]))
        XCTAssertEqual(
            session.acceptedFamilySet,
            Set(["workout_summaries", "workout_time_series", "workout_routes"])
        )
        XCTAssertEqual(
            session.workoutImportState?.alreadyUploadedWorkoutExternalUids,
            ["workout-a", "workout-b"]
        )
        XCTAssertEqual(session.workoutImportState?.incompleteWorkoutExternalUids, ["workout-c"])
        XCTAssertEqual(session.workoutImportState?.alreadyUploadedWorkoutCount, 2)
        XCTAssertEqual(session.workoutImportState?.existingWorkoutCount, 3)
        XCTAssertEqual(session.workoutImportState?.incompleteWorkoutCount, 1)
        XCTAssertEqual(session.workoutImportState?.staleEvidenceVersionWorkoutCount, 1)
        XCTAssertEqual(session.workoutImportState?.heartRateSampleCount, 180)
        XCTAssertEqual(session.workoutImportState?.timeSeriesSampleCount, 240)
        XCTAssertEqual(session.workoutImportState?.routePointCount, 40)
    }

    func testWorkoutHealthChunkIdsUsePayloadChecksumForSafeResume() {
        let uploadSession = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_resume",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 512_000,
            chunkMaxBytes: 1_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_routes"],
            receivedChunkIds: []
        )
        let emptyChunkId = ForgeSyncClient.healthSyncContentAddressedChunkId(
            uploadSession: uploadSession,
            sequence: 111,
            family: "workout_routes",
            checksumSha256: String(repeating: "a", count: 64)
        )
        let realChunkId = ForgeSyncClient.healthSyncContentAddressedChunkId(
            uploadSession: uploadSession,
            sequence: 111,
            family: "workout_routes",
            checksumSha256: String(repeating: "b", count: 64)
        )

        XCTAssertEqual(
            emptyChunkId,
            "hms_resume-000111-workout_routes-aaaaaaaaaaaaaaaaaaaa"
        )
        XCTAssertEqual(
            realChunkId,
            "hms_resume-000111-workout_routes-bbbbbbbbbbbbbbbbbbbb"
        )
        XCTAssertNotEqual(emptyChunkId, realChunkId)
    }

    func testBaseHealthChunkIdIncludesPayloadChecksumForSafeResume() {
        let uploadSession = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_resume",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 512_000,
            chunkMaxBytes: 1_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["sleep_nights"],
            receivedChunkIds: []
        )

        let emptyChunkId = ForgeSyncClient.healthSyncContentAddressedChunkId(
            uploadSession: uploadSession,
            sequence: 0,
            family: "sleep_nights",
            checksumSha256: String(repeating: "a", count: 64)
        )
        let realChunkId = ForgeSyncClient.healthSyncContentAddressedChunkId(
            uploadSession: uploadSession,
            sequence: 0,
            family: "sleep_nights",
            checksumSha256: String(repeating: "b", count: 64)
        )

        XCTAssertEqual(emptyChunkId, "hms_resume-000000-sleep_nights-aaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(realChunkId, "hms_resume-000000-sleep_nights-bbbbbbbbbbbbbbbbbbbb")
        XCTAssertNotEqual(emptyChunkId, realChunkId)
    }

    func testHistoricalWorkoutBatchRangesStartSmallThenKeepPipelineFed() {
        let ranges = HealthSyncStore.workoutBatchRanges(
            totalCount: 1_077,
            firstBatchSize: 8,
            regularBatchSize: 32
        )

        XCTAssertEqual(ranges.count, 35)
        XCTAssertEqual(ranges.first, 0..<8)
        XCTAssertEqual(ranges.dropFirst().first, 8..<40)
        XCTAssertEqual(ranges.last, 1_064..<1_077)
        XCTAssertTrue(ranges.dropFirst().dropLast().allSatisfy { $0.count == 32 })
    }

    func testHistoricalWorkoutPrefetchPipelineKeepsBatchesReadyBehindUploads() {
        let batchCount = HealthSyncStore.workoutBatchRanges(
            totalCount: 1_077,
            firstBatchSize: 8,
            regularBatchSize: 32
        ).count

        let snapshots = HealthSyncStore.workoutPipelinePrefetchSnapshotsForTesting(
            totalBatches: batchCount,
            prefetchLimit: 10
        )

        XCTAssertEqual(batchCount, 35)
        XCTAssertEqual(snapshots.first?.scheduledBatches, 10)
        XCTAssertEqual(snapshots.first?.pendingBatches, 10)
        XCTAssertEqual(snapshots[1].pendingBatches, 10)
        XCTAssertEqual(snapshots[20].pendingBatches, 10)
        XCTAssertEqual(snapshots.last?.deliveredBatches, batchCount)
        XCTAssertEqual(snapshots.last?.pendingBatches, 0)
    }

    func testRecentWorkoutBatchRangesStartUploadingBeforeWholeWindowIsMapped() {
        let ranges = HealthSyncStore.workoutBatchRanges(
            totalCount: 21,
            firstBatchSize: HealthSyncStore.recentWorkoutFirstEvidenceBatchSize,
            regularBatchSize: HealthSyncStore.recentWorkoutEvidenceBatchSize
        )

        XCTAssertEqual(ranges, [
            0..<4,
            4..<12,
            12..<20,
            20..<21
        ])
    }

    func testHistoricalWorkoutBatchRangesClampInvalidSizes() {
        let ranges = HealthSyncStore.workoutBatchRanges(
            totalCount: 3,
            firstBatchSize: 0,
            regularBatchSize: 0
        )

        XCTAssertEqual(ranges, [0..<1, 1..<2, 2..<3])
    }

    func testCompletedWorkoutUUIDSetUsesFastPathForBackendUuidIds() {
        let first = UUID()
        let second = UUID()

        let completed = HealthSyncStore.completedWorkoutUUIDSetForTesting(
            from: [first.uuidString.lowercased(), second.uuidString]
        )

        XCTAssertEqual(completed, Set([first, second]))
    }

    func testCompletedWorkoutUUIDSetFallsBackForNonUuidBackendIds() {
        let completed = HealthSyncStore.completedWorkoutUUIDSetForTesting(
            from: [UUID().uuidString, "external-workout-id"]
        )

        XCTAssertNil(completed)
    }

    func testHealthSyncLifecyclePolicyWaitsThroughNormalUploadGaps() {
        let startedAt = makeDate("2026-05-27T09:40:00.000Z")
        let lastChunkAt = makeDate("2026-05-27T09:43:30.000Z")
        let now = makeDate("2026-05-27T09:44:00.000Z")

        let reason = CompanionAppModel.HealthSyncLifecyclePolicy.stallReason(
            startedAt: startedAt,
            lastChunkAt: lastChunkAt,
            uploadedChunks: 12,
            now: now
        )

        XCTAssertNil(reason)
    }

    func testHealthSyncLifecyclePolicyFlagsStalledAcceptedChunkWindow() {
        let startedAt = makeDate("2026-05-27T09:40:00.000Z")
        let lastChunkAt = makeDate("2026-05-27T09:41:00.000Z")
        let now = makeDate("2026-05-27T09:46:30.000Z")

        let reason = CompanionAppModel.HealthSyncLifecyclePolicy.stallReason(
            startedAt: startedAt,
            lastChunkAt: lastChunkAt,
            uploadedChunks: 12,
            now: now
        )

        XCTAssertEqual(reason, "no accepted health sync chunk for 330s")
    }

    func testHealthSyncLifecyclePolicyFlagsNoInitialAcknowledgement() {
        let startedAt = makeDate("2026-05-27T09:40:00.000Z")
        let now = makeDate("2026-05-27T09:45:05.000Z")

        let reason = CompanionAppModel.HealthSyncLifecyclePolicy.stallReason(
            startedAt: startedAt,
            lastChunkAt: nil,
            uploadedChunks: 0,
            now: now
        )

        XCTAssertEqual(reason, "no accepted health sync chunk within 305s")
    }

    func testHealthSyncLifecyclePolicyIgnoresStoppedTelemetry() {
        let now = makeDate("2026-05-27T09:45:05.000Z")

        let reason = CompanionAppModel.HealthSyncLifecyclePolicy.stallReason(
            startedAt: nil,
            lastChunkAt: nil,
            uploadedChunks: 0,
            now: now
        )

        XCTAssertNil(reason)
    }

    func testStartupBootstrapPolicySkipsDuplicateWatchRefreshAfterMovementRefresh() {
        XCTAssertFalse(
            CompanionAppModel.StartupBootstrapPolicy.shouldRefreshWatchAfterMovementBootstrap(
                refreshedWatchViaMovement: true
            )
        )
        XCTAssertTrue(
            CompanionAppModel.StartupBootstrapPolicy.shouldRefreshWatchAfterMovementBootstrap(
                refreshedWatchViaMovement: false
            )
        )
    }

    func testHealthAccessRefreshPolicySkipsOnlyRecentNonForcedChecks() {
        let now = makeDate("2026-06-08T10:00:00.000Z")
        let recent = now.addingTimeInterval(-1)
        let stale = now.addingTimeInterval(-3)

        XCTAssertTrue(
            CompanionAppModel.HealthAccessRefreshPolicy.shouldSkipRecentRefresh(
                force: false,
                lastCompletedAt: recent,
                now: now
            )
        )
        XCTAssertFalse(
            CompanionAppModel.HealthAccessRefreshPolicy.shouldSkipRecentRefresh(
                force: true,
                lastCompletedAt: recent,
                now: now
            )
        )
        XCTAssertFalse(
            CompanionAppModel.HealthAccessRefreshPolicy.shouldSkipRecentRefresh(
                force: false,
                lastCompletedAt: stale,
                now: now
            )
        )
        XCTAssertFalse(
            CompanionAppModel.HealthAccessRefreshPolicy.shouldSkipRecentRefresh(
                force: false,
                lastCompletedAt: nil,
                now: now
            )
        )
    }

    func testPairingRestorePersistencePolicySkipsUnchangedKeychainRewrite() {
        let storedData = Data("pairing".utf8)

        XCTAssertFalse(
            CompanionAppModel.PairingRestorePersistencePolicy.shouldPersistRestoredPairing(
                restoredFromKeychain: true,
                storedData: storedData,
                normalizedData: storedData
            )
        )
    }

    func testPairingRestorePersistencePolicyMigratesUserDefaultsFallback() {
        let storedData = Data("pairing".utf8)

        XCTAssertTrue(
            CompanionAppModel.PairingRestorePersistencePolicy.shouldPersistRestoredPairing(
                restoredFromKeychain: false,
                storedData: storedData,
                normalizedData: storedData
            )
        )
    }

    func testPairingRestorePersistencePolicyPersistsNormalizedChanges() {
        XCTAssertTrue(
            CompanionAppModel.PairingRestorePersistencePolicy.shouldPersistRestoredPairing(
                restoredFromKeychain: true,
                storedData: Data("before".utf8),
                normalizedData: Data("after".utf8)
            )
        )
        XCTAssertTrue(
            CompanionAppModel.PairingRestorePersistencePolicy.shouldPersistRestoredPairing(
                restoredFromKeychain: true,
                storedData: Data("before".utf8),
                normalizedData: nil
            )
        )
    }

    func testHealthSyncWindowPolicyScopesNormalWorkoutImportState() {
        let syncWindowEnd = makeDate("2026-06-08T10:00:00.000Z")

        XCTAssertNil(
            CompanionAppModel.HealthSyncWindowPolicy.workoutImportStartedAfter(
                lastSuccessfulSyncAt: nil,
                syncWindowEnd: syncWindowEnd
            )
        )

        XCTAssertEqual(
            CompanionAppModel.HealthSyncWindowPolicy.workoutImportStartedAfter(
                lastSuccessfulSyncAt: makeDate("2026-06-08T08:00:00.000Z"),
                syncWindowEnd: syncWindowEnd
            ),
            makeDate("2026-06-05T08:00:00.000Z")
        )

        XCTAssertEqual(
            CompanionAppModel.HealthSyncWindowPolicy.workoutImportStartedAfter(
                lastSuccessfulSyncAt: makeDate("2026-05-01T08:00:00.000Z"),
                syncWindowEnd: syncWindowEnd
            ),
            makeDate("2026-05-18T10:00:00.000Z")
        )
    }

    func testActiveHealthSyncCheckpointResumePolicyRejectsStaleBaseWindows() {
        let now = makeDate("2026-06-09T06:30:00.000Z")
        let freshCheckpoint = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_fresh",
            schemaVersion: "healthkit-sync-v2",
            requestedFamilies: ["sleep_nights", "sleep_segments"],
            createdAt: now.addingTimeInterval(-10 * 60),
            windowEnd: now.addingTimeInterval(-9 * 60),
            requiresWorkoutBackfill: false,
            lastReceivedChunkCount: 2,
            lastReceivedBytes: 20_000,
            clientChunkingVersion: "iroh-v7-balanced-content-addressed-base"
        )

        XCTAssertTrue(
            CompanionAppModel.ActiveHealthSyncCheckpointResumePolicy.shouldResume(
                checkpoint: freshCheckpoint,
                currentChunkingVersion: "iroh-v7-balanced-content-addressed-base",
                now: now
            )
        )

        let staleCreatedAt = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_stale_created",
            schemaVersion: freshCheckpoint.schemaVersion,
            requestedFamilies: freshCheckpoint.requestedFamilies,
            createdAt: now.addingTimeInterval(-45 * 60),
            windowEnd: now.addingTimeInterval(-9 * 60),
            requiresWorkoutBackfill: false,
            lastReceivedChunkCount: freshCheckpoint.lastReceivedChunkCount,
            lastReceivedBytes: freshCheckpoint.lastReceivedBytes,
            clientChunkingVersion: freshCheckpoint.clientChunkingVersion
        )
        XCTAssertFalse(
            CompanionAppModel.ActiveHealthSyncCheckpointResumePolicy.shouldResume(
                checkpoint: staleCreatedAt,
                currentChunkingVersion: freshCheckpoint.clientChunkingVersion,
                now: now
            )
        )

        let staleWindow = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_stale_window",
            schemaVersion: freshCheckpoint.schemaVersion,
            requestedFamilies: freshCheckpoint.requestedFamilies,
            createdAt: now.addingTimeInterval(-10 * 60),
            windowEnd: now.addingTimeInterval(-45 * 60),
            requiresWorkoutBackfill: false,
            lastReceivedChunkCount: freshCheckpoint.lastReceivedChunkCount,
            lastReceivedBytes: freshCheckpoint.lastReceivedBytes,
            clientChunkingVersion: freshCheckpoint.clientChunkingVersion
        )
        XCTAssertFalse(
            CompanionAppModel.ActiveHealthSyncCheckpointResumePolicy.shouldResume(
                checkpoint: staleWindow,
                currentChunkingVersion: freshCheckpoint.clientChunkingVersion,
                now: now
            )
        )

        let oldChunkingVersion = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_old_version",
            schemaVersion: freshCheckpoint.schemaVersion,
            requestedFamilies: freshCheckpoint.requestedFamilies,
            createdAt: freshCheckpoint.createdAt,
            windowEnd: freshCheckpoint.windowEnd,
            requiresWorkoutBackfill: false,
            lastReceivedChunkCount: freshCheckpoint.lastReceivedChunkCount,
            lastReceivedBytes: freshCheckpoint.lastReceivedBytes,
            clientChunkingVersion: "iroh-v6-small-content-addressed-base"
        )
        XCTAssertFalse(
            CompanionAppModel.ActiveHealthSyncCheckpointResumePolicy.shouldResume(
                checkpoint: oldChunkingVersion,
                currentChunkingVersion: freshCheckpoint.clientChunkingVersion,
                now: now
            )
        )
    }

    func testHistoricalWorkoutImportRefreshPolicySkipsPerBatchStatusPolls() {
        var batchesSinceLastRefresh = 0
        var refreshes = 0
        for _ in 0..<29 {
            if CompanionAppModel.HistoricalWorkoutImportRefreshPolicy
                .shouldRefreshBeforeBatch(
                    batchesSinceLastRefresh: batchesSinceLastRefresh
                ) {
                refreshes += 1
                batchesSinceLastRefresh = 0
            }
            batchesSinceLastRefresh += 1
        }

        XCTAssertEqual(refreshes, 3)
        XCTAssertFalse(
            CompanionAppModel.HistoricalWorkoutImportRefreshPolicy
                .shouldRefreshBeforeBatch(batchesSinceLastRefresh: 7)
        )
        XCTAssertTrue(
            CompanionAppModel.HistoricalWorkoutImportRefreshPolicy
                .shouldRefreshBeforeBatch(batchesSinceLastRefresh: 8)
        )
    }

    func testHealthSyncCompletionPolicyRefusesEmptyChunkSessionCompletion() {
        XCTAssertFalse(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.canCompleteChunkedSession(
                expectedRecordCount: 0,
                acceptedChunkCount: 0
            )
        )
        XCTAssertFalse(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.canCompleteChunkedSession(
                expectedRecordCount: 10,
                acceptedChunkCount: 0
            )
        )
        XCTAssertTrue(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.canCompleteChunkedSession(
                expectedRecordCount: 10,
                acceptedChunkCount: 1
            )
        )
    }

    func testHistoricalImportPolicyTreatsBackendCompleteEmptyUploadAsComplete() {
        XCTAssertTrue(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.shouldTreatHistoricalImportAsAlreadyComplete(
                expectedUploadRecordCount: 0,
                acceptedChunkCount: 0,
                backendUploadedWorkoutCount: 1_051,
                backendIncompleteWorkoutCount: 0,
                discoveredHealthKitWorkoutCount: 1_051
            )
        )
    }

    func testHistoricalImportPolicyDoesNotHideMissingEvidence() {
        XCTAssertFalse(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.shouldTreatHistoricalImportAsAlreadyComplete(
                expectedUploadRecordCount: 0,
                acceptedChunkCount: 0,
                backendUploadedWorkoutCount: 900,
                backendIncompleteWorkoutCount: 151,
                discoveredHealthKitWorkoutCount: 1_051
            )
        )
        XCTAssertFalse(
            CompanionAppModel.HealthSyncSessionCompletionPolicy.shouldTreatHistoricalImportAsAlreadyComplete(
                expectedUploadRecordCount: 250,
                acceptedChunkCount: 0,
                backendUploadedWorkoutCount: 900,
                backendIncompleteWorkoutCount: 0,
                discoveredHealthKitWorkoutCount: 1_051
            )
        )
    }

    func testActiveHealthSyncCheckpointPersistsFrozenWindowAndProgress() throws {
        let windowEnd = makeDate("2026-05-25T20:19:12.377Z")
        let checkpoint = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_resume",
            schemaVersion: "healthkit-sync-v2",
            requestedFamilies: ["sleep_nights", "workout_routes"],
            createdAt: makeDate("2026-05-25T20:18:59.000Z"),
            windowEnd: windowEnd,
            requiresWorkoutBackfill: true,
            lastReceivedChunkCount: 18,
            lastReceivedBytes: 42_000_000
        )

        let encoded = try JSONEncoder().encode(checkpoint)
        let decoded = try JSONDecoder().decode(ActiveHealthSyncCheckpoint.self, from: encoded)

        XCTAssertEqual(decoded, checkpoint)
        XCTAssertEqual(decoded.resumeSessionId, "hms_resume")
        XCTAssertEqual(decoded.windowEnd, windowEnd)
        XCTAssertTrue(decoded.requiresWorkoutBackfill)
        XCTAssertEqual(decoded.lastReceivedChunkCount, 18)
        XCTAssertEqual(decoded.clientChunkingVersion, ForgeSyncClient.legacyHTTPHealthSyncChunkingVersion)
    }

    func testHealthSyncCheckpointProgressPersistenceIsThrottled() {
        XCTAssertFalse(
            CompanionAppModel.shouldPersistHealthSyncCheckpointProgress(
                lastPersistedChunkCount: 20,
                lastPersistedBytes: 10_000_000,
                nextChunkCount: 29,
                nextBytes: 14_999_999
            )
        )
        XCTAssertTrue(
            CompanionAppModel.shouldPersistHealthSyncCheckpointProgress(
                lastPersistedChunkCount: 20,
                lastPersistedBytes: 10_000_000,
                nextChunkCount: 30,
                nextBytes: 11_000_000
            )
        )
        XCTAssertTrue(
            CompanionAppModel.shouldPersistHealthSyncCheckpointProgress(
                lastPersistedChunkCount: 20,
                lastPersistedBytes: 10_000_000,
                nextChunkCount: 21,
                nextBytes: 15_000_000
            )
        )
    }

    func testActiveHealthSyncCheckpointIgnoresLegacyCompletedWorkoutIds() throws {
        let checkpoint = ActiveHealthSyncCheckpoint(
            syncSessionId: "hms_resume",
            schemaVersion: "healthkit-sync-v2",
            requestedFamilies: ["workout_summaries"],
            createdAt: makeDate("2026-05-25T20:18:59.000Z"),
            windowEnd: makeDate("2026-05-25T20:19:12.377Z"),
            requiresWorkoutBackfill: true,
            lastReceivedChunkCount: 9,
            lastReceivedBytes: 12_000_000,
            clientChunkingVersion: ForgeSyncClient.httpBackgroundHealthSyncChunkingVersion
        )
        var checkpointObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(checkpoint)) as? [String: Any]
        )
        checkpointObject["completedWorkoutExternalUids"] = ["workout-b", "workout-a", "workout-a"]
        let checkpointJSON = try JSONSerialization.data(withJSONObject: checkpointObject)

        let decoded = try JSONDecoder().decode(
            ActiveHealthSyncCheckpoint.self,
            from: checkpointJSON
        )
        let reencoded = String(data: try JSONEncoder().encode(decoded), encoding: .utf8) ?? ""

        XCTAssertEqual(decoded, checkpoint)
        XCTAssertFalse(reencoded.contains("completedWorkoutExternalUids"))
    }

    func testHealthSyncChunkingVersionMatchesTransport() {
        let urlSessionPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_urlsession",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )

        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkingVersion(for: urlSessionPayload),
            "http-background-v6-content-addressed-base"
        )
        XCTAssertEqual(
            ForgeSyncClient.httpBackgroundHealthSyncChunkingVersion,
            "http-background-v6-content-addressed-base"
        )
        XCTAssertEqual(
            ForgeSyncClient.irohHealthSyncChunkingVersion,
            "iroh-v7-balanced-content-addressed-base"
        )
    }

    func testHealthSyncChunkUploadTransportPolicyPrefersForegroundUrlSessionWhenActive() {
        let httpPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_http",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "node",
            relay: nil,
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "node",
                token: "host-token",
                hostName: "Mac",
                relay: nil
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let irohPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "iroh",
            transport: irohTransport
        )

        XCTAssertFalse(
            ForgeSyncClient.shouldUseBackgroundUploadForHealthSyncChunk(
                pairing: httpPayload,
                appIsForegroundActive: true
            )
        )
        XCTAssertTrue(
            ForgeSyncClient.shouldUseBackgroundUploadForHealthSyncChunk(
                pairing: httpPayload,
                appIsForegroundActive: false
            )
        )
        XCTAssertFalse(
            ForgeSyncClient.shouldUseBackgroundUploadForHealthSyncChunk(
                pairing: irohPayload,
                appIsForegroundActive: true
            )
        )
        XCTAssertTrue(
            ForgeSyncClient.shouldUseBackgroundUploadForHealthSyncChunk(
                pairing: irohPayload,
                appIsForegroundActive: false
            )
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: httpPayload,
                useBackgroundUpload: false
            ),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: httpPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: false
            ),
            1
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: httpPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: true
            ),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
        )
        XCTAssertFalse(
            ForgeSyncClient.effectiveUseBackgroundUploadForTesting(
                requestedBackgroundUpload: true,
                appIsForegroundActive: true
            )
        )
        XCTAssertTrue(
            ForgeSyncClient.effectiveUseBackgroundUploadForTesting(
                requestedBackgroundUpload: true,
                appIsForegroundActive: false
            )
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: irohPayload,
                useBackgroundUpload: false
            ),
            ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncChunkUploadConcurrency(
                pairing: irohPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: false
            ),
            1
        )
    }

    func testForegroundTransportsUseLargerChunksThanBackground() {
        let uploadSession = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_large",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 12_000_000,
            chunkMaxBytes: 24_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["movement"],
            receivedChunkIds: []
        )
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "node",
            relay: nil,
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "node",
                token: "host-token",
                hostName: "Mac",
                relay: nil
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let irohPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "iroh",
            transport: irohTransport
        )
        let httpPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_http",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )

        XCTAssertEqual(
            ForgeSyncClient.effectiveHealthSyncChunkTargetForTesting(
                uploadSession: uploadSession,
                pairing: irohPayload
            ),
            ForgeSyncClient.irohHealthSyncChunkTargetBytes
        )
        XCTAssertEqual(
            ForgeSyncClient.effectiveHealthSyncChunkTargetForTesting(
                uploadSession: uploadSession,
                pairing: httpPayload
            ),
            ForgeSyncClient.foregroundHTTPHealthSyncChunkTargetBytes
        )
        XCTAssertEqual(
            ForgeSyncClient.effectiveHealthSyncChunkTargetForTesting(
                uploadSession: uploadSession,
                pairing: httpPayload,
                useBackgroundUpload: true
            ),
            ForgeSyncClient.backgroundHTTPHealthSyncChunkTargetBytes
        )
        let irohTimeSeriesLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: irohPayload,
            estimatedBytesPerRecord: 640,
            minimum: 500,
            maximum: 12_000
        )
        let httpTimeSeriesLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: httpPayload,
            estimatedBytesPerRecord: 640,
            minimum: 500,
            maximum: 12_000
        )
        let backgroundHTTPTimeSeriesLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: httpPayload,
            useBackgroundUpload: true,
            estimatedBytesPerRecord: 640,
            minimum: 500,
            maximum: 12_000
        )
        let irohRouteLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: irohPayload,
            estimatedBytesPerRecord: 520,
            minimum: 500,
            maximum: 15_000
        )
        let httpRouteLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: httpPayload,
            estimatedBytesPerRecord: 520,
            minimum: 500,
            maximum: 15_000
        )
        let backgroundHTTPRouteLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: httpPayload,
            useBackgroundUpload: true,
            estimatedBytesPerRecord: 520,
            minimum: 500,
            maximum: 15_000
        )

        XCTAssertEqual(irohTimeSeriesLimit, 4_687)
        XCTAssertEqual(backgroundHTTPTimeSeriesLimit, 781)
        XCTAssertEqual(httpTimeSeriesLimit, 3_906)
        XCTAssertEqual(irohRouteLimit, 5_769)
        XCTAssertEqual(backgroundHTTPRouteLimit, 961)
        XCTAssertEqual(httpRouteLimit, 4_807)
        XCTAssertLessThanOrEqual(irohTimeSeriesLimit * 640, ForgeSyncClient.irohHealthSyncChunkTargetBytes)
        XCTAssertLessThanOrEqual(irohRouteLimit * 520, ForgeSyncClient.irohHealthSyncChunkTargetBytes)
        XCTAssertLessThanOrEqual(
            httpTimeSeriesLimit * 640,
            ForgeSyncClient.foregroundHTTPHealthSyncChunkTargetBytes
        )
        XCTAssertLessThanOrEqual(
            httpRouteLimit * 520,
            ForgeSyncClient.foregroundHTTPHealthSyncChunkTargetBytes
        )
    }

    func testForegroundHttpHealthSyncUsesBoundedPreparedChunkPrefetch() {
        let httpPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: "pair_http",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: []
        )
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "node",
            relay: nil,
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "node",
                token: "host-token",
                hostName: "Mac",
                relay: nil
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let irohPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "iroh",
            transport: irohTransport
        )

        XCTAssertEqual(
            ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(pairing: httpPayload),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
                * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(
                pairing: httpPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: false
            ),
            0
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(
                pairing: httpPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: true
            ),
            ForgeSyncClient.foregroundHealthSyncChunkUploadConcurrency
                * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(pairing: irohPayload),
            ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency
                * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows
        )
        XCTAssertEqual(
            ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(
                pairing: irohPayload,
                useBackgroundUpload: true,
                appIsForegroundActive: false
            ),
            0
        )
    }

    func testForegroundIrohHealthSyncNoLongerSerializesUploadPipe() {
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "node",
            relay: nil,
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "node",
                token: "host-token",
                hostName: "Mac",
                relay: nil
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let irohPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "iroh",
            transport: irohTransport
        )

        let previousSerializedBudgetBytes = 500_000
        let previousForegroundWaveBudgetBytes = 6 * 2_000_000
        let foregroundConcurrency = ForgeSyncClient.healthSyncChunkUploadConcurrency(
            pairing: irohPayload,
            useBackgroundUpload: false,
            appIsForegroundActive: true
        )
        let foregroundPreparedLimit = ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(
            pairing: irohPayload,
            useBackgroundUpload: false,
            appIsForegroundActive: true
        )
        let foregroundWaveBudgetBytes = foregroundConcurrency * ForgeSyncClient.irohHealthSyncChunkTargetBytes

        XCTAssertEqual(foregroundConcurrency, 8)
        XCTAssertEqual(foregroundPreparedLimit, 24)
        XCTAssertEqual(foregroundWaveBudgetBytes, 24_000_000)
        XCTAssertEqual(foregroundWaveBudgetBytes / previousSerializedBudgetBytes, 48)
        XCTAssertEqual(foregroundWaveBudgetBytes / previousForegroundWaveBudgetBytes, 2)
    }

    func testForegroundDirectHealthSyncWidensTailscalePipeBeyondIrohWindow() {
        let tailscalePayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "https://macbook-pro.example.ts.net/api/v1",
            uiBaseUrl: "https://macbook-pro.example.ts.net/forge/",
            sessionId: "pair_tailscale",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "tailscale",
            transport: nil
        )

        let oldDirectWindow = 8
        let foregroundConcurrency = ForgeSyncClient.healthSyncChunkUploadConcurrency(
            pairing: tailscalePayload,
            useBackgroundUpload: false,
            appIsForegroundActive: true
        )
        let foregroundPreparedLimit = ForgeSyncClient.healthSyncPreparedChunkPrefetchLimitForTesting(
            pairing: tailscalePayload,
            useBackgroundUpload: false,
            appIsForegroundActive: true
        )
        let foregroundWaveBudgetBytes = foregroundConcurrency * ForgeSyncClient.foregroundHTTPHealthSyncChunkTargetBytes

        XCTAssertEqual(foregroundConcurrency, 12)
        XCTAssertEqual(ForgeSyncClient.foregroundHTTPMaximumConnectionsPerHost, 12)
        XCTAssertEqual(foregroundPreparedLimit, 36)
        XCTAssertEqual(foregroundWaveBudgetBytes, 30_000_000)
        XCTAssertEqual(
            foregroundConcurrency - oldDirectWindow,
            4
        )
        XCTAssertEqual(
            foregroundPreparedLimit - oldDirectWindow * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows,
            12
        )
        XCTAssertGreaterThan(
            foregroundConcurrency,
            ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency
        )
    }

    func testForegroundIrohHealthSyncDoublesPreviousThreeRequestWave() async throws {
        let oldForegroundIrohWindow = 3
        let chunkCount = 18
        let oldMetrics = try await ForgeSyncClient.preparedChunkSchedulerMetricsForTesting(
            totalChunks: chunkCount,
            concurrency: oldForegroundIrohWindow,
            prefetchLimit: oldForegroundIrohWindow * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows
        )
        let newMetrics = try await ForgeSyncClient.preparedChunkSchedulerMetricsForTesting(
            totalChunks: chunkCount,
            concurrency: ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency,
            prefetchLimit: ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency
                * ForgeSyncClient.foregroundHealthSyncPreparedChunkPrefetchWindows
        )

        XCTAssertEqual(oldMetrics.scheduledBeforeFirstCompletion, oldForegroundIrohWindow)
        XCTAssertEqual(
            newMetrics.scheduledBeforeFirstCompletion,
            ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency
        )
        XCTAssertEqual(
            Int(ceil(Double(chunkCount) / Double(oldForegroundIrohWindow))),
            6
        )
        XCTAssertEqual(
            Int(ceil(Double(chunkCount) / Double(ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency))),
            3
        )
    }

    func testForegroundIrohLargerChunksReduceRoundTripWaves() {
        let uploadSession = ForgeSyncClient.HealthSyncUploadSession(
            syncSessionId: "hms_iroh_wave",
            schemaVersion: "healthkit-sync-v2",
            chunkTargetBytes: 12_000_000,
            chunkMaxBytes: 24_000_000,
            chunkPayloadEncoding: "payload_json_base64",
            acceptedPayloadEncodings: ["payload_json_base64"],
            supportsCompression: true,
            acceptedFamilies: ["workout_time_series"],
            receivedChunkIds: []
        )
        let irohTransport = PairingTransport(
            protocolName: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            publicBaseUrl: nil,
            localBaseUrl: "http://127.0.0.1:4317",
            nodeId: "node",
            relay: nil,
            alpn: "forge-companion/1",
            agent: "forge",
            pairPayload: PairingTransportPairPayload(
                v: 1,
                nodeId: "node",
                token: "host-token",
                hostName: "Mac",
                relay: nil
            ),
            recreateCommand: nil,
            startedAt: nil,
            lastError: nil,
            notes: []
        )
        let irohPayload = PairingPayload(
            kind: "pairing",
            apiBaseUrl: "forge-iroh://node/api/v1",
            uiBaseUrl: "forge-iroh://node/forge/",
            sessionId: "pair_iroh",
            pairingToken: "token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: [],
            transportMode: "iroh",
            transport: irohTransport
        )
        let recordCount = 100_000
        let previousIrohTargetBytes = 1_000_000
        let oldCurrentIrohTargetBytes = 2_000_000
        let previousRecordLimit = previousIrohTargetBytes / 640
        let oldCurrentRecordLimit = oldCurrentIrohTargetBytes / 640
        let newRecordLimit = ForgeSyncClient.healthSyncChunkRecordLimitForTesting(
            uploadSession: uploadSession,
            pairing: irohPayload,
            estimatedBytesPerRecord: 640,
            minimum: 500,
            maximum: 12_000
        )
        let previousChunkCount = ForgeSyncClient.workoutEvidenceChunkCountForTesting(
            recordCount: recordCount,
            recordLimit: previousRecordLimit
        )
        let oldCurrentChunkCount = ForgeSyncClient.workoutEvidenceChunkCountForTesting(
            recordCount: recordCount,
            recordLimit: oldCurrentRecordLimit
        )
        let newChunkCount = ForgeSyncClient.workoutEvidenceChunkCountForTesting(
            recordCount: recordCount,
            recordLimit: newRecordLimit
        )
        let previousWaves = Int(ceil(Double(previousChunkCount) / 6.0))
        let oldCurrentWaves = Int(ceil(Double(oldCurrentChunkCount) / 6.0))
        let newWaves = Int(ceil(Double(newChunkCount) / Double(ForgeSyncClient.foregroundIrohHealthSyncChunkUploadConcurrency)))

        XCTAssertEqual(previousRecordLimit, 1_562)
        XCTAssertEqual(oldCurrentRecordLimit, 3_125)
        XCTAssertEqual(newRecordLimit, 4_687)
        XCTAssertEqual(previousChunkCount, 65)
        XCTAssertEqual(oldCurrentChunkCount, 32)
        XCTAssertEqual(newChunkCount, 22)
        XCTAssertEqual(previousWaves, 11)
        XCTAssertEqual(oldCurrentWaves, 6)
        XCTAssertEqual(newWaves, 3)
        XCTAssertLessThan(newWaves, oldCurrentWaves)
        XCTAssertLessThan(newWaves, previousWaves)
    }

    func testPreparedChunkSchedulerKeepsOneWindowReadyWithoutUnboundedPreparation() async throws {
        let metrics = try await ForgeSyncClient.preparedChunkSchedulerMetricsForTesting(
            totalChunks: 20,
            concurrency: 3,
            prefetchLimit: 3
        )

        XCTAssertEqual(metrics.preparedCount, 20)
        XCTAssertEqual(metrics.scheduledCount, 20)
        XCTAssertEqual(metrics.scheduledBeforeFirstCompletion, 3)
        XCTAssertEqual(metrics.maxPreparedQueueDepth, 3)
    }

    func testPreparedChunkSchedulerCanRunWithoutExtraPrefetchForBackgroundTransfers() async throws {
        let metrics = try await ForgeSyncClient.preparedChunkSchedulerMetricsForTesting(
            totalChunks: 8,
            concurrency: 1,
            prefetchLimit: 0
        )

        XCTAssertEqual(metrics.preparedCount, 8)
        XCTAssertEqual(metrics.scheduledCount, 8)
        XCTAssertEqual(metrics.scheduledBeforeFirstCompletion, 1)
        XCTAssertEqual(metrics.maxPreparedQueueDepth, 1)
    }

    func testCombinedWorkoutEvidenceSchedulerFillsForegroundWindowAcrossFamilies() async throws {
        let metrics = try await ForgeSyncClient.combinedWorkoutEvidenceSchedulerMetricsForTesting(
            summaryChunks: 1,
            timeSeriesChunks: 18,
            routeChunks: 5,
            concurrency: 8,
            prefetchLimit: 24,
            uploadDelayNanoseconds: 120_000_000
        )

        XCTAssertEqual(metrics.preparedCount, 24)
        XCTAssertEqual(metrics.scheduledCount, 24)
        XCTAssertEqual(metrics.scheduledBeforeFirstCompletion, 8)
        XCTAssertEqual(metrics.maxPreparedQueueDepth, 16)
    }

    func testPreparedChunkSchedulerWidensBeforeFirstCompletionWhenForegroundWindowAppears() async throws {
        let metrics = try await ForgeSyncClient.adaptivePreparedChunkSchedulerMetricsForTesting(
            totalChunks: 8,
            firstConcurrency: 1,
            laterConcurrency: 3,
            firstPrefetchLimit: 0,
            laterPrefetchLimit: 3,
            windowPollIntervalNanoseconds: 10_000_000,
            uploadDelayNanoseconds: 120_000_000
        )

        XCTAssertEqual(metrics.preparedCount, 8)
        XCTAssertEqual(metrics.scheduledCount, 8)
        XCTAssertEqual(metrics.scheduledBeforeFirstCompletion, 3)
        XCTAssertEqual(metrics.maxPreparedQueueDepth, 3)
    }

    func testPreparedChunkSchedulerWidensPreparedArrayWithoutPrefetchBacklog() async throws {
        let metrics = try await ForgeSyncClient.adaptivePreparedChunkSchedulerMetricsForTesting(
            totalChunks: 8,
            firstConcurrency: 1,
            laterConcurrency: 3,
            firstPrefetchLimit: 0,
            laterPrefetchLimit: 0,
            windowPollIntervalNanoseconds: 10_000_000,
            uploadDelayNanoseconds: 120_000_000
        )

        XCTAssertEqual(metrics.preparedCount, 8)
        XCTAssertEqual(metrics.scheduledCount, 8)
        XCTAssertEqual(metrics.scheduledBeforeFirstCompletion, 3)
        XCTAssertEqual(metrics.maxPreparedQueueDepth, 1)
    }

    func testWorkoutEvidenceChunkCountSupportsNextFamilyWarmupSequences() {
        XCTAssertEqual(
            ForgeSyncClient.workoutEvidenceChunkCountForTesting(recordCount: 0, recordLimit: 625),
            0
        )
        XCTAssertEqual(
            ForgeSyncClient.workoutEvidenceChunkCountForTesting(recordCount: 625, recordLimit: 625),
            1
        )
        XCTAssertEqual(
            ForgeSyncClient.workoutEvidenceChunkCountForTesting(recordCount: 626, recordLimit: 625),
            2
        )
        XCTAssertEqual(
            ForgeSyncClient.workoutEvidenceChunkCountForTesting(recordCount: 2_739, recordLimit: 625),
            5
        )
    }

    func testSyncUploadStatusExplainsCurrentCountsAndTransferChunk() {
        let payloadSummary = SyncPayloadSummary(
            builtAt: makeDate("2026-05-20T08:00:00.000Z"),
            sleepSessions: 0,
            sleepNights: 2,
            sleepSegments: 18,
            sleepRawRecords: 42,
            sleepStageEntries: 9,
            workouts: 7,
            workoutsWithAverageHeartRate: 5,
            workoutsWithMaxHeartRate: 4,
            workoutsWithStepCount: 3,
            movementKnownPlaces: 4,
            movementStays: 12,
            movementTrips: 6,
            movementTripPoints: 80,
            movementTripStops: 5,
            vitalsDaySummaries: 3,
            vitalsMetricEntries: 24,
            screenTimeDaySummaries: 1,
            screenTimeHourlySegments: 10,
            screenTimeTotalActivitySeconds: 3600,
            rawHeartRateDatapointsSynced: 128
        )

        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Uploading workouts 5/7",
            payloadSummary: payloadSummary,
            lastChunkFamily: "workout_time_series",
            lastPayloadBytes: 1536,
            activeSessionId: "hms_abcdefghijklmnopqrstuvwxyz",
            transferStats: SyncTransferStats(
                totalBytesSent: 2_097_152,
                currentBytesPerSecond: 524_288,
                averageBytesPerSecond: 262_144,
                scheduledCurrentBytesPerSecond: 786_432,
                scheduledAverageBytesPerSecond: 393_216,
                uploadedChunks: 8,
                uploadedRecords: 512,
                skippedChunks: 1,
                scheduledChunks: 10,
                scheduledBytes: 2_621_440,
                inFlightChunks: 2,
                inFlightBytes: 524_288,
                uploadWindow: 8,
                transportLabel: "HTTP",
                secondsSinceLastChunk: 4,
                secondsSinceOldestInFlight: 5,
                lastServerProcessingMs: 1_240,
                lastTransportTimingSummary: "Iroh client 84 ms • response wait 70 ms • bridge ready 2 ms • host proxy 12 ms",
                preparingFamily: nil,
                secondsPreparing: nil
            ),
            historicalWorkoutImport: nil
        )

        XCTAssertEqual(status.headline, "Uploading workout time series")
        XCTAssertEqual(
            status.uploadSummary,
            "42 raw sleep, 18 segments, 2 nights, 7 workouts, 128 HR samples, 6 trips"
        )
        XCTAssertTrue(status.transferSummary.contains("workout time series"))
        XCTAssertTrue(status.transferSummary.contains("2.0 MB accepted"))
        XCTAssertTrue(status.transferSummary.contains("512.0 KB in flight awaiting network response"))
        XCTAssertTrue(status.transferSummary.contains("session"))
        XCTAssertTrue(status.speedSummary?.contains("Phone sent 768.0 KB/s now") == true)
        XCTAssertTrue(status.speedSummary?.contains("384.0 KB/s sent avg") == true)
        XCTAssertTrue(status.speedSummary?.contains("Forge accepted 512.0 KB/s now") == true)
        XCTAssertTrue(status.speedSummary?.contains("2/8 requests in flight") == true)
        XCTAssertTrue(status.speedSummary?.contains("HTTP") == true)
        XCTAssertTrue(status.speedSummary?.contains("512.0 KB in flight") == true)
        XCTAssertTrue(status.speedSummary?.contains("oldest transport wait 5s") == true)
        XCTAssertFalse(status.speedSummary?.contains("4s since last Forge reply") == true)
        XCTAssertFalse(status.speedSummary?.contains("ack") == true)
        XCTAssertEqual(
            status.pipelineSummary,
            "Awaiting HTTP network responses for 5s: 2/8 active requests, 512.0 KB in flight"
        )
        XCTAssertEqual(
            status.bridgeTimingSummary,
            "Iroh client 84 ms • response wait 70 ms • bridge ready 2 ms • host proxy 12 ms"
        )
        XCTAssertFalse(status.bridgeTimingSummary?.contains("ack") == true)
        XCTAssertEqual(status.forgeProcessingSummary, "Forge processed the last chunk in 1.2s")
    }

    func testSyncUploadStatusExplainsPhoneSideChunkPreparation() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Uploading recent workouts 10/10",
            payloadSummary: nil,
            lastChunkFamily: "workout_summaries",
            lastPayloadBytes: nil,
            activeSessionId: "hms_prepare",
            transferStats: SyncTransferStats(
                totalBytesSent: 177_700,
                currentBytesPerSecond: 0,
                averageBytesPerSecond: 1_100,
                scheduledCurrentBytesPerSecond: 0,
                scheduledAverageBytesPerSecond: 1_100,
                uploadedChunks: 4,
                uploadedRecords: 10,
                skippedChunks: 0,
                scheduledChunks: 4,
                scheduledBytes: 177_700,
                inFlightChunks: 0,
                inFlightBytes: 0,
                uploadWindow: 8,
                transportLabel: "HTTP",
                secondsSinceLastChunk: 30,
                secondsSinceOldestInFlight: nil,
                lastServerProcessingMs: 18,
                lastTransportTimingSummary: nil,
                preparingFamily: "workout_time_series",
                secondsPreparing: 12
            ),
            historicalWorkoutImport: nil
        )

        XCTAssertTrue(status.speedSummary?.contains("preparing workout time series for 12s") == true)
        XCTAssertFalse(status.speedSummary?.contains("30s since last Forge reply") == true)
        XCTAssertEqual(
            status.pipelineSummary,
            "Preparing workout time series chunks on the phone for 12s"
        )
        XCTAssertFalse(status.pipelineSummary?.contains("Forge to accept") == true)
        XCTAssertFalse(status.speedSummary?.contains("ack") == true)
    }

    func testSyncUploadStatusDoesNotReportIdleWhenRequestsAreInFlightWithoutRecentReplies() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Uploading recent workouts 10/10",
            payloadSummary: nil,
            lastChunkFamily: "workout_summaries",
            lastPayloadBytes: nil,
            activeSessionId: "hms_active_request",
            transferStats: SyncTransferStats(
                totalBytesSent: 177_700,
                currentBytesPerSecond: 0,
                averageBytesPerSecond: 1_100,
                scheduledCurrentBytesPerSecond: 1_572_300,
                scheduledAverageBytesPerSecond: 8_000,
                uploadedChunks: 4,
                uploadedRecords: 10,
                skippedChunks: 0,
                scheduledChunks: 5,
                scheduledBytes: 1_750_000,
                inFlightChunks: 1,
                inFlightBytes: 1_572_300,
                uploadWindow: 8,
                transportLabel: "Iroh primary",
                secondsSinceLastChunk: 30,
                secondsSinceOldestInFlight: 30,
                lastServerProcessingMs: 18,
                lastTransportTimingSummary: "Iroh client 213 ms • response wait 201 ms",
                preparingFamily: nil,
                secondsPreparing: nil
            ),
            historicalWorkoutImport: nil
        )

        XCTAssertTrue(status.speedSummary?.contains("Phone sent 1.5 MB/s now") == true)
        XCTAssertTrue(status.speedSummary?.contains("Forge accepted 0 B/s now") == true)
        XCTAssertTrue(status.speedSummary?.contains("Iroh primary") == true)
        XCTAssertTrue(status.speedSummary?.contains("1.5 MB in flight") == true)
        XCTAssertTrue(status.speedSummary?.contains("oldest transport wait 30s") == true)
        XCTAssertFalse(status.speedSummary?.contains("30s since last Forge reply") == true)
        XCTAssertEqual(
            status.pipelineSummary,
            "Awaiting Iroh network responses for 30s: 1/8 active request, 1.5 MB in flight"
        )
        XCTAssertEqual(status.bridgeTimingSummary, "Iroh client 213 ms • response wait 201 ms")
    }

    func testSyncUploadStatusNamesTailscaleRouteWhenBulkUploadsUseDirectTransfer() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Uploading recent workouts 10/11",
            payloadSummary: nil,
            lastChunkFamily: "workout_time_series",
            lastPayloadBytes: nil,
            activeSessionId: "hms_tailscale",
            transferStats: SyncTransferStats(
                totalBytesSent: 338_300,
                currentBytesPerSecond: 0,
                averageBytesPerSecond: 3_800,
                scheduledCurrentBytesPerSecond: 229_171,
                scheduledAverageBytesPerSecond: 3_800,
                uploadedChunks: 3,
                uploadedRecords: 1_875,
                skippedChunks: 4,
                scheduledChunks: 6,
                scheduledBytes: 567_471,
                inFlightChunks: 3,
                inFlightBytes: 229_171,
                uploadWindow: 12,
                transportLabel: "Tailscale direct",
                secondsSinceLastChunk: nil,
                secondsSinceOldestInFlight: 21,
                lastServerProcessingMs: 39,
                lastTransportTimingSummary: "Tailscale request 21.0s",
                preparingFamily: nil,
                secondsPreparing: nil
            ),
            historicalWorkoutImport: nil
        )

        XCTAssertTrue(status.speedSummary?.contains("Tailscale direct") == true)
        XCTAssertEqual(
            status.pipelineSummary,
            "Awaiting Tailscale network responses for 21s: 3/12 active requests, 223.8 KB in flight"
        )
        XCTAssertEqual(status.bridgeTimingSummary, "Tailscale request 21.0s")
        XCTAssertEqual(status.forgeProcessingSummary, "Forge processed the last chunk in 39 ms")
        XCTAssertFalse(status.pipelineSummary?.contains("Forge replies") == true)
        XCTAssertFalse(status.speedSummary?.contains("Iroh tunnel") == true)
    }

    func testSyncUploadStatusHeadlineUsesActiveTransferOverStaleSyncedMessage() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Synced 2 nights, 1 workouts, 0 body metrics, and 114 trips",
            payloadSummary: nil,
            lastChunkFamily: "workout_routes",
            lastPayloadBytes: nil,
            activeSessionId: "hms_stale_message",
            transferStats: SyncTransferStats(
                totalBytesSent: 126_700,
                currentBytesPerSecond: 0,
                averageBytesPerSecond: 3_800,
                scheduledCurrentBytesPerSecond: 126_700,
                scheduledAverageBytesPerSecond: 3_800,
                uploadedChunks: 1,
                uploadedRecords: 1,
                skippedChunks: 0,
                scheduledChunks: 2,
                scheduledBytes: 253_400,
                inFlightChunks: 1,
                inFlightBytes: 126_700,
                uploadWindow: 12,
                transportLabel: "Tailscale direct",
                secondsSinceLastChunk: nil,
                secondsSinceOldestInFlight: 8,
                lastServerProcessingMs: nil,
                lastTransportTimingSummary: "Tailscale request 8.0s",
                preparingFamily: nil,
                secondsPreparing: nil
            ),
            historicalWorkoutImport: nil
        )

        XCTAssertEqual(status.headline, "Uploading workout routes")
        XCTAssertFalse(status.headline.contains("Synced"))
    }

    func testSyncUploadStatusDoesNotShowCompletedMessageBeforeNextChunkTelemetry() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Synced 22 workouts",
            payloadSummary: nil,
            lastChunkFamily: nil,
            lastPayloadBytes: nil,
            activeSessionId: "hms_next_stage",
            transferStats: nil,
            historicalWorkoutImport: nil
        )

        XCTAssertEqual(status.headline, "Preparing the next upload")
        XCTAssertEqual(
            status.pipelineSummary,
            "Starting the next sync stage; no upload request is in flight yet"
        )
        XCTAssertFalse(status.headline.contains("Synced"))
    }

    func testSyncUploadStatusUsesHistoricalHeadlineOverCompletedMessage() {
        let status = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .historicalWorkoutImport,
            message: "Synced 22 workouts",
            payloadSummary: nil,
            lastChunkFamily: nil,
            lastPayloadBytes: nil,
            activeSessionId: "hms_history",
            transferStats: nil,
            historicalWorkoutImport: HistoricalWorkoutImportStatus(
                indexedWorkouts: 22,
                totalWorkouts: 1051,
                uploadedWorkoutSummaries: 22,
                uploadedTimeSeriesSamples: 10_000,
                uploadedRoutePoints: 5_000,
                targetHeartRateSamples: 12_000,
                targetTimeSeriesSamples: 20_000,
                targetRoutePoints: 8_000,
                uploadedChunks: 12,
                resumedChunks: 0
            )
        )

        XCTAssertEqual(status.headline, "Historical workout import")
        XCTAssertEqual(status.pipelineSummary, "Preparing historical workout evidence")
        XCTAssertTrue(status.shouldShowHistoricalWorkoutImportPanel)
        XCTAssertFalse(status.headline.contains("Synced"))
    }

    func testHistoricalWorkoutImportPanelRemainsVisibleForRepairMessages() {
        let progress = HistoricalWorkoutImportStatus(
            indexedWorkouts: 1077,
            totalWorkouts: 1077,
            uploadedWorkoutSummaries: 900,
            uploadedTimeSeriesSamples: 120_000,
            uploadedRoutePoints: 45_000,
            targetHeartRateSamples: 85_000,
            targetTimeSeriesSamples: 140_000,
            targetRoutePoints: 50_000,
            uploadedChunks: 180,
            resumedChunks: 12
        )

        let repairingStatus = CompanionSyncUploadStatus(
            isSyncing: false,
            syncMode: .normal,
            message: "Repairing historical workout heart-rate and route evidence",
            payloadSummary: nil,
            lastChunkFamily: nil,
            lastPayloadBytes: nil,
            activeSessionId: nil,
            transferStats: nil,
            historicalWorkoutImport: progress
        )

        XCTAssertTrue(repairingStatus.shouldShowHistoricalWorkoutImportPanel)

        let normalStatus = CompanionSyncUploadStatus(
            isSyncing: true,
            syncMode: .normal,
            message: "Uploading sleep, vitals, movement, and screen time",
            payloadSummary: nil,
            lastChunkFamily: nil,
            lastPayloadBytes: nil,
            activeSessionId: nil,
            transferStats: nil,
            historicalWorkoutImport: progress
        )

        XCTAssertFalse(normalStatus.shouldShowHistoricalWorkoutImportPanel)
    }

    func testHistoricalWorkoutImportProgressClampsReplayedWorkoutSummariesToTotal() {
        let progress = HistoricalWorkoutImportStatus(
            indexedWorkouts: 1051,
            totalWorkouts: 1051,
            uploadedWorkoutSummaries: 1089,
            uploadedTimeSeriesSamples: 409_262,
            uploadedRoutePoints: 753_342,
            targetHeartRateSamples: 94_782,
            targetTimeSeriesSamples: 409_262,
            targetRoutePoints: 753_342,
            uploadedChunks: 0,
            resumedChunks: 0
        )

        XCTAssertEqual(progress.completedWorkoutSummaries, 1051)
        XCTAssertEqual(progress.remainingWorkouts, 0)
        XCTAssertEqual(progress.progressFraction, 1)
    }

    func testHistoricalWorkoutImportPresentationUsesClampedWorkoutProgressAndEvidenceCounts() {
        let progress = HistoricalWorkoutImportStatus(
            indexedWorkouts: 1051,
            totalWorkouts: 1051,
            uploadedWorkoutSummaries: 1089,
            uploadedTimeSeriesSamples: 409_262,
            uploadedRoutePoints: 753_342,
            targetHeartRateSamples: 94_782,
            targetTimeSeriesSamples: 409_262,
            targetRoutePoints: 753_342,
            uploadedChunks: 0,
            resumedChunks: 0
        )
        let status = CompanionSyncUploadStatus(
            isSyncing: false,
            syncMode: .historicalWorkoutImport,
            message: nil,
            payloadSummary: nil,
            lastChunkFamily: nil,
            lastPayloadBytes: nil,
            activeSessionId: nil,
            transferStats: nil,
            historicalWorkoutImport: progress
        )

        let presentation = CompanionHistoricalWorkoutImportPresentation(status: status)

        XCTAssertTrue(presentation.progressLabel.contains("1,051/1,051 workouts accounted for"))
        XCTAssertTrue(presentation.compactProgressLabel.contains("1,051/1,051 workouts"))
        XCTAssertTrue(presentation.evidenceLabel.contains("409,262 / 409,262 time-series"))
        XCTAssertTrue(presentation.evidenceLabel.contains("94,782 HR"))
        XCTAssertTrue(presentation.routeLabel.contains("753,342 / 753,342 route points"))
    }

    func testWorkoutRawEvidenceContractUsesCurrentBackendVersion() {
        XCTAssertEqual(
            HealthSyncEvidenceContract.workoutRawEvidenceVersion,
            "healthkit-workout-raw-bulk-v4"
        )
    }

    func testWorkoutStreamingWindowsScanRecentHistoryFirstWithoutOneHugeQuery() {
        let startDate = makeDate("2024-01-01T00:00:00.000Z")
        let endDate = makeDate("2026-05-20T12:00:00.000Z")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let windows = HealthSyncStore.workoutStreamingWindows(
            startDate: startDate,
            endDate: endDate,
            calendar: calendar
        )

        XCTAssertFalse(windows.isEmpty)
        XCTAssertEqual(windows.first?.end, endDate)
        XCTAssertLessThanOrEqual(windows.first?.duration ?? .greatestFiniteMagnitude, 31 * 24 * 60 * 60)
        XCTAssertEqual(windows.last?.start, startDate)
        for index in 1..<windows.count {
            XCTAssertEqual(windows[index - 1].start, windows[index].end)
        }
    }

    func testWorkoutMetricQueryBatchRangesBoundHealthKitFanout() {
        let ranges = HealthSyncStore.workoutMetricQueryBatchRangesForTesting(
            totalCount: 16,
            concurrencyLimit: 4
        )

        XCTAssertEqual(ranges.map(\.count), [4, 4, 4, 4])
        XCTAssertEqual(ranges.first, 0..<4)
        XCTAssertEqual(ranges.last, 12..<16)
        XCTAssertEqual(
            HealthSyncStore.workoutMetricQueryBatchRangesForTesting(
                totalCount: 5,
                concurrencyLimit: 2
            ),
            [0..<2, 2..<4, 4..<5]
        )
        XCTAssertEqual(
            HealthSyncStore.workoutMetricQueryBatchRangesForTesting(
                totalCount: 0,
                concurrencyLimit: 4
            ),
            []
        )
    }

    func testCompanionDebugLogPlainTextExportUsesChronologicalLines() {
        let earlier = CompanionDebugLogEntry(
            id: "log_earlier",
            timestamp: makeDate("2026-04-18T10:00:00.000Z"),
            scope: "MovementLifeTimeline",
            message: "openPlaceLabelDraft item=stay_1 initialQuery=Home",
            level: .info
        )
        let later = CompanionDebugLogEntry(
            id: "log_later",
            timestamp: makeDate("2026-04-18T10:00:05.500Z"),
            scope: "MovementLifeTimeline",
            message: "savePlaceDraft failed item=stay_1 label=Home error=Request timed out",
            level: .error
        )

        let rendered = CompanionDebugLogStore.renderPlainText(entries: [later, earlier])

        XCTAssertTrue(rendered.contains("[INFO][MovementLifeTimeline] openPlaceLabelDraft item=stay_1 initialQuery=Home"))
        XCTAssertTrue(rendered.contains("[ERROR][MovementLifeTimeline] savePlaceDraft failed item=stay_1 label=Home error=Request timed out"))
    }

    func testCompanionDebugLogRedactsCredentialsAcrossCommonDiagnosticFormats() {
        let labeledSecrets = companionRedactDiagnosticMessage(
            #"pairingToken=pair-secret sessionId='pair-session' api_key: abc123 password=hunter2"#
        )
        let requestSecrets = companionRedactDiagnosticMessage(
            "Authorization: Bearer header.payload.signature"
        )
        let querySecrets = companionRedactDiagnosticMessage(
            "GET https://forge.example/pair?pairing_token=query-secret&session-id=query-session"
        )
        let cookieSecrets = companionRedactDiagnosticMessage(
            "Set-Cookie: forge_operator_session=session-cookie; Path=/; HttpOnly"
        )
        let userInfoSecret = companionRedactDiagnosticMessage(
            "https://operator:plain-password@forge.example/api/v1"
        )
        let jwtSecret = companionRedactDiagnosticMessage(
            "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGJlcnQifQ.signaturevalue"
        )
        let activeCheckpoint = companionRedactDiagnosticMessage(
            "discarding active health sync checkpoint session=sync_01J123SECRET chunkingVersion=2 currentChunkingVersion=3 ageSeconds=42 windowAgeSeconds=84"
        )

        for secret in [
            "pair-secret", "pair-session", "abc123", "hunter2",
            "header.payload.signature", "query-secret", "query-session",
            "session-cookie", "plain-password", "eyJhbGciOiJIUzI1NiJ9",
            "sync_01J123SECRET"
        ] {
            XCTAssertFalse(
                [
                    labeledSecrets, requestSecrets, querySecrets, cookieSecrets,
                    userInfoSecret, jwtSecret, activeCheckpoint
                ]
                    .joined(separator: "\n")
                    .contains(secret)
            )
        }
        XCTAssertTrue(labeledSecrets.contains("pairingToken=<redacted>"))
        XCTAssertTrue(requestSecrets.contains("Bearer <redacted>"))
        XCTAssertTrue(querySecrets.contains("pairing_token=<redacted>"))
        XCTAssertTrue(cookieSecrets.contains("Set-Cookie: <redacted>"))
        XCTAssertTrue(userInfoSecret.contains(":<redacted>@"))
        XCTAssertTrue(jwtSecret.contains("<redacted-token>"))
        XCTAssertEqual(
            activeCheckpoint,
            "discarding active health sync checkpoint session=<redacted> chunkingVersion=2 currentChunkingVersion=3 ageSeconds=42 windowAgeSeconds=84"
        )
    }

    func testCompanionDebugLogEntryRedactsLegacyPersistedMessageDuringDecode() throws {
        let data = Data(
            #"{"id":"legacy","timestamp":0,"scope":"Pairing","message":"pairingToken=legacy-secret sessionId=legacy-session","level":"info"}"#.utf8
        )

        let decoded = try JSONDecoder().decode(CompanionDebugLogEntry.self, from: data)

        XCTAssertFalse(decoded.message.contains("legacy-secret"))
        XCTAssertFalse(decoded.message.contains("legacy-session"))
        XCTAssertEqual(
            decoded.message,
            "pairingToken=<redacted> sessionId=<redacted>"
        )
    }

    func testCompanionDebugLogPrunesRegularLogsBeforeErrors() {
        let pruned = CompanionDebugLogStore.prunedEntries(
            entries: [
                CompanionDebugLogEntry(
                    id: "regular_old",
                    timestamp: makeDate("2026-04-17T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync start trigger=manual",
                    level: .info
                ),
                CompanionDebugLogEntry(
                    id: "error_old",
                    timestamp: makeDate("2026-04-12T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync failed trigger=manual error=timeout",
                    level: .error
                ),
                CompanionDebugLogEntry(
                    id: "error_recent",
                    timestamp: makeDate("2026-04-18T10:00:00.000Z"),
                    scope: "CompanionAppModel",
                    message: "performSync failed trigger=manual error=timeout",
                    level: .error
                )
            ],
            settings: .init(regularDays: 1, errorDays: 10),
            referenceDate: makeDate("2026-04-19T12:00:00.000Z")
        )

        XCTAssertEqual(pruned.map(\.id), ["error_old", "error_recent"])
    }

    func testWorkoutActivityDescriptorNormalizesKnownAppleHealthCodes() async {
        let store = HealthSyncStore()

        let descriptor = await store.workoutActivityDescriptor(for: 52)

        XCTAssertEqual(descriptor.sourceSystem, "apple_health")
        XCTAssertEqual(descriptor.providerActivityType, "hk_workout_activity_type")
        XCTAssertEqual(descriptor.providerRawValue, 52)
        XCTAssertEqual(descriptor.canonicalKey, "walking")
        XCTAssertEqual(descriptor.canonicalLabel, "Walking")
        XCTAssertEqual(descriptor.familyKey, "cardio")
        XCTAssertEqual(descriptor.familyLabel, "Cardio")
        XCTAssertFalse(descriptor.isFallback)
    }

    func testWorkoutActivityDescriptorFallsBackForUnknownAppleHealthCodes() async {
        let store = HealthSyncStore()

        let descriptor = await store.workoutActivityDescriptor(for: 9999)

        XCTAssertEqual(descriptor.providerRawValue, 9999)
        XCTAssertEqual(descriptor.canonicalKey, "activity_9999")
        XCTAssertEqual(descriptor.canonicalLabel, "Activity 9999")
        XCTAssertEqual(descriptor.familyKey, "other")
        XCTAssertEqual(descriptor.familyLabel, "Other")
        XCTAssertTrue(descriptor.isFallback)
    }

    func testSafeDoubleValueReturnsNilForIncompatibleQuantityUnits() {
        let store = HealthSyncStore()
        let quantity = HKQuantity(unit: .second(), doubleValue: 30)

        let value = store.safeDoubleValue(
            quantity,
            for: .meter(),
            context: "test.incompatible_quantity"
        )

        XCTAssertNil(value)
    }

    func testSafeDoubleValueConvertsCompatibleQuantityUnits() {
        let store = HealthSyncStore()
        let quantity = HKQuantity(unit: HKUnit.meterUnit(with: .kilo), doubleValue: 1.5)

        let value = store.safeDoubleValue(
            quantity,
            for: .meter(),
            context: "test.compatible_quantity"
        )

        XCTAssertNotNil(value)
        XCTAssertEqual(value ?? 0, 1500, accuracy: 0.001)
    }

    func testWorkoutDetailsEncodesMetricsEventsAndComponents() throws {
        let payload = CompanionSyncPayload.WorkoutDetails(
            sourceSystem: "apple_health",
            metrics: [
                .init(
                    key: "average_speed",
                    label: "Average speed",
                    category: "cardio",
                    unit: "km/h",
                    statistic: "average",
                    value: .number(5.1),
                    startedAt: nil,
                    endedAt: nil
                )
            ],
            events: [
                .init(
                    type: "pause",
                    label: "Pause",
                    startedAt: "2026-04-07T07:33:00.000Z",
                    endedAt: "2026-04-07T07:35:00.000Z",
                    durationSeconds: 120,
                    metadata: [:]
                )
            ],
            components: [
                .init(
                    externalUid: "component_1",
                    startedAt: "2026-04-07T07:50:00.000Z",
                    endedAt: "2026-04-07T08:00:00.000Z",
                    durationSeconds: 600,
                    activity: .init(
                        sourceSystem: "apple_health",
                        providerActivityType: "hk_workout_activity_type",
                        providerRawValue: 80,
                        canonicalKey: "cooldown",
                        canonicalLabel: "Cooldown",
                        familyKey: "mobility",
                        familyLabel: "Mobility",
                        isFallback: false
                    ),
                    metrics: [],
                    metadata: [:]
                )
            ],
            metadata: [
                "indoorWorkout": .boolean(false)
            ]
        )

        let encoded = try JSONEncoder().encode(payload)
        let rendered = try XCTUnwrap(String(data: encoded, encoding: .utf8))

        XCTAssertTrue(rendered.contains("\"average_speed\""))
        XCTAssertTrue(rendered.contains("\"pause\""))
        XCTAssertTrue(rendered.contains("\"Cooldown\""))
    }

    private func makeLocation(
        latitude: Double,
        longitude: Double,
        timestamp: Date
    ) -> CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
            altitude: 0,
            horizontalAccuracy: 8,
            verticalAccuracy: 8,
            course: 0,
            speed: 0,
            timestamp: timestamp
        )
    }

    private func makeDisplayItem(
        id: String,
        kind: MovementLifeTimelineItem.Kind,
        title: String,
        placeLabel: String?,
        startedAt: Date,
        endedAt: Date,
        durationSeconds: Int? = nil,
        distanceMeters: Double? = nil,
        origin: MovementLifeTimelineItem.Origin,
        isCurrent: Bool = false
    ) -> MovementLifeTimelineItem {
        MovementLifeTimelineItem(
            id: id,
            source: .derived(id),
            kind: kind,
            title: title,
            subtitle: "",
            placeLabel: placeLabel,
            tags: [],
            syncSource: "test",
            startedAtDate: startedAt,
            endedAtDate: endedAt,
            durationSeconds: durationSeconds ?? max(60, Int(endedAt.timeIntervalSince(startedAt))),
            laneSide: kind == .trip ? .right : .left,
            connectorFromLane: kind == .trip ? .right : .left,
            connectorToLane: kind == .trip ? .right : .left,
            distanceMeters: distanceMeters,
            averageSpeedMps: nil,
            origin: origin,
            editable: origin == .recorded,
            isCurrent: isCurrent
        )
    }

    func testWatchPhoneHandoffDeliversPersistedIrohDestinationExactlyOnce() throws {
        let (defaults, suiteName) = makeWatchHandoffDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let now = Date()
        let pairing = makeWatchHandoffPairing()
        let request = try XCTUnwrap(
            ForgeWatchPhoneHandoffRequest(
                id: "handoff-once",
                createdAt: ISO8601DateFormatter().string(from: now),
                destination: .goal("goal-42")
            )
        )
        let firstManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { true }
        )
        firstManager.configure { pairing }

        let response = firstManager.handlePhoneHandoffRequestForTesting(request, now: now)

        XCTAssertEqual(response?.status, .ready)
        XCTAssertEqual(
            firstManager.pendingPhoneHandoffURL?.absoluteString,
            "forge-iroh://paired-node/forge/goals/goal-42"
        )

        let relaunchedManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { true }
        )
        relaunchedManager.configure { pairing }
        XCTAssertEqual(
            relaunchedManager.consumePendingPhoneHandoffURL()?.absoluteString,
            "forge-iroh://paired-node/forge/goals/goal-42"
        )
        XCTAssertNil(relaunchedManager.consumePendingPhoneHandoffURL())
    }

    func testWatchPhoneHandoffSuppressesRepeatedAndStaleRequests() throws {
        let (defaults, suiteName) = makeWatchHandoffDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let now = Date()
        let pairing = makeWatchHandoffPairing()
        let request = try XCTUnwrap(
            ForgeWatchPhoneHandoffRequest(
                id: "handoff-repeat",
                createdAt: ISO8601DateFormatter().string(from: now),
                destination: .today
            )
        )
        let firstManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { true }
        )
        firstManager.configure { pairing }
        XCTAssertEqual(
            firstManager.handlePhoneHandoffRequestForTesting(request, now: now)?.status,
            .ready
        )
        XCTAssertNotNil(firstManager.consumePendingPhoneHandoffURL())

        let relaunchedManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { true }
        )
        relaunchedManager.configure { pairing }
        XCTAssertEqual(
            relaunchedManager.handlePhoneHandoffRequestForTesting(
                request,
                now: now.addingTimeInterval(1)
            )?.status,
            .ready
        )
        XCTAssertNil(relaunchedManager.pendingPhoneHandoffURL)

        let staleRequest = try XCTUnwrap(
            ForgeWatchPhoneHandoffRequest(
                id: "handoff-stale",
                createdAt: ISO8601DateFormatter().string(
                    from: now.addingTimeInterval(-ForgeWatchPhoneHandoffDeliveryPolicy.maximumRequestAge - 1)
                ),
                destination: .goals
            )
        )
        XCTAssertEqual(
            relaunchedManager.handlePhoneHandoffRequestForTesting(staleRequest, now: now)?.status,
            .unavailable
        )
        XCTAssertNil(relaunchedManager.pendingPhoneHandoffURL)
    }

    func testWatchPhoneHandoffRetriesAfterUnavailableOrUnpairedTransport() throws {
        let now = Date()
        let pairing = makeWatchHandoffPairing()
        let request = try XCTUnwrap(
            ForgeWatchPhoneHandoffRequest(
                id: "handoff-retry",
                createdAt: ISO8601DateFormatter().string(from: now),
                destination: .task("task-7")
            )
        )

        let (unpairedDefaults, unpairedSuite) = makeWatchHandoffDefaults()
        defer { unpairedDefaults.removePersistentDomain(forName: unpairedSuite) }
        let unpairedManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: unpairedDefaults,
            phoneHandoffTransportAvailable: { false }
        )
        unpairedManager.configure { pairing }
        XCTAssertEqual(
            unpairedManager.handlePhoneHandoffRequestForTesting(request, now: now)?.status,
            .unavailable
        )
        XCTAssertNil(unpairedManager.pendingPhoneHandoffURL)

        let (unavailableDefaults, unavailableSuite) = makeWatchHandoffDefaults()
        defer { unavailableDefaults.removePersistentDomain(forName: unavailableSuite) }
        var availablePairing: PairingPayload?
        let unavailableManager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: unavailableDefaults,
            phoneHandoffTransportAvailable: { true }
        )
        unavailableManager.configure { availablePairing }
        XCTAssertEqual(
            unavailableManager.handlePhoneHandoffRequestForTesting(request, now: now)?.status,
            .unavailable
        )
        availablePairing = pairing
        XCTAssertEqual(
            unavailableManager.handlePhoneHandoffRequestForTesting(
                request,
                now: now.addingTimeInterval(1)
            )?.status,
            .ready
        )
        XCTAssertEqual(
            unavailableManager.consumePendingPhoneHandoffURL()?.absoluteString,
            "forge-iroh://paired-node/forge/tasks/task-7"
        )
    }

    func testWatchPhoneHandoffURLPolicyCannotBypassPairedForgeOriginOrDownloads() throws {
        let pairedBaseURL = try XCTUnwrap(URL(string: "forge-iroh://paired-node/forge/"))
        XCTAssertEqual(
            CompanionWatchHandoffURLPolicy.navigationURL(
                pendingURL: URL(string: "forge-iroh://paired-node/forge/projects/project-1"),
                pairedBaseURL: pairedBaseURL
            )?.absoluteString,
            "forge-iroh://paired-node/forge/projects/project-1"
        )

        for blockedValue in [
            "forge-iroh://other-node/forge/goals",
            "https://paired-node/forge/goals",
            "forge-iroh://user:secret@paired-node/forge/goals",
            "forge-iroh://paired-node/forge/goals?download=1",
            "forge-iroh://paired-node/forge/goals#outside",
            "forge-iroh://paired-node/admin",
            "forge-iroh://paired-node/forge/%2E%2E/admin"
        ] {
            XCTAssertNil(
                CompanionWatchHandoffURLPolicy.navigationURL(
                    pendingURL: URL(string: blockedValue),
                    pairedBaseURL: pairedBaseURL
                ),
                "Unexpectedly accepted \(blockedValue)"
            )
        }

        XCTAssertEqual(
            ForgeWebNavigationPolicy.disposition(
                for: try XCTUnwrap(URL(string: "https://external.example/export.zip")),
                relativeTo: pairedBaseURL,
                isUserActivated: false,
                isPrimaryNavigation: true,
                shouldPerformDownload: true
            ),
            .cancel
        )
    }

    func testPeerNativeRouteInventoryContainsOnlyExecutableCompanionContracts() {
        let actual = Set(PeerAPIRoute.allCases.map { "\($0.method.rawValue) \($0.pathTemplate)" })
        let expected: Set<String> = [
            "GET /api/v1/peers/human-presence",
            "POST /api/v1/peers/human-presence/options",
            "POST /api/v1/peers/human-presence/verify",
            "POST /api/v1/peers/invitations",
            "GET /api/v1/peers/invitations/:invitationId",
            "DELETE /api/v1/peers/invitations/:invitationId",
            "POST /api/v1/peers/pairings/accept",
            "POST /api/v1/peers/pairings/:pairingId/confirm",
            "GET /api/v1/peers/requests",
            "POST /api/v1/peers/requests/:requestId/accept",
            "POST /api/v1/peers/requests/:requestId/reject",
            "GET /api/v1/peers/relationships",
            "GET /api/v1/peers/relationships/:relationshipId",
            "POST /api/v1/peers/relationships/:relationshipId/revoke",
            "GET /api/v1/peers/relationships/:relationshipId/devices",
            "POST /api/v1/peers/relationships/:relationshipId/devices/:deviceId/approve",
            "POST /api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove",
            "GET /api/v1/peers/relationships/:relationshipId/grants",
            "POST /api/v1/peers/relationships/:relationshipId/grants/preview",
            "POST /api/v1/peers/relationships/:relationshipId/grants/propose",
            "POST /api/v1/peers/grants/:grantId/accept",
            "POST /api/v1/peers/grants/:grantId/counter",
            "POST /api/v1/peers/grants/:grantId/revoke",
            "GET /api/v1/peers/relationships/:relationshipId/sync",
            "POST /api/v1/peers/relationships/:relationshipId/resync",
            "GET /api/v1/peers/relationships/:relationshipId/diagnostics"
        ]

        XCTAssertEqual(PeerAPIRoute.allCases.count, 26)
        XCTAssertEqual(actual, expected)
        XCTAssertTrue(actual.allSatisfy { $0.contains("/api/v1/peers/") })
        XCTAssertFalse(actual.contains { $0.contains("/api/v1/people") })
        XCTAssertEqual(
            try PeerAPIRoute.getPeerRelationship.resolvedPath(parameters: ["relationshipId": "../other"]),
            "/api/v1/peers/relationships/..%2Fother"
        )
    }

    func testPeerSwiftRequestProofBindsExactMethodPathBodySessionAndDevice() async throws {
        let identityStore = makePeerIdentityStore()
        let transport = PeerTestTransport(steps: [
            .response(
                peerJSONResponse(
                    #"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            )
        ])
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )

        _ = try await client.listRelationships(pairing: makePeerPairing())
        let request = try XCTUnwrap(transport.requests.first)
        let signatureText = try XCTUnwrap(
            request.headers["X-Forge-Companion-Request-Signature"]
        )
        let nonce = try XCTUnwrap(
            request.headers["X-Forge-Companion-Request-Nonce"]
        )
        let issuedAt = try XCTUnwrap(
            request.headers["X-Forge-Companion-Request-Issued-At"]
        )
        let identity = try identityStore.identity()
        let proof = PeerTestRequestSignatureProof(
            bodySha256: SHA256.hash(data: Data())
                .map { String(format: "%02x", $0) }
                .joined(),
            deviceId: identity.deviceId,
            enrollmentId: "enrollment-test",
            issuedAt: issuedAt,
            keyId: "key-test",
            method: "GET",
            nonce: nonce,
            ownerUserId: "owner-local",
            path: request.requestTarget,
            protocolName: PeerCompanionSecurityContract.requestProtocol,
            sessionId: makePeerPairing().sessionId
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let proofData = try encoder.encode(proof)
        let publicKey = try P256.Signing.PublicKey(
            x963Representation: try XCTUnwrap(PeerBase64URL.decode(identity.publicKey))
        )
        let signature = try P256.Signing.ECDSASignature(
            derRepresentation: try XCTUnwrap(PeerBase64URL.decode(signatureText))
        )

        XCTAssertEqual(
            request.requestTarget,
            "/api/v1/peers/relationships?limit=100"
        )
        XCTAssertEqual(request.headers["X-Forge-Companion-Session-Id"], "pair-peer-tests")
        XCTAssertEqual(request.headers["X-Forge-Companion-Device-Id"], identity.deviceId)
        XCTAssertEqual(request.headers["X-Forge-Companion-Enrollment-Id"], "enrollment-test")
        XCTAssertEqual(request.headers["X-Forge-Companion-Key-Id"], "key-test")
        XCTAssertNil(request.headers["X-Forge-Companion-Pairing-Token"])
        XCTAssertNil(request.headers["X-Forge-Companion-Public-Key"])
        XCTAssertEqual(nonce.count, 32)
        XCTAssertTrue(publicKey.isValidSignature(signature, for: proofData))
        XCTAssertFalse(request.requestTarget.contains(makePeerPairing().pairingToken))

        let tampered = PeerTestRequestSignatureProof(
            bodySha256: String(repeating: "0", count: 64),
            deviceId: identity.deviceId,
            enrollmentId: "enrollment-test",
            issuedAt: issuedAt,
            keyId: "key-test",
            method: "POST",
            nonce: nonce,
            ownerUserId: "owner-local",
            path: "/api/v1/peers/relationships/tampered",
            protocolName: PeerCompanionSecurityContract.requestProtocol,
            sessionId: makePeerPairing().sessionId
        )
        XCTAssertFalse(
            publicKey.isValidSignature(signature, for: try encoder.encode(tampered))
        )
    }

    func testPeerV2CanonicalWireUsesP256AndIgnoresLegacyEd25519Material() throws {
        let secrets = PeerMemorySecretStore()
        secrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: "forge_peer_device_ed25519_private_key_v1"
        )
        var privateScalar = Data(repeating: 0, count: 31)
        privateScalar.append(1)
        let keys = PeerTestDeviceKeyOperations(
            privateKey: try P256.Signing.PrivateKey(rawRepresentation: privateScalar)
        )
        let identityStore = makePeerIdentityStore(keys: keys, legacySecrets: secrets)
        let identity = try identityStore.identity()
        let proof = PeerTestRequestSignatureProof(
            bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            deviceId: identity.deviceId,
            enrollmentId: "enrollment-wire-fixture",
            issuedAt: "2026-07-15T12:00:00Z",
            keyId: "key-wire-fixture",
            method: "GET",
            nonce: "0123456789abcdef0123456789abcdef",
            ownerUserId: "owner-wire-fixture",
            path: "/api/v1/peers/relationships?limit=100",
            protocolName: PeerCompanionSecurityContract.requestProtocol,
            sessionId: "pair-swift-wire-fixture"
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let canonical = try encoder.encode(proof)

        XCTAssertEqual(
            String(decoding: canonical, as: UTF8.self),
            #"{"bodySha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","deviceId":"\#(identity.deviceId)","enrollmentId":"enrollment-wire-fixture","issuedAt":"2026-07-15T12:00:00Z","keyId":"key-wire-fixture","method":"GET","nonce":"0123456789abcdef0123456789abcdef","ownerUserId":"owner-wire-fixture","path":"/api/v1/peers/relationships?limit=100","protocol":"forge-peer-companion-request/v2","sessionId":"pair-swift-wire-fixture"}"#
        )
        XCTAssertEqual(identity.algorithm, "ES256")
        XCTAssertEqual(identity.publicKeyFormat, "ansi-x963")
        XCTAssertEqual(identity.protection, "secure-enclave-user-presence")
        let publicKey = try P256.Signing.PublicKey(
            x963Representation: try XCTUnwrap(PeerBase64URL.decode(identity.publicKey))
        )
        let signature = try P256.Signing.ECDSASignature(
            derRepresentation: try XCTUnwrap(PeerBase64URL.decode(
                try identityStore.sign(data: canonical, reason: "Test user presence")
            ))
        )
        XCTAssertTrue(publicKey.isValidSignature(signature, for: canonical))
        XCTAssertNotEqual(secrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey), nil)
    }

    func testPeerStolenLegacyBootstrapCannotAuthenticateOrImplicitlyEnroll() async throws {
        let stolenToken = "stolen-legacy-bootstrap-token"
        let pairing = makePeerPairing(pairingToken: stolenToken)
        let legacySecrets = PeerMemorySecretStore()
        legacySecrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey
        )
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let enrollmentSecrets = PeerMemorySecretStore()
        let enrollmentVault = PeerCompanionEnrollmentVault(secrets: enrollmentSecrets)
        let transport = PeerTestTransport()
        let client = PeerAPIClient(
            transport: transport,
            identityStore: makePeerIdentityStore(
                keys: keys,
                legacySecrets: legacySecrets
            ),
            enrollmentVault: enrollmentVault
        )

        do {
            _ = try await client.listRelationships(pairing: pairing)
            XCTFail("A legacy bootstrap token must not authenticate People")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .secureEnrollmentRequired)
        }

        let context = PeerCompanionEnrollmentContext(
            sessionId: pairing.sessionId,
            ownerUserId: "owner-local",
            apiBaseURL: pairing.apiBaseUrl
        )
        XCTAssertTrue(transport.requests.isEmpty)
        XCTAssertEqual(keys.createCount, 0)
        XCTAssertEqual(keys.signCount, 0)
        XCTAssertNil(try enrollmentVault.pending(context: context))
        XCTAssertNil(try enrollmentVault.receipt(context: context))
        XCTAssertNotNil(
            legacySecrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey)
        )
        XCTAssertFalse(enrollmentSecrets.values.values.contains { data in
            String(decoding: data, as: UTF8.self).contains(stolenToken)
        })
    }

    @MainActor
    func testPeerUpgradedSessionAttackerFirstEnrollmentFailsWithoutHumanOperatorSession() async throws {
        let pairing = makePeerPairing(pairingToken: "stolen-upgraded-session-token")
        let legacySecrets = PeerMemorySecretStore()
        legacySecrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey
        )
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let identityStore = makePeerIdentityStore(
            keys: keys,
            legacySecrets: legacySecrets
        )
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let companionTransport = PeerTestTransport(steps: [
            .response(peerJSONResponse(#"{"enrolled":true}"#))
        ])
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .failure(PeopleWatchPinError.operatorSessionRequired)
        ])
        let client = PeerAPIClient(
            transport: companionTransport,
            identityStore: identityStore,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: operatorTransport
        )

        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: "owner-local"
            )
            XCTFail("A paired session alone must not enroll the first caller's key")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .operatorSessionRequired)
        }

        XCTAssertTrue(companionTransport.requests.isEmpty)
        XCTAssertEqual(operatorTransport.requests.count, 1)
        let optionsBody = try XCTUnwrap(operatorTransport.requests.first?.body)
        let options = try JSONDecoder().decode(
            PeerTestEnrollmentOptionsBody.self,
            from: optionsBody
        )
        XCTAssertEqual(options.device.algorithm, "ES256")
        XCTAssertEqual(options.device.publicKeyFormat, "ansi-x963")
        XCTAssertEqual(options.device.protection, "secure-enclave-user-presence")
        XCTAssertFalse(String(decoding: optionsBody, as: UTF8.self).contains(pairing.pairingToken))
        XCTAssertEqual(keys.createCount, 1)
        XCTAssertEqual(keys.signCount, 0)
        XCTAssertNil(try enrollmentVault.receipt(
            context: PeerCompanionEnrollmentContext(
                sessionId: pairing.sessionId,
                ownerUserId: "owner-local",
                apiBaseURL: pairing.apiBaseUrl
            )
        ))
        XCTAssertNotNil(
            legacySecrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey)
        )
    }

    @MainActor
    func testPeerExplicitEnrollmentUsesOperatorSessionP256PresenceProofAndRetiresLegacy() async throws {
        let pairing = makePeerPairing(pairingToken: "legacy-token-must-never-cross-wire")
        let legacySecrets = PeerMemorySecretStore()
        legacySecrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey
        )
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let identityStore = makePeerIdentityStore(
            keys: keys,
            legacySecrets: legacySecrets
        )
        let enrollmentSecrets = PeerMemorySecretStore()
        let enrollmentVault = PeerCompanionEnrollmentVault(secrets: enrollmentSecrets)
        let regularTransport = PeerTestTransport()
        let context = PeerCompanionEnrollmentContext(
            sessionId: pairing.sessionId,
            ownerUserId: "owner-local",
            apiBaseURL: pairing.apiBaseUrl
        )
        var issuedChallenge: PeerTestEnrollmentChallenge?
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .handler { request in
                XCTAssertEqual(request.method, "POST")
                XCTAssertEqual(
                    request.requestTarget,
                    PeerCompanionSecurityContract.enrollmentOptionsPath
                )
                XCTAssertNil(request.headers["X-Forge-Companion-Pairing-Token"])
                let body = try XCTUnwrap(request.body)
                let bodyText = String(decoding: body, as: UTF8.self)
                XCTAssertFalse(bodyText.contains(pairing.pairingToken))
                XCTAssertFalse(bodyText.contains("authenticatedAt"))
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: body
                )
                XCTAssertEqual(
                    options.protocolName,
                    PeerCompanionSecurityContract.enrollmentProtocol
                )
                XCTAssertEqual(options.pairingSessionId, pairing.sessionId)
                XCTAssertEqual(options.device.algorithm, "ES256")
                XCTAssertEqual(options.device.publicKeyFormat, "ansi-x963")
                XCTAssertEqual(
                    options.device.protection,
                    "secure-enclave-user-presence"
                )
                XCTAssertEqual(
                    try enrollmentVault.pending(context: context)?.attemptId,
                    options.enrollmentAttemptId
                )

                let now = Date()
                let challenge = PeerTestEnrollmentChallenge(
                    protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                    challengeId: "enrollment-challenge-success",
                    challenge: String(repeating: "E", count: 43),
                    enrollmentAttemptId: options.enrollmentAttemptId,
                    pairingSessionId: options.pairingSessionId,
                    ownerUserId: "owner-local",
                    device: options.device,
                    issuedAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(-1)
                    ),
                    expiresAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(120)
                    )
                )
                issuedChallenge = challenge
                return PeopleWatchOperatorResponse(
                    statusCode: 200,
                    data: try JSONEncoder().encode(challenge)
                )
            },
            .handler { request in
                XCTAssertEqual(
                    request.requestTarget,
                    PeerCompanionSecurityContract.enrollmentVerifyPath
                )
                XCTAssertNil(request.headers["X-Forge-Companion-Pairing-Token"])
                let body = try XCTUnwrap(request.body)
                let bodyText = String(decoding: body, as: UTF8.self)
                XCTAssertFalse(bodyText.contains(pairing.pairingToken))
                XCTAssertFalse(bodyText.contains("authenticatedAt"))
                XCTAssertFalse(bodyText.contains("publicKey"))
                XCTAssertFalse(bodyText.contains("device"))
                let verification = try JSONDecoder().decode(
                    PeerTestEnrollmentVerifyBody.self,
                    from: body
                )
                let challenge = try XCTUnwrap(issuedChallenge)
                XCTAssertEqual(
                    verification.protocolName,
                    PeerCompanionSecurityContract.enrollmentProtocol
                )
                XCTAssertEqual(verification.challengeId, challenge.challengeId)
                XCTAssertEqual(
                    verification.enrollmentAttemptId,
                    challenge.enrollmentAttemptId
                )
                XCTAssertEqual(verification.pairingSessionId, pairing.sessionId)

                let proof = PeerTestEnrollmentProof(
                    algorithm: challenge.device.algorithm,
                    challenge: challenge.challenge,
                    challengeId: challenge.challengeId,
                    deviceId: challenge.device.deviceId,
                    enrollmentAttemptId: challenge.enrollmentAttemptId,
                    expiresAt: challenge.expiresAt,
                    issuedAt: challenge.issuedAt,
                    ownerUserId: challenge.ownerUserId,
                    pairingSessionId: challenge.pairingSessionId,
                    protocolName: challenge.protocolName,
                    publicKey: challenge.device.publicKey,
                    publicKeyFormat: challenge.device.publicKeyFormat,
                    protection: challenge.device.protection
                )
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                let publicKey = try P256.Signing.PublicKey(
                    x963Representation: try XCTUnwrap(
                        PeerBase64URL.decode(challenge.device.publicKey)
                    )
                )
                let signature = try P256.Signing.ECDSASignature(
                    derRepresentation: try XCTUnwrap(
                        PeerBase64URL.decode(verification.signature)
                    )
                )
                XCTAssertTrue(
                    publicKey.isValidSignature(signature, for: try encoder.encode(proof))
                )

                let receipt = self.makePeerEnrollmentReceipt(
                    identity: challenge.device.identity,
                    pairing: pairing
                )
                return PeopleWatchOperatorResponse(
                    statusCode: 201,
                    data: try JSONEncoder().encode(receipt)
                )
            }
        ])
        let client = PeerAPIClient(
            transport: regularTransport,
            identityStore: identityStore,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: operatorTransport
        )

        let receipt = try await client.enrollCompanion(
            pairing: pairing,
            ownerUserId: "owner-local"
        )

        XCTAssertEqual(receipt.identity.identity, try identityStore.identity())
        XCTAssertEqual(keys.createCount, 1)
        XCTAssertEqual(keys.signCount, 1)
        XCTAssertEqual(
            keys.authorizations,
            [.userPresence(reason: "Enroll this iPhone for Forge People")]
        )
        XCTAssertTrue(regularTransport.requests.isEmpty)
        XCTAssertEqual(operatorTransport.requests.map(\.requestTarget), [
            PeerCompanionSecurityContract.enrollmentOptionsPath,
            PeerCompanionSecurityContract.enrollmentVerifyPath
        ])
        XCTAssertNil(try enrollmentVault.pending(context: context))
        XCTAssertEqual(try enrollmentVault.receipt(context: context), receipt)
        XCTAssertNil(
            legacySecrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey)
        )
    }

    @MainActor
    func testPeerLiveOperatorEnrollmentUsesAuthenticatedCookieAndExactV2Wire() async throws {
        PeopleWatchURLProtocol.reset()
        defer { PeopleWatchURLProtocol.reset() }

        let pairing = makePeerPairing(pairingToken: "stolen-token-not-operator-proof")
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let identityStore = makePeerIdentityStore(keys: keys)
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let state = PeerTestEnrollmentState()
        PeopleWatchURLProtocol.handler = { request in
            let body = try XCTUnwrap(PeopleWatchURLProtocol.bodies.last ?? nil)
            switch request.url?.path {
            case PeerCompanionSecurityContract.enrollmentOptionsPath:
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: body
                )
                let now = Date()
                let challenge = PeerTestEnrollmentChallenge(
                    protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                    challengeId: "live-enrollment-challenge",
                    challenge: String(repeating: "L", count: 43),
                    enrollmentAttemptId: options.enrollmentAttemptId,
                    pairingSessionId: options.pairingSessionId,
                    ownerUserId: "owner-local",
                    device: options.device,
                    issuedAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(-1)
                    ),
                    expiresAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(120)
                    )
                )
                state.store(challenge)
                return (200, try JSONEncoder().encode(challenge))

            case PeerCompanionSecurityContract.enrollmentVerifyPath:
                let verification = try JSONDecoder().decode(
                    PeerTestEnrollmentVerifyBody.self,
                    from: body
                )
                let challenge = try XCTUnwrap(state.challenge())
                let proof = PeerTestEnrollmentProof(
                    algorithm: challenge.device.algorithm,
                    challenge: challenge.challenge,
                    challengeId: challenge.challengeId,
                    deviceId: challenge.device.deviceId,
                    enrollmentAttemptId: challenge.enrollmentAttemptId,
                    expiresAt: challenge.expiresAt,
                    issuedAt: challenge.issuedAt,
                    ownerUserId: challenge.ownerUserId,
                    pairingSessionId: challenge.pairingSessionId,
                    protocolName: challenge.protocolName,
                    publicKey: challenge.device.publicKey,
                    publicKeyFormat: challenge.device.publicKeyFormat,
                    protection: challenge.device.protection
                )
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                let signature = try P256.Signing.ECDSASignature(
                    derRepresentation: try XCTUnwrap(
                        PeerBase64URL.decode(verification.signature)
                    )
                )
                let publicKey = try P256.Signing.PublicKey(
                    x963Representation: try XCTUnwrap(
                        PeerBase64URL.decode(challenge.device.publicKey)
                    )
                )
                guard publicKey.isValidSignature(
                    signature,
                    for: try encoder.encode(proof)
                ) else {
                    throw PeerAPIError.invalidResponse
                }
                return (
                    201,
                    try JSONEncoder().encode(self.makePeerEnrollmentReceipt(
                        identity: challenge.device.identity,
                        pairing: pairing
                    ))
                )

            default:
                return (404, Data(#"{"code":"not_found"}"#.utf8))
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.protocolClasses = [PeopleWatchURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let dataStore = WKWebsiteDataStore.nonPersistent()
        let cookieStore = dataStore.httpCookieStore
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "forge.example",
            .path: "/",
            .name: "forge_session",
            .value: "authenticated-human-session",
            .secure: "TRUE",
            .expires: Date().addingTimeInterval(300)
        ]))
        await withCheckedContinuation { continuation in
            cookieStore.setCookie(cookie) { continuation.resume() }
        }

        let regularTransport = PeerTestTransport()
        let client = PeerAPIClient(
            transport: regularTransport,
            identityStore: identityStore,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: LivePeopleWatchOperatorTransport(
                session: session,
                cookieStore: cookieStore
            )
        )
        _ = try await client.enrollCompanion(
            pairing: pairing,
            ownerUserId: "owner-local"
        )

        XCTAssertTrue(regularTransport.requests.isEmpty)
        XCTAssertEqual(PeopleWatchURLProtocol.requests.map { $0.url?.path }, [
            PeerCompanionSecurityContract.enrollmentOptionsPath,
            PeerCompanionSecurityContract.enrollmentVerifyPath
        ])
        XCTAssertEqual(PeopleWatchURLProtocol.bodies.count, 2)
        for request in PeopleWatchURLProtocol.requests {
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Cookie"),
                "forge_session=authenticated-human-session"
            )
            XCTAssertNil(
                request.value(forHTTPHeaderField: "X-Forge-Companion-Pairing-Token")
            )
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        }
        for body in PeopleWatchURLProtocol.bodies.compactMap({ $0 }) {
            let text = String(decoding: body, as: UTF8.self)
            XCTAssertFalse(text.contains(pairing.pairingToken))
            XCTAssertFalse(text.contains("authenticatedAt"))
        }
        let verifyText = String(
            decoding: try XCTUnwrap(PeopleWatchURLProtocol.bodies[1]),
            as: UTF8.self
        )
        XCTAssertFalse(verifyText.contains("publicKey"))
        XCTAssertFalse(verifyText.contains("device"))
        XCTAssertEqual(keys.signCount, 1)
        withExtendedLifetime(dataStore) {}
    }

    @MainActor
    func testPeerEnrollmentUserPresenceCancellationFailsClosed() async throws {
        let pairing = makePeerPairing()
        let legacySecrets = PeerMemorySecretStore()
        legacySecrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey
        )
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        keys.signingError = .userPresenceCancelled
        let identityStore = makePeerIdentityStore(
            keys: keys,
            legacySecrets: legacySecrets
        )
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let context = PeerCompanionEnrollmentContext(
            sessionId: pairing.sessionId,
            ownerUserId: "owner-local",
            apiBaseURL: pairing.apiBaseUrl
        )
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .handler { request in
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let now = Date()
                return PeopleWatchOperatorResponse(
                    statusCode: 200,
                    data: try JSONEncoder().encode(PeerTestEnrollmentChallenge(
                        protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                        challengeId: "enrollment-challenge-cancel",
                        challenge: String(repeating: "C", count: 43),
                        enrollmentAttemptId: options.enrollmentAttemptId,
                        pairingSessionId: options.pairingSessionId,
                        ownerUserId: "owner-local",
                        device: options.device,
                        issuedAt: ISO8601DateFormatter().string(from: now),
                        expiresAt: ISO8601DateFormatter().string(
                            from: now.addingTimeInterval(120)
                        )
                    ))
                )
            }
        ])
        let client = PeerAPIClient(
            transport: PeerTestTransport(),
            identityStore: identityStore,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: operatorTransport
        )

        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: "owner-local"
            )
            XCTFail("Cancellation must not enroll the key")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .localAuthentication(.cancelled))
        }

        XCTAssertEqual(operatorTransport.requests.count, 1)
        XCTAssertEqual(keys.signCount, 1)
        XCTAssertNotNil(try enrollmentVault.pending(context: context))
        XCTAssertNil(try enrollmentVault.receipt(context: context))
        XCTAssertNotNil(
            legacySecrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey)
        )
    }

    @MainActor
    func testPeerEnrollmentRejectsExpiredChallengeBeforeUserPresence() async throws {
        let pairing = makePeerPairing()
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .handler { request in
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let now = Date()
                return PeopleWatchOperatorResponse(
                    statusCode: 200,
                    data: try JSONEncoder().encode(PeerTestEnrollmentChallenge(
                        protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                        challengeId: "expired-enrollment-challenge",
                        challenge: String(repeating: "X", count: 43),
                        enrollmentAttemptId: options.enrollmentAttemptId,
                        pairingSessionId: options.pairingSessionId,
                        ownerUserId: "owner-local",
                        device: options.device,
                        issuedAt: ISO8601DateFormatter().string(
                            from: now.addingTimeInterval(-120)
                        ),
                        expiresAt: ISO8601DateFormatter().string(
                            from: now.addingTimeInterval(-1)
                        )
                    ))
                )
            }
        ])
        let client = PeerAPIClient(
            transport: PeerTestTransport(),
            identityStore: makePeerIdentityStore(keys: keys),
            enrollmentVault: enrollmentVault,
            enrollmentTransport: operatorTransport
        )

        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: "owner-local"
            )
            XCTFail("An expired enrollment challenge must fail closed")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .invalidResponse)
        }
        XCTAssertEqual(operatorTransport.requests.count, 1)
        XCTAssertEqual(keys.signCount, 0)
        XCTAssertNil(try enrollmentVault.receipt(
            context: PeerCompanionEnrollmentContext(
                sessionId: pairing.sessionId,
                ownerUserId: "owner-local",
                apiBaseURL: pairing.apiBaseUrl
            )
        ))
    }

    @MainActor
    func testPeerEnrollmentRejectsReceiptUntilLegacyBootstrapIsDisabled() async throws {
        let pairing = makePeerPairing()
        let legacySecrets = PeerMemorySecretStore()
        legacySecrets.seed(
            Data((0..<32).map(UInt8.init)),
            forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey
        )
        let keys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let identityStore = makePeerIdentityStore(
            keys: keys,
            legacySecrets: legacySecrets
        )
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let state = PeerTestEnrollmentState()
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .handler { request in
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let now = Date()
                let challenge = PeerTestEnrollmentChallenge(
                    protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                    challengeId: "legacy-enabled-enrollment",
                    challenge: String(repeating: "B", count: 43),
                    enrollmentAttemptId: options.enrollmentAttemptId,
                    pairingSessionId: options.pairingSessionId,
                    ownerUserId: "owner-local",
                    device: options.device,
                    issuedAt: ISO8601DateFormatter().string(from: now),
                    expiresAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(120)
                    )
                )
                state.store(challenge)
                return PeopleWatchOperatorResponse(
                    statusCode: 200,
                    data: try JSONEncoder().encode(challenge)
                )
            },
            .handler { request in
                _ = try JSONDecoder().decode(
                    PeerTestEnrollmentVerifyBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let challenge = try XCTUnwrap(state.challenge())
                return PeopleWatchOperatorResponse(
                    statusCode: 201,
                    data: try JSONEncoder().encode(self.makePeerEnrollmentReceipt(
                        identity: challenge.device.identity,
                        pairing: pairing,
                        legacyBootstrapAccepted: true
                    ))
                )
            }
        ])
        let client = PeerAPIClient(
            transport: PeerTestTransport(),
            identityStore: identityStore,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: operatorTransport
        )

        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: "owner-local"
            )
            XCTFail("Enrollment must not complete while legacy bootstrap remains valid")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .invalidResponse)
        }
        XCTAssertEqual(operatorTransport.requests.count, 2)
        XCTAssertEqual(keys.signCount, 1)
        XCTAssertNil(try enrollmentVault.receipt(
            context: PeerCompanionEnrollmentContext(
                sessionId: pairing.sessionId,
                ownerUserId: "owner-local",
                apiBaseURL: pairing.apiBaseUrl
            )
        ))
        XCTAssertNotNil(
            legacySecrets.load(forKey: PeerDeviceIdentityStore.legacyPrivateKeyKey)
        )
    }

    @MainActor
    func testPeerEnrollmentRejectsKeySubstitutionBeforeSigningOrDispatch() async throws {
        let pairing = makePeerPairing()
        let enrollmentKeys = PeerTestDeviceKeyOperations(identityAvailable: false)
        let identityStore = makePeerIdentityStore(keys: enrollmentKeys)
        let replacementIdentity = try PeerDeviceIdentityStore.identity(
            publicKeyX963: P256.Signing.PrivateKey().publicKey.x963Representation
        )
        let operatorTransport = PeopleWatchTestTransport(steps: [
            .handler { request in
                let options = try JSONDecoder().decode(
                    PeerTestEnrollmentOptionsBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let now = Date()
                return PeopleWatchOperatorResponse(
                    statusCode: 200,
                    data: try JSONEncoder().encode(PeerTestEnrollmentChallenge(
                        protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
                        challengeId: "substituted-key-challenge",
                        challenge: String(repeating: "K", count: 43),
                        enrollmentAttemptId: options.enrollmentAttemptId,
                        pairingSessionId: options.pairingSessionId,
                        ownerUserId: "owner-local",
                        device: PeerDeviceIdentityRecord(replacementIdentity),
                        issuedAt: ISO8601DateFormatter().string(from: now),
                        expiresAt: ISO8601DateFormatter().string(
                            from: now.addingTimeInterval(120)
                        )
                    ))
                )
            }
        ])
        let client = PeerAPIClient(
            transport: PeerTestTransport(),
            identityStore: identityStore,
            enrollmentVault: PeerCompanionEnrollmentVault(
                secrets: PeerMemorySecretStore()
            ),
            enrollmentTransport: operatorTransport
        )

        do {
            _ = try await client.enrollCompanion(
                pairing: pairing,
                ownerUserId: "owner-local"
            )
            XCTFail("A substituted challenge key must be rejected")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .invalidResponse)
        }
        XCTAssertEqual(operatorTransport.requests.count, 1)
        XCTAssertEqual(enrollmentKeys.signCount, 0)

        let enrolledKeys = PeerTestDeviceKeyOperations()
        let enrolledIdentityStore = makePeerIdentityStore(keys: enrolledKeys)
        let ordinaryTransport = PeerTestTransport()
        let enrolledClient = makeEnrolledPeerClient(
            transport: ordinaryTransport,
            identityStore: enrolledIdentityStore
        )
        enrolledKeys.substitutedIdentity = replacementIdentity
        do {
            _ = try await enrolledClient.listRelationships(pairing: pairing)
            XCTFail("A key that differs from the enrollment receipt must be rejected")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .secureEnrollmentRequired)
        }
        XCTAssertTrue(ordinaryTransport.requests.isEmpty)
        XCTAssertEqual(enrolledKeys.signCount, 0)
    }

    func testPeerSecureEnclaveConfigurationRejectsSigningWithoutUserPresence() throws {
        XCTAssertTrue(
            PeerCompanionSecurityContract.isValidChallenge(String(repeating: "A", count: 43))
        )
        XCTAssertFalse(
            PeerCompanionSecurityContract.isValidChallenge(String(repeating: "A", count: 42))
        )
        XCTAssertFalse(
            PeerCompanionSecurityContract.isValidChallenge(String(repeating: "!", count: 43))
        )
        XCTAssertTrue(
            SystemPeerSecureEnclaveKeyOperations.accessControlFlags.contains(.privateKeyUsage)
        )
        XCTAssertTrue(
            SystemPeerSecureEnclaveKeyOperations.accessControlFlags.contains(.userPresence)
        )
        let interactiveContext = try SystemPeerSecureEnclaveKeyOperations.authenticationContext(
            for: .userPresence(reason: "Approve the People action")
        )
        XCTAssertFalse(interactiveContext.interactionNotAllowed)
        XCTAssertEqual(interactiveContext.localizedReason, "Approve the People action")
        let nonInteractiveContext = try SystemPeerSecureEnclaveKeyOperations.authenticationContext(
            for: .nonInteractive
        )
        XCTAssertTrue(nonInteractiveContext.interactionNotAllowed)
        XCTAssertThrowsError(
            try SystemPeerSecureEnclaveKeyOperations.authenticationContext(
                for: .userPresence(reason: "   ")
            )
        ) { error in
            XCTAssertEqual(error as? PeerDeviceIdentityError, .userPresenceRequired)
        }

        let keys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: keys)
        XCTAssertThrowsError(
            try identityStore.sign(
                data: Data("unsigned".utf8),
                authorization: .nonInteractive
            )
        ) { error in
            XCTAssertEqual(error as? PeerDeviceIdentityError, .userPresenceRequired)
        }
        XCTAssertEqual(keys.authorizations, [.nonInteractive])
    }

    func testPeerCompanionClientExecutesEveryAdvertisedNativeContract() async throws {
        let keyOperations = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: keyOperations)
        let identity = try identityStore.identity()
        let transport = PeerTestTransport()
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )
        let relationship = makePeerRelationship()
        let device = makePeerDevice()
        let grant = makePeerGrant()
        let request = makePeerPendingRequest(id: "request-contract-device", kind: "device")
        let pairingRequest = makePeerPendingRequest(
            id: "pairing-contract",
            kind: "pairing"
        )
        let invitation = makePeerInvitation()
        let invitationStatus = makePeerInvitationStatus(invitation: invitation)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let page = PeerTestPageBody(limit: 100, hasMore: false, nextCursor: nil)
        let proposalDraft = PeerGrantDraft.proposal(
            label: "Availability and profile",
            purpose: "Coordinate through Forge",
            projections: [.availability, .profile],
            approvedDeviceIds: [device.deviceId],
            rollingFutureDays: 30,
            retentionSeconds: 86_400,
            expiresAt: "2099-01-01T00:00:00Z"
        )

        func previewResponse(
            draft: PeerGrantDraft,
            hash: String
        ) throws -> Data {
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: encoder.encode(draft))
                    as? [String: Any]
            )
            let rules = try XCTUnwrap(object["rules"] as? [[String: Any]])
            let projectionIds = rules.compactMap { $0["projectionId"] as? String }
            let direction = try XCTUnwrap(object["direction"])
            let cachePolicy = try XCTUnwrap(object["cachePolicy"])
            return try JSONSerialization.data(withJSONObject: [
                "preview": [
                    "hash": hash,
                    "relationshipVersion": relationship.updatedAt,
                    "exact": [
                        "direction": direction,
                        "rules": rules,
                        "cachePolicy": cachePolicy,
                        "effectiveAt": object["effectiveAt"] ?? NSNull(),
                        "expiresAt": object["expiresAt"] ?? NSNull()
                    ],
                    "worstCase": [
                        "projectionIds": projectionIds,
                        "maximumResultCount": rules.count * 100,
                        "maximumPayloadBytes": rules.count * 262_144,
                        "maximumRetentionSeconds": 86_400,
                        "allShareableRuleCount": rules.count,
                        "currentApprovedDeviceCount": 1
                    ],
                    "samples": []
                ]
            ], options: [.sortedKeys])
        }

        func grantMutationResponse(_ grant: PeerGrant) throws -> Data {
            var object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: encoder.encode(grant))
                    as? [String: Any]
            )
            object.removeValue(forKey: "versionHash")
            return try JSONSerialization.data(withJSONObject: [
                "grant": object,
                "versionHash": try XCTUnwrap(grant.versionHash)
            ], options: [.sortedKeys])
        }

        transport.steps = [.response(peerPresenceStatusResponse(deviceId: identity.deviceId))]
        _ = try await client.presenceStatus(pairing: makePeerPairing())

        transport.steps = [.response(PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try encoder.encode(
                PeerTestRelationshipsBody(relationships: [relationship], page: page)
            )
        ))]
        _ = try await client.listRelationships(pairing: makePeerPairing())

        transport.steps = [.response(try peerRequestsResponse(
            requests: [peerPendingRequestJSONObject(id: request.id, kind: request.kind)],
            hasMore: false,
            nextCursor: nil
        ))]
        _ = try await client.listRequests(pairing: makePeerPairing())

        transport.steps = [.response(PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try encoder.encode(
                PeerTestRelationshipBody(
                    relationship: relationship,
                    devices: [device],
                    grants: [grant]
                )
            )
        ))]
        _ = try await client.relationship(id: relationship.id, pairing: makePeerPairing())

        transport.steps = [.response(PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try encoder.encode(["devices": [device]])
        ))]
        _ = try await client.devices(
            relationshipId: relationship.id,
            pairing: makePeerPairing()
        )

        transport.steps = [.response(PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try encoder.encode(PeerTestGrantsBody(grants: [grant], page: page))
        ))]
        _ = try await client.grants(
            relationshipId: relationship.id,
            pairing: makePeerPairing()
        )

        transport.steps = [.response(peerJSONResponse(
            #"{"diagnostics":[{"id":"diagnostic-1","eventType":"peer_connected","actorClass":"companion_session","outcome":"allowed","createdAt":"2026-07-15T12:00:00Z"}],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
        ))]
        _ = try await client.diagnostics(
            relationshipId: relationship.id,
            pairing: makePeerPairing()
        )

        let relationshipObject = try JSONSerialization.jsonObject(
            with: encoder.encode(relationship)
        )
        transport.steps = [.response(PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try JSONSerialization.data(withJSONObject: [
                "sync": [
                    "relationship": relationshipObject,
                    "pendingOutbox": 0,
                    "pendingInbox": 0,
                    "currentRemoteRecords": 2,
                    "staleRemoteRecords": 0
                ]
            ], options: [.sortedKeys])
        ))]
        _ = try await client.syncStatus(
            relationshipId: relationship.id,
            pairing: makePeerPairing()
        )

        transport.steps = [.response(try peerInvitationStatusResponse(invitationStatus))]
        _ = try await client.invitationStatus(
            invitationId: invitation.id,
            pairing: makePeerPairing()
        )

        func appendApproval(_ finalData: Data, character: Character) {
            transport.steps.append(contentsOf: peerApprovedMutationSteps(
                identityStore: identityStore,
                challenge: String(repeating: character, count: 43),
                capabilitySecret: String(repeating: "z", count: 43),
                finalData: finalData
            ))
        }

        appendApproval(try encoder.encode(["invitation": invitation]), character: "G")
        _ = try await client.createInvitation(
            label: "Contract invite",
            idempotencyKey: "peer-invite-contract",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(
            Data(#"{"canceled":true,"invitationId":"invite-peer-1"}"#.utf8),
            character: "H"
        )
        _ = try await client.cancelInvitation(
            invitationStatus,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        var review = PeerPairingReview.scanned(
            PeerInviteQREnvelope(invitation: invitation)
        )
        appendApproval(
            try peerRequestEnvelopeData(request: pairingRequest),
            character: "I"
        )
        _ = try await client.acceptScannedInvitation(
            review: review,
            localPeerDeviceId: "peer-local-device-test",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        review = review.applying(pairingRequest)
        appendApproval(
            try peerConfirmationEnvelopeData(
                relationshipId: relationship.id,
                request: pairingRequest
            ),
            character: "J"
        )
        _ = try await client.confirmPairing(
            review: review,
            personName: "Remote Forge",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(try peerRequestEnvelopeData(request: request), character: "K")
        _ = try await client.decideRequest(
            request,
            accept: true,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )
        appendApproval(try peerRequestEnvelopeData(request: request), character: "L")
        _ = try await client.decideRequest(
            request,
            accept: false,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(try encoder.encode(["device": device]), character: "M")
        _ = try await client.mutateDevice(
            route: .approvePeerDevice,
            relationship: relationship,
            device: device,
            reason: "Approve contract device",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )
        appendApproval(try encoder.encode(["device": device]), character: "N")
        _ = try await client.mutateDevice(
            route: .removePeerDevice,
            relationship: relationship,
            device: device,
            reason: "Remove contract device",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(try encoder.encode(["relationship": relationship]), character: "O")
        _ = try await client.revokeRelationship(
            relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(
            try previewResponse(draft: proposalDraft, hash: String(repeating: "c", count: 64)),
            character: "P"
        )
        let proposalPreview = try await client.previewGrant(
            draft: proposalDraft,
            relationship: relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        ).preview

        appendApproval(try grantMutationResponse(grant), character: "Q")
        _ = try await client.proposeGrant(
            draft: proposalDraft,
            preview: proposalPreview,
            relationship: relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(try grantMutationResponse(grant), character: "R")
        _ = try await client.acceptGrant(
            grant,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        let counterDraft = try XCTUnwrap(PeerGrantDraft.countering(
            grant,
            retainedAllowRuleIds: Set(grant.rules.map(\.id))
        ))
        appendApproval(
            try previewResponse(draft: counterDraft, hash: String(repeating: "d", count: 64)),
            character: "S"
        )
        let counterPreview = try await client.previewGrant(
            draft: counterDraft,
            relationship: relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        ).preview

        appendApproval(try grantMutationResponse(grant), character: "T")
        _ = try await client.counterGrant(
            grant,
            draft: counterDraft,
            preview: counterPreview,
            relationship: relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(
            Data(#"{"requested":true,"envelopeIds":["envelope-contract-1"]}"#.utf8),
            character: "U"
        )
        _ = try await client.requestResync(
            relationship: relationship,
            projectionIds: ["person.profile.v1", "calendar.availability.v1"],
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        appendApproval(try grantMutationResponse(grant), character: "V")
        _ = try await client.revokeGrant(
            grant,
            expectedVersionHash: try XCTUnwrap(grant.versionHash),
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        XCTAssertEqual(Set(transport.requests.map(\.route)), Set(PeerAPIRoute.allCases))
        XCTAssertEqual(keyOperations.signCount, transport.requests.count + 16)
        XCTAssertTrue(keyOperations.authorizations.allSatisfy {
            if case .userPresence(let reason) = $0 {
                return reason.isEmpty == false
            }
            return false
        })
        XCTAssertFalse(transport.requests.contains {
            $0.requestTarget.contains("/api/v1/people")
        })
        XCTAssertTrue(transport.requests.contains {
            $0.route == .requestPeerResync && $0.requestTarget.hasSuffix("/resync")
        })
        for route in [
            PeerAPIRoute.proposePeerGrant,
            .acceptPeerGrant,
            .counterPeerGrant,
            .requestPeerResync
        ] {
            let request = try XCTUnwrap(
                transport.requests.last(where: { $0.route == route })
            )
            let body = try XCTUnwrap(
                JSONSerialization.jsonObject(with: try XCTUnwrap(request.body))
                    as? [String: Any]
            )
            XCTAssertNotNil(body["idempotencyKey"] as? String)
            XCTAssertNotNil(
                body[route == .acceptPeerGrant || route == .counterPeerGrant
                    ? "expectedVersionHash"
                    : "expectedRelationshipVersion"] as? String
            )
        }
    }

    func testPeerInviteQRIsVersionedAndDistinctFromOwnerCompanionPairing() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z"))
        let peerText = try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
        let ownerPairing = makePeerPairing()
        let ownerText = String(decoding: try JSONEncoder().encode(ownerPairing), as: UTF8.self)

        XCTAssertEqual(NativeQRCodeClassifier.classify(peerText, now: now), .peerInvite)
        XCTAssertEqual(NativeQRCodeClassifier.classify(ownerText, now: now), .ownerCompanion)
        XCTAssertThrowsError(try PairingPayload.decodePairingText(peerText))
        XCTAssertThrowsError(try PeerInviteQREnvelope.decode(ownerText, now: now))
        let decoded = try PeerInviteQREnvelope.decode(peerText, now: now)
        XCTAssertEqual(decoded.kind, "forge-peer-invite")
        XCTAssertEqual(decoded.version, 1)
    }

    func testPeerScanStagesReviewWithoutNetworkOrApprovalAction() throws {
        let transport = PeerTestTransport()
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: makePeerIdentityStore()
        )
        let store = PeoplePeerStore(
            client: client,
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            now: { ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z")! }
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")

        XCTAssertTrue(
            store.stageScannedInvitation(
                try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
            )
        )
        XCTAssertEqual(store.pairingReview?.stage, .scanned)
        XCTAssertNil(store.pairingReview?.verificationPhrase)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testPeerExpiryAndReplayAreRejectedBeforeNetworkAction() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z"))
        let expired = makePeerInvitation(expiresAt: "2026-07-15T11:59:59Z")
        XCTAssertThrowsError(
            try PeerInviteQREnvelope.decode(
                PeerInviteQREnvelope(invitation: expired).encodedText(),
                now: now
            )
        ) { error in
            XCTAssertEqual(error as? PeerInviteValidationError, .expired)
        }

        let secrets = PeerMemorySecretStore()
        let ledger = PeerReplayLedger(secrets: secrets)
        try ledger.recordAccepted(invitationId: "invite-peer-1", now: now)
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: PeerTestTransport(),
                identityStore: makePeerIdentityStore()
            ),
            replayLedger: ledger,
            now: { now }
        )

        XCTAssertFalse(
            store.stageScannedInvitation(
                try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
            )
        )
        XCTAssertEqual(store.pairingReview?.stage, .replayed)
        XCTAssertEqual(store.errorMessage, PeerAPIError.replayed.userMessage)
    }

    func testPeerVerifiedReviewShowsPhraseFingerprintAndInitialSharingOnlyAfterAPIData() {
        let envelope = PeerInviteQREnvelope(invitation: makePeerInvitation())
        let request = PeerPendingRequest(
            id: "pairing-1",
            relationshipId: nil,
            kind: "pairing",
            status: "pending",
            version: 3,
            payload: [
                "transcriptHash": .string(String(repeating: "a", count: 64)),
                "remoteLabel": .string("Ada's Forge"),
                "deviceLabel": .string("Ada's iPhone"),
                "verificationPhrase": .string("violet harbor seven"),
                "requestedProjections": .array([.string("calendar.availability.v1")]),
                "requestedFields": .array([.string("startsAt"), .string("endsAt")])
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:00:00Z"
        )

        let scanned = PeerPairingReview.scanned(envelope)
        XCTAssertNil(scanned.verificationPhrase)
        XCTAssertTrue(scanned.initialFields.isEmpty)

        let verified = scanned.applying(request)
        XCTAssertEqual(verified.stage, .verified)
        XCTAssertEqual(verified.fingerprint, "ABCD-EFGH-JKLM-NPQR")
        XCTAssertEqual(verified.verificationPhrase, "violet harbor seven")
        XCTAssertEqual(verified.initialProjections, ["calendar.availability.v1"])
        XCTAssertEqual(verified.initialFields, ["endsAt", "startsAt"])
        XCTAssertTrue(PeerPrivacyRedactor.presentationIsSafe(verified))
    }

    func testPeerVerifiedReviewResumesFromSessionScopedKeychainVault() throws {
        let request = PeerPendingRequest(
            id: "pairing-resume-1",
            relationshipId: nil,
            kind: "pairing",
            status: "pending",
            version: 2,
            payload: [
                "transcriptHash": .string(String(repeating: "a", count: 64)),
                "verificationPhrase": .string("amber cedar river"),
                "remotePrincipalId": .string("remote-principal"),
                "remoteDeviceId": .string("remote-device")
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:01:00Z"
        )
        let secrets = PeerMemorySecretStore()
        let vault = PeerPairingReviewVault(secrets: secrets)
        let context = PeerPairingReviewVaultContext(
            sessionId: "pair-peer-tests",
            ownerUserId: "owner-local",
            apiBaseURL: "https://forge.example/api/v1"
        )
        var verified = PeerPairingReview.scanned(
            PeerInviteQREnvelope(invitation: makePeerInvitation())
        ).applying(request)
        verified.remoteLabel = "Ada's Forge"
        try vault.save(verified, context: context)

        XCTAssertNil(
            try vault.load(
                context: PeerPairingReviewVaultContext(
                    sessionId: "different-session",
                    ownerUserId: "owner-local",
                    apiBaseURL: "https://forge.example/api/v1"
                )
            )
        )
        XCTAssertEqual(try vault.load(context: context)?.stage, .verified)
        XCTAssertEqual(secrets.values.count, 1)

        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: PeerTestTransport(),
                identityStore: makePeerIdentityStore()
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: vault
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        XCTAssertTrue(store.canResume(request))

        store.resume(request)
        XCTAssertEqual(store.pairingReview?.stage, .verified)
        XCTAssertEqual(store.pairingReview?.verificationPhrase, "amber cedar river")
        XCTAssertTrue(try XCTUnwrap(store.pairingReview).presentationStrings.allSatisfy {
            $0.contains(String(repeating: "B", count: 48)) == false &&
                $0.contains(String(repeating: "S", count: 86)) == false
        })
    }

    func testPeerDeviceIdentityAndReplaySecretsUseInjectedKeychainStoreOnly() throws {
        let defaultsName = "ForgeCompanionTests.peer-secrets.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        defer { defaults.removePersistentDomain(forName: defaultsName) }
        defaults.set("unchanged", forKey: "peer-secret-sentinel")

        let secrets = PeerMemorySecretStore()
        let keys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: keys, legacySecrets: secrets)
        let identity = try identityStore.identity()
        let signedData = Data(String(repeating: "C", count: 43).utf8)
        let signature = try identityStore.sign(
            data: signedData,
            reason: "Verify the test user's presence"
        )
        XCTAssertTrue(try identityStore.verify(signature: signature, data: signedData))
        XCTAssertEqual(identity, try identityStore.identity())
        XCTAssertEqual(keys.signCount, 1)
        XCTAssertEqual(
            keys.authorizations,
            [.userPresence(reason: "Verify the test user's presence")]
        )
        XCTAssertTrue(secrets.values.isEmpty)

        let ledger = PeerReplayLedger(secrets: secrets)
        try ledger.recordAccepted(invitationId: "invite-keychain", now: Date())
        XCTAssertTrue(try ledger.contains(invitationId: "invite-keychain", now: Date()))
        XCTAssertEqual(secrets.values.count, 1)
        XCTAssertEqual(defaults.string(forKey: "peer-secret-sentinel"), "unchanged")
    }

    func testPeerKeychainUpdateCorruptionAndWriteFailurePreserveExistingRecoveryData() async throws {
        let keychainOperations = PeerTestKeychainOperations()
        let keychain = PeerKeychainStore(
            service: "com.aurel.forgecompanion.people.tests",
            operations: keychainOperations
        )
        let key = "update-or-add"
        XCTAssertTrue(keychain.save(Data("existing".utf8), forKey: key))
        XCTAssertTrue(keychain.save(Data("updated".utf8), forKey: key))
        XCTAssertEqual(keychain.load(forKey: key), Data("updated".utf8))
        XCTAssertEqual(keychainOperations.updateCount, 2)
        XCTAssertEqual(keychainOperations.addCount, 1)
        XCTAssertEqual(keychainOperations.deleteCount, 0)

        keychainOperations.forcedUpdateStatus = errSecInteractionNotAllowed
        XCTAssertFalse(keychain.save(Data("must-not-replace".utf8), forKey: key))
        XCTAssertEqual(keychain.load(forKey: key), Data("updated".utf8))
        XCTAssertEqual(keychainOperations.addCount, 1)
        XCTAssertEqual(keychainOperations.deleteCount, 0)

        let legacyIdentity = PeerMemorySecretStore()
        legacyIdentity.seed(
            Data("not-an-ed25519-private-key".utf8),
            forKey: "forge_peer_device_ed25519_private_key_v1"
        )
        let missingKeys = PeerTestDeviceKeyOperations(identityAvailable: false)
        XCTAssertThrowsError(
            try makePeerIdentityStore(
                keys: missingKeys,
                legacySecrets: legacyIdentity
            ).identity()
        ) { error in
            XCTAssertEqual(error as? PeerDeviceIdentityError, .notEnrolled)
        }

        let corruptedReplay = PeerMemorySecretStore()
        corruptedReplay.seed(
            Data("corrupted".utf8),
            forKey: "forge_peer_invitation_replay_ledger_v1"
        )
        XCTAssertThrowsError(
            try PeerReplayLedger(secrets: corruptedReplay).contains(
                invitationId: "invite-corrupt"
            )
        ) { error in
            XCTAssertTrue(error is PeerReplayLedgerError)
        }
        let corruptionStore = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: PeerTestTransport(),
                identityStore: makePeerIdentityStore(),
                capabilityVault: PeerActionCapabilityVault(
                    secrets: PeerMemorySecretStore()
                )
            ),
            replayLedger: PeerReplayLedger(secrets: corruptedReplay),
            reviewVault: PeerPairingReviewVault(secrets: PeerMemorySecretStore())
        )
        corruptionStore.configure(
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )
        XCTAssertTrue(
            corruptionStore.stageScannedInvitation(
                try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
            )
        )
        XCTAssertTrue(corruptionStore.canRetry)
        if case .failed = corruptionStore.pairingReview?.stage {
            // Expected fail-closed recovery state.
        } else {
            XCTFail("Expected replay-ledger corruption to fail closed")
        }
        corruptedReplay.seed(
            try JSONEncoder().encode([String]()),
            forKey: "forge_peer_invitation_replay_ledger_v1"
        )
        await corruptionStore.retry()
        XCTAssertEqual(corruptionStore.pairingReview?.stage, .scanned)

        let preservedReview = PeerMemorySecretStore()
        let storageKey = "forge_peer_pending_review_v1"
        let original = Data("existing-recovery-record".utf8)
        preservedReview.seed(original, forKey: storageKey)
        preservedReview.failingSaveCounts = [1]
        let vault = PeerPairingReviewVault(secrets: preservedReview)
        XCTAssertThrowsError(
            try vault.save(
                PeerPairingReview.scanned(
                    PeerInviteQREnvelope(invitation: makePeerInvitation())
                ),
                context: PeerPairingReviewVaultContext(
                    sessionId: "pair-peer-tests",
                    ownerUserId: "owner-local",
                    apiBaseURL: "https://forge.example/api/v1"
                )
            )
        ) { error in
            XCTAssertTrue(error is PeerPairingReviewVaultError)
        }
        XCTAssertEqual(preservedReview.load(forKey: storageKey), original)

        let corruptedCapability = PeerMemorySecretStore()
        corruptedCapability.seed(
            Data("corrupted".utf8),
            forKey: "forge_peer_pending_action_capability_v1"
        )
        XCTAssertThrowsError(
            try PeerActionCapabilityVault(secrets: corruptedCapability).load(
                actionDigest: String(repeating: "a", count: 64),
                context: PeerActionCapabilityVaultContext(
                    sessionId: "pair-peer-tests",
                    ownerUserId: "owner-local",
                    apiBaseURL: "https://forge.example/api/v1",
                    deviceId: "ios_\(String(repeating: "a", count: 32))"
                )
            )
        ) { error in
            XCTAssertTrue(error is PeerActionCapabilityVaultError)
        }
    }

    func testPeerSecureEnclaveSigningDenialSendsNoConsentOrMutationRequest() async {
        let transport = PeerTestTransport()
        let keys = PeerTestDeviceKeyOperations()
        keys.signingError = .userPresenceDenied
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: makePeerIdentityStore(keys: keys),
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )

        do {
            _ = try await client.createInvitation(
                label: "Ada",
                idempotencyKey: "peer-invite-auth-denial",
                pairing: makePeerPairing(),
                ownerUserId: "owner-local"
            )
            XCTFail("Expected user-presence signing denial")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .localAuthentication(.denied))
        }
        XCTAssertEqual(keys.signCount, 1)
        XCTAssertEqual(
            keys.authorizations,
            [.userPresence(reason: "Create a one-use Forge peer invitation")]
        )
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testPeerCapabilityKeychainFailurePreventsFinalMutationDispatch() async throws {
        let transport = PeerTestTransport()
        let capabilitySecrets = PeerMemorySecretStore()
        capabilitySecrets.failingSaveCounts = [1]
        let identityStore = makePeerIdentityStore()
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: capabilitySecrets
            )
        )
        transport.steps = Array(
            peerApprovedMutationSteps(
                identityStore: identityStore,
                challenge: String(repeating: "F", count: 43),
                capabilitySecret: String(repeating: "v", count: 43),
                finalData: Data(#"{"invitation":{}}"#.utf8)
            ).prefix(2)
        )

        do {
            _ = try await client.createInvitation(
                label: "No dispatch on Keychain failure",
                idempotencyKey: "peer-invite-keychain-failure",
                pairing: makePeerPairing(),
                ownerUserId: "owner-local"
            )
            XCTFail("Expected secure capability storage failure")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .secureStorage)
        }
        XCTAssertEqual(transport.requests.map(\.route), [
            .createPeerHumanPresenceOptions,
            .verifyPeerHumanPresence
        ])
    }

    func testPeerCommittedResponseLossReusesKeychainCapabilityAndStableAcceptBodyAfterRelaunch() async throws {
        let sharedKeys = PeerTestDeviceKeyOperations()
        let capabilitySecrets = PeerMemorySecretStore()
        let review = PeerPairingReview.scanned(
            PeerInviteQREnvelope(invitation: makePeerInvitation()),
            now: try XCTUnwrap(
                ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z")
            )
        )
        let acceptedData = Data(
            #"{"request":{"id":"pairing-loss-1","relationshipId":null,"kind":"pairing","status":"pending","version":1,"payload":{"transcriptHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verificationPhrase":"violet harbor seven"},"expiresAt":"2099-01-01T00:00:00Z","createdAt":"2026-07-15T12:00:00Z","updatedAt":"2026-07-15T12:00:00Z"}}"#.utf8
        )
        let firstIdentityStore = makePeerIdentityStore(keys: sharedKeys)
        var firstSteps = peerApprovedMutationSteps(
            identityStore: firstIdentityStore,
            challenge: String(repeating: "C", count: 43),
            capabilitySecret: String(repeating: "s", count: 43),
            finalData: acceptedData
        )
        var firstFinalRequest: PeerTransportRequest?
        firstSteps[2] = .handler { request in
            firstFinalRequest = request
            throw URLError(.networkConnectionLost)
        }
        let firstTransport = PeerTestTransport(steps: firstSteps)
        let firstClient = makeEnrolledPeerClient(
            transport: firstTransport,
            identityStore: firstIdentityStore,
            capabilityVault: PeerActionCapabilityVault(secrets: capabilitySecrets)
        )

        do {
            _ = try await firstClient.acceptScannedInvitation(
                review: review,
                localPeerDeviceId: "peer-local-device-test",
                pairing: makePeerPairing(),
                ownerUserId: "owner-local"
            )
            XCTFail("Expected ambiguous response loss")
        } catch {
            XCTAssertEqual(error as? PeerAPIError, .offline)
        }
        XCTAssertEqual(sharedKeys.signCount, 4)
        XCTAssertEqual(firstTransport.requests.map(\.route), [
            .createPeerHumanPresenceOptions,
            .verifyPeerHumanPresence,
            .acceptScannedPeerPairing
        ])
        XCTAssertEqual(capabilitySecrets.values.count, 1)

        let secondTransport = PeerTestTransport(steps: [
            .response(PeerTransportResponse(statusCode: 202, headers: [:], data: acceptedData))
        ])
        let relaunchedClient = makeEnrolledPeerClient(
            transport: secondTransport,
            identityStore: makePeerIdentityStore(keys: sharedKeys),
            capabilityVault: PeerActionCapabilityVault(secrets: capabilitySecrets)
        )
        let response = try await relaunchedClient.acceptScannedInvitation(
            review: review,
            localPeerDeviceId: "peer-local-device-test",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        XCTAssertEqual(response.request.id, "pairing-loss-1")
        XCTAssertEqual(sharedKeys.signCount, 5)
        XCTAssertEqual(secondTransport.requests.map(\.route), [.acceptScannedPeerPairing])
        XCTAssertEqual(secondTransport.requests.first?.body, firstFinalRequest?.body)
        XCTAssertEqual(
            secondTransport.requests.first?.headers["Cookie"],
            firstFinalRequest?.headers["Cookie"]
        )
        XCTAssertEqual(capabilitySecrets.values.count, 0)
    }

    func testPeerOfflineLoadCanRetryWithoutDiscardingState() async {
        let transport = PeerTestTransport(steps: [.failure(URLError(.notConnectedToInternet))])
        let identityKeys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: identityKeys)
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore
        )
        let store = PeoplePeerStore(
            client: client,
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore())
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")

        await store.load()
        XCTAssertEqual(store.loadState, .offline)
        XCTAssertEqual(store.errorMessage, PeerAPIError.offline.userMessage)

        transport.steps = [
            .response(peerPresenceStatusResponse(deviceId: try! identityStore.identity().deviceId)),
            .response(peerJSONResponse(#"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#)),
            .response(peerJSONResponse(#"{"requests":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#))
        ]
        await store.retry()

        XCTAssertEqual(store.loadState, .loaded)
        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(transport.requests.map(\.route), [
            .getPeerHumanPresenceStatus,
            .getPeerHumanPresenceStatus,
            .listPeerRelationships,
            .listPeerRequests
        ])
    }

    func testPeerPostAcceptVaultFailurePreservesStableRecoveryAndRetriesSameOperation() async throws {
        let identityKeys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: identityKeys)
        let identity = try identityStore.identity()
        let transport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(
                peerJSONResponse(
                    #"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            ),
            .response(
                peerJSONResponse(
                    #"{"requests":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            )
        ])
        let reviewSecrets = PeerMemorySecretStore()
        let reviewVault = PeerPairingReviewVault(secrets: reviewSecrets)
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )
        let store = PeoplePeerStore(
            client: client,
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: reviewVault,
            now: {
                ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z")!
            }
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        await store.load()
        XCTAssertTrue(
            store.stageScannedInvitation(
                try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
            )
        )
        let stableReview = try XCTUnwrap(store.pairingReview)
        XCTAssertEqual(reviewSecrets.saveCount, 1)
        reviewSecrets.failingSaveCounts = [3]

        let acceptedData = Data(
            #"{"request":{"id":"pairing-vault-1","relationshipId":null,"kind":"pairing","status":"pending","version":2,"payload":{"transcriptHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verificationPhrase":"violet harbor seven"},"expiresAt":"2099-01-01T00:00:00Z","createdAt":"2026-07-15T12:00:00Z","updatedAt":"2026-07-15T12:01:00Z"}}"#.utf8
        )
        transport.steps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: String(repeating: "D", count: 43),
            capabilitySecret: String(repeating: "t", count: 43),
            finalData: acceptedData
        )
        await store.submitScannedInvitationForReview()

        XCTAssertTrue(store.canRetry)
        XCTAssertEqual(store.pairingReview?.pairingId, "pairing-vault-1")
        if case .failed = store.pairingReview?.stage {
            // Expected recoverable state.
        } else {
            XCTFail("Expected a recoverable secure-vault failure")
        }
        let context = PeerPairingReviewVaultContext(
            sessionId: "pair-peer-tests",
            ownerUserId: "owner-local",
            apiBaseURL: "https://forge.example/api/v1"
        )
        let preserved = try XCTUnwrap(try reviewVault.load(context: context))
        XCTAssertEqual(preserved.acceptIdempotencyKey, stableReview.acceptIdempotencyKey)
        XCTAssertEqual(preserved.scannedAt, stableReview.scannedAt)

        reviewSecrets.failingSaveCounts = []
        transport.steps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: String(repeating: "E", count: 43),
            capabilitySecret: String(repeating: "u", count: 43),
            finalData: acceptedData
        )
        await store.retry()

        XCTAssertEqual(store.pairingReview?.stage, .verified)
        XCTAssertEqual(store.resumablePairingId, "pairing-vault-1")
        let acceptBodies = transport.requests
            .filter { $0.route == .acceptScannedPeerPairing }
            .compactMap(\.body)
        XCTAssertEqual(acceptBodies.count, 2)
        XCTAssertEqual(acceptBodies[0], acceptBodies[1])
        XCTAssertTrue(identityKeys.authorizations.allSatisfy {
            if case .userPresence = $0 { return true }
            return false
        })
    }

    func testPeerResumeSearchFollowsMoreThanOneHundredPendingRequestsWithoutErasingVault() async throws {
        let identityKeys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: identityKeys)
        let identity = try identityStore.identity()
        let target = PeerPendingRequest(
            id: "pairing-page-two",
            relationshipId: nil,
            kind: "pairing",
            status: "pending",
            version: 4,
            payload: [
                "transcriptHash": .string(String(repeating: "a", count: 64)),
                "verificationPhrase": .string("amber cedar river")
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:01:00Z"
        )
        let reviewSecrets = PeerMemorySecretStore()
        let reviewVault = PeerPairingReviewVault(secrets: reviewSecrets)
        let context = PeerPairingReviewVaultContext(
            sessionId: "pair-peer-tests",
            ownerUserId: "owner-local",
            apiBaseURL: "https://forge.example/api/v1"
        )
        let review = PeerPairingReview.scanned(
            PeerInviteQREnvelope(invitation: makePeerInvitation())
        ).applying(target)
        try reviewVault.save(review, context: context)

        let firstPageRequests = (0..<100).map {
            peerPendingRequestJSONObject(id: "request-page-one-\($0)")
        }
        let secondPageRequests = [peerPendingRequestJSONObject(id: target.id)]
        let transport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(
                peerJSONResponse(
                    #"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            ),
            .handler { request in
                XCTAssertNil(request.queryItems.first { $0.name == "cursor" })
                return try self.peerRequestsResponse(
                    requests: firstPageRequests,
                    hasMore: true,
                    nextCursor: "opaque-next-page"
                )
            },
            .handler { request in
                XCTAssertEqual(
                    request.queryItems.first { $0.name == "cursor" }?.value,
                    "opaque-next-page"
                )
                return try self.peerRequestsResponse(
                    requests: secondPageRequests,
                    hasMore: false,
                    nextCursor: nil
                )
            }
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: transport,
                identityStore: identityStore,
                capabilityVault: PeerActionCapabilityVault(
                    secrets: PeerMemorySecretStore()
                )
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: reviewVault
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        XCTAssertEqual(store.resumablePairingId, target.id)

        await store.load()

        XCTAssertEqual(store.loadState, .loaded)
        XCTAssertEqual(store.requests.count, 101)
        XCTAssertTrue(store.canResume(target))
        XCTAssertEqual(try reviewVault.load(context: context)?.pairingId, target.id)
        XCTAssertEqual(
            transport.requests.filter { $0.route == .listPeerRequests }.count,
            2
        )
    }

    func testPeerHostSwitchCancelsAndIgnoresEveryAwaitedOldHostResponse() async throws {
        let gate = PeerAsyncResponseGate()
        let requestStarted = expectation(description: "Old host request started")
        let identityStore = makePeerIdentityStore()
        let identity = try identityStore.identity()
        let transport = PeerTestTransport(steps: [
            .handler { _ in
                requestStarted.fulfill()
                return await gate.wait()
            }
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: transport,
                identityStore: identityStore,
                capabilityVault: PeerActionCapabilityVault(
                    secrets: PeerMemorySecretStore()
                )
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: PeerPairingReviewVault(secrets: PeerMemorySecretStore())
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        XCTAssertTrue(
            store.stageScannedInvitation(
                try PeerInviteQREnvelope(invitation: makePeerInvitation()).encodedText()
            )
        )
        let oldLoad = Task { await store.load() }
        await fulfillment(of: [requestStarted], timeout: 2)
        XCTAssertEqual(transport.requests.count, 1)

        let secondHost = PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "https://second-forge.example/api/v1",
            uiBaseUrl: "https://second-forge.example/forge/",
            sessionId: "pair-second-host",
            pairingToken: "second-host-token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["companion-consent"]
        )
        store.configure(pairing: secondHost, ownerUserId: "owner-second")
        gate.release(peerPresenceStatusResponse(deviceId: identity.deviceId))
        await oldLoad.value

        XCTAssertEqual(store.loadState, .idle)
        XCTAssertNil(store.pairingReview)
        XCTAssertNil(store.outgoingInvitation)
        XCTAssertNil(store.resumablePairingId)
        XCTAssertNil(store.errorMessage)
        XCTAssertTrue(store.relationships.isEmpty)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testPeerOutgoingInvitationRetriesAmbiguousCreateThenRefreshesExpiresAndCancels() async throws {
        var currentNow = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-07-15T12:00:00Z")
        )
        let invitation = makePeerInvitation(
            expiresAt: "2026-07-15T12:05:00Z"
        )
        let status = makePeerInvitationStatus(invitation: invitation)
        let identityKeys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: identityKeys)
        let identity = try identityStore.identity()
        let transport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(
                peerJSONResponse(
                    #"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            ),
            .response(
                peerJSONResponse(
                    #"{"requests":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
                )
            )
        ])
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )
        let store = PeoplePeerStore(
            client: client,
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: PeerPairingReviewVault(secrets: PeerMemorySecretStore()),
            now: { currentNow }
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        await store.load()

        var creationSteps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: String(repeating: "Q", count: 43),
            capabilitySecret: String(repeating: "y", count: 43),
            finalData: try JSONEncoder().encode(["invitation": invitation])
        )
        creationSteps[2] = .failure(URLError(.networkConnectionLost))
        transport.steps = creationSteps
        await store.createInvitation(label: "Remote Forge")
        XCTAssertEqual(store.loadState, .offline)
        XCTAssertTrue(store.canRetry)
        XCTAssertNil(store.outgoingInvitation)

        transport.steps = [
            .response(PeerTransportResponse(
                statusCode: 201,
                headers: ["X-Forge-Idempotent-Replay": "true"],
                data: try JSONEncoder().encode(["invitation": invitation])
            )),
            .response(try peerInvitationStatusResponse(status))
        ]
        await store.retry()

        XCTAssertEqual(store.outgoingInvitation?.id, invitation.id)
        XCTAssertEqual(store.outgoingInvitationStatus?.status, "active")
        XCTAssertTrue(store.outgoingInvitationIsDisplayable)
        let createBodies = transport.requests
            .filter { $0.route == .createPeerInvitation }
            .compactMap(\.body)
        XCTAssertEqual(createBodies.count, 2)
        XCTAssertEqual(createBodies[0], createBodies[1])

        currentNow = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-07-15T12:06:00Z")
        )
        XCTAssertFalse(store.outgoingInvitationIsDisplayable)
        currentNow = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-07-15T12:02:00Z")
        )

        transport.steps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: String(repeating: "R", count: 43),
            capabilitySecret: String(repeating: "x", count: 43),
            finalData: Data(
                #"{"canceled":true,"invitationId":"invite-peer-1"}"#.utf8
            )
        )
        await store.cancelOutgoingInvitation()

        XCTAssertEqual(store.outgoingInvitationStatus?.status, "canceled")
        XCTAssertFalse(store.outgoingInvitationIsDisplayable)
        XCTAssertTrue(identityKeys.authorizations.allSatisfy {
            if case .userPresence = $0 { return true }
            return false
        })
        XCTAssertEqual(
            transport.requests.last { $0.route == .cancelPeerInvitation }?.body,
            Data(
                #"{"expectedVersion":"2026-07-15T12:01:00Z"}"#.utf8
            )
        )
    }

    func testPeerForegroundPollingStopsOffscreenAndSceneActivationRefreshes() async throws {
        let identityStore = makePeerIdentityStore()
        let identity = try identityStore.identity()
        let emptyRelationships = peerJSONResponse(
            #"{"relationships":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
        )
        let emptyRequests = peerJSONResponse(
            #"{"requests":[],"page":{"limit":100,"hasMore":false,"nextCursor":null}}"#
        )
        let transport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(emptyRelationships),
            .response(emptyRequests)
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: transport,
                identityStore: identityStore,
                capabilityVault: PeerActionCapabilityVault(
                    secrets: PeerMemorySecretStore()
                )
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            reviewVault: PeerPairingReviewVault(secrets: PeerMemorySecretStore()),
            foregroundRefreshSeconds: 1
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        await store.load()

        transport.steps = [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(emptyRelationships),
            .response(emptyRequests)
        ]
        store.managementDidAppear()
        try await Task.sleep(nanoseconds: 1_250_000_000)
        let afterForegroundPoll = transport.requests.filter {
            $0.route == .getPeerHumanPresenceStatus
        }.count
        XCTAssertEqual(afterForegroundPoll, 2)

        store.managementDidDisappear()
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertEqual(
            transport.requests.filter { $0.route == .getPeerHumanPresenceStatus }.count,
            afterForegroundPoll
        )

        let activated = expectation(description: "Scene activation refresh")
        transport.steps = [
            .handler { _ in
                activated.fulfill()
                return self.peerPresenceStatusResponse(deviceId: identity.deviceId)
            },
            .response(emptyRelationships),
            .response(emptyRequests)
        ]
        store.sceneDidLeaveForeground()
        store.managementDidAppear()
        store.sceneDidBecomeActive()
        await fulfillment(of: [activated], timeout: 2)
        for _ in 0..<20 where transport.steps.isEmpty == false {
            await Task.yield()
        }
        XCTAssertEqual(store.loadState, .loaded)
        store.managementDidDisappear()
    }

    func testPeerDeviceRemovalAndRelationshipRevokeUseFreshSignedConsent() async throws {
        let transport = PeerTestTransport()
        let identityKeys = PeerTestDeviceKeyOperations()
        let identityStore = makePeerIdentityStore(keys: identityKeys)
        let client = makeEnrolledPeerClient(
            transport: transport,
            identityStore: identityStore,
            capabilityVault: PeerActionCapabilityVault(
                secrets: PeerMemorySecretStore()
            )
        )
        let relationship = makePeerRelationship()
        let device = makePeerDevice()
        let secret = String(repeating: "s", count: 43)
        let challenge = String(repeating: "C", count: 43)

        transport.steps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: challenge,
            capabilitySecret: secret,
            finalData: try JSONEncoder().encode(["device": device])
        )
        _ = try await client.mutateDevice(
            route: .removePeerDevice,
            relationship: relationship,
            device: device,
            reason: "Remove test device",
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )

        XCTAssertEqual(transport.requests.map(\.route), [
            .createPeerHumanPresenceOptions,
            .verifyPeerHumanPresence,
            .removePeerDevice
        ])
        XCTAssertEqual(transport.requests.last?.pathParameters, [
            "relationshipId": relationship.id,
            "deviceId": device.deviceId
        ])
        XCTAssertEqual(transport.requests.last?.headers["Cookie"], "forge_peer_presence=presence-test.\(secret)")
        XCTAssertFalse(String(decoding: transport.requests.last?.body ?? Data(), as: UTF8.self).contains(secret))

        let requestOffset = transport.requests.count
        transport.steps = peerApprovedMutationSteps(
            identityStore: identityStore,
            challenge: challenge,
            capabilitySecret: secret,
            finalData: try JSONEncoder().encode(["relationship": relationship])
        )
        _ = try await client.revokeRelationship(
            relationship,
            pairing: makePeerPairing(),
            ownerUserId: "owner-local"
        )
        XCTAssertEqual(Array(transport.requests.dropFirst(requestOffset)).map(\.route), [
            .createPeerHumanPresenceOptions,
            .verifyPeerHumanPresence,
            .revokePeerRelationship
        ])
        XCTAssertEqual(identityKeys.signCount, 8)
    }

    func testPeerServerExpiredReplayedRevokedAndConsentUnavailableStatesAreTyped() async {
        let cases: [(String, PeerAPIError)] = [
            ("peer_invitation_expired", .expired),
            ("peer_invitation_replayed", .replayed),
            ("peer_relationship_revoked", .revoked),
            ("peer_companion_consent_unavailable", .companionConsentUnavailable)
        ]

        for (code, expected) in cases {
            let transport = PeerTestTransport(steps: [
                .response(peerJSONResponse(#"{"code":"\#(code)","message":"Rejected"}"#, statusCode: 409))
            ])
            let client = makeEnrolledPeerClient(
                transport: transport,
                identityStore: makePeerIdentityStore()
            )
            do {
                _ = try await client.listRelationships(pairing: makePeerPairing())
                XCTFail("Expected typed peer error for \(code)")
            } catch {
                XCTAssertEqual(error as? PeerAPIError, expected)
            }
        }
    }

    func testPeopleWatchSelectorUsesNewestEligibleOwnerPersonPinAndFallsBackSafely() throws {
        let owner = "owner-local"
        let personOne = makePeerRelationship(
            id: "relationship-person-1",
            localPersonId: "person-1",
            remoteDisplayLabel: "Ada"
        )
        let personTwo = makePeerRelationship(
            id: "relationship-person-2",
            localPersonId: "person-2",
            status: "revoked",
            remoteDisplayLabel: "Revoked"
        )
        let personThree = makePeerRelationship(
            id: "relationship-person-3",
            localPersonId: "person-3",
            remoteDisplayLabel: "Grace"
        )
        let crossOwner = makePeerRelationship(
            id: "relationship-cross-owner",
            ownerUserId: "owner-other",
            localPersonId: "person-4",
            remoteDisplayLabel: "Other owner"
        )
        let generalPin = makePeopleWatchPin(
            pinId: "pin-task",
            entityType: "task",
            entityId: "task-1",
            title: "General task pin",
            pinnedAt: "2026-07-16T11:00:00Z"
        )
        let crossOwnerPin = makePeopleWatchPin(
            pinId: "pin-cross-owner",
            entityId: "person-4",
            title: "Cross-owner secret",
            ownerUserId: "owner-other",
            pinnedAt: "2026-07-16T10:00:00Z"
        )
        let binnedPin = makePeopleWatchPin(
            pinId: "pin-binned",
            entityId: "person-binned",
            title: "Settings Bin person",
            availability: "deleted",
            pinnedAt: "2026-07-16T09:30:00Z"
        )
        let revokedPin = makePeopleWatchPin(
            pinId: "pin-revoked",
            entityId: "person-2",
            title: "Revoked person",
            pinnedAt: "2026-07-16T09:00:00Z"
        )
        let newestEligible = makePeopleWatchPin(
            pinId: "pin-person-1",
            entityId: "person-1",
            title: "Ada Lovelace",
            pinnedAt: "2026-07-16T08:00:00Z"
        )
        let fallbackEligible = makePeopleWatchPin(
            pinId: "pin-person-3",
            entityId: "person-3",
            title: "Grace Hopper",
            pinnedAt: "2026-07-16T07:00:00Z"
        )
        let pins = [
            generalPin, crossOwnerPin, binnedPin, revokedPin,
            fallbackEligible, newestEligible
        ]
        let relationships = [personOne, personTwo, personThree, crossOwner]

        let selected = PeopleWatchGlanceSelector.resolve(
            pins: pins,
            relationships: relationships,
            ownerUserId: owner,
            generatedAt: "2026-07-16T12:00:00Z"
        )

        XCTAssertEqual(selected.selectedPinId, newestEligible.pinId)
        XCTAssertEqual(selected.snapshot.selection, .selected)
        XCTAssertEqual(selected.snapshot.personName, "Ada Lovelace")
        XCTAssertEqual(selected.snapshot.lastConnectedAt, personOne.lastConnectedAt)
        XCTAssertEqual(Set(selected.pinsByPersonId.keys), ["person-1", "person-3"])
        XCTAssertFalse(selected.pinsByPersonId.values.contains { $0.pinId == generalPin.pinId })
        XCTAssertFalse(selected.pinsByPersonId.values.contains { $0.pinId == crossOwnerPin.pinId })

        let fallback = PeopleWatchGlanceSelector.resolve(
            pins: pins.filter { $0.pinId != newestEligible.pinId },
            relationships: relationships,
            ownerUserId: owner,
            generatedAt: "2026-07-16T12:01:00Z"
        )
        XCTAssertEqual(fallback.selectedPinId, fallbackEligible.pinId)
        XCTAssertEqual(fallback.snapshot.personName, "Grace Hopper")

        let neutral = PeopleWatchGlanceSelector.resolve(
            pins: pins,
            relationships: relationships.filter { $0.localPersonId != "person-1" && $0.localPersonId != "person-3" },
            ownerUserId: owner,
            generatedAt: "2026-07-16T12:02:00Z"
        )
        XCTAssertEqual(neutral.snapshot.selection, .chooseOnIPhone)
        XCTAssertNil(neutral.selectedPinId)
        XCTAssertNil(neutral.snapshot.personName)
        XCTAssertEqual(neutral.snapshot.nextSharedEvent, nil)
    }

    @MainActor
    func testPeopleWatchPinClientUsesAuthenticatedOperatorCookieAndExactHumanPinWire() async throws {
        PeopleWatchURLProtocol.reset()
        defer { PeopleWatchURLProtocol.reset() }

        let pin = makePeopleWatchPin(
            pinId: "pin/person 1",
            entityId: "person-1",
            title: "Ada Lovelace",
            pinnedAt: "2026-07-16T12:00:00Z"
        )
        let listData = try peopleWatchPinListResponse([pin]).data
        let mutationData = try peopleWatchPinMutationResponse(pin).data
        let unpinData = try peopleWatchUnpinResponse(pinId: "pin/person 1").data
        PeopleWatchURLProtocol.handler = { request in
            switch request.httpMethod {
            case "GET":
                return (200, listData)
            case "PUT":
                return (201, mutationData)
            case "DELETE":
                return (200, unpinData)
            default:
                return (405, Data(#"{"code":"method_not_allowed"}"#.utf8))
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.protocolClasses = [PeopleWatchURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let dataStore = WKWebsiteDataStore.nonPersistent()
        let cookieStore = dataStore.httpCookieStore
        let cookie = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "forge.example",
            .path: "/",
            .name: "forge_session",
            .value: "operator-cookie-proof",
            .secure: "TRUE",
            .expires: Date().addingTimeInterval(300)
        ]))
        await withCheckedContinuation { continuation in
            cookieStore.setCookie(cookie) { continuation.resume() }
        }
        defer { cookieStore.delete(cookie) }
        let storedCookies: [HTTPCookie] = await withCheckedContinuation { continuation in
            cookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        XCTAssertTrue(storedCookies.contains { $0.name == cookie.name && $0.value == cookie.value })

        let client = PeopleWatchPinClient(
            transport: LivePeopleWatchOperatorTransport(
                session: session,
                cookieStore: cookieStore
            )
        )
        let pairing = makePeerPairing(
            pairingToken: "must-never-enter-human-pin-wire"
        )

        _ = try await client.listPins(pairing: pairing)
        _ = try await client.pinPerson(
            personId: "person-1",
            ownerUserId: "owner-local",
            pairing: pairing
        )
        try await client.unpin(pinId: "pin/person 1", pairing: pairing)

        let requests = PeopleWatchURLProtocol.requests
        XCTAssertEqual(requests.map(\.httpMethod), ["GET", "PUT", "DELETE"])
        XCTAssertEqual(
            requests[0].url?.absoluteString,
            "https://forge.example/api/v1/entity-navigation?pinnedLimit=25&recentLimit=0"
        )
        XCTAssertEqual(requests[1].url?.path, "/api/v1/entity-navigation/pins")
        XCTAssertEqual(
            URLComponents(url: try XCTUnwrap(requests[2].url), resolvingAgainstBaseURL: false)?.percentEncodedPath,
            "/api/v1/entity-navigation/pins/pin%2Fperson%201"
        )
        for request in requests {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "forge_session=operator-cookie-proof")
            let renderedHeaders = request.allHTTPHeaderFields?
                .map { "\($0.key):\($0.value)" }
                .joined(separator: "\n")
                .lowercased() ?? ""
            for forbidden in [
                "pairing", "companion", "device-id", "public-key",
                "signature", "authorization", pairing.pairingToken.lowercased()
            ] {
                XCTAssertFalse(renderedHeaders.contains(forbidden))
            }
        }
        let putBody = try XCTUnwrap(PeopleWatchURLProtocol.bodies[1])
        let putObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: putBody) as? [String: String]
        )
        XCTAssertEqual(putObject, [
            "entityId": "person-1",
            "entityType": "person",
            "ownerUserId": "owner-local"
        ])
        XCTAssertFalse(String(decoding: putBody, as: UTF8.self).contains(pairing.pairingToken))
        withExtendedLifetime(dataStore) {}
    }

    func testPeopleWatchOperatorCookiePolicyRejectsCrossOwnerInsecureAndExpiredCookies() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-16T12:00:00Z"))
        let url = try XCTUnwrap(URL(string: "https://forge.example/api/v1/entity-navigation"))
        let valid = try XCTUnwrap(HTTPCookie(properties: [
            .domain: ".forge.example", .path: "/api", .name: "session",
            .value: "valid", .secure: "TRUE", .expires: now.addingTimeInterval(60)
        ]))
        let otherHost = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "other.example", .path: "/", .name: "session",
            .value: "other", .expires: now.addingTimeInterval(60)
        ]))
        let expired = try XCTUnwrap(HTTPCookie(properties: [
            .domain: "forge.example", .path: "/", .name: "session",
            .value: "expired", .expires: now.addingTimeInterval(-1)
        ]))

        XCTAssertTrue(LivePeopleWatchOperatorTransport.cookie(valid, matches: url, now: now))
        XCTAssertFalse(LivePeopleWatchOperatorTransport.cookie(otherHost, matches: url, now: now))
        XCTAssertFalse(LivePeopleWatchOperatorTransport.cookie(expired, matches: url, now: now))
        XCTAssertFalse(
            LivePeopleWatchOperatorTransport.cookie(
                valid,
                matches: try XCTUnwrap(URL(string: "http://forge.example/api/v1/entity-navigation")),
                now: now
            )
        )
    }

    @MainActor
    func testPeopleWatchStoreAssemblesSelectionUnpinFallbackAndRepinWithoutTouchingGeneralPins() async throws {
        let identityStore = makePeerIdentityStore()
        let identity = try identityStore.identity()
        let personOne = makePeerRelationship(
            id: "relationship-watch-1",
            localPersonId: "person-1",
            remoteDisplayLabel: "Ada"
        )
        let personTwo = makePeerRelationship(
            id: "relationship-watch-2",
            localPersonId: "person-2",
            remoteDisplayLabel: "Grace"
        )
        let personOnePin = makePeopleWatchPin(
            pinId: "pin-person-1",
            entityId: "person-1",
            title: "Ada Lovelace",
            pinnedAt: "2026-07-16T10:00:00Z"
        )
        let personTwoPin = makePeopleWatchPin(
            pinId: "pin-person-2",
            entityId: "person-2",
            title: "Grace Hopper",
            pinnedAt: "2026-07-16T09:00:00Z"
        )
        let generalPin = makePeopleWatchPin(
            pinId: "pin-task-1",
            entityType: "task",
            entityId: "task-1",
            title: "Keep this general pin",
            pinnedAt: "2026-07-16T11:00:00Z"
        )
        let peerTransport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(try peerRelationshipsResponse([personOne, personTwo])),
            .response(try peerRequestsResponse(requests: [], hasMore: false, nextCursor: nil))
        ])
        let pinTransport = PeopleWatchTestTransport(steps: [
            .response(try peopleWatchPinListResponse([generalPin, personTwoPin, personOnePin]))
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: peerTransport,
                identityStore: identityStore
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            watchPinClient: PeopleWatchPinClient(transport: pinTransport),
            now: { ISO8601DateFormatter().date(from: "2026-07-16T12:00:00Z")! }
        )
        var relayedNames: [String?] = []
        store.configureWatchRelay { relayedNames.append($0.personName) }
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")

        await store.load()

        XCTAssertEqual(store.loadState, .loaded)
        XCTAssertEqual(store.selectedWatchPinId, personOnePin.pinId)
        XCTAssertEqual(store.watchGlance.personName, "Ada Lovelace")
        XCTAssertTrue(store.isSelectedForWatch(personOne))
        XCTAssertNotNil(store.watchPin(for: personTwo))

        pinTransport.steps = [
            .response(try peopleWatchUnpinResponse(pinId: "pin-person-1")),
            .response(try peopleWatchPinListResponse([generalPin, personTwoPin]))
        ]
        await store.removeFromWatch(personOne)

        XCTAssertEqual(store.selectedWatchPinId, personTwoPin.pinId)
        XCTAssertEqual(store.watchGlance.personName, "Grace Hopper")
        XCTAssertNil(store.watchPin(for: personOne))

        let repinnedPersonOne = makePeopleWatchPin(
            pinId: "pin-person-1-new",
            entityId: "person-1",
            title: "Ada Lovelace",
            pinnedAt: "2026-07-16T12:01:00Z"
        )
        pinTransport.steps = [
            .response(try peopleWatchPinMutationResponse(repinnedPersonOne)),
            .response(try peopleWatchPinListResponse([generalPin, personTwoPin, repinnedPersonOne]))
        ]
        await store.chooseForWatch(personOne)

        XCTAssertEqual(store.selectedWatchPinId, repinnedPersonOne.pinId)
        XCTAssertEqual(store.watchGlance.personName, "Ada Lovelace")
        XCTAssertEqual(pinTransport.requests.map(\.method), ["GET", "DELETE", "GET", "PUT", "GET"])
        XCTAssertEqual(pinTransport.requests[1].requestTarget, "/api/v1/entity-navigation/pins/pin-person-1")
        XCTAssertFalse(pinTransport.requests.contains {
            $0.method == "DELETE" && $0.requestTarget.contains(generalPin.pinId ?? "")
        })
        XCTAssertTrue(relayedNames.contains("Grace Hopper"))
        XCTAssertEqual(relayedNames.last!, "Ada Lovelace")
    }

    @MainActor
    func testPeopleWatchStorePreservesSelectionOfflineThenRetriesCurrentOwnerSnapshot() async throws {
        let identityStore = makePeerIdentityStore()
        let identity = try identityStore.identity()
        let personOne = makePeerRelationship(id: "relationship-offline-1", localPersonId: "person-1")
        let personTwo = makePeerRelationship(id: "relationship-offline-2", localPersonId: "person-2")
        let personOnePin = makePeopleWatchPin(
            pinId: "pin-offline-1",
            entityId: "person-1",
            title: "Ada Lovelace",
            pinnedAt: "2026-07-16T09:00:00Z"
        )
        let personTwoPin = makePeopleWatchPin(
            pinId: "pin-offline-2",
            entityId: "person-2",
            title: "Grace Hopper",
            pinnedAt: "2026-07-16T11:00:00Z"
        )
        let peerTransport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(try peerRelationshipsResponse([personOne, personTwo])),
            .response(try peerRequestsResponse(requests: [], hasMore: false, nextCursor: nil))
        ])
        let pinTransport = PeopleWatchTestTransport(steps: [
            .response(try peopleWatchPinListResponse([personOnePin]))
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: peerTransport,
                identityStore: identityStore
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            watchPinClient: PeopleWatchPinClient(transport: pinTransport)
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        await store.load()
        XCTAssertEqual(store.watchGlance.personName, "Ada Lovelace")

        peerTransport.steps = [.response(try peerRelationshipsResponse([personOne, personTwo]))]
        pinTransport.steps = [.failure(URLError(.notConnectedToInternet))]
        await store.refreshWatchGlance()

        XCTAssertEqual(store.watchGlance.personName, "Ada Lovelace")
        XCTAssertEqual(store.selectedWatchPinId, personOnePin.pinId)
        XCTAssertEqual(store.watchPinErrorMessage, PeopleWatchPinError.offline.userMessage)

        peerTransport.steps = [.response(try peerRelationshipsResponse([personOne, personTwo]))]
        pinTransport.steps = [.response(try peopleWatchPinListResponse([personOnePin, personTwoPin]))]
        await store.retryWatchPinAction()

        XCTAssertEqual(store.watchGlance.personName, "Grace Hopper")
        XCTAssertEqual(store.selectedWatchPinId, personTwoPin.pinId)
        XCTAssertNil(store.watchPinErrorMessage)
    }

    @MainActor
    func testPeopleWatchStoreIgnoresPinResponseAfterHostAndOwnerSwitch() async throws {
        let identityStore = makePeerIdentityStore()
        let identity = try identityStore.identity()
        let relationship = makePeerRelationship(
            id: "relationship-old-host",
            localPersonId: "person-old-host"
        )
        let peerTransport = PeerTestTransport(steps: [
            .response(peerPresenceStatusResponse(deviceId: identity.deviceId)),
            .response(try peerRelationshipsResponse([relationship])),
            .response(try peerRequestsResponse(requests: [], hasMore: false, nextCursor: nil))
        ])
        let pinTransport = PeopleWatchTestTransport(steps: [
            .response(try peopleWatchPinListResponse([]))
        ])
        let store = PeoplePeerStore(
            client: makeEnrolledPeerClient(
                transport: peerTransport,
                identityStore: identityStore
            ),
            replayLedger: PeerReplayLedger(secrets: PeerMemorySecretStore()),
            watchPinClient: PeopleWatchPinClient(transport: pinTransport)
        )
        store.configure(pairing: makePeerPairing(), ownerUserId: "owner-local")
        await store.load()

        let started = expectation(description: "Old-host pin request started")
        let gate = PeopleWatchAsyncResponseGate()
        let oldHostPin = makePeopleWatchPin(
            pinId: "pin-old-host",
            entityId: "person-old-host",
            title: "Must not cross hosts",
            pinnedAt: "2026-07-16T12:00:00Z"
        )
        pinTransport.steps = [
            .handler { _ in
                started.fulfill()
                return await gate.wait()
            }
        ]
        let operation = Task { await store.chooseForWatch(relationship) }
        await fulfillment(of: [started], timeout: 2)

        store.configure(
            pairing: makePeerPairing(
                apiBaseUrl: "https://other-forge.example/api/v1",
                sessionId: "pair-other-host",
                pairingToken: "other-host-token"
            ),
            ownerUserId: "owner-other"
        )
        gate.release(try peopleWatchPinMutationResponse(oldHostPin))
        await operation.value

        XCTAssertEqual(store.watchGlance.selection, .chooseOnIPhone)
        XCTAssertNil(store.watchGlance.personName)
        XCTAssertNil(store.selectedWatchPinId)
        XCTAssertFalse(store.watchPinOperationInFlight)
        XCTAssertTrue(store.relationships.isEmpty)
    }

    @MainActor
    func testPeopleWatchRelayPersistsOnlySameSessionAndCrossSessionClearIsNeutral() throws {
        let (defaults, suiteName) = makeWatchHandoffDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let sessionOne = "pair-people-one"
        let connection = ForgeWatchConnection(
            apiBaseUrl: "https://forge.example/api/v1",
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: sessionOne,
            pairingToken: "watch-token",
            transportLabel: "HTTPS",
            directNetworkingEnabled: true
        )
        defaults.set(
            try JSONEncoder().encode(ForgeWatchBootstrap.empty.withConnection(connection)),
            forKey: ForgeWatchStorage.bootstrapKey
        )
        let selected = ForgeWatchPeopleGlanceSnapshot(
            selection: .selected,
            generatedAt: "2026-07-16T12:00:00Z",
            personName: "Ada Lovelace",
            lastConnectedAt: "2026-07-16T11:59:00Z",
            nextSharedEvent: nil
        )
        let manager = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { false }
        )

        manager.updatePeopleGlance(selected, pairingSessionId: sessionOne)
        XCTAssertEqual(manager.latestBootstrap.people, selected)

        let relaunched = WatchSessionManager(
            syncClient: ForgeSyncClient(),
            defaults: defaults,
            phoneHandoffTransportAvailable: { false }
        )
        XCTAssertEqual(relaunched.latestBootstrap.people, selected)

        let wrongSession = ForgeWatchPeopleGlanceSnapshot(
            selection: .selected,
            generatedAt: "2026-07-16T12:01:00Z",
            personName: "Cross-host name",
            lastConnectedAt: nil,
            nextSharedEvent: nil
        )
        relaunched.updatePeopleGlance(wrongSession, pairingSessionId: "pair-people-two")
        XCTAssertEqual(relaunched.latestBootstrap.people, selected)

        let neutral = ForgeWatchPeopleGlanceSnapshot.chooseOnIPhone(
            generatedAt: "2026-07-16T12:02:00Z"
        )
        relaunched.updatePeopleGlance(neutral, pairingSessionId: "pair-people-two")
        XCTAssertEqual(relaunched.latestBootstrap.people, neutral)
        let wire = String(
            decoding: try JSONEncoder().encode(relaunched.latestBootstrap),
            as: UTF8.self
        ).lowercased()
        for forbidden in ["relationshipid", "grantid", "deviceid", "identityid", "revoke"] {
            XCTAssertFalse(wire.contains(forbidden))
        }
    }

    func testPeerDeepLinksOpenOnlyGenericPeopleManagementWithoutPayloads() throws {
        XCTAssertEqual(
            PeerDeepLinkDestination.parse(try XCTUnwrap(URL(string: "forge-companion://people"))),
            .people
        )
        XCTAssertEqual(
            PeerDeepLinkDestination.parse(try XCTUnwrap(URL(string: "https://forge.example/forge/people"))),
            .people
        )
        for blocked in [
            "forge-companion://people?invitation=secret",
            "forge-companion://people#invite",
            "forge-companion://user:secret@people",
            "forge-companion://people/relationships/relationship-1"
        ] {
            XCTAssertNil(PeerDeepLinkDestination.parse(try XCTUnwrap(URL(string: blocked))))
        }
    }

    func testPeerCameraDenialAndPrivacyRedactionHaveExplicitSafeStates() {
        XCTAssertEqual(PeerCameraAuthorizationPolicy.state(for: .authorized), .authorized)
        XCTAssertEqual(PeerCameraAuthorizationPolicy.state(for: .notDetermined), .request)
        XCTAssertEqual(PeerCameraAuthorizationPolicy.state(for: .denied), .denied)
        XCTAssertEqual(PeerCameraAuthorizationPolicy.state(for: .restricted), .restricted)

        let value = #"{"bootstrap":"BBBB","requestNonce":"NNNN","idempotencyKey":"IIII","sessionId":"session-secret","signature":"SSSS"} secret=token Bearer abc.def"#
        let redacted = PeerPrivacyRedactor.redacted(value)
        XCTAssertFalse(redacted.contains("BBBB"))
        XCTAssertFalse(redacted.contains("NNNN"))
        XCTAssertFalse(redacted.contains("IIII"))
        XCTAssertFalse(redacted.contains("session-secret"))
        XCTAssertFalse(redacted.contains("SSSS"))
        XCTAssertFalse(redacted.contains("token"))
        XCTAssertFalse(redacted.contains("abc.def"))
        XCTAssertTrue(redacted.contains("[redacted]"))
    }

    private func makePeerPairing(
        apiBaseUrl: String = "https://forge.example/api/v1",
        sessionId: String = "pair-peer-tests",
        pairingToken: String = "pairing-token-kept-in-headers"
    ) -> PairingPayload {
        PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: apiBaseUrl,
            uiBaseUrl: "https://forge.example/forge/",
            sessionId: sessionId,
            pairingToken: pairingToken,
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["companion-consent"]
        )
    }

    private func makePeerIdentityStore(
        keys: PeerTestDeviceKeyOperations = PeerTestDeviceKeyOperations(),
        legacySecrets: PeerSecretStoring = PeerMemorySecretStore()
    ) -> PeerDeviceIdentityStore {
        PeerDeviceIdentityStore(keys: keys, legacySecrets: legacySecrets)
    }

    private func makeEnrolledPeerClient(
        transport: PeerTransporting = PeerTestTransport(),
        identityStore: PeerDeviceIdentityStore? = nil,
        capabilityVault: PeerActionCapabilityVault = PeerActionCapabilityVault(
            secrets: PeerMemorySecretStore()
        ),
        enrollmentTransport: PeopleWatchOperatorTransporting? = nil,
        pairing: PairingPayload? = nil,
        ownerUserId: String = "owner-local"
    ) -> PeerAPIClient {
        let resolvedIdentityStore = identityStore ?? makePeerIdentityStore()
        let resolvedPairing = pairing ?? makePeerPairing()
        let enrollmentVault = PeerCompanionEnrollmentVault(
            secrets: PeerMemorySecretStore()
        )
        let identity = try! resolvedIdentityStore.identity()
        let receipt = makePeerEnrollmentReceipt(
            identity: identity,
            pairing: resolvedPairing,
            ownerUserId: ownerUserId
        )
        try! enrollmentVault.saveReceipt(
            receipt,
            context: PeerCompanionEnrollmentContext(
                sessionId: resolvedPairing.sessionId,
                ownerUserId: ownerUserId,
                apiBaseURL: resolvedPairing.apiBaseUrl
            )
        )
        return PeerAPIClient(
            transport: transport,
            identityStore: resolvedIdentityStore,
            capabilityVault: capabilityVault,
            enrollmentVault: enrollmentVault,
            enrollmentTransport: enrollmentTransport
        )
    }

    private func makePeerEnrollmentReceipt(
        identity: PeerDeviceIdentity,
        pairing: PairingPayload,
        ownerUserId: String = "owner-local",
        legacyBootstrapAccepted: Bool = false
    ) -> PeerCompanionEnrollmentReceipt {
        PeerCompanionEnrollmentReceipt(
            protocolName: PeerCompanionSecurityContract.enrollmentProtocol,
            enrollmentId: "enrollment-test",
            keyId: "key-test",
            pairingSessionId: pairing.sessionId,
            ownerUserId: ownerUserId,
            identity: PeerDeviceIdentityRecord(identity),
            scopes: ["peer:grants:manage", "peer:query", "peer:status"],
            capabilities: [
                PeerCompanionSecurityContract.enrollmentProtocol,
                PeerCompanionSecurityContract.requestProtocol,
                PeerCompanionSecurityContract.consentProtocol
            ],
            authorizedOperations: PeerAPIRoute.allCases.map(\.rawValue),
            enrolledAt: "2026-07-16T00:00:00Z",
            legacyBootstrapDisabledAt: "2026-07-16T00:00:00Z",
            legacyBootstrapAccepted: legacyBootstrapAccepted
        )
    }

    private func makePeerInvitation(
        expiresAt: String = "2099-01-01T00:00:00Z"
    ) -> PeerPairingInvite {
        PeerPairingInvite(
            id: "invite-peer-1",
            ownerUserId: "owner-remote",
            inviterPrincipalId: "Ada's Forge",
            inviterDeviceId: "Ada's iPhone",
            fingerprint: "ABCD-EFGH-JKLM-NPQR",
            expiresAt: expiresAt,
            protocolVersion: "forge-peer/1",
            transportKinds: ["local_direct"],
            bootstrap: String(repeating: "B", count: 48),
            signature: String(repeating: "S", count: 86)
        )
    }

    private func makePeerRelationship(
        id: String = "relationship-1",
        ownerUserId: String = "owner-local",
        localPersonId: String? = "person-1",
        status: String = "active",
        remoteDisplayLabel: String = "Ada's Forge",
        lastConnectedAt: String? = "2026-07-15T12:01:00Z",
        updatedAt: String = "2026-07-15T12:01:00Z"
    ) -> PeerRelationship {
        PeerRelationship(
            id: id,
            ownerUserId: ownerUserId,
            localPrincipalId: "principal-local",
            remotePrincipalId: "principal-remote",
            localPersonId: localPersonId,
            status: status,
            negotiatedProtocolVersion: "forge-peer/1",
            transportPrivacyMode: "fastest",
            highestReceivedSequence: 2,
            highestSentSequence: 3,
            establishedAt: "2026-07-15T12:00:00Z",
            lastConnectedAt: lastConnectedAt,
            revokedAt: status == "revoked" ? updatedAt : nil,
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: updatedAt,
            remoteDisplayLabel: remoteDisplayLabel,
            remoteTrustState: "verified"
        )
    }

    private func makePeopleWatchPin(
        pinId: String,
        entityType: String = "person",
        entityId: String,
        title: String,
        ownerUserId: String? = "owner-local",
        availability: String = "available",
        pinnedAt: String
    ) -> PeopleEntityNavigationItem {
        PeopleEntityNavigationItem(
            pinId: pinId,
            entityType: entityType,
            entityId: entityId,
            title: title,
            detail: "",
            category: entityType == "person" ? "Person" : "Task",
            targetPath: entityType == "person"
                ? "/people/\(entityId)"
                : "/tasks/\(entityId)",
            ownerUserId: ownerUserId,
            availability: availability,
            pinnedAt: pinnedAt
        )
    }

    private func peopleWatchPinListResponse(
        _ pins: [PeopleEntityNavigationItem],
        pinnedTotal: Int? = nil,
        generatedAt: String = "2026-07-16T08:00:00Z"
    ) throws -> PeopleWatchOperatorResponse {
        let encodedPins = try pins.map { pin -> [String: Any] in
            let data = try JSONEncoder().encode(pin)
            return try XCTUnwrap(
                JSONSerialization.jsonObject(with: data) as? [String: Any]
            )
        }
        return PeopleWatchOperatorResponse(
            statusCode: 200,
            data: try JSONSerialization.data(
                withJSONObject: [
                    "generatedAt": generatedAt,
                    "pinnedTotal": pinnedTotal ?? pins.count,
                    "recentTotal": 0,
                    "hiddenRecentCount": 0,
                    "pinned": encodedPins,
                    "recent": []
                ],
                options: [.sortedKeys]
            )
        )
    }

    private func peopleWatchPinMutationResponse(
        _ pin: PeopleEntityNavigationItem
    ) throws -> PeopleWatchOperatorResponse {
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(pin)) as? [String: Any]
        )
        return PeopleWatchOperatorResponse(
            statusCode: 201,
            data: try JSONSerialization.data(
                withJSONObject: ["pin": object],
                options: [.sortedKeys]
            )
        )
    }

    private func peopleWatchUnpinResponse(pinId: String) throws -> PeopleWatchOperatorResponse {
        PeopleWatchOperatorResponse(
            statusCode: 200,
            data: try JSONSerialization.data(
                withJSONObject: ["unpinned": true, "pinId": pinId],
                options: [.sortedKeys]
            )
        )
    }

    private func makePeerDevice() -> PeerDevice {
        PeerDevice(
            relationshipId: "relationship-1",
            deviceId: "device-remote-1",
            principalRole: "remote",
            status: "approved",
            label: "Ada's iPhone",
            deviceType: "iphone",
            lastSeenAt: "2026-07-15T12:01:00Z",
            approvedAt: "2026-07-15T12:00:30Z",
            removedAt: nil,
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:01:00Z"
        )
    }

    private func makePeerGrant() -> PeerGrant {
        PeerGrant(
            id: "grant-1",
            relationshipId: "relationship-1",
            direction: "remote_to_local",
            sequence: 1,
            status: "proposed",
            label: "Availability",
            purpose: "Coordinate time",
            issuedAt: "2026-07-15T12:00:00Z",
            effectiveAt: "2026-07-15T12:00:00Z",
            expiresAt: "2099-01-01T00:00:00Z",
            revokedAt: nil,
            rules: [
                PeerGrantRule(
                    id: "rule-availability",
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
                    approvedDeviceIds: ["device-remote-1"],
                    devicePolicy: "explicit",
                    maximumResultCount: 100,
                    maximumPayloadBytes: 262_144
                )
            ],
            protocolVersion: "forge-peer/1",
            schemaVersion: 1,
            versionHash: String(repeating: "b", count: 64),
            cachePolicy: PeerGrantCachePolicy(
                mode: "duration",
                maximumRetentionSeconds: 86_400,
                purgeOnRevocation: true
            )
        )
    }

    private func makePeerPendingRequest(
        id: String,
        kind: String
    ) -> PeerPendingRequest {
        PeerPendingRequest(
            id: id,
            relationshipId: kind == "pairing" ? nil : "relationship-1",
            kind: kind,
            status: "pending",
            version: 1,
            payload: [
                "transcriptHash": .string(String(repeating: "a", count: 64)),
                "verificationPhrase": .string("violet harbor seven"),
                "remoteLabel": .string("Remote Forge")
            ],
            expiresAt: "2099-01-01T00:00:00Z",
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:01:00Z"
        )
    }

    private func makePeerInvitationStatus(
        invitation: PeerPairingInvite
    ) -> PeerInvitationStatus {
        PeerInvitationStatus(
            id: invitation.id,
            status: "active",
            fingerprint: invitation.fingerprint,
            protocolVersion: invitation.protocolVersion,
            transportKinds: invitation.transportKinds,
            failedAttemptCount: 0,
            maximumAttempts: 3,
            expiresAt: invitation.expiresAt,
            claimedAt: nil,
            consumedAt: nil,
            canceledAt: nil,
            createdAt: "2026-07-15T12:00:00Z",
            updatedAt: "2026-07-15T12:01:00Z"
        )
    }

    private func peerJSONResponse(
        _ json: String,
        statusCode: Int = 200,
        headers: [String: String] = [:]
    ) -> PeerTransportResponse {
        PeerTransportResponse(
            statusCode: statusCode,
            headers: headers,
            data: Data(json.utf8)
        )
    }

    private func peerApprovedMutationSteps(
        identityStore: PeerDeviceIdentityStore,
        challenge: String,
        capabilitySecret: String,
        finalData: Data
    ) -> [PeerTestTransportStep] {
        let state = PeerTestConsentState()
        let identity = try! identityStore.identity()
        let publicKey = try! P256.Signing.PublicKey(
            x963Representation: PeerBase64URL.decode(identity.publicKey)!
        )
        return [
            .handler { request in
                let options = try JSONDecoder().decode(
                    PeerTestPresenceOptionsBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                var digestInput = Data("forge-peer/human-presence-action/v1\0".utf8)
                digestInput.append(try encoder.encode(options.action))
                let digest = SHA256.hash(data: digestInput)
                    .map { String(format: "%02x", $0) }
                    .joined()
                let now = Date()
                let response = PeerTestConsentChallenge(
                    protocolName: PeerCompanionSecurityContract.consentProtocol,
                    challengeId: "challenge-test",
                    challenge: challenge,
                    actionDigest: digest,
                    deviceId: options.companionDeviceId,
                    ownerUserId: options.action.ownerUserId,
                    principalId: request.pairing.sessionId,
                    issuedAt: ISO8601DateFormatter().string(from: now),
                    expiresAt: ISO8601DateFormatter().string(
                        from: now.addingTimeInterval(120)
                    )
                )
                state.challenge = response
                state.action = options.action
                return PeerTransportResponse(
                    statusCode: 200,
                    headers: [:],
                    data: try encoder.encode(response)
                )
            },
            .handler { request in
                let verification = try JSONDecoder().decode(
                    PeerTestPresenceVerifyBody.self,
                    from: try XCTUnwrap(request.body)
                )
                let issued = try XCTUnwrap(state.challenge)
                guard
                    verification.challengeId == issued.challengeId,
                    verification.verification.deviceId == issued.deviceId,
                    verification.verification.challenge == issued.challenge,
                    verification.verification.algorithm == identity.algorithm,
                    verification.verification.keyId == "key-test",
                    verification.action == state.action,
                    request.headers["X-Forge-Companion-Public-Key"] == nil,
                    request.headers["X-Forge-Companion-Pairing-Token"] == nil,
                    let signatureData = PeerBase64URL.decode(
                        verification.verification.signature
                    ),
                    let signature = try? P256.Signing.ECDSASignature(
                        derRepresentation: signatureData
                    )
                else {
                    throw PeerAPIError.invalidResponse
                }
                let proof = PeerTestConsentSignatureProof(
                    actionDigest: issued.actionDigest,
                    algorithm: identity.algorithm,
                    challenge: issued.challenge,
                    challengeId: issued.challengeId,
                    deviceId: issued.deviceId,
                    expiresAt: issued.expiresAt,
                    issuedAt: issued.issuedAt,
                    keyId: verification.verification.keyId,
                    ownerUserId: issued.ownerUserId,
                    principalId: issued.principalId,
                    protocolName: issued.protocolName
                )
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                guard publicKey.isValidSignature(signature, for: try encoder.encode(proof)) else {
                    throw PeerAPIError.invalidResponse
                }
                return PeerTransportResponse(
                    statusCode: 200,
                    headers: [
                        "Set-Cookie": "forge_peer_presence=presence-test.\(capabilitySecret); Path=/api/v1/peers; HttpOnly; Secure"
                    ],
                    data: Data(
                        #"{"approved":true,"expiresAt":"2099-01-01T00:00:00Z"}"#.utf8
                    )
                )
            },
            .response(
                PeerTransportResponse(statusCode: 200, headers: [:], data: finalData)
            )
        ]
    }

    private func peerPresenceStatusResponse(deviceId: String) -> PeerTransportResponse {
        let operations = PeerAPIRoute.allCases.map(\.rawValue)
        let object: [String: Any] = [
            "methods": [
                "companionConsent": [
                    "available": true,
                    "protocol": PeerCompanionSecurityContract.consentProtocol,
                    "requestProtocol": PeerCompanionSecurityContract.requestProtocol,
                    "deviceId": deviceId,
                    "scopes": ["peer:grants:manage", "peer:query", "peer:status"],
                    "capabilities": [
                        PeerCompanionSecurityContract.enrollmentProtocol,
                        PeerCompanionSecurityContract.consentProtocol,
                        PeerCompanionSecurityContract.requestProtocol
                    ],
                    "authorizedOperations": operations
                ]
            ],
            "peerCore": [
                "enabled": true,
                "healthy": true,
                "protocolVersion": "forge-peer/1",
                "localDeviceId": "peer-local-device-test"
            ]
        ]
        return PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        )
    }

    private func peerPendingRequestJSONObject(
        id: String,
        kind: String = "pairing"
    ) -> [String: Any] {
        let relationshipId: Any = kind == "pairing" ? NSNull() : "relationship-1"
        return [
            "id": id,
            "relationshipId": relationshipId,
            "kind": kind,
            "status": "pending",
            "version": 1,
            "payload": [
                "transcriptHash": String(repeating: "a", count: 64),
                "verificationPhrase": "amber cedar river"
            ],
            "expiresAt": "2099-01-01T00:00:00Z",
            "createdAt": "2026-07-15T12:00:00Z",
            "updatedAt": "2026-07-15T12:01:00Z"
        ]
    }

    private func peerPendingRequestJSONObject(
        _ request: PeerPendingRequest
    ) throws -> [String: Any] {
        let encoder = JSONEncoder()
        let payload = try JSONSerialization.jsonObject(
            with: encoder.encode(request.payload)
        )
        return [
            "id": request.id,
            "relationshipId": request.relationshipId.map { $0 as Any } ?? NSNull(),
            "kind": request.kind,
            "status": request.status,
            "version": request.version,
            "payload": payload,
            "expiresAt": request.expiresAt,
            "createdAt": request.createdAt,
            "updatedAt": request.updatedAt
        ]
    }

    private func peerRequestEnvelopeData(
        request: PeerPendingRequest
    ) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: ["request": try peerPendingRequestJSONObject(request)],
            options: [.sortedKeys]
        )
    }

    private func peerConfirmationEnvelopeData(
        relationshipId: String,
        request: PeerPendingRequest
    ) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: [
                "relationshipId": relationshipId,
                "request": try peerPendingRequestJSONObject(request)
            ],
            options: [.sortedKeys]
        )
    }

    private func peerInvitationStatusResponse(
        _ status: PeerInvitationStatus
    ) throws -> PeerTransportResponse {
        PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try JSONSerialization.data(
                withJSONObject: [
                    "invitation": [
                        "id": status.id,
                        "status": status.status,
                        "fingerprint": status.fingerprint,
                        "protocolVersion": status.protocolVersion,
                        "transportKinds": status.transportKinds,
                        "failedAttemptCount": status.failedAttemptCount,
                        "maximumAttempts": status.maximumAttempts,
                        "expiresAt": status.expiresAt,
                        "claimedAt": status.claimedAt.map { $0 as Any } ?? NSNull(),
                        "consumedAt": status.consumedAt.map { $0 as Any } ?? NSNull(),
                        "canceledAt": status.canceledAt.map { $0 as Any } ?? NSNull(),
                        "createdAt": status.createdAt,
                        "updatedAt": status.updatedAt
                    ]
                ],
                options: [.sortedKeys]
            )
        )
    }

    private func peerRequestsResponse(
        requests: [[String: Any]],
        hasMore: Bool,
        nextCursor: String?
    ) throws -> PeerTransportResponse {
        PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try JSONSerialization.data(
                withJSONObject: [
                    "requests": requests,
                    "page": [
                        "limit": 100,
                        "hasMore": hasMore,
                        "nextCursor": nextCursor.map { $0 as Any } ?? NSNull()
                    ]
                ],
                options: [.sortedKeys]
            )
        )
    }

    private func peerRelationshipsResponse(
        _ relationships: [PeerRelationship],
        hasMore: Bool = false,
        nextCursor: String? = nil
    ) throws -> PeerTransportResponse {
        PeerTransportResponse(
            statusCode: 200,
            headers: [:],
            data: try JSONEncoder().encode(PeerTestRelationshipsBody(
                relationships: relationships,
                page: PeerTestPageBody(
                    limit: 100,
                    hasMore: hasMore,
                    nextCursor: nextCursor
                )
            ))
        )
    }

    private func makeWatchHandoffDefaults() -> (UserDefaults, String) {
        let suiteName = "ForgeCompanionTests.watch-handoff.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return (defaults, suiteName)
    }

    private func makeWatchHandoffPairing() -> PairingPayload {
        PairingPayload(
            kind: "forge-companion-pairing",
            apiBaseUrl: "forge-iroh://paired-node/api/v1",
            uiBaseUrl: "forge-iroh://paired-node/forge/",
            sessionId: "pair-watch-handoff",
            pairingToken: "watch-handoff-token",
            expiresAt: "2099-01-01T00:00:00Z",
            capabilities: ["watch-ready"],
            transportMode: "iroh",
            transport: nil
        )
    }

    func testCompanionForgeTargetURLResolverKeepsPinnedPathsInsideForge() throws {
        let httpsURL = CompanionForgeTargetURLResolver.resolve(
            baseURL: URL(string: "https://forge.example/forge"),
            targetPath: "/calendar?focus=timebox-1&focusType=task_timebox"
        )
        XCTAssertEqual(
            httpsURL?.absoluteString,
            "https://forge.example/forge/calendar?focus=timebox-1&focusType=task_timebox"
        )

        let irohURL = CompanionForgeTargetURLResolver.resolve(
            baseURL: URL(string: "forge-iroh://node-id/forge/"),
            targetPath: "/tasks/task-1"
        )
        XCTAssertEqual(
            irohURL?.absoluteString,
            "forge-iroh://node-id/forge/tasks/task-1"
        )

        XCTAssertNil(
            CompanionForgeTargetURLResolver.resolve(
                baseURL: nil,
                targetPath: "/tasks/task-1"
            )
        )
        XCTAssertNil(
            CompanionForgeTargetURLResolver.resolve(
                baseURL: URL(string: "https://forge.example/forge/"),
                targetPath: "https://untrusted.example/file"
            )
        )
        XCTAssertNil(
            CompanionForgeTargetURLResolver.resolve(
                baseURL: URL(string: "https://forge.example/forge/"),
                targetPath: "//untrusted.example/file"
            )
        )
    }

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }
}
