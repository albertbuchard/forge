import SwiftUI

struct UnpairedHeroScreen: View {
    let startSetup: () -> Void

    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 18) {
                    Text("Forge Companion")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(CompanionStyle.textMuted)

                    Text("Sync sleep and workouts into Forge.")
                        .font(
                            .system(
                                size: min(max(proxy.size.width * 0.094, 28), 40),
                                weight: .bold,
                                design: .rounded
                            )
                        )
                        .tracking(-1.2)
                        .foregroundStyle(CompanionStyle.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("Pair once. Then this app stays in the background.")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(CompanionStyle.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("Set up sync", action: startSetup)
                        .buttonStyle(CompanionFilledButtonStyle())
                }
                .padding(.horizontal, 26)
                .padding(.bottom, max(28, proxy.safeAreaInsets.bottom + 20))

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            .contentShape(Rectangle())
        }
        .ignoresSafeArea()
    }
}
