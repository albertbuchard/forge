import SwiftUI

@MainActor
final class WatchNavigationModel: ObservableObject {
    @Published var selectedSurface: WatchSurface = .now
    @Published var crownValue = 0.0

    private var selectedCardIndexes: [WatchSurface: Int] = [:]
    private var cardCounts: [WatchSurface: Int] = [:]
    private let surfaces = WatchSurface.allCases

    func selectSurface(_ surface: WatchSurface) {
        selectedSurface = surface
        crownValue = Double(surfaceIndex(surface))
        clampCardIndex(for: surface)
    }

    func selectSurfaceFromCrown(_ value: Double) {
        let index = min(max(Int(value.rounded()), 0), surfaces.count - 1)
        selectSurface(surfaces[index])
    }

    func selectNextSurface() {
        let next = min(surfaceIndex(selectedSurface) + 1, surfaces.count - 1)
        selectSurface(surfaces[next])
    }

    func selectPreviousSurface() {
        let previous = max(surfaceIndex(selectedSurface) - 1, 0)
        selectSurface(surfaces[previous])
    }

    func cardIndexBinding(for surface: WatchSurface) -> Binding<Int> {
        Binding(
            get: { [weak self] in self?.selectedCardIndexes[surface] ?? 0 },
            set: { [weak self] value in self?.setCardIndex(value, for: surface) }
        )
    }

    func registerCardCount(_ count: Int, for surface: WatchSurface) {
        cardCounts[surface] = max(1, count)
        clampCardIndex(for: surface)
    }

    func selectedCardIndex(for surface: WatchSurface) -> Int {
        selectedCardIndexes[surface] ?? 0
    }

    func cardCount(for surface: WatchSurface) -> Int {
        cardCounts[surface] ?? 1
    }

    private func setCardIndex(_ value: Int, for surface: WatchSurface) {
        let maxIndex = max(0, (cardCounts[surface] ?? 1) - 1)
        selectedCardIndexes[surface] = min(max(value, 0), maxIndex)
    }

    private func clampCardIndex(for surface: WatchSurface) {
        setCardIndex(selectedCardIndexes[surface] ?? 0, for: surface)
    }

    private func surfaceIndex(_ surface: WatchSurface) -> Int {
        surfaces.firstIndex(of: surface) ?? 0
    }
}

struct WatchCommandModalAction: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    let tint: Color
    let perform: () -> Void
}

struct WatchCommandModalItem: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let actions: [WatchCommandModalAction]
}

struct WatchCommandModalView: View {
    @Environment(\.dismiss) private var dismiss
    let item: WatchCommandModalItem

    var body: some View {
        WatchSurfaceBackground()
            .overlay {
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(item.title)
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(WatchTheme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(item.subtitle)
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(WatchTheme.textMuted)
                            .fixedSize(horizontal: false, vertical: true)

                        ForEach(item.actions) { action in
                            Button {
                                action.perform()
                                dismiss()
                            } label: {
                                Label(action.title, systemImage: action.systemImage)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(action.tint)
                        }
                    }
                    .padding(10)
                }
            }
    }
}

struct SurfaceCarousel<Content: View>: View {
    @Binding var selection: Int
    let count: Int
    private let content: () -> Content

    init(selection: Binding<Int>, count: Int, @ViewBuilder content: @escaping () -> Content) {
        self._selection = selection
        self.count = count
        self.content = content
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            TabView(selection: $selection) {
                content()
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            if count > 1 {
                WatchPageIndicator(selection: selection, count: count)
                    .padding(.top, 5)
                    .padding(.trailing, 8)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .onAppear(perform: clampSelection)
        .onChange(of: count) { _, _ in clampSelection() }
    }

    private func clampSelection() {
        selection = min(max(selection, 0), max(0, count - 1))
    }
}

struct WatchPageIndicator: View {
    let selection: Int
    let count: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "chevron.left")
                .font(.system(size: 7, weight: .black))
                .foregroundStyle(selection > 0 ? WatchTheme.textMuted : WatchTheme.neutral)

            ForEach(0..<min(count, 7), id: \.self) { index in
                Capsule()
                    .fill(index == clampedSelection ? WatchTheme.accent : Color.white.opacity(0.18))
                    .frame(width: index == clampedSelection ? 10 : 4, height: 4)
            }

            if count > 7 {
                Text("+")
                    .font(.system(size: 7, weight: .black, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 7, weight: .black))
                .foregroundStyle(selection < count - 1 ? WatchTheme.textMuted : WatchTheme.neutral)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.black.opacity(0.34)))
        .overlay(Capsule().stroke(WatchTheme.border, lineWidth: 1))
        .accessibilityLabel("Card \(clampedSelection + 1) of \(max(count, 1))")
    }

    private var clampedSelection: Int {
        min(max(selection, 0), max(0, count - 1))
    }
}

struct DenseMetric: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .lineLimit(1)
            Text(title)
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(WatchTheme.textMuted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct EmptySurfaceCard: View {
    let title: String
    let message: String
    var actionTitle: String? = nil
    var systemImage: String = "arrow.clockwise"
    var action: (() -> Void)? = nil

    var body: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "applewatch")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(WatchTheme.accent)
                Text(title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                Text(message)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if let actionTitle, let action {
                    Button {
                        action()
                    } label: {
                        Label(actionTitle, systemImage: systemImage)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTheme.accent)
                }
            }
        }
    }
}

func formatSeconds(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded()))
    let minutes = total / 60
    if minutes < 60 {
        return "\(minutes)m"
    }
    return "\(minutes / 60)h\(minutes % 60)"
}
