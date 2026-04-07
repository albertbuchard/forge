import SwiftUI

enum WatchTheme {
    static let background = Color(red: 9 / 255, green: 13 / 255, blue: 24 / 255)
    static let card = Color(red: 19 / 255, green: 28 / 255, blue: 48 / 255)
    static let border = Color.white.opacity(0.08)
    static let textPrimary = Color.white
    static let textMuted = Color.white.opacity(0.62)
    static let success = Color(red: 0.32, green: 0.83, blue: 0.54)
    static let danger = Color(red: 0.98, green: 0.41, blue: 0.44)
    static let neutral = Color.white.opacity(0.16)
    static let accent = Color(red: 0.62, green: 0.73, blue: 1.0)
}

struct WatchSurfaceBackground: View {
    var body: some View {
        LinearGradient(
            colors: [WatchTheme.background, Color.black],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

struct WatchCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(WatchTheme.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(WatchTheme.border, lineWidth: 1)
                    )
            )
    }
}

struct WatchRingSegment: Shape {
    let index: Int
    let count: Int

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        let gap = 7.0
        let total = 360.0 - (Double(count) * gap)
        let segment = total / Double(count)
        let start = -90.0 + (Double(index) * (segment + gap))
        let end = start + segment
        var path = Path()
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(start),
            endAngle: .degrees(end),
            clockwise: false
        )
        return path
    }
}

struct WatchHabitRingView: View {
    let habit: ForgeWatchHabitSummary

    private func color(for state: ForgeWatchHistoryState) -> Color {
        switch state {
        case .aligned:
            return WatchTheme.success
        case .unaligned:
            return WatchTheme.danger
        case .unknown:
            return WatchTheme.neutral
        }
    }

    var body: some View {
        ZStack {
            ForEach(Array(habit.last7History.enumerated()), id: \.element.id) { index, segment in
                WatchRingSegment(index: index, count: habit.last7History.count)
                    .stroke(
                        color(for: segment.state).opacity(segment.current ? 1 : 0.82),
                        style: StrokeStyle(
                            lineWidth: segment.current ? 8 : 6,
                            lineCap: .round
                        )
                    )
            }

            VStack(spacing: 2) {
                Text("\(habit.streakCount)")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(WatchTheme.textPrimary)
                Text("streak")
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .foregroundStyle(WatchTheme.textMuted)
                    .textCase(.uppercase)
            }
        }
        .frame(width: 88, height: 88)
    }
}
