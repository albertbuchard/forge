import SwiftUI
import WebKit

struct ForgeWebView: UIViewRepresentable {
    let url: URL
    let transport: PairingTransport?
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    static var cacheDataTypesForHardRefresh: Set<String> {
        var types: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache
        ]

        if #available(iOS 11.3, *) {
            types.insert(WKWebsiteDataTypeFetchCache)
            types.insert(WKWebsiteDataTypeServiceWorkerRegistrations)
        }

        return types
    }

    static let companionBootstrapScript = """
    window.__forgeCompanionEmbedded = true;
    document.documentElement.dataset.forgeCompanionEmbedded = 'true';
    window.__forgeCompanionApplyLayout = function(width, height, top, bottom) {
        const widthPx = width + 'px';
        const heightPx = height + 'px';
        const topPx = top + 'px';
        const bottomPx = bottom + 'px';
        window.__forgeCompanionViewportInsets = { top, bottom };
        document.documentElement.style.setProperty('--forge-companion-webview-width', widthPx);
        document.documentElement.style.setProperty('--forge-companion-webview-height', heightPx);
        document.documentElement.style.setProperty('--forge-visual-viewport-height', heightPx);
        document.documentElement.style.setProperty('--forge-visual-viewport-top', topPx);
        document.documentElement.style.setProperty('--forge-visual-viewport-bottom', bottomPx);
        document.documentElement.style.setProperty('--forge-safe-area-top', topPx);
        document.documentElement.style.setProperty('--forge-safe-area-bottom', bottomPx);
        document.body.style.minHeight = heightPx;
        document.body.style.margin = '0';

        const root = document.getElementById('root');
        if (root) {
            root.style.minHeight = heightPx;
        }
    };
    const style = document.createElement('style');
    style.innerHTML = `
    html {
        background-color: #0B1326;
    }
    body {
        overflow-x: hidden;
    }`;
    document.documentElement.appendChild(style);
    """

    static func freshRequest(
        for url: URL,
        cachePolicy: URLRequest.CachePolicy = .reloadIgnoringLocalCacheData,
        reloadToken: UUID? = nil
    ) -> URLRequest {
        let resolvedURL: URL
        if let reloadToken,
           var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        {
            var queryItems = components.queryItems ?? []
            queryItems.removeAll { $0.name == "forgeWebRefresh" }
            queryItems.append(URLQueryItem(name: "forgeWebRefresh", value: reloadToken.uuidString))
            components.queryItems = queryItems
            resolvedURL = components.url ?? url
        } else {
            resolvedURL = url
        }

        var request = URLRequest(url: resolvedURL)
        request.cachePolicy = cachePolicy
        request.timeoutInterval = 45
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        return request
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        companionDebugLog(
            "ForgeWebView",
            "makeUIView url=\(url.absoluteString) reloadToken=\(reloadToken.uuidString)"
        )
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.applicationNameForUserAgent = "ForgeCompanion"
        if let transport, transport.isIrohTransport {
            configuration.setURLSchemeHandler(
                ForgeIrohURLSchemeHandler(transport: transport),
                forURLScheme: "forge-iroh"
            )
        }

        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.companionBootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        let webView = LayoutAwareWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 11 / 255, green: 19 / 255, blue: 38 / 255, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 11 / 255, green: 19 / 255, blue: 38 / 255, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.onLayout = { [weak coordinator = context.coordinator, weak webView] bounds, safeAreaInsets in
            guard let webView else { return }
            coordinator?.applyNativeBounds(bounds, safeAreaInsets: safeAreaInsets, to: webView)
        }

        context.coordinator.lastURL = url
        context.coordinator.lastReloadToken = reloadToken
        context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
        companionDebugLog("ForgeWebView", "makeUIView load request url=\(url.absoluteString)")
        webView.load(Self.freshRequest(for: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self

        if context.coordinator.lastURL != url {
            context.coordinator.lastURL = url
            context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
            companionDebugLog("ForgeWebView", "updateUIView load new url=\(url.absoluteString)")
            webView.load(Self.freshRequest(for: url))
            return
        }

        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
            companionDebugLog("ForgeWebView", "updateUIView hard refresh token=\(reloadToken.uuidString)")
            webView.stopLoading()
            context.coordinator.clearWebViewCaches {
                companionDebugLog("ForgeWebView", "updateUIView hard refresh load url=\(url.absoluteString)")
                webView.load(Self.freshRequest(for: url, reloadToken: reloadToken))
            }
        }

        companionDebugLog(
            "ForgeWebView",
            "updateUIView applyNativeBounds bounds=\(String(describing: webView.bounds)) safeArea=\(String(describing: webView.safeAreaInsets))"
        )
        context.coordinator.applyNativeBounds(
            webView.bounds,
            safeAreaInsets: webView.safeAreaInsets,
            to: webView
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: ForgeWebView
        var lastURL: URL?
        var lastReloadToken: UUID

        init(parent: ForgeWebView) {
            self.parent = parent
            self.lastReloadToken = parent.reloadToken
        }

        private func isBenignNavigationCancellation(_ error: Error) -> Bool {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain &&
                nsError.code == URLError.cancelled.rawValue
        }

        func clearWebViewCaches(completion: @escaping () -> Void) {
            WKWebsiteDataStore.default().removeData(
                ofTypes: ForgeWebView.cacheDataTypesForHardRefresh,
                modifiedSince: .distantPast
            ) {
                DispatchQueue.main.async(execute: completion)
            }
        }

        func updateViewState(isLoading: Bool, errorMessage: String?) {
            companionDebugLog(
                "ForgeWebView",
                "updateViewState isLoading=\(isLoading) error=\(errorMessage ?? "nil")"
            )
            DispatchQueue.main.async {
                self.parent.isLoading = isLoading
                self.parent.errorMessage = errorMessage
            }
        }

        func applyNativeBounds(
            _ bounds: CGRect,
            safeAreaInsets: UIEdgeInsets,
            to webView: WKWebView
        ) {
            guard bounds.width > 0, bounds.height > 0 else { return }
            let width = Int(bounds.width.rounded(.down))
            let height = Int(bounds.height.rounded(.down))
            let top = Int(safeAreaInsets.top.rounded(.down))
            let bottom = 0
            companionDebugLog(
                "ForgeWebView",
                "applyNativeBounds width=\(width) height=\(height) top=\(top) bottom=\(bottom) rawBottom=\(Int(safeAreaInsets.bottom.rounded(.down)))"
            )
            webView.evaluateJavaScript(
                "window.__forgeCompanionApplyLayout && window.__forgeCompanionApplyLayout(\(width), \(height), \(top), \(bottom));",
                completionHandler: nil
            )
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            companionDebugLog(
                "ForgeWebView",
                "didStartProvisionalNavigation url=\(webView.url?.absoluteString ?? "nil")"
            )
            updateViewState(isLoading: true, errorMessage: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            companionDebugLog(
                "ForgeWebView",
                "didFinish url=\(webView.url?.absoluteString ?? "nil") title=\(webView.title ?? "nil")"
            )
            updateViewState(isLoading: false, errorMessage: nil)
            applyNativeBounds(
                webView.bounds,
                safeAreaInsets: webView.safeAreaInsets,
                to: webView
            )
            debugInspectDocument(on: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            if isBenignNavigationCancellation(error) {
                companionDebugLog(
                    "ForgeWebView",
                    "didFail ignored cancelled navigation url=\(webView.url?.absoluteString ?? "nil")"
                )
                return
            }
            companionDebugLog(
                "ForgeWebView",
                "didFail url=\(webView.url?.absoluteString ?? "nil") error=\(error.localizedDescription)"
            )
            updateViewState(isLoading: false, errorMessage: error.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            if isBenignNavigationCancellation(error) {
                companionDebugLog(
                    "ForgeWebView",
                    "didFailProvisionalNavigation ignored cancelled navigation url=\(webView.url?.absoluteString ?? "nil")"
                )
                return
            }
            companionDebugLog(
                "ForgeWebView",
                "didFailProvisionalNavigation url=\(webView.url?.absoluteString ?? "nil") error=\(error.localizedDescription)"
            )
            updateViewState(isLoading: false, errorMessage: error.localizedDescription)
        }

        private func debugInspectDocument(on webView: WKWebView) {
            let script = """
            (() => {
              const root = document.getElementById('root');
                return JSON.stringify({
                  href: location.href,
                  title: document.title,
                  readyState: document.readyState,
                  bodyClassName: document.body.className,
                  theme: document.documentElement.dataset.forgeTheme || '',
                  rootChildren: root ? root.children.length : -1,
                  rootTextSample: root ? (root.innerText || '').slice(0, 160) : '',
                  bodyBackground: getComputedStyle(document.body).backgroundColor,
                  rootBackground: root ? getComputedStyle(root).backgroundColor : 'none'
                });
            })();
            """
            webView.evaluateJavaScript(script) { result, error in
                if let error {
                    companionDebugLog(
                        "ForgeWebView",
                        "debugInspectDocument failed error=\(error.localizedDescription)"
                    )
                    return
                }
                companionDebugLog(
                    "ForgeWebView",
                    "debugInspectDocument result=\(String(describing: result))"
                )
            }
        }
    }
}

private final class ForgeIrohURLSchemeHandler: NSObject, WKURLSchemeHandler {
    private let transport: PairingTransport
    private var activeTasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(transport: PairingTransport) {
        self.transport = transport
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        let request = urlSchemeTask.request
        let task = Task {
            do {
                guard let url = request.url else {
                    throw URLError(.badURL)
                }
                var path = url.path.isEmpty ? "/" : url.path
                if let query = url.query, !query.isEmpty {
                    path += "?\(query)"
                }
                let result = try await ForgeIrohTransportClient.send(
                    method: request.httpMethod ?? "GET",
                    path: path,
                    headers: request.allHTTPHeaderFields ?? [:],
                    body: request.httpBody,
                    transport: transport
                )
                guard let response = HTTPURLResponse(
                    url: url,
                    statusCode: result.statusCode,
                    httpVersion: "HTTP/1.1",
                    headerFields: result.headers
                ) else {
                    throw URLError(.badServerResponse)
                }
                await MainActor.run {
                    urlSchemeTask.didReceive(response)
                    urlSchemeTask.didReceive(result.data)
                    urlSchemeTask.didFinish()
                    activeTasks.removeValue(forKey: key)
                }
            } catch {
                await MainActor.run {
                    urlSchemeTask.didFailWithError(error)
                    activeTasks.removeValue(forKey: key)
                }
            }
        }
        activeTasks[key] = task
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        activeTasks[key]?.cancel()
        activeTasks.removeValue(forKey: key)
    }
}

final class LayoutAwareWebView: WKWebView {
    var onLayout: ((CGRect, UIEdgeInsets) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(bounds, safeAreaInsets)
    }
}
