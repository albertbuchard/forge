import SwiftUI

struct SetupQRScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let goBack: () -> Void
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
                Text("Scan the Forge tunnel QR.")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                VStack(alignment: .leading, spacing: 12) {
                    step("1", "Open Forge Settings, then Mobile.")
                    step("2", "Generate the tunnel QR or run npx forge-memory pair-ios.")
                    step("3", "Scan it here and approve the native permissions.")
                }

                Button("Open scanner") {
                    companionDebugLog("SetupQRScreen", "tap Open scanner")
                    scannerVisible = true
                }
                .buttonStyle(CompanionFilledButtonStyle())

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
