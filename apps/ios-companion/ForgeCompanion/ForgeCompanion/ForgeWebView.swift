import SwiftUI
import WebKit

enum ForgeWebReloadKind: Equatable {
    case standard
    case clearCache
}

struct ForgeWebReloadRequest: Equatable {
    let id: UUID
    let kind: ForgeWebReloadKind

    init(id: UUID = UUID(), kind: ForgeWebReloadKind) {
        self.id = id
        self.kind = kind
    }
}

struct ForgeWebFailure: Equatable {
    let title: String
    let detail: String
    let isOffline: Bool

    static func from(_ error: Error) -> ForgeWebFailure {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            let code = URLError.Code(rawValue: nsError.code)
            switch code {
            case .notConnectedToInternet, .internationalRoamingOff, .dataNotAllowed:
                return ForgeWebFailure(
                    title: "Forge is offline",
                    detail: "The last loaded page is still available. Reconnect, then try again.",
                    isOffline: true
                )
            case .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
                 .dnsLookupFailed, .secureConnectionFailed:
                return ForgeWebFailure(
                    title: "Forge is unreachable",
                    detail: "Check the paired Forge runtime and your network, then try again.",
                    isOffline: false
                )
            default:
                break
            }
        }
        return ForgeWebFailure(
            title: "Forge could not load",
            detail: "The web experience stopped loading. Try again or open Companion settings.",
            isOffline: false
        )
    }

    static func httpStatus(_ statusCode: Int) -> ForgeWebFailure {
        ForgeWebFailure(
            title: "Forge returned an error",
            detail: "The runtime returned HTTP \(statusCode). Try again or check Companion diagnostics.",
            isOffline: false
        )
    }

    static let webProcessStopped = ForgeWebFailure(
        title: "Forge needs to reload",
        detail: "The embedded web process stopped. Reload to restore the web experience.",
        isOffline: false
    )
}

struct ForgeWebLayoutMetrics: Equatable {
    let width: Int
    let height: Int
    let top: Int
    let right: Int
    let bottom: Int
    let left: Int

    static func resolve(bounds: CGRect, safeAreaInsets: UIEdgeInsets) -> ForgeWebLayoutMetrics? {
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        return ForgeWebLayoutMetrics(
            width: max(0, Int(bounds.width.rounded(.down))),
            height: max(0, Int(bounds.height.rounded(.down))),
            top: max(0, Int(safeAreaInsets.top.rounded(.down))),
            right: max(0, Int(safeAreaInsets.right.rounded(.down))),
            bottom: max(0, Int(safeAreaInsets.bottom.rounded(.down))),
            left: max(0, Int(safeAreaInsets.left.rounded(.down)))
        )
    }
}

enum ForgeWebNavigationDisposition: Equatable {
    case allow
    case download
    case openExternally
    case cancel
}

enum ForgeWebNavigationPolicy {
    static func disposition(
        for candidateURL: URL,
        relativeTo forgeURL: URL,
        isUserActivated: Bool,
        isPrimaryNavigation: Bool,
        shouldPerformDownload: Bool
    ) -> ForgeWebNavigationDisposition {
        guard let scheme = candidateURL.scheme?.lowercased() else {
            return .cancel
        }
        switch scheme {
        case "about":
            return candidateURL.absoluteString == "about:blank" ? .allow : .cancel
        case "blob":
            return isUserActivated &&
                shouldPerformDownload &&
                blobOriginMatches(candidateURL, forgeURL) ? .download : .cancel
        case "data":
            return .cancel
        case "mailto", "tel", "sms", "facetime", "facetime-audio":
            return isUserActivated && isPrimaryNavigation ? .openExternally : .cancel
        case "http", "https", "forge-iroh":
            if sameOrigin(candidateURL, forgeURL) {
                if shouldPerformDownload {
                    return isUserActivated ? .download : .cancel
                }
                return .allow
            }
            return isUserActivated && isPrimaryNavigation ? .openExternally : .cancel
        default:
            return .cancel
        }
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.caseInsensitiveCompare(rhs.scheme ?? "") == .orderedSame
            && lhs.host?.caseInsensitiveCompare(rhs.host ?? "") == .orderedSame
            && normalizedPort(lhs) == normalizedPort(rhs)
    }

    private static func blobOriginMatches(_ blobURL: URL, _ forgeURL: URL) -> Bool {
        let value = blobURL.absoluteString
        guard value.lowercased().hasPrefix("blob:") else {
            return false
        }
        let serializedOrigin = String(value.dropFirst("blob:".count))
        if forgeURL.scheme?.lowercased() == "forge-iroh",
           serializedOrigin.lowercased().hasPrefix("null/")
        {
            return true
        }
        guard let originURL = URL(string: serializedOrigin) else { return false }
        return sameOrigin(originURL, forgeURL)
    }

    private static func normalizedPort(_ url: URL) -> Int? {
        if let port = url.port {
            return port
        }
        switch url.scheme?.lowercased() {
        case "http":
            return 80
        case "https":
            return 443
        default:
            return nil
        }
    }
}

enum ForgeWebDownloadPolicy {
    static func safeFilename(_ suggestedFilename: String) -> String {
        let basename = suggestedFilename
            .replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/", omittingEmptySubsequences: true)
            .last
            .map(String.init) ?? ""
        let sanitized = basename.replacingOccurrences(
            of: #"[^A-Za-z0-9._ -]"#,
            with: "_",
            options: .regularExpression
        )
        let bounded = String(sanitized.prefix(160))
        return bounded.isEmpty || bounded == "." || bounded == ".."
            ? "Forge download"
            : bounded
    }
}

struct ForgeWebView: UIViewRepresentable {
    let url: URL
    let transport: PairingTransport?
    let reloadRequest: ForgeWebReloadRequest
    @Binding var isLoading: Bool
    @Binding var failure: ForgeWebFailure?

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
    window.__forgeCompanionSyncVisualViewport = function() {
        const viewport = window.visualViewport;
        const height = Math.max(0, viewport ? viewport.height : window.innerHeight);
        const top = Math.max(0, viewport ? viewport.offsetTop : 0);
        const bottom = Math.max(0, window.innerHeight - height - top);
        document.documentElement.style.setProperty('--forge-visual-viewport-height', height + 'px');
        document.documentElement.style.setProperty('--forge-visual-viewport-top', top + 'px');
        document.documentElement.style.setProperty('--forge-visual-viewport-bottom', bottom + 'px');
        document.documentElement.style.setProperty('--forge-keyboard-inset-bottom', bottom + 'px');
    };
    window.__forgeCompanionApplyLayout = function(width, height, top, right, bottom, left) {
        const widthPx = width + 'px';
        const heightPx = height + 'px';
        const topPx = top + 'px';
        const rightPx = right + 'px';
        const bottomPx = bottom + 'px';
        const leftPx = left + 'px';
        window.__forgeCompanionViewportInsets = { top, right, bottom, left };
        document.documentElement.style.setProperty('--forge-companion-webview-width', widthPx);
        document.documentElement.style.setProperty('--forge-companion-webview-height', heightPx);
        document.documentElement.style.setProperty('--forge-safe-area-top', topPx);
        document.documentElement.style.setProperty('--forge-safe-area-right', rightPx);
        document.documentElement.style.setProperty('--forge-safe-area-bottom', bottomPx);
        document.documentElement.style.setProperty('--forge-safe-area-left', leftPx);
        document.body.style.minHeight = heightPx;
        document.body.style.margin = '0';

        const root = document.getElementById('root');
        if (root) {
            root.style.minHeight = heightPx;
        }
        window.__forgeCompanionSyncVisualViewport();
    };
    window.addEventListener('resize', window.__forgeCompanionSyncVisualViewport, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', window.__forgeCompanionSyncVisualViewport, { passive: true });
        window.visualViewport.addEventListener('scroll', window.__forgeCompanionSyncVisualViewport, { passive: true });
    }
    document.addEventListener('focusin', function() {
        window.requestAnimationFrame(window.__forgeCompanionSyncVisualViewport);
    });
    document.addEventListener('focusout', function() {
        window.requestAnimationFrame(window.__forgeCompanionSyncVisualViewport);
    });
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
        cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy,
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
        if cachePolicy != .useProtocolCachePolicy {
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        }
        return request
    }

    static func configureEmbeddedInteraction(on webView: WKWebView) {
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.allowsBackForwardNavigationGestures = true
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        companionDebugLog(
            "ForgeWebView",
            "makeUIView url=\(url.absoluteString) reloadRequest=\(reloadRequest.id.uuidString)"
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
        webView.uiDelegate = context.coordinator
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 11 / 255, green: 19 / 255, blue: 38 / 255, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 11 / 255, green: 19 / 255, blue: 38 / 255, alpha: 1)
        Self.configureEmbeddedInteraction(on: webView)
        webView.onLayout = { [weak coordinator = context.coordinator, weak webView] bounds, safeAreaInsets in
            guard let webView else { return }
            coordinator?.applyNativeBounds(bounds, safeAreaInsets: safeAreaInsets, to: webView)
        }

        context.coordinator.lastURL = url
        context.coordinator.lastReloadRequest = reloadRequest
        context.coordinator.updateViewState(isLoading: true, failure: nil)
        companionDebugLog("ForgeWebView", "makeUIView load request url=\(url.absoluteString)")
        webView.load(Self.freshRequest(for: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self

        if context.coordinator.lastURL != url {
            context.coordinator.lastURL = url
            context.coordinator.updateViewState(isLoading: true, failure: nil)
            companionDebugLog("ForgeWebView", "updateUIView load new url=\(url.absoluteString)")
            webView.load(Self.freshRequest(for: url))
            return
        }

        if context.coordinator.lastReloadRequest != reloadRequest {
            context.coordinator.lastReloadRequest = reloadRequest
            context.coordinator.updateViewState(isLoading: true, failure: nil)
            switch reloadRequest.kind {
            case .standard:
                companionDebugLog("ForgeWebView", "updateUIView standard reload id=\(reloadRequest.id.uuidString)")
                if webView.url == nil {
                    webView.load(Self.freshRequest(for: url))
                } else {
                    webView.reload()
                }
            case .clearCache:
                companionDebugLog("ForgeWebView", "updateUIView clear cache id=\(reloadRequest.id.uuidString)")
                webView.stopLoading()
                context.coordinator.clearWebViewCaches {
                    companionDebugLog("ForgeWebView", "updateUIView cache reset load url=\(url.absoluteString)")
                    webView.load(Self.freshRequest(
                        for: url,
                        cachePolicy: .reloadIgnoringLocalCacheData,
                        reloadToken: reloadRequest.id
                    ))
                }
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: ForgeWebView
        var lastURL: URL?
        var lastReloadRequest: ForgeWebReloadRequest
        private var downloadDestinations: [ObjectIdentifier: URL] = [:]
        private var pendingDownloadShares: [URL] = []
        private var downloadShareInFlight = false
        private var didBecomeActiveObserver: NSObjectProtocol?

        init(parent: ForgeWebView) {
            self.parent = parent
            self.lastReloadRequest = parent.reloadRequest
            super.init()
            didBecomeActiveObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.presentNextDownloadShareIfPossible()
            }
        }

        deinit {
            if let didBecomeActiveObserver {
                NotificationCenter.default.removeObserver(didBecomeActiveObserver)
            }
            let unfinishedFiles = Array(downloadDestinations.values) + pendingDownloadShares
            for fileURL in unfinishedFiles {
                try? FileManager.default.removeItem(at: fileURL)
            }
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

        func updateViewState(isLoading: Bool, failure: ForgeWebFailure?) {
            companionDebugLog(
                "ForgeWebView",
                "updateViewState isLoading=\(isLoading) failure=\(failure?.title ?? "nil")"
            )
            DispatchQueue.main.async {
                self.parent.isLoading = isLoading
                self.parent.failure = failure
            }
        }

        func applyNativeBounds(
            _ bounds: CGRect,
            safeAreaInsets: UIEdgeInsets,
            to webView: WKWebView
        ) {
            guard let metrics = ForgeWebLayoutMetrics.resolve(
                bounds: bounds,
                safeAreaInsets: safeAreaInsets
            ) else { return }
            companionDebugLog(
                "ForgeWebView",
                "applyNativeBounds width=\(metrics.width) height=\(metrics.height) insets=\(metrics.top),\(metrics.right),\(metrics.bottom),\(metrics.left)"
            )
            webView.evaluateJavaScript(
                "window.__forgeCompanionApplyLayout && window.__forgeCompanionApplyLayout(\(metrics.width), \(metrics.height), \(metrics.top), \(metrics.right), \(metrics.bottom), \(metrics.left));",
                completionHandler: nil
            )
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let candidateURL = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            let disposition = ForgeWebNavigationPolicy.disposition(
                for: candidateURL,
                relativeTo: parent.url,
                isUserActivated: navigationAction.navigationType == .linkActivated,
                isPrimaryNavigation: navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true,
                shouldPerformDownload: navigationAction.shouldPerformDownload
            )
            switch disposition {
            case .allow:
                if navigationAction.targetFrame == nil {
                    webView.load(navigationAction.request)
                    decisionHandler(.cancel)
                } else {
                    decisionHandler(.allow)
                }
            case .download:
                decisionHandler(.download)
            case .openExternally:
                UIApplication.shared.open(candidateURL)
                decisionHandler(.cancel)
            case .cancel:
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if navigationResponse.isForMainFrame,
               let response = navigationResponse.response as? HTTPURLResponse,
               response.statusCode >= 400
            {
                updateViewState(isLoading: false, failure: .httpStatus(response.statusCode))
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            companionDebugLog(
                "ForgeWebView",
                "didStartProvisionalNavigation url=\(webView.url?.absoluteString ?? "nil")"
            )
            updateViewState(isLoading: true, failure: nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            companionDebugLog(
                "ForgeWebView",
                "didFinish url=\(webView.url?.absoluteString ?? "nil") title=\(webView.title ?? "nil")"
            )
            updateViewState(isLoading: false, failure: nil)
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
            updateViewState(isLoading: false, failure: .from(error))
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
            updateViewState(isLoading: false, failure: .from(error))
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            companionDebugLog("ForgeWebView", "web content process terminated")
            updateViewState(isLoading: false, failure: .webProcessStopped)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let candidateURL = navigationAction.request.url
            else {
                return nil
            }
            switch ForgeWebNavigationPolicy.disposition(
                for: candidateURL,
                relativeTo: parent.url,
                isUserActivated: navigationAction.navigationType == .linkActivated,
                isPrimaryNavigation: true,
                shouldPerformDownload: navigationAction.shouldPerformDownload
            ) {
            case .allow:
                webView.load(navigationAction.request)
            case .download:
                webView.startDownload(using: navigationAction.request) { [weak self] download in
                    self?.attachDownload(download)
                }
            case .openExternally:
                UIApplication.shared.open(candidateURL)
            case .cancel:
                break
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            attachDownload(download)
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            attachDownload(download)
        }

        private func attachDownload(_ download: WKDownload) {
            download.delegate = self
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            do {
                let directory = FileManager.default.temporaryDirectory
                    .appendingPathComponent("ForgeDownloads", isDirectory: true)
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
                let filename = ForgeWebDownloadPolicy.safeFilename(suggestedFilename)
                var destination = directory.appendingPathComponent(filename, isDirectory: false)
                if FileManager.default.fileExists(atPath: destination.path) ||
                    downloadDestinations.values.contains(destination)
                {
                    let base = destination.deletingPathExtension().lastPathComponent
                    let pathExtension = destination.pathExtension
                    let uniqueName = "\(base)-\(UUID().uuidString.prefix(8))"
                    let uniqueDestination = directory
                        .appendingPathComponent(uniqueName, isDirectory: false)
                    destination = pathExtension.isEmpty
                        ? uniqueDestination
                        : uniqueDestination.appendingPathExtension(pathExtension)
                }
                downloadDestinations[ObjectIdentifier(download)] = destination
                completionHandler(destination)
            } catch {
                companionDebugLog(
                    "ForgeWebView",
                    "download destination failed error=\(error.localizedDescription)"
                )
                completionHandler(nil)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let destination = downloadDestinations.removeValue(
                forKey: ObjectIdentifier(download)
            ) else { return }
            DispatchQueue.main.async {
                self.pendingDownloadShares.append(destination)
                self.presentNextDownloadShareIfPossible()
            }
        }

        func download(
            _ download: WKDownload,
            didFailWithError error: Error,
            resumeData: Data?
        ) {
            if let destination = downloadDestinations.removeValue(
                forKey: ObjectIdentifier(download)
            ) {
                try? FileManager.default.removeItem(at: destination)
            }
            companionDebugLog(
                "ForgeWebView",
                "download failed error=\(error.localizedDescription) resumable=\(resumeData != nil)"
            )
        }

        private func presentNextDownloadShareIfPossible() {
            guard downloadShareInFlight == false,
                  let destination = pendingDownloadShares.first,
                  let presenter = activePresenter()
            else {
                return
            }
            pendingDownloadShares.removeFirst()
            downloadShareInFlight = true

            let activity = UIActivityViewController(
                activityItems: [destination],
                applicationActivities: nil
            )
            activity.completionWithItemsHandler = { [weak self] _, _, _, _ in
                try? FileManager.default.removeItem(at: destination)
                DispatchQueue.main.async {
                    self?.downloadShareInFlight = false
                    self?.presentNextDownloadShareIfPossible()
                }
            }
            if let popover = activity.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1
                )
            }
            presenter.present(activity, animated: true)
        }

        private func activePresenter() -> UIViewController? {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
                let window = scene.windows.first(where: \.isKeyWindow),
                var presenter = window.rootViewController
            else {
                companionDebugLog(
                    "ForgeWebView",
                    "download share deferred until an active presentation window is available"
                )
                return nil
            }
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            guard presenter.viewIfLoaded?.window != nil else {
                companionDebugLog(
                    "ForgeWebView",
                    "download share deferred because the presenter is not visible"
                )
                return nil
            }
            return presenter
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

final class ForgeIrohURLSchemeHandler: NSObject, WKURLSchemeHandler {
    private let transport: PairingTransport
    private let cookieJar = ForgeIrohURLSchemeCookieJar()
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
                let path = Self.proxyPath(for: url)
                companionDebugLog(
                    "ForgeIrohURLSchemeHandler",
                    "start method=\(request.httpMethod ?? "GET") url=\(url.absoluteString) path=\(path)"
                )
                let requestHeaders = await cookieJar.headersByAddingStoredCookies(
                    to: Self.proxyHeaders(from: request)
                )
                let result = try await ForgeIrohTransportClient.send(
                    method: request.httpMethod ?? "GET",
                    path: path,
                    headers: requestHeaders,
                    body: request.httpBody,
                    transport: transport
                )
                let storedCookies = await cookieJar.storeCookies(from: result.headers)
                if storedCookies.isEmpty == false {
                    companionDebugLog(
                        "ForgeIrohURLSchemeHandler",
                        "stored cookies names=\(storedCookies.joined(separator: ",")) path=\(path)"
                    )
                }
                if Task.isCancelled {
                    return
                }
                if let redirectURL = Self.redirectURL(
                    from: result,
                    originalURL: url
                ) {
                    companionDebugLog(
                        "ForgeIrohURLSchemeHandler",
                        "redirect status=\(result.statusCode) url=\(url.absoluteString) location=\(redirectURL.absoluteString)"
                    )
                    let redirectResult = try await ForgeIrohTransportClient.send(
                        method: "GET",
                        path: Self.proxyPath(for: redirectURL),
                        headers: await cookieJar.headersByAddingStoredCookies(to: requestHeaders),
                        body: nil,
                        transport: transport
                    )
                    let redirectStoredCookies = await cookieJar.storeCookies(from: redirectResult.headers)
                    if redirectStoredCookies.isEmpty == false {
                        companionDebugLog(
                            "ForgeIrohURLSchemeHandler",
                            "stored cookies names=\(redirectStoredCookies.joined(separator: ",")) path=\(Self.proxyPath(for: redirectURL))"
                        )
                    }
                    let redirectPath = Self.proxyPath(for: redirectURL)
                    try await Self.finish(
                        urlSchemeTask,
                        url: redirectURL,
                        path: redirectPath,
                        result: redirectResult
                    )
                } else {
                    try await Self.finish(
                        urlSchemeTask,
                        url: url,
                        path: path,
                        result: result
                    )
                }
                await MainActor.run {
                    _ = activeTasks.removeValue(forKey: key)
                }
            } catch {
                if Task.isCancelled {
                    await MainActor.run {
                        _ = activeTasks.removeValue(forKey: key)
                    }
                    return
                }
                companionDebugLog(
                    "ForgeIrohURLSchemeHandler",
                    "fail url=\(request.url?.absoluteString ?? "nil") error=\(error.localizedDescription)"
                )
                await MainActor.run {
                    urlSchemeTask.didFailWithError(error)
                    _ = activeTasks.removeValue(forKey: key)
                }
            }
        }
        activeTasks[key] = task
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        companionDebugLog(
            "ForgeIrohURLSchemeHandler",
            "stop url=\(urlSchemeTask.request.url?.absoluteString ?? "nil")"
        )
        activeTasks[key]?.cancel()
        activeTasks.removeValue(forKey: key)
    }

    static func proxyPath(for url: URL) -> String {
        let absoluteString = url.absoluteString
        if let schemeSeparatorRange = absoluteString.range(of: "://") {
            let afterAuthority = absoluteString[schemeSeparatorRange.upperBound...]
            if let pathStartIndex = afterAuthority.firstIndex(of: "/") {
                var pathAndQuery = String(afterAuthority[pathStartIndex...])
                if let fragmentStartIndex = pathAndQuery.firstIndex(of: "#") {
                    pathAndQuery = String(pathAndQuery[..<fragmentStartIndex])
                }
                return pathAndQuery.isEmpty ? "/" : pathAndQuery
            }
        }
        var normalizedPath = url.path.isEmpty ? "/" : url.path
        if let query = url.query, !query.isEmpty {
            normalizedPath += "?\(query)"
        }
        return normalizedPath
    }

    static func mimeType(from headers: [String: String], fallbackURL url: URL) -> String {
        let contentType = headerValue("content-type", in: headers)?
            .split(separator: ";", maxSplits: 1)
            .first
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        if let contentType, contentType.isEmpty == false {
            return contentType
        }
        switch url.pathExtension.lowercased() {
        case "css":
            return "text/css"
        case "js", "mjs", "ts", "tsx":
            return "text/javascript"
        case "json", "map":
            return "application/json"
        case "svg":
            return "image/svg+xml"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "ico":
            return "image/x-icon"
        case "woff":
            return "font/woff"
        case "woff2":
            return "font/woff2"
        default:
            return "text/html"
        }
    }

    private static func finish(
        _ urlSchemeTask: WKURLSchemeTask,
        url: URL,
        path: String,
        result: ForgeIrohTransportResult
    ) async throws {
        if Task.isCancelled {
            return
        }
        let mimeType = mimeType(from: result.headers, fallbackURL: url)
        let response = response(for: url, path: path, result: result)
        let responseKind = response is HTTPURLResponse ? "http" : "plain"
        companionDebugLog(
            "ForgeIrohURLSchemeHandler",
            "finish status=\(result.statusCode) response=\(responseKind) url=\(url.absoluteString) bytes=\(result.data.count) mime=\(mimeType)"
        )
        await MainActor.run {
            urlSchemeTask.didReceive(response)
            if result.data.isEmpty == false {
                urlSchemeTask.didReceive(result.data)
            }
            urlSchemeTask.didFinish()
        }
    }

    static func response(for url: URL, path: String, result: ForgeIrohTransportResult) -> URLResponse {
        let mimeType = mimeType(from: result.headers, fallbackURL: url)
        if shouldUseHTTPResponse(for: path),
           let response = HTTPURLResponse(
               url: url,
               statusCode: result.statusCode,
               httpVersion: "HTTP/1.1",
               headerFields: responseHeaders(from: result.headers)
           ) {
            return response
        }
        return URLResponse(
            url: url,
            mimeType: mimeType,
            expectedContentLength: result.data.count,
            textEncodingName: textEncodingName(from: result.headers)
        )
    }

    static func shouldUseHTTPResponse(for path: String) -> Bool {
        path == "/api" || path.hasPrefix("/api/") || path.hasPrefix("/api?")
    }

    private static func redirectURL(
        from result: ForgeIrohTransportResult,
        originalURL: URL
    ) -> URL? {
        guard (300 ... 399).contains(result.statusCode),
              let location = headerValue("location", in: result.headers),
              location.isEmpty == false
        else {
            return nil
        }
        if let absoluteURL = URL(string: location), absoluteURL.scheme != nil {
            if absoluteURL.scheme == "forge-iroh" {
                return absoluteURL
            }
            var components = URLComponents(url: originalURL, resolvingAgainstBaseURL: false)
            components?.path = absoluteURL.path
            components?.query = absoluteURL.query
            return components?.url
        }
        return URL(string: location, relativeTo: originalURL)?.absoluteURL
    }

    private static func proxyHeaders(from request: URLRequest) -> [String: String] {
        var headers = request.allHTTPHeaderFields ?? [:]
        headers["Host"] = nil
        headers["Connection"] = nil
        headers["Content-Length"] = nil
        headers["Transfer-Encoding"] = nil
        return headers
    }

    static func responseHeaders(from headers: [String: String]) -> [String: String] {
        headers.filter { header in
            let lowercased = header.key.lowercased()
            return lowercased != "connection" &&
                lowercased != "keep-alive" &&
                lowercased != "te" &&
                lowercased != "trailer" &&
                lowercased != "transfer-encoding" &&
                lowercased != "upgrade"
        }
    }

    private static func headerValue(_ name: String, in headers: [String: String]) -> String? {
        headers.first {
            $0.key.caseInsensitiveCompare(name) == .orderedSame
        }?.value
    }

    private static func textEncodingName(from headers: [String: String]) -> String? {
        guard let contentType = headerValue("content-type", in: headers) else {
            return nil
        }
        let parts = contentType
            .split(separator: ";")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        for part in parts {
            let lowercased = part.lowercased()
            if lowercased.hasPrefix("charset=") {
                return String(part.dropFirst("charset=".count))
            }
        }
        return nil
    }
}

actor ForgeIrohURLSchemeCookieJar {
    private var cookies: [String: String] = [:]

    func headersByAddingStoredCookies(to headers: [String: String]) -> [String: String] {
        guard cookies.isEmpty == false else {
            return headers
        }
        var nextHeaders = headers
        let storedCookieHeader = Self.cookieHeader(from: cookies)
        if let existingKey = nextHeaders.keys.first(where: { $0.caseInsensitiveCompare("cookie") == .orderedSame }),
           let existingValue = nextHeaders[existingKey],
           existingValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            nextHeaders[existingKey] = Self.mergeCookieHeaders(existingValue, storedCookieHeader)
        } else {
            nextHeaders["Cookie"] = storedCookieHeader
        }
        return nextHeaders
    }

    @discardableResult
    func storeCookies(from headers: [String: String]) -> [String] {
        var storedNames: [String] = []
        for header in headers where header.key.caseInsensitiveCompare("set-cookie") == .orderedSame {
            for parsedCookie in Self.parseSetCookieHeader(header.value) {
                if parsedCookie.value.isEmpty || parsedCookie.shouldDelete {
                    cookies.removeValue(forKey: parsedCookie.name)
                } else {
                    cookies[parsedCookie.name] = parsedCookie.value
                }
                storedNames.append(parsedCookie.name)
            }
        }
        return storedNames
    }

    static func cookieHeader(from cookies: [String: String]) -> String {
        cookies
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "; ")
    }

    static func mergeCookieHeaders(_ existingHeader: String, _ storedHeader: String) -> String {
        var cookiesByName: [String: String] = [:]
        for cookie in parseCookieHeader(existingHeader) {
            cookiesByName[cookie.name] = cookie.value
        }
        for cookie in parseCookieHeader(storedHeader) {
            cookiesByName[cookie.name] = cookie.value
        }
        return cookieHeader(from: cookiesByName)
    }

    static func parseCookieHeader(_ header: String) -> [(name: String, value: String)] {
        header
            .split(separator: ";")
            .compactMap { part -> (name: String, value: String)? in
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let equalsIndex = trimmed.firstIndex(of: "=") else {
                    return nil
                }
                let name = String(trimmed[..<equalsIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
                let value = String(trimmed[trimmed.index(after: equalsIndex)...])
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard name.isEmpty == false else {
                    return nil
                }
                return (name, value)
            }
    }

    static func parseSetCookieHeader(_ header: String) -> [(name: String, value: String, shouldDelete: Bool)] {
        let parts = header.split(separator: ";")
        guard let firstPart = parts.first else {
            return []
        }
        let first = firstPart.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let equalsIndex = first.firstIndex(of: "=") else {
            return []
        }
        let name = String(first[..<equalsIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        let value = String(first[first.index(after: equalsIndex)...])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.isEmpty == false else {
            return []
        }
        let shouldDelete = parts.dropFirst().contains { attribute in
            attribute
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased() == "max-age=0"
        }
        return [(name, value, shouldDelete)]
    }
}

final class LayoutAwareWebView: WKWebView {
    var onLayout: ((CGRect, UIEdgeInsets) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(bounds, safeAreaInsets)
    }
}
