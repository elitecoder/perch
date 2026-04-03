import Foundation

private let label = "dev.perch"
private var plistPath: String {
    NSHomeDirectory() + "/Library/LaunchAgents/\(label).plist"
}

enum DaemonManager {
    static func status() -> DaemonStatus {
        do {
            let output = try shell("/bin/launchctl", args: ["list", label])
            return output.contains(label) ? .running : .stopped
        } catch {
            return .stopped
        }
    }

    static func start() throws {
        try shell("/bin/launchctl", args: ["load", plistPath])
    }

    static func stop() throws {
        try shell("/bin/launchctl", args: ["unload", plistPath])
    }

    static func restart() throws {
        try? stop()
        try start()
    }

    static func isPlistInstalled() -> Bool {
        FileManager.default.fileExists(atPath: plistPath)
    }
}
