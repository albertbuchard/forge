import SwiftUI

struct PairedForgeScreen: View {
    @EnvironmentObject private var appModel: CompanionAppModel

    let reopenSetup: () -> Void

    @State private var menuVisible = false
    @State private var reloadToken = UUID()
    @State private var isLoading = true
    @State private var webError: String?

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                CompanionStyle.background

                if let url = appModel.forgeWebURL {
                    ForgeWebView(
                        url: url,
                        reloadToken: reloadToken,
                        isLoading: $isLoading,
                        errorMessage: $webError
                    )
                    .frame(width: proxy.size.width, height: proxy.size.height)
                }

                if isLoading {
                    VStack {
                        ProgressView()
                            .tint(CompanionStyle.accentStrong)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.08))
                    .allowsHitTesting(false)
                }

                if let webError {
                    VStack {
                        Spacer()

                        Text(webError)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.36), in: Capsule())
                            .padding(.bottom, proxy.safeAreaInsets.bottom + 18)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
                }

                HStack {
                    Button {
                        companionDebugLog(
                            "PairedForgeScreen",
                            "menu button tap old=\(menuVisible)"
                        )
                        menuVisible.toggle()
                    } label: {
                        Image(systemName: menuVisible ? "xmark" : "line.3.horizontal")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(Color.black.opacity(0.22), in: Circle())
                            .overlay(Circle().stroke(Color.white.opacity(0.14), lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    if appModel.needsNativeAttention {
                        Circle()
                            .fill(Color(red: 1, green: 0.67, blue: 0.29))
                            .frame(width: 8, height: 8)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, proxy.safeAreaInsets.top + 28)
                .zIndex(3)

                if menuVisible {
                    Color.black.opacity(0.001)
                        .ignoresSafeArea()
                        .onTapGesture {
                            companionDebugLog("PairedForgeScreen", "overlay tap close menu")
                            menuVisible = false
                        }
                        .zIndex(1)

                    CompanionMenuSheet(
                        reopenSetup: reopenSetup,
                        reloadForge: { reloadToken = UUID() },
                        closeMenu: { menuVisible = false }
                    )
                    .environmentObject(appModel)
                    .padding(.top, proxy.safeAreaInsets.top + 68)
                    .padding(.leading, 16)
                    .zIndex(2)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .onAppear {
            companionDebugLog(
                "PairedForgeScreen",
                "onAppear forgeWebURL=\(appModel.forgeWebURL?.absoluteString ?? "nil")"
            )
        }
        .onChange(of: menuVisible) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "menuVisible -> \(nextValue)")
        }
        .onChange(of: reloadToken) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "reloadToken -> \(nextValue.uuidString)")
        }
        .onChange(of: isLoading) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "isLoading -> \(nextValue)")
        }
        .onChange(of: webError) { _, nextValue in
            companionDebugLog("PairedForgeScreen", "webError -> \(nextValue ?? "nil")")
        }
        .onChange(of: appModel.forgeWebURL) { _, nextValue in
            companionDebugLog(
                "PairedForgeScreen",
                "forgeWebURL -> \(nextValue?.absoluteString ?? "nil")"
            )
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: menuVisible)
    }
}
