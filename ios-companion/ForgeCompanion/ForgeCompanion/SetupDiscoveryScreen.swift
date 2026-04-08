import SwiftUI

struct SetupDiscoveryScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let openQR: () -> Void
    let openManual: () -> Void
    let openHealth: () -> Void
    let close: () -> Void

    @State private var connectingServerId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            content
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 20)
        .onAppear {
            companionDebugLog(
                "SetupDiscoveryScreen",
                "onAppear discovered=\(appModel.discoveredServers.count) tailscaleDevices=\(appModel.discoveredTailscaleDevices.count) inFlight=\(appModel.discoveryInFlight)"
            )
        }
        .onChange(of: connectingServerId) { _, nextValue in
            companionDebugLog("SetupDiscoveryScreen", "connectingServerId -> \(nextValue ?? "nil")")
        }
        .task {
            if appModel.screenshotScenario == nil && appModel.discoveredServers.isEmpty && !appModel.discoveryInFlight {
                companionDebugLog("SetupDiscoveryScreen", "task auto discover start")
                await appModel.discoverForgeServers()
            }
        }
    }

    private var header: some View {
            HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Set up sync")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Pick your Forge runtime.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
            }

            Spacer()

            CompanionIconButton(systemName: "xmark") {
                close()
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text(appModel.discoveryMessage)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)

                Spacer()

                if appModel.discoveryInFlight {
                    ProgressView()
                        .tint(CompanionStyle.accentStrong)
                        .scaleEffect(0.8)
                } else {
                    Button("Rescan") {
                        companionDebugLog("SetupDiscoveryScreen", "tap Rescan")
                        Task { await appModel.discoverForgeServers() }
                    }
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.accentStrong)
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 28)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    ForEach(appModel.discoveredServers) { server in
                        serverRow(server)
                    }

                    if appModel.discoveredServers.isEmpty && !appModel.discoveryInFlight {
                        CompanionSectionCard {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("No Forge runtime found.")
                                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textPrimary)

                                Text("Keep Forge running, then scan again.")
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .foregroundStyle(CompanionStyle.textSecondary)
                            }
                        }
                    }

                    tailscaleDevicesSection
                }
                .padding(.vertical, 10)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var tailscaleDevicesSection: some View {
        if !appModel.discoveredTailscaleDevices.isEmpty || !appModel.tailscaleDiscoveryMessage.isEmpty {
            CompanionSectionCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Tailscale devices")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)

                    Text(appModel.tailscaleDiscoveryMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)

                    ForEach(appModel.discoveredTailscaleDevices) { device in
                        tailscaleDeviceRow(device)
                    }
                }
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 12) {
            Button("Scan QR") {
                companionDebugLog("SetupDiscoveryScreen", "tap Scan QR")
                openQR()
            }
            .buttonStyle(CompanionGhostButtonStyle())

            Button("Paste code") {
                companionDebugLog("SetupDiscoveryScreen", "tap Paste code")
                openManual()
            }
            .buttonStyle(CompanionGhostButtonStyle())

            if let error = appModel.latestError {
                Text(error)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
            }
        }
    }

    private func serverRow(_ server: DiscoveredForgeServer) -> some View {
        CompanionSectionCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(server.name)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)

                        Text(server.detail)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                    }

                    Spacer(minLength: 8)

                    Text(sourceLabel(server.source))
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.08), in: Capsule())
                }

                Button(server.canBootstrapPairing ? "Pair" : "Use QR") {
                    companionDebugLog(
                        "SetupDiscoveryScreen",
                        "tap server action id=\(server.id) canBootstrap=\(server.canBootstrapPairing)"
                    )
                    if server.canBootstrapPairing {
                        connectingServerId = server.id
                        Task {
                            do {
                                try await appModel.bootstrapPairing(for: server)
                                companionDebugLog(
                                    "SetupDiscoveryScreen",
                                    "server bootstrap success id=\(server.id)"
                                )
                                connectingServerId = nil
                                openHealth()
                            } catch {
                                companionDebugLog(
                                    "SetupDiscoveryScreen",
                                    "server bootstrap failed id=\(server.id) error=\(error.localizedDescription)"
                                )
                                connectingServerId = nil
                            }
                        }
                    } else {
                        companionDebugLog("SetupDiscoveryScreen", "server requires QR id=\(server.id)")
                        openQR()
                    }
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .overlay(alignment: .center) {
                    if connectingServerId == server.id {
                        ProgressView()
                            .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                    }
                }
                .disabled(connectingServerId != nil)
                .opacity(connectingServerId == server.id ? 0.88 : 1)
            }
        }
    }

    private func sourceLabel(_ source: ForgeDiscoverySource) -> String {
        switch source {
        case .simulator:
            return "Simulator"
        case .tailscale:
            return "Tailscale"
        case .lan:
            return "Local network"
        case .bonjour:
            return "Bonjour"
        }
    }

    private func tailscaleDeviceRow(_ device: DiscoveredTailscaleDevice) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(device.name)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Spacer(minLength: 8)

                routeBadge(label: "API", reachable: device.forgeApiReachable)
                routeBadge(label: "/forge", reachable: device.forgeUiReachable)
            }

            Text(device.dnsName ?? device.host)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(CompanionStyle.textMuted)
                .lineLimit(1)

            Text(device.detail)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    private func routeBadge(label: String, reachable: Bool) -> some View {
        Text(label)
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(reachable ? Color(red: 0.18, green: 0.37, blue: 0.21) : CompanionStyle.textMuted)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(
                reachable
                    ? Color(red: 0.67, green: 0.9, blue: 0.7)
                    : Color.white.opacity(0.06),
                in: Capsule()
            )
    }
}
