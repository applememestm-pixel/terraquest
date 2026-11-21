import SwiftUI
import WebKit

@main
struct TerraApp: App {
    var body: some Scene {
        WindowGroup {
            LocalAtlas().background(Color(red: 0.067, green: 0.102, blue: 0.165))
        }
    }
}

struct LocalAtlas: UIViewRepresentable {
    static let storePrefix = "Terra.storage."
    static let allowedKeys = ["terra-atlas-progress-v2", "terra-atlas-progress-v1", "terra-theme"]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let initialValues = Self.allowedKeys.reduce(into: [String: String]()) { result, key in
            result[key] = UserDefaults.standard.string(forKey: Self.storePrefix + key)
        }
        let data = (try? JSONSerialization.data(withJSONObject: initialValues)) ?? Data("{}".utf8)
        let initial = String(decoding: data, as: UTF8.self)
        let bridge = """
        (() => {
          const values = \(initial);
          globalThis.terraStorage = {
            getItem(key) { return values[key] ?? null; },
            setItem(key, value) {
              values[key] = String(value);
              webkit.messageHandlers.terraStore.postMessage({key, value: values[key]});
            }
          };
        })();
        """
        configuration.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(context.coordinator, name: "terraStore")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "mobile-web") {
            let local = page.deletingLastPathComponent().standardizedFileURL
            context.coordinator.directory = local
            view.loadFileURL(page, allowingReadAccessTo: local)
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "terraStore")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var directory: URL?

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.name == "terraStore",
                  let fields = message.body as? [String: String],
                  let key = fields["key"], LocalAtlas.allowedKeys.contains(key),
                  let value = fields["value"], value.utf8.count <= 512 * 1024 else { return }
            UserDefaults.standard.set(value, forKey: LocalAtlas.storePrefix + key)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, url.isFileURL, let directory,
                  url.standardizedFileURL.path.hasPrefix(directory.path + "/") else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
