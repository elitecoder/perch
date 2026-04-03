import SwiftUI

struct SlackManifestView: View {
    var onNext: () -> Void

    private let manifestURL = "https://api.slack.com/apps?new_app=1"
    private let manifest = """
    {
      "display_information": { "name": "Perch" },
      "settings": { "socket_mode_enabled": true },
      "oauth_config": { "scopes": { "bot": ["chat:write","channels:read","channels:history","im:write"] } },
      "features": { "bot_user": { "display_name": "perch" } }
    }
    """

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Step 2: Create Slack App")
                .font(.title2).fontWeight(.semibold)

            Text("1. Click the button below to open Slack's app creation page.")
            Text("2. Choose \"From a manifest\", paste the JSON below, and click Create.")

            Button("Open api.slack.com →") {
                NSWorkspace.shared.open(URL(string: manifestURL)!)
            }

            Text("Manifest:")
                .fontWeight(.medium)
            ScrollView {
                Text(manifest)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(6)
            }
            .frame(height: 120)

            Spacer()
            HStack {
                Spacer()
                Button("App Created →") { onNext() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
        .frame(width: 480, height: 380)
    }
}
