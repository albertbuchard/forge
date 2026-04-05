import SwiftUI

struct SetupManualScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let goBack: () -> Void
    let openHealth: () -> Void

    @State private var payloadText = ""
    @State private var isSubmitting = false
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
                Text("Paste the pairing code.")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("Copy the code from Forge Settings, then connect.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)

                TextEditor(text: $payloadText)
                    .scrollContentBackground(.hidden)
                    .font(.system(size: 13, weight: .medium, design: .monospaced))
                    .foregroundStyle(CompanionStyle.textPrimary)
                    .padding(16)
                    .frame(minHeight: 220)
                    .background(CompanionStyle.sheetBackground(cornerRadius: 24))

                Button("Connect") {
                    connect()
                }
                .buttonStyle(CompanionFilledButtonStyle())
                .disabled(isSubmitting || payloadText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(isSubmitting ? 0.86 : 1)

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

    private func connect() {
        companionDebugLog("SetupManualScreen", "connect start")
        localError = nil
        let trimmed = payloadText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else {
            companionDebugLog("SetupManualScreen", "connect invalid pairing code")
            localError = "Invalid pairing code."
            return
        }

        companionDebugLog(
            "SetupManualScreen",
            "connect parsed payload session=\(payload.sessionId) apiBaseUrl=\(payload.apiBaseUrl)"
        )
        isSubmitting = true
        Task {
            do {
                try await appModel.verifyAndConnect(with: payload)
                companionDebugLog("SetupManualScreen", "connect verify success session=\(payload.sessionId)")
                isSubmitting = false
                openHealth()
            } catch {
                companionDebugLog(
                    "SetupManualScreen",
                    "connect verify failed error=\(error.localizedDescription)"
                )
                isSubmitting = false
                localError = error.localizedDescription
            }
        }
    }
}
