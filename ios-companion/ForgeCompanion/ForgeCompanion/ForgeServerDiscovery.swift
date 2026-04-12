import Foundation
import UIKit

final class ForgeServerDiscovery {
    struct ManualProbeCandidate: Hashable {
        let host: String
        let apiBaseUrl: String
        let uiBaseUrl: String
        let source: ForgeDiscoverySource
        let detail: String
        let canBootstrapPairing: Bool
    }

    private enum StorageKeys {
        static let recentHosts = "forge_companion_recent_runtime_hosts"
    }

    private struct TailscalePeerFetchResult {
        let peers: [TailscalePeer]
        let statusMessage: String
    }

    private struct TailscalePeerProbeResult {
        let device: DiscoveredTailscaleDevice
        let server: DiscoveredForgeServer?
    }

    struct BonjourSeed: Hashable {
        let name: String
        let host: String
        let txtRecords: [String: String]
    }

    private struct TailscalePeer: Hashable {
        let host: String
        let name: String
        let dnsName: String?
    }

    private static let forgeApiPort = 4317
    private static let forgeUiPort = 3027
    private static let maxConcurrentProbes = 40
    private static let maxConcurrentTailscalePeerProbes = 8
    private static let maxRememberedHosts = 6

    func probeManualRuntime(_ rawInput: String) async -> DiscoveredForgeServer? {
        let candidates = Self.manualProbeCandidates(for: rawInput)
        companionDebugLog(
            "ForgeServerDiscovery",
            "probeManualRuntime start raw=\(rawInput) candidates=\(candidates.count)"
        )

        for candidate in candidates {
            async let apiProbe = Self.probeForgeHealth(apiBaseUrl: candidate.apiBaseUrl)
            async let uiProbe = Self.probeForgeUi(uiBaseUrl: candidate.uiBaseUrl)
            let apiReachable = await apiProbe
            let uiReachable = await uiProbe
            if apiReachable && uiReachable {
                let server = DiscoveredForgeServer(
                    id: "forge-manual-\(candidate.host)",
                    name: candidate.host,
                    host: candidate.host,
                    apiBaseUrl: candidate.apiBaseUrl,
                    uiBaseUrl: candidate.uiBaseUrl,
                    source: candidate.source,
                    canBootstrapPairing: candidate.canBootstrapPairing,
                    detail: candidate.detail
                )
                companionDebugLog(
                    "ForgeServerDiscovery",
                    "probeManualRuntime success host=\(candidate.host) api=\(candidate.apiBaseUrl)"
                )
                return server
            }
        }

        companionDebugLog("ForgeServerDiscovery", "probeManualRuntime no match raw=\(rawInput)")
        return nil
    }

    func discoverEnvironment() async -> ForgeDiscoveryReport {
        companionDebugLog("ForgeServerDiscovery", "discoverEnvironment start")
        if isRunningInSimulator {
            companionDebugLog("ForgeServerDiscovery", "discoverEnvironment simulator shortcut")
            return ForgeDiscoveryReport(
                servers: [
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
                ],
                tailscaleDevices: [],
                tailscaleStatusMessage: "Simulator mode skips Tailscale peer discovery."
            )
        }

        var candidates: [DiscoveredForgeServer] = []
        var tailscaleDevices: [DiscoveredTailscaleDevice] = []
        let seeds = await Self.discoverBonjourSeeds(timeout: 3.0)
        companionDebugLog("ForgeServerDiscovery", "discoverEnvironment bonjourSeeds=\(seeds.count)")
        for seed in seeds {
            candidates.append(contentsOf: await Self.probeBonjourSeed(seed))
        }

        let tailscaleReport = await Self.discoverTailscalePeers()
        tailscaleDevices = tailscaleReport.devices
        candidates.append(contentsOf: tailscaleReport.servers)
        companionDebugLog(
            "ForgeServerDiscovery",
            "discoverEnvironment tailscaleDevices=\(tailscaleDevices.count) tailscaleServers=\(tailscaleReport.servers.count)"
        )

        if candidates.contains(where: { $0.source == .tailscale }) {
            companionDebugLog("ForgeServerDiscovery", "discoverEnvironment tailscale candidate available")
        }

        if candidates.isEmpty {
            let rememberedCandidates = await Self.probeRememberedHosts()
            candidates.append(contentsOf: rememberedCandidates)
            companionDebugLog(
                "ForgeServerDiscovery",
                "discoverEnvironment rememberedCandidates=\(rememberedCandidates.count)"
            )
        }

        if candidates.isEmpty {
            let lanCandidates = await Self.scanLanForForge()
            candidates.append(contentsOf: lanCandidates)
            companionDebugLog("ForgeServerDiscovery", "discoverEnvironment lanCandidates=\(lanCandidates.count)")
        } else {
            companionDebugLog("ForgeServerDiscovery", "discoverEnvironment skippedLanScan existingCandidates=\(candidates.count)")
        }

        let reconciled = Self.reconcile(candidates)
        let reconciledTailscaleDevices = Self.reconcileTailscaleDevices(tailscaleDevices)
        companionDebugLog(
            "ForgeServerDiscovery",
            "discoverEnvironment complete reconciled=\(reconciled.count) tailscaleDevices=\(reconciledTailscaleDevices.count)"
        )
        return ForgeDiscoveryReport(
            servers: reconciled,
            tailscaleDevices: reconciledTailscaleDevices,
            tailscaleStatusMessage: tailscaleReport.statusMessage
        )
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

    private static func reconcileTailscaleDevices(
        _ devices: [DiscoveredTailscaleDevice]
    ) -> [DiscoveredTailscaleDevice] {
        var byHost: [String: DiscoveredTailscaleDevice] = [:]
        for device in devices {
            let key = normalizedHostKey(device.dnsName ?? device.host)
            if let existing = byHost[key] {
                byHost[key] = preferredTailscaleDevice(existing, device)
            } else {
                byHost[key] = device
            }
        }

        return byHost.values.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private static func preferredTailscaleDevice(
        _ lhs: DiscoveredTailscaleDevice,
        _ rhs: DiscoveredTailscaleDevice
    ) -> DiscoveredTailscaleDevice {
        let lhsScore = (lhs.forgeApiReachable ? 1 : 0) + (lhs.forgeUiReachable ? 1 : 0)
        let rhsScore = (rhs.forgeApiReachable ? 1 : 0) + (rhs.forgeUiReachable ? 1 : 0)
        if rhsScore > lhsScore {
            return rhs
        }
        if lhs.dnsName == nil, rhs.dnsName != nil {
            return rhs
        }
        return lhs
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

        let requestHost = formattedHostForURL(trimmedHost)
        let apiBaseUrl = "http://\(requestHost):\(forgeApiPort)"
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
            uiBaseUrl: "http://\(requestHost):\(forgeUiPort)/forge/",
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

    private static func probeTailscalePeer(_ peer: TailscalePeer) async -> TailscalePeerProbeResult {
        let trimmedHost = peer.host.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = peer.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let dnsHost = peer.dnsName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))

        companionDebugLog(
            "ForgeServerDiscovery",
            "probeTailscalePeer start host=\(trimmedHost) dns=\(dnsHost ?? "nil")"
        )

        let displayName = trimmedName.isEmpty ? (dnsHost ?? trimmedHost) : trimmedName
        let apiBaseUrl = dnsHost.map { "https://\($0)/api/v1" }
        let uiBaseUrl = dnsHost.map { "https://\($0)/forge/" }
        var apiReachable = false
        var uiReachable = false

        if let dnsHost, !dnsHost.isEmpty {
            async let apiProbe = probeForgeHealth(apiBaseUrl: "https://\(dnsHost)/api/v1")
            async let uiProbe = probeForgeUi(uiBaseUrl: "https://\(dnsHost)/forge/")
            apiReachable = await apiProbe
            uiReachable = await uiProbe
            if apiReachable, uiReachable {
                let server = DiscoveredForgeServer(
                    id: "forge-ts-\(dnsHost)",
                    name: displayName,
                    host: dnsHost,
                    apiBaseUrl: "https://\(dnsHost)/api/v1",
                    uiBaseUrl: "https://\(dnsHost)/forge/",
                    source: .tailscale,
                    canBootstrapPairing: true,
                    detail: "Tailscale HTTPS target via tailscale serve"
                )
                companionDebugLog(
                    "ForgeServerDiscovery",
                    "probeTailscalePeer success dns=\(dnsHost) name=\(displayName)"
                )
                return TailscalePeerProbeResult(
                    device: DiscoveredTailscaleDevice(
                        id: "ts-device-\(dnsHost)",
                        name: displayName,
                        host: trimmedHost,
                        dnsName: dnsHost,
                        forgeApiBaseUrl: apiBaseUrl,
                        forgeUiBaseUrl: uiBaseUrl,
                        forgeApiReachable: apiReachable,
                        forgeUiReachable: uiReachable,
                        detail: "Forge API and /forge route reachable over Tailscale"
                    ),
                    server: server
                )
            }
        }

        let detail: String
        if dnsHost == nil {
            detail = "MagicDNS hostname unavailable for this Tailscale device."
        } else if apiReachable {
            detail = "Forge API responded over Tailscale, but /forge did not."
        } else if uiReachable {
            detail = "/forge responded over Tailscale, but the Forge API did not."
        } else {
            detail = "No Forge /api or /forge route detected over Tailscale."
        }
        companionDebugLog(
            "ForgeServerDiscovery",
            "probeTailscalePeer no Forge serve routes dns=\(dnsHost ?? "nil") api=\(apiReachable) ui=\(uiReachable)"
        )
        return TailscalePeerProbeResult(
            device: DiscoveredTailscaleDevice(
                id: "ts-device-\(dnsHost ?? trimmedHost)",
                name: displayName,
                host: trimmedHost,
                dnsName: dnsHost,
                forgeApiBaseUrl: apiBaseUrl,
                forgeUiBaseUrl: uiBaseUrl,
                forgeApiReachable: apiReachable,
                forgeUiReachable: uiReachable,
                detail: detail
            ),
            server: nil
        )
    }

    private static func probeBonjourSeed(_ seed: BonjourSeed) async -> [DiscoveredForgeServer] {
        if let tailscaleServer = await probeTailscaleAdvertisement(seed) {
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeBonjourSeed using tailscale-preferred service=\(seed.name)"
            )
            return [tailscaleServer]
        }

        if let localServer = await probeForgeHost(host: seed.host, name: seed.name, source: .bonjour) {
            return [localServer]
        }

        return []
    }

    private static func probeTailscaleAdvertisement(_ seed: BonjourSeed) async -> DiscoveredForgeServer? {
        let rawApiBaseUrl = seed.txtRecords["tsApiBaseUrl"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawUiBaseUrl = seed.txtRecords["tsUiBaseUrl"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawDnsName = seed.txtRecords["tsDnsName"]?.trimmingCharacters(in: .whitespacesAndNewlines)

        let apiBaseUrl = normalizedTailscaleBaseUrl(rawApiBaseUrl)
        let uiBaseUrl = normalizedTailscaleUiUrl(rawUiBaseUrl)
        let dnsName = rawDnsName?.trimmingCharacters(in: CharacterSet(charactersIn: "."))

        companionDebugLog(
            "ForgeServerDiscovery",
            "probeTailscaleAdvertisement start service=\(seed.name) dns=\(dnsName ?? "nil") api=\(apiBaseUrl ?? "nil")"
        )

        guard let apiBaseUrl else {
            return nil
        }
        let resolvedUiBaseUrl = uiBaseUrl ?? inferredUiBaseUrl(from: apiBaseUrl)
        async let apiProbe = probeForgeHealth(apiBaseUrl: apiBaseUrl)
        async let uiProbe = probeForgeUi(uiBaseUrl: resolvedUiBaseUrl)
        guard await apiProbe else {
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeTailscaleAdvertisement health failed service=\(seed.name)"
            )
            return nil
        }
        guard await uiProbe else {
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeTailscaleAdvertisement ui failed service=\(seed.name)"
            )
            return nil
        }

        let host = dnsName?.isEmpty == false ? dnsName! : URL(string: apiBaseUrl)?.host ?? seed.host
        let server = DiscoveredForgeServer(
            id: "forge-ts-bonjour-\(host)",
            name: seed.name,
            host: host,
            apiBaseUrl: apiBaseUrl,
            uiBaseUrl: resolvedUiBaseUrl,
            source: .tailscale,
            canBootstrapPairing: true,
            detail: "Tailscale HTTPS target advertised by Forge"
        )
        companionDebugLog(
            "ForgeServerDiscovery",
            "probeTailscaleAdvertisement success service=\(seed.name) host=\(host)"
        )
        return server
    }

    private static func probeForgeUi(uiBaseUrl: String) async -> Bool {
        guard let url = URL(string: uiBaseUrl) else {
            companionDebugLog("ForgeServerDiscovery", "probeForgeUi badURL uiBaseUrl=\(uiBaseUrl)")
            return false
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.4
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                companionDebugLog("ForgeServerDiscovery", "probeForgeUi no HTTP response url=\(url.absoluteString)")
                return false
            }
            let success = (200..<400).contains(http.statusCode)
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeForgeUi response url=\(url.absoluteString) status=\(http.statusCode) success=\(success)"
            )
            return success
        } catch {
            companionDebugLog(
                "ForgeServerDiscovery",
                "probeForgeUi failed url=\(url.absoluteString) error=\(error.localizedDescription)"
            )
            return false
        }
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
        let candidateHosts = lanCandidateHosts(prefix: prefix, localLast: localLast)
        companionDebugLog(
            "ForgeServerDiscovery",
            "scanLanForForge start prefix=\(prefix) localLast=\(localLast) candidates=\(candidateHosts.count)"
        )

        let discovered = await withTaskGroup(of: DiscoveredForgeServer?.self, returning: [DiscoveredForgeServer].self) { group in
            for host in candidateHosts {
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

    private static func discoverTailscalePeers() async -> (
        devices: [DiscoveredTailscaleDevice],
        servers: [DiscoveredForgeServer],
        statusMessage: String
    ) {
        let fetchResult = await fetchTailscalePeers()
        guard !fetchResult.peers.isEmpty else {
            return ([], [], fetchResult.statusMessage)
        }

        let limiter = ProbeLimiter(maxConcurrentTailscalePeerProbes)
        let results = await withTaskGroup(of: TailscalePeerProbeResult.self, returning: [TailscalePeerProbeResult].self) { group in
            for peer in fetchResult.peers {
                group.addTask {
                    await limiter.acquire()
                    let result = await probeTailscalePeer(peer)
                    await limiter.release()
                    return result
                }
            }

            var values: [TailscalePeerProbeResult] = []
            for await result in group {
                values.append(result)
            }
            return values
        }

        let devices = results.map(\.device)
        let servers = results.compactMap(\.server)
        let reachableForgeCount = devices.filter { $0.forgeApiReachable || $0.forgeUiReachable }.count
        let statusMessage = "\(devices.count) Tailscale device\(devices.count == 1 ? "" : "s") visible. Forge routes detected on \(reachableForgeCount)."
        return (devices, servers, statusMessage)
    }

    private static func fetchTailscalePeers() async -> TailscalePeerFetchResult {
        guard let url = URL(string: "http://100.100.100.100/localapi/v0/status") else {
            companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers badURL")
            return TailscalePeerFetchResult(peers: [], statusMessage: "Tailscale LocalAPI URL is invalid.")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 1.2
        configuration.timeoutIntervalForResource = 1.4
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration)

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.8
        request.setValue("local-tailscaled.sock", forHTTPHeaderField: "Host")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers non-200")
                return TailscalePeerFetchResult(
                    peers: [],
                    statusMessage: "Tailscale is installed, but its local status endpoint did not answer cleanly."
                )
            }
            let peers = parseTailscalePeers(data: data)
            companionDebugLog("ForgeServerDiscovery", "fetchTailscalePeers success count=\(peers.count)")
            let statusMessage = peers.isEmpty
                ? "No online Tailscale peers were reported by this phone."
                : "Found \(peers.count) online Tailscale peer\(peers.count == 1 ? "" : "s")."
            return TailscalePeerFetchResult(peers: peers, statusMessage: statusMessage)
        } catch {
            companionDebugLog(
                "ForgeServerDiscovery",
                "fetchTailscalePeers failed error=\(error.localizedDescription)"
            )
            return TailscalePeerFetchResult(
                peers: [],
                statusMessage: "This iPhone cannot read the Tailscale app peer list here. Use Manual setup with a known .ts.net machine name."
            )
        }
    }

    static func manualProbeCandidates(for rawInput: String) -> [ManualProbeCandidate] {
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return []
        }

        let lowered = trimmed.lowercased()
        let hasExplicitScheme = lowered.hasPrefix("http://") || lowered.hasPrefix("https://")
        let inferredHost = hasExplicitScheme ? (URL(string: trimmed)?.host ?? trimmed) : trimmed
        let normalizedHost = normalizedHostKey(inferredHost)
        guard !normalizedHost.isEmpty else {
            return []
        }

        let isMagicDNS = normalizedHost.contains(".ts.net")
        if !hasExplicitScheme {
            if isMagicDNS {
                return [
                    ManualProbeCandidate(
                        host: normalizedHost,
                        apiBaseUrl: "https://\(normalizedHost)/api/v1",
                        uiBaseUrl: "https://\(normalizedHost)/forge/",
                        source: .tailscale,
                        detail: "Manual Tailscale target via tailscale serve",
                        canBootstrapPairing: true
                    )
                ]
            }

            let requestHost = formattedHostForURL(normalizedHost)
            return [
                ManualProbeCandidate(
                    host: normalizedHost,
                    apiBaseUrl: "http://\(requestHost):\(forgeApiPort)",
                    uiBaseUrl: "http://\(requestHost):\(forgeUiPort)/forge/",
                    source: .lan,
                    detail: "Manual Forge host on your local network",
                    canBootstrapPairing: false
                )
            ]
        }

        guard let explicitUrl = URL(string: trimmed) else {
            return []
        }

        var candidates: [ManualProbeCandidate] = []

        let normalizedApiBaseUrl = CompanionPairingURLResolver.normalizeApiBaseUrl(explicitUrl.absoluteString)
        let normalizedUiBaseUrl = CompanionPairingURLResolver.normalizeUiBaseUrl(explicitUrl.absoluteString)
        candidates.append(
            ManualProbeCandidate(
                host: normalizedHost,
                apiBaseUrl: normalizedApiBaseUrl,
                uiBaseUrl: normalizedUiBaseUrl,
                source: isMagicDNS ? .tailscale : .lan,
                detail: isMagicDNS
                    ? "Manual Tailscale target via a known machine name"
                    : "Manual Forge host on your local network",
                canBootstrapPairing: isMagicDNS
            )
        )

        if isMagicDNS {
            candidates.append(
                ManualProbeCandidate(
                    host: normalizedHost,
                    apiBaseUrl: "https://\(normalizedHost)/api/v1",
                    uiBaseUrl: "https://\(normalizedHost)/forge/",
                    source: .tailscale,
                    detail: "Manual Tailscale target via tailscale serve",
                    canBootstrapPairing: true
                )
            )
        } else {
            let requestHost = formattedHostForURL(normalizedHost)
            candidates.append(
                ManualProbeCandidate(
                    host: normalizedHost,
                    apiBaseUrl: "http://\(requestHost):\(forgeApiPort)",
                    uiBaseUrl: "http://\(requestHost):\(forgeUiPort)/forge/",
                    source: .lan,
                    detail: "Manual Forge host on your local network",
                    canBootstrapPairing: false
                )
            )
        }

        var deduped: [ManualProbeCandidate] = []
        var seen: Set<String> = []
        for candidate in candidates {
            let key = "\(candidate.apiBaseUrl)|\(candidate.uiBaseUrl)"
            if seen.insert(key).inserted {
                deduped.append(candidate)
            }
        }
        return deduped
    }

    private static func parseTailscalePeers(data: Data) -> [TailscalePeer] {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let peers = json["Peer"] as? [String: Any]
        else {
            companionDebugLog("ForgeServerDiscovery", "parseTailscalePeers invalid JSON")
            return []
        }

        var results: [TailscalePeer] = []
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
            let dnsName = (peer["DNSName"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let ips = peer["TailscaleIPs"] as? [String] ?? []
            guard let ipv4 = ips.first(where: isIPv4Address) else {
                continue
            }
            results.append(
                TailscalePeer(
                    host: ipv4,
                    name: displayName?.isEmpty == false ? displayName! : ipv4,
                    dnsName: dnsName?.isEmpty == false ? dnsName : nil
                )
            )
        }
        companionDebugLog("ForgeServerDiscovery", "parseTailscalePeers parsed count=\(results.count)")
        return results
    }

    private static func normalizedTailscaleBaseUrl(_ value: String?) -> String? {
        guard let value, !value.isEmpty, let url = URL(string: value), url.scheme == "https" else {
            return nil
        }
        return value.hasSuffix("/") ? String(value.dropLast()) : value
    }

    private static func normalizedTailscaleUiUrl(_ value: String?) -> String? {
        guard let value, !value.isEmpty, let url = URL(string: value), url.scheme == "https" else {
            return nil
        }
        return value.hasSuffix("/") ? value : "\(value)/"
    }

    private static func inferredUiBaseUrl(from apiBaseUrl: String) -> String {
        guard let url = URL(string: apiBaseUrl), var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return apiBaseUrl
        }
        components.path = "/forge/"
        components.query = nil
        components.fragment = nil
        return components.url?.absoluteString ?? apiBaseUrl
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

    private static func lanCandidateHosts(prefix: String, localLast: Int) -> [String] {
        var candidates: [Int] = []
        let commonHosts = [1, 2, 10, 20, 30, 40, 50, 60, 75, 80, 90, 100, 110, 120, 150, 180, 200, 220, 240, 254]
        candidates.append(contentsOf: commonHosts)

        let nearbyRange = max(1, localLast - 16)...min(254, localLast + 16)
        candidates.append(contentsOf: nearbyRange)

        let remembered = recentHosts()
            .compactMap { host -> Int? in
                let parts = host.split(separator: ".")
                guard parts.count == 4 else { return nil }
                let rememberedPrefix = parts.prefix(3).joined(separator: ".")
                guard rememberedPrefix == prefix.dropLast() else { return nil }
                return Int(parts[3])
            }
        candidates.append(contentsOf: remembered)

        let ordered = Array(
            Set(candidates.filter { $0 != localLast && (1...254).contains($0) })
        ).sorted()
        return ordered.map { "\(prefix)\($0)" }
    }

    private static func recentHosts() -> [String] {
        (UserDefaults.standard.array(forKey: StorageKeys.recentHosts) as? [String] ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { $0.isEmpty == false }
    }

    private static func probeRememberedHosts() async -> [DiscoveredForgeServer] {
        let rememberedHosts = recentHosts()
        guard rememberedHosts.isEmpty == false else {
            return []
        }

        return await withTaskGroup(of: DiscoveredForgeServer?.self, returning: [DiscoveredForgeServer].self) { group in
            for host in rememberedHosts {
                group.addTask {
                    if host.contains(".ts.net") {
                        return await ForgeServerDiscovery().probeManualRuntime(host)
                    }
                    return await probeForgeHost(host: host, name: host, source: .lan)
                }
            }

            var servers: [DiscoveredForgeServer] = []
            for await server in group {
                if let server {
                    servers.append(server)
                }
            }
            return servers
        }
    }

    static func rememberSuccessfulServer(_ server: DiscoveredForgeServer) {
        rememberSuccessfulHost(server.host)
    }

    static func rememberSuccessfulHost(_ host: String) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmedHost.isEmpty == false else {
            return
        }

        var hosts = recentHosts().filter { $0 != trimmedHost }
        hosts.insert(trimmedHost, at: 0)
        if hosts.count > maxRememberedHosts {
            hosts = Array(hosts.prefix(maxRememberedHosts))
        }
        UserDefaults.standard.set(hosts, forKey: StorageKeys.recentHosts)
    }

    private static func formattedHostForURL(_ host: String) -> String {
        guard host.contains(":"), host.hasPrefix("[") == false else {
            return host
        }
        return "[\(host)]"
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
    private var results: [String: ForgeServerDiscovery.BonjourSeed] = [:]
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
        let seeds = Array(results.values)
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
        let resolvedHostName = sender.hostName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))

        if let resolvedHostName, resolvedHostName.isEmpty == false {
            results[resolvedHostName] = ForgeServerDiscovery.BonjourSeed(
                name: sender.name,
                host: resolvedHostName,
                txtRecords: txtRecords(from: sender)
            )
            companionDebugLog(
                "BonjourServiceDiscoverer",
                "resolved service=\(sender.name) hostname=\(resolvedHostName)"
            )
        }

        for address in sender.addresses ?? [] {
            guard let hostAddress = ipAddress(fromSockaddrData: address) else { continue }
            results[hostAddress] = ForgeServerDiscovery.BonjourSeed(
                name: sender.name,
                host: hostAddress,
                txtRecords: txtRecords(from: sender)
            )
            companionDebugLog(
                "BonjourServiceDiscoverer",
                "resolved service=\(sender.name) host=\(hostAddress)"
            )
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

    private func ipAddress(fromSockaddrData data: Data) -> String? {
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return nil }
            let sockaddrPtr = base.assumingMemoryBound(to: sockaddr.self)
            let family = sockaddrPtr.pointee.sa_family

            if family == sa_family_t(AF_INET) {
                let sinPtr = base.assumingMemoryBound(to: sockaddr_in.self)
                var addr = sinPtr.pointee.sin_addr
                var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                guard inet_ntop(AF_INET, &addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else {
                    return nil
                }
                return String(cString: buffer)
            }

            guard family == sa_family_t(AF_INET6) else {
                return nil
            }
            let sin6Ptr = base.assumingMemoryBound(to: sockaddr_in6.self)
            var addr6 = sin6Ptr.pointee.sin6_addr
            var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            guard inet_ntop(AF_INET6, &addr6, &buffer, socklen_t(INET6_ADDRSTRLEN)) != nil else {
                return nil
            }
            return String(cString: buffer)
        }
    }

    private func txtRecords(from service: NetService) -> [String: String] {
        guard let txtRecordData = service.txtRecordData() else {
            return [:]
        }

        return NetService.dictionary(fromTXTRecord: txtRecordData).reduce(into: [:]) { partialResult, entry in
            partialResult[entry.key] = String(data: entry.value, encoding: .utf8) ?? ""
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
