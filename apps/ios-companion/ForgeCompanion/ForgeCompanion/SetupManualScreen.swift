import SwiftUI

struct SetupManualScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let goBack: () -> Void
    let openHealth: () -> Void

    @State private var knownHost = ""
    @State private var payloadText = ""
    @State private var isSubmitting = false
    @State private var isResolvingHost = false
    @State private var manualProgressMessage: String?
    @State private var localError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                CompanionIconButton(systemName: "chevron.left") {
                    companionDebugLog("SetupManualScreen", "tap Back")
                    goBack()
                }

                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Manual connection")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)

                    Text("Use this for a known LAN or Tailscale host, the simulator, or a copied pairing payload.")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)

                    Text("The normal setup is the Forge QR. Manual connection stays here for deliberate fallback and debugging.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    CompanionSectionCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Known Forge host")
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)

                            Text("Best for Tailscale or a reachable LAN host. Enter a machine name and Forge will try /api/v1 and /forge/ there.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)

                            TextField("macbook-pro.tail1234.ts.net", text: $knownHost)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.system(size: 15, weight: .medium, design: .rounded))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(Color.white.opacity(0.06))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                                .stroke(Color.white.opacity(0.09), lineWidth: 1)
                                        )
                                )

                            Button {
                                connectKnownHost()
                            } label: {
                                HStack(spacing: 10) {
                                    if isResolvingHost {
                                        ProgressView()
                                            .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                                    }
                                    Text(isResolvingHost ? "Connecting..." : "Connect known host")
                                }
                            }
                            .buttonStyle(CompanionFilledButtonStyle())
                            .disabled(isSubmitting || isResolvingHost || knownHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                            if let manualProgressMessage, isResolvingHost {
                                HStack(spacing: 10) {
                                    ProgressView()
                                        .tint(CompanionStyle.accentStrong)
                                        .scaleEffect(0.82)

                                    Text(manualProgressMessage)
                                        .font(.system(size: 13, weight: .medium, design: .rounded))
                                        .foregroundStyle(CompanionStyle.textSecondary)
                                }
                            }
                        }
                    }

                    CompanionSectionCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Paste pairing payload")
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundStyle(CompanionStyle.textPrimary)

                            Text("Use this if the camera cannot scan. Paste the saved payload from ~/.forge/pairing/, Forge Settings -> Mobile, or npx forge-memory pair-ios --json.")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(CompanionStyle.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)

                            TextEditor(text: $payloadText)
                                .scrollContentBackground(.hidden)
                                .font(.system(size: 13, weight: .medium, design: .monospaced))
                                .foregroundStyle(CompanionStyle.textPrimary)
                                .padding(16)
                                .frame(minHeight: 180)
                                .background(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(Color.white.opacity(0.06))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                                .stroke(Color.white.opacity(0.09), lineWidth: 1)
                                        )
                                )

                            Button {
                                connectPairingCode()
                            } label: {
                                HStack(spacing: 10) {
                                    if isSubmitting {
                                        ProgressView()
                                            .tint(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
                                    }
                                    Text(isSubmitting ? "Verifying..." : "Connect with payload")
                                }
                            }
                            .buttonStyle(CompanionFilledButtonStyle())
                            .disabled(isSubmitting || isResolvingHost || payloadText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }

                    if let message = localError ?? appModel.latestError {
                        Text(message)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.destructive)
                    }
                }
                .padding(.bottom, 28)
            }
            .padding(.horizontal, 20)
            .padding(.top, 30)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            companionDebugLog("SetupManualScreen", "onAppear")
        }
        .onChange(of: appModel.pairing?.sessionId) { _, sessionId in
            companionDebugLog("SetupManualScreen", "pairing session changed -> \(sessionId ?? "nil")")
            if sessionId != nil {
                openHealth()
            }
        }
    }

    private func connectKnownHost() {
        companionDebugLog("SetupManualScreen", "connectKnownHost start")
        localError = nil
        manualProgressMessage = "Checking that Forge is reachable."
        isResolvingHost = true
        let target = knownHost.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                manualProgressMessage = "Opening one-tap pairing."
                try await appModel.connectToManualRuntime(target)
                companionDebugLog("SetupManualScreen", "connectKnownHost success target=\(target)")
                isResolvingHost = false
                manualProgressMessage = nil
                openHealth()
            } catch {
                companionDebugLog(
                    "SetupManualScreen",
                    "connectKnownHost failed error=\(error.localizedDescription)"
                )
                isResolvingHost = false
                manualProgressMessage = nil
                localError = error.localizedDescription
            }
        }
    }

    private func connectPairingCode() {
        companionDebugLog("SetupManualScreen", "connectPairingCode start")
        localError = nil
        let trimmed = payloadText.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload: PairingPayload
        do {
            payload = try PairingPayload.decodePairingText(trimmed)
        } catch {
            companionDebugLog("SetupManualScreen", "connectPairingCode invalid pairing code")
            localError = "Invalid pairing payload. Paste the JSON payload from ~/.forge/pairing/, Forge Settings -> Mobile, or npx forge-memory pair-ios --json."
            return
        }

        companionDebugLog(
            "SetupManualScreen",
            "connectPairingCode parsed payload session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        isSubmitting = true
        Task {
            do {
                try await appModel.verifyAndConnect(with: payload)
                companionDebugLog("SetupManualScreen", "connectPairingCode verify success session=\(payload.sessionId)")
                isSubmitting = false
                openHealth()
            } catch {
                companionDebugLog(
                    "SetupManualScreen",
                    "connectPairingCode verify failed error=\(error.localizedDescription)"
                )
                isSubmitting = false
                localError = error.localizedDescription
            }
        }
    }
}
