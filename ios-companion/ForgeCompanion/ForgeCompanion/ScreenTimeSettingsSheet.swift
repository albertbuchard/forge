import SwiftUI

struct ScreenTimeSettingsSheet: View {
    @ObservedObject var screenTimeStore: ScreenTimeStore
    let close: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Screen Time Archived")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(CompanionStyle.textPrimary)

                Text("The iOS Screen Time and OCR experiments were removed from the live companion app. The implementation has been preserved for future Android companion work.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(CompanionStyle.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Backup path: Backups/ios-screen-time-archive")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(CompanionStyle.textMuted)
                    .textSelection(.enabled)

                Spacer()
            }
            .padding(20)
            .background(CompanionStyle.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: close)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textPrimary)
                }
            }
        }
    }
}
