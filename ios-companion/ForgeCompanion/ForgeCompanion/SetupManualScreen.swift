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

            VStack(alignment: .leading, spacing: 18) {
                Text("Manual setup")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Use a known machine name or paste a pairing code.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                Text("In Forge web: Settings -> Mobile companion. Open the QR panel there to scan the code or copy the JSON payload.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                CompanionSectionCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Known Forge host")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)

                        Text("Best for Tailscale. Enter a `.ts.net` machine name and Forge will try `/api/v1` and `/forge/` there.")
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
                                Text(isResolvingHost ? "Connecting…" : "Connect known host")
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
                        Text("Pairing code")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(CompanionStyle.textPrimary)

                        Text("Paste the JSON payload from Forge web -> Settings -> Mobile companion. It appears in the same panel as the QR code.")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(CompanionStyle.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)

                        TextEditor(text: $payloadText)
                            .scrollContentBackground(.hidden)
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .foregroundStyle(CompanionStyle.textPrimary)
                            .padding(16)
                            .frame(minHeight: 220)
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
                                Text(isSubmitting ? "Verifying…" : "Connect with code")
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
            .padding(.horizontal, 20)
            .padding(.top, 30)

            Spacer()
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
        guard let data = trimmed.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else {
            companionDebugLog("SetupManualScreen", "connectPairingCode invalid pairing code")
            localError = "Invalid pairing code."
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
