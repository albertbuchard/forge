import SwiftUI

struct SetupQRScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let goBack: () -> Void
    let openManual: () -> Void
    let openHealth: () -> Void

    @State private var scannerVisible = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CompanionIconButton(systemName: "chevron.left") {
                    companionDebugLog("SetupQRScreen", "tap Back")
                    goBack()
                }

                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 22) {
                Text("Scan your Forge QR.")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("This is the default private connection path. Forge Companion receives the desktop node and one-time token, then verifies the session before any sync starts.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 12) {
                    step("1", "Run npx forge-memory and choose iOS pairing, or open Forge Settings -> Mobile.")
                    step("2", "Scan the compact QR, or paste the saved payload if the camera cannot read it.")
                    step("3", "Approve Health access after pairing so Forge can start the first sync.")
                }

                CompanionSectionCard {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "lock.shield")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(CompanionStyle.accentStrong)
                            .frame(width: 28, height: 28)

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Tailscale is preferred when it is available.")
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)

                            Text("Forge uses the QR transport exactly as paired: Tailscale/LAN direct when reachable, or Iroh only for Iroh pairings.")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                Button("Open camera scanner") {
                    companionDebugLog("SetupQRScreen", "tap Open scanner")
                    scannerVisible = true
                }
                .buttonStyle(CompanionFilledButtonStyle())

                Button("Paste pairing payload") {
                    companionDebugLog("SetupQRScreen", "tap Paste pairing payload")
                    openManual()
                }
                .buttonStyle(CompanionGhostButtonStyle())

                if let error = appModel.latestError {
                    Text(error)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.destructive)
                }
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 34)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            companionDebugLog("SetupQRScreen", "onAppear")
        }
        .onChange(of: scannerVisible) { _, nextValue in
            companionDebugLog("SetupQRScreen", "scannerVisible -> \(nextValue)")
        }
        .fullScreenCover(isPresented: $scannerVisible) {
            QRScannerScreen {
                companionDebugLog("SetupQRScreen", "scanner dismissed")
                scannerVisible = false
            } onPayload: { payload in
                companionDebugLog(
                    "SetupQRScreen",
                    "scanner payload session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
                )
                Task {
                    do {
                        try await appModel.verifyAndConnect(with: payload)
                        companionDebugLog("SetupQRScreen", "scanner verify success session=\(payload.sessionId)")
                        scannerVisible = false
                        openHealth()
                    } catch {
                        companionDebugLog(
                            "SetupQRScreen",
                            "scanner verify failed error=\(error.localizedDescription)"
                        )
                    }
                }
            }
            .environmentObject(appModel)
        }
        .onChange(of: appModel.pairing?.sessionId) { _, sessionId in
            companionDebugLog("SetupQRScreen", "pairing session changed -> \(sessionId ?? "nil")")
            if sessionId != nil {
                openHealth()
            }
        }
    }

    private func step(_ number: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                .frame(width: 26, height: 26)
                .background(CompanionStyle.accentStrong, in: Circle())

            Text(text)
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(CompanionStyle.textSecondary)
        }
    }
}
