import Foundation
import UIKit

final class ForgeServerDiscovery {
    struct BonjourSeed: Hashable {
        let name: String
        let host: String
    }

    private static let forgeApiPort = 4317
    private static let forgeUiPort = 3027
    private static let maxConcurrentProbes = 40

    func discoverServers() async -> [DiscoveredForgeServer] {
        companionDebugLog("ForgeServerDiscovery", "discoverServers start")
        if isRunningInSimulator {
            companionDebugLog("ForgeServerDiscovery", "discoverServers simulator shortcut")
            return [
                DiscoveredForgeServer(
                    id: "simulator-local-forge",
                    name: "Local Forge",
                    host: "127.0.0.1",
                    apiBaseUrl: "http://127.0.0.1:4317",
                    uiBaseUrl: "http://127.0.0.1:3027/forge/",
                    source: .simulator,
                    canBootstrapPairing: true,
                    detail: "Simulator local development runtime"
                )
            ]
        }

        async let bonjourSeeds = Self.discoverBonjourSeeds(timeout: 3.0)
        async let tailscalePeers = Self.fetchTailscalePeers()
        async let lanCandidates = Self.scanLanForForge()

        var candidates: [DiscoveredForgeServer] = []
        candidates.append(contentsOf: await lanCandidates)
        companionDebugLog("ForgeServerDiscovery", "discoverServers lanCandidates=\(candidates.count)")

        let seeds = await bonjourSeeds
        companionDebugLog("ForgeServerDiscovery", "discoverServers bonjourSeeds=\(seeds.count)")
        for seed in seeds {
            if let server = await Self.probeForgeHost(
                host: seed.host,
                name: seed.name,
                source: .bonjour
            ) {
                candidates.append(server)
            }
        }

        let peers = await tailscalePeers
        companionDebugLog("ForgeServerDiscovery", "discoverServers tailscalePeers=\(peers.count)")
        for peer in peers {
            if let server = await Self.probeForgeHost(
                host: peer.host,
                name: peer.name,
                source: .tailscale
            ) {
                candidates.append(server)
            }
        }

        let reconciled = Self.reconcile(candidates)
        companionDebugLog("ForgeServerDiscovery", "discoverServers complete reconciled=\(reconciled.count)")
        return reconciled
    }

    private var isRunningInSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    private static func reconcile(_ servers: [DiscoveredForgeServer]) -> [DiscoveredForgeServer] {
        var byHost: [String: DiscoveredForgeServer] = [:]
        for server in servers {
            let key = normalizedHostKey(server.host)
            if let existing = byHost[key] {
                byHost[key] = preferredServer(existing, server)
            } else {
                byHost[key] = server
            }
        }

        return byHost.values.sorted {
            sourceRank($0.source) < sourceRank($1.source)
                || (sourceRank($0.source) == sourceRank($1.source) && $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending)
        }
    }

    private static func preferredServer(
        _ lhs: DiscoveredForgeServer,
        _ rhs: DiscoveredForgeServer
    ) -> DiscoveredForgeServer {
        if sourceRank(rhs.source) < sourceRank(lhs.source) {
            return rhs
        }
        if lhs.name == lhs.host && rhs.name != rhs.host {
            return rhs
        }
        return lhs
    }

    private static func sourceRank(_ source: ForgeDiscoverySource) -> Int {
        switch source {
        case .simulator:
            return 0
        case .tailscale:
            return 1
        case .bonjour:
            return 2
        case .lan:
            return 3
        }
    }

    private static func normalizedHostKey(_ raw: String) -> String {
        raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()
    }

    private static func probeForgeHost(
        host: String,
        name: String,
        source: ForgeDiscoverySource
    ) async -> DiscoveredForgeServer? {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedHost.isEmpty else {
            companionDebugLog("ForgeServerDiscovery", "probeForgeHost skipped empty host")
            return nil
        }

        let apiBaseUrl = "http://\(trimmedHost):\(forgeApiPort)"
        companionDebugLog(
            "ForgeServerDiscovery",
            "probeForgeHost start host=\(trimmedHost) source=\(source)"
        )
        guard await probeForgeHealth(apiBaseUrl: apiBaseUrl) else {
            companionDebugLog("ForgeServerDiscovery", "probeForgeHost health failed host=\(trimmedHost)")
            return nil
        }

        let displayName = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? trimmedHost
            : name.trimmingCharacters(in: .whitespacesAndNewlines)
        let canBootstrap = source == .tailscale
        let detail = canBootstrap
            ? "Trusted network target with one-tap pairing"
            : "Open Forge on this machine and generate a mobile QR code"

        let server = DiscoveredForgeServer(
            id: "forge-\(trimmedHost)",
            name: displayName,
            host: trimmedHost,
            apiBaseUrl: apiBaseUrl,
            uiBaseUrl: "http://\(trimmedHost):\(forgeUiPort)/forge/",
            source: source,
            canBootstrapPairing: canBootstrap,
            detail: detail
        )
        companionDebugLog(
            "ForgeServerDiscovery",
            "probeForgeHost success host=\(trimmedHost) name=\(displayName) canBootstrap=\(canBootstrap)"
        )
        return server
    }

    private static func probeForgeHealth(apiBaseUrl: String) async -> Bool {
        guard let url = URL(string: "\(apiBaseUrl)/health") else {
            companionDebugLog("ForgeServerDiscovery", "probeForgeHealth badURL apiBaseUrl=\(apiBaseUrl)")
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.4
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                companionDebugLog("ForgeServerDiscovery", "probeForgeHealth no HTTP response url=\(url.absoluteString)")
                return false
            }
            let success = (200..<300).contains(http.statusCode)
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeForgeHealth response url=\(url.absoluteString) status=\(http.statusCode) success=\(success)"
            )
            return success
        } catch {
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeForgeHealth failed url=\(url.absoluteString) error=\(error.localizedDescription)"
            )
            return false
        }
    }

    private static func scanLanForForge() async -> [DiscoveredForgeServer] {
        guard let localIPv4 = localIPv4Address() else {
            companionDebugLog("ForgeServerDiscovery", "scanLanForForge no local IPv4")
            return []
        }

        let octets = localIPv4.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else {
            return []
        }

        let prefix = "\(octets[0]).\(octets[1]).\(octets[2])."
        let localLast = octets[3]
        let limiter = ProbeLimiter(maxConcurrentProbes)
        companionDebugLog("ForgeServerDiscovery", "scanLanForForge start prefix=\(prefix) localLast=\(localLast)")

        let discovered = await withTaskGroup(of: DiscoveredForgeServer?.self, returning: [DiscoveredForgeServer].self) { group in
            for lastOctet in 1...254 {
                guard lastOctet != localLast else {
                    continue
                }
                let host = "\(prefix)\(lastOctet)"
                group.addTask {
                    await limiter.acquire()
                    let result = await probeForgeHost(host: host, name: host, source: .lan)
                    await limiter.release()
                    return result
                }
            }

            var discovered: [DiscoveredForgeServer] = []
            for await server in group {
                if let server {
                    discovered.append(server)
                }
            }
            return discovered
        }
        companionDebugLog("ForgeServerDiscovery", "scanLanForForge complete count=\(discovered.count)")
        return discovered
    }

    private static func fetchTailscalePeers() async -> [(host: String, name: String)] {
        guard let url = URL(string: "http://100.100.100.100/localapi/v0/status") else {
            companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers badURL")
            return []
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 1.8
        configuration.timeoutIntervalForResource = 2.0
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration)

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.8

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers non-200")
                return []
            }
            let peers = parseTailscalePeers(data: data)
            companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers success count=\(peers.count)")
            return peers
        } catch {
            companionDebugLog(
                "ForgeServerDiscovery",
                "fetchTailscalePeers failed error=\(error.localizedDescription)"
            )
            return []
        }
    }

    private static func parseTailscalePeers(data: Data) -> [(host: String, name: String)] {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let peers = json["Peer"] as? [String: Any]
        else {
            companionDebugLog("ForgeServerDiscovery", "parseTailscalePeers invalid JSON")
            return []
        }

        var results: [(host: String, name: String)] = []
        for value in peers.values {
            guard let peer = value as? [String: Any] else {
                continue
            }
            if let online = peer["Online"] as? Bool, !online {
                continue
            }
            let displayName = (peer["HostName"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let ips = peer["TailscaleIPs"] as? [String] ?? []
            guard let ipv4 = ips.first(where: isIPv4Address) else {
                continue
            }
            results.append((host: ipv4, name: displayName?.isEmpty == false ? displayName! : ipv4))
        }
        companionDebugLog("ForgeServerDiscovery", "parseTailscalePeers parsed count=\(results.count)")
        return results
    }

    private static func isIPv4Address(_ value: String) -> Bool {
        var addr = in_addr()
        return value.withCString { inet_pton(AF_INET, $0, &addr) == 1 }
    }

    private static func localIPv4Address() -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else {
            return nil
        }
        defer { freeifaddrs(ifaddr) }

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else {
                continue
            }
            guard ptr.pointee.ifa_addr.pointee.sa_family == UInt8(AF_INET) else {
                continue
            }
            let name = String(cString: ptr.pointee.ifa_name)
            guard name.hasPrefix("en") else {
                continue
            }
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            _ = ptr.pointee.ifa_addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sin in
                inet_ntop(AF_INET, &sin.pointee.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN))
            }
            let address = String(cString: buffer)
            companionDebugLog("ForgeServerDiscovery", "localIPv4Address -> \(address)")
            return address
        }

        companionDebugLog("ForgeServerDiscovery", "localIPv4Address none")
        return nil
    }

    private static func discoverBonjourSeeds(timeout: TimeInterval) async -> [BonjourSeed] {
        let browser = await MainActor.run {
            BonjourServiceDiscoverer(serviceType: "_forge._tcp.")
        }
        return await browser.discover(timeout: timeout)
    }
}

@MainActor
private final class BonjourServiceDiscoverer: NSObject, @preconcurrency NetServiceBrowserDelegate, @preconcurrency NetServiceDelegate {
    private let serviceType: String
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    private var results: [String: String] = [:]
    private var pendingServices: Set<ObjectIdentifier> = []
    private var continuation: CheckedContinuation<[ForgeServerDiscovery.BonjourSeed], Never>?
    private var timeoutTask: Task<Void, Never>?
    private var isFinished = false
    private var requestedStop = false

    init(serviceType: String) {
        self.serviceType = serviceType
    }

    func discover(timeout: TimeInterval) async -> [ForgeServerDiscovery.BonjourSeed] {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            browser.delegate = self
            browser.searchForServices(ofType: serviceType, inDomain: "local.")
            timeoutTask = Task { [weak self] in
                guard let self else { return }
                try? await Task.sleep(nanoseconds: UInt64(max(timeout, 0.25) * 1_000_000_000))
                self.stopAndFinish()
            }
        }
    }

    private func stopAndFinish() {
        guard !requestedStop else { return }
        companionDebugLog("BonjourServiceDiscoverer", "stopAndFinish pending=\(pendingServices.count)")
        requestedStop = true
        browser.stop()
        if pendingServices.isEmpty {
            finish()
        }
    }

    private func finish() {
        guard !isFinished else { return }
        isFinished = true
        timeoutTask?.cancel()
        for service in services {
            service.stop()
            service.delegate = nil
        }
        let seeds = results.map { ForgeServerDiscovery.BonjourSeed(name: $0.value, host: $0.key) }
        companionDebugLog("BonjourServiceDiscoverer", "finish seeds=\(seeds.count)")
        continuation?.resume(returning: seeds)
        continuation = nil
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard !isFinished else { return }
        companionDebugLog("BonjourServiceDiscoverer", "didFind service=\(service.name) moreComing=\(moreComing)")
        services.append(service)
        pendingServices.insert(ObjectIdentifier(service))
        service.delegate = self
        service.resolve(withTimeout: 2.0)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        pendingServices.remove(ObjectIdentifier(sender))
        for address in sender.addresses ?? [] {
            guard let ip = ipv4Address(fromSockaddrData: address) else { continue }
            results[ip] = sender.name
            companionDebugLog("BonjourServiceDiscoverer", "resolved service=\(sender.name) ip=\(ip)")
            break
        }
        if requestedStop, pendingServices.isEmpty {
            finish()
        }
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String : NSNumber]) {
        companionDebugLog("BonjourServiceDiscoverer", "didNotResolve service=\(sender.name)")
        pendingServices.remove(ObjectIdentifier(sender))
        if requestedStop, pendingServices.isEmpty {
            finish()
        }
    }

    func netServiceBrowserDidStopSearch(_ browser: NetServiceBrowser) {
        companionDebugLog("BonjourServiceDiscoverer", "didStopSearch")
        finish()
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String : NSNumber]) {
        companionDebugLog("BonjourServiceDiscoverer", "didNotSearch")
        finish()
    }

    private func ipv4Address(fromSockaddrData data: Data) -> String? {
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return nil }
            let sockaddrPtr = base.assumingMemoryBound(to: sockaddr.self)
            guard sockaddrPtr.pointee.sa_family == sa_family_t(AF_INET) else { return nil }
            let sinPtr = base.assumingMemoryBound(to: sockaddr_in.self)
            var addr = sinPtr.pointee.sin_addr
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else {
                return nil
            }
            return String(cString: buffer)
        }
    }
}

private actor ProbeLimiter {
    private var available: Int
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(_ value: Int) {
        self.available = value
    }

    func acquire() async {
        if available > 0 {
            available -= 1
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func release() {
        if let waiter = waiters.first {
            waiters.removeFirst()
            waiter.resume()
        } else {
            available += 1
        }
    }
}
