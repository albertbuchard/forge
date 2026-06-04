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
                VStack(alignment: .leading, spacing: 10) {
                    Text(item.title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(WatchTheme.textPrimary)
                        .lineLimit(3)
                    Text(item.subtitle)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(WatchTheme.textMuted)
                        .lineLimit(2)

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
        TabView(selection: $selection) {
            content()
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .onAppear(perform: clampSelection)
        .onChange(of: count) { _, _ in clampSelection() }
    }

    private func clampSelection() {
        selection = min(max(selection, 0), max(0, count - 1))
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
