import AppKit
import SwiftUI

final class SetupWindowController: NSWindowController {
    static let shared = SetupWindowController()

    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 400),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Perch Setup"
        window.center()
        super.init(window: window)
        showStep(.welcome)
    }

    required init?(coder: NSCoder) { nil }

    enum Step {
        case welcome
        case multiplexer
        case slackManifest
        case tokenInput
        case channelInput
        case testConnection(channelId: String)
        case complete(multiplexer: String, channelId: String)
    }

    private var multiplexer = ""
    private var channelId = ""

    func showStep(_ step: Step) {
        let view: AnyView
        switch step {
        case .welcome:
            view = AnyView(WelcomeView { self.showStep(.multiplexer) })
        case .multiplexer:
            view = AnyView(MultiplexerView { mux in
                self.multiplexer = mux
                self.showStep(.slackManifest)
            })
        case .slackManifest:
            view = AnyView(SlackManifestView { self.showStep(.tokenInput) })
        case .tokenInput:
            view = AnyView(TokenInputView { self.showStep(.channelInput) })
        case .channelInput:
            view = AnyView(ChannelInputView { channelId in
                self.channelId = channelId
                var config = ConfigManager.read()
                config.slackChannelId = channelId
                ConfigManager.write(config)
                self.showStep(.testConnection(channelId: channelId))
            })
        case .testConnection(let cid):
            view = AnyView(TestConnectionView(channelId: cid) {
                self.showStep(.complete(multiplexer: self.multiplexer, channelId: cid))
            })
        case .complete(let mux, let cid):
            view = AnyView(CompleteView(multiplexer: mux, channelId: cid) {
                self.close()
            })
        }
        window?.contentView = NSHostingView(rootView: view)
    }
}
