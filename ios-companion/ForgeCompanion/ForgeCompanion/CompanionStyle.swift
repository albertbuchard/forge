import SwiftUI

enum CompanionStyle {
    static let backgroundTop = Color(red: 11 / 255, green: 19 / 255, blue: 38 / 255)
    static let backgroundBottom = Color(red: 7 / 255, green: 14 / 255, blue: 28 / 255)
    static let surface = Color(red: 16 / 255, green: 28 / 255, blue: 56 / 255)
    static let surfaceRaised = Color(red: 23 / 255, green: 37 / 255, blue: 72 / 255)
    static let border = Color.white.opacity(0.08)
    static let accent = Color(red: 111 / 255, green: 133 / 255, blue: 232 / 255)
    static let accentStrong = Color(red: 147 / 255, green: 170 / 255, blue: 255 / 255)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.74)
    static let textMuted = Color.white.opacity(0.5)
    static let destructive = Color(red: 1, green: 0.45, blue: 0.45)

    static var background: some View {
        ZStack {
            LinearGradient(
                colors: [backgroundTop, backgroundBottom],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(accent.opacity(0.18))
                .frame(width: 320, height: 320)
                .blur(radius: 84)
                .offset(x: 120, y: -240)
            Circle()
                .fill(Color.white.opacity(0.05))
                .frame(width: 280, height: 280)
                .blur(radius: 90)
                .offset(x: -120, y: 260)
        }
        .ignoresSafeArea()
    }

    static func sheetBackground(cornerRadius: CGFloat = 28) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [surface.opacity(0.98), surfaceRaised.opacity(0.94)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(border, lineWidth: 1)
            )
    }
}

struct CompanionFilledButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(Color(red: 13 / 255, green: 20 / 255, blue: 37 / 255))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                CompanionStyle.accentStrong.opacity(configuration.isPressed ? 0.86 : 1),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
    }
}

struct CompanionGhostButtonStyle: ButtonStyle {
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold, design: .rounded))
            .foregroundStyle(destructive ? CompanionStyle.destructive : CompanionStyle.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                Color.white.opacity(configuration.isPressed ? 0.12 : 0.08),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
    }
}

struct CompanionSectionCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CompanionStyle.sheetBackground(cornerRadius: 24))
    }
}

struct CompanionIconButton: View {
    let systemName: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(CompanionStyle.textPrimary)
                .frame(width: 34, height: 34)
                .background(Color.white.opacity(0.08), in: Circle())
        }
        .buttonStyle(.plain)
    }
}
