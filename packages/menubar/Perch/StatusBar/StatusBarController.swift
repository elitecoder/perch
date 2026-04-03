import AppKit
import SwiftUI

final class StatusBarController: NSObject {
    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusCheckTimer: Timer?

    override init() {
        super.init()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        buildMenu()
        updateIcon()
        statusCheckTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.updateIcon()
        }
    }

    private func buildMenu() {
        menu = NSMenu()

        let statusItem = NSMenuItem(title: "Checking status...", action: nil, keyEquivalent: "")
        statusItem.tag = 100
        menu.addItem(statusItem)

        menu.addItem(NSMenuItem.separator())
        menu.addItem(makeItem("Restart",    action: #selector(restart),   key: "r"))
        menu.addItem(makeItem("Show Logs",  action: #selector(showLogs),  key: "l"))
        menu.addItem(makeItem("Settings…",  action: #selector(openSetup), key: ","))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(makeItem("Quit Perch", action: #selector(quit),      key: "q"))

        self.statusItem.menu = menu
    }

    private func makeItem(_ title: String, action: Selector, key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    func updateIcon() {
        let status = DaemonManager.status()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            switch status {
            case .running:
                self.statusItem.button?.title = "🐦"
                self.menu.item(withTag: 100)?.title = "Perch is running"
            case .stopped:
                self.statusItem.button?.title = "🐦"
                self.statusItem.button?.alphaValue = 0.4
                self.menu.item(withTag: 100)?.title = "Perch is stopped"
            case .error(let msg):
                self.statusItem.button?.title = "🐦!"
                self.menu.item(withTag: 100)?.title = "Error: \(msg)"
            }
        }
    }

    @objc private func restart() {
        try? DaemonManager.restart()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.updateIcon()
        }
    }

    @objc private func showLogs() {
        let logPath = NSHomeDirectory() + "/.config/perch/perch.log"
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    @objc private func openSetup() {
        NSApp.activate(ignoringOtherApps: true)
        SetupWindowController.shared.showWindow(nil)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
