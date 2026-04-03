import Foundation

struct PerchConfig: Codable {
    var slackChannelId: String = ""
    var pollIntervalMs: Int = 2000
    var maxScreenLines: Int = 50
    var adapterPriority: [String] = ["tmux", "zellij", "cmux", "screen"]
    var userPluginsDir: String = ""
}

enum ConfigManager {
    static var configDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/perch")
    }

    static var configURL: URL {
        configDir.appendingPathComponent("config.json")
    }

    static func read() -> PerchConfig {
        guard let data = try? Data(contentsOf: configURL),
              let config = try? JSONDecoder().decode(PerchConfig.self, from: data)
        else { return PerchConfig() }
        return config
    }

    static func write(_ config: PerchConfig) {
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        if let data = try? encoder.encode(config) {
            try? data.write(to: configURL)
        }
    }
}
