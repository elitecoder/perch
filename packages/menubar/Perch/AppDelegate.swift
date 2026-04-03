import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusBarController: StatusBarController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // hide from Dock

        statusBarController = StatusBarController()

        // First-run: open setup if not configured
        let config = ConfigManager.read()
        if config.slackChannelId.isEmpty || !DaemonManager.isPlistInstalled() {
            SetupWindowController.shared.showWindow(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false // stay alive as a menu bar app even after setup window closes
    }
}
