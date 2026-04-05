import SwiftUI
import WebKit

struct ForgeWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

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

        let source = """
        window.__forgeCompanionEmbedded = true;
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
            document.documentElement.style.height = heightPx;
            document.documentElement.style.minHeight = heightPx;
            document.documentElement.style.background = '#0B1326';
            document.body.style.height = heightPx;
            document.body.style.minHeight = heightPx;
            document.body.style.margin = '0';
            document.body.style.background = '#0B1326';

            const root = document.getElementById('root');
            if (root) {
                root.style.height = heightPx;
                root.style.minHeight = heightPx;
                root.style.background = '#0B1326';
            }
        };
        const style = document.createElement('style');
        style.innerHTML = `
        html, body, #root {
            width: 100% !important;
            min-height: 100% !important;
            max-height: none !important;
            background: #0B1326 !important;
        }
        body {
            overflow-x: hidden !important;
        }`;
        document.documentElement.appendChild(style);
        """

        configuration.userContentController.addUserScript(
            WKUserScript(
                source: source,
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
        webView.scrollView.bounces = false
        webView.onLayout = { [weak coordinator = context.coordinator, weak webView] bounds, safeAreaInsets in
            guard let webView else { return }
            coordinator?.applyNativeBounds(bounds, safeAreaInsets: safeAreaInsets, to: webView)
        }

        context.coordinator.lastURL = url
        context.coordinator.lastReloadToken = reloadToken
        context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
        companionDebugLog("ForgeWebView", "makeUIView load request url=\(url.absoluteString)")
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url {
            context.coordinator.lastURL = url
            context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
            companionDebugLog("ForgeWebView", "updateUIView load new url=\(url.absoluteString)")
            webView.load(URLRequest(url: url))
            return
        }

        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.updateViewState(isLoading: true, errorMessage: nil)
            companionDebugLog("ForgeWebView", "updateUIView reload token=\(reloadToken.uuidString)")
            webView.reload()
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

final class LayoutAwareWebView: WKWebView {
    var onLayout: ((CGRect, UIEdgeInsets) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(bounds, safeAreaInsets)
    }
}
