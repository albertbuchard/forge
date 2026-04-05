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
                "onAppear discovered=\(appModel.discoveredServers.count) inFlight=\(appModel.discoveryInFlight)"
            )
        }
        .onChange(of: connectingServerId) { _, nextValue in
            companionDebugLog("SetupDiscoveryScreen", "connectingServerId -> \(nextValue ?? "nil")")
        }
        .task {
            if appModel.discoveredServers.isEmpty && !appModel.discoveryInFlight {
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
                }
                .padding(.vertical, 10)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
}
