import SwiftUI

struct CompleteView: View {
    var multiplexer: String
    var channelId: String
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)

            Text("Perch is Ready!")
                .font(.largeTitle).fontWeight(.bold)

            VStack(alignment: .leading, spacing: 8) {
                Label("Multiplexer: \(multiplexer)", systemImage: "terminal")
                Label("Channel: \(channelId)", systemImage: "bubble.left.and.bubble.right")
                Label("Daemon: running via LaunchAgent", systemImage: "bolt.fill")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(NSColor.controlBackgroundColor))
            .cornerRadius(8)

            Text("Perch lives in your menu bar. Open Slack and type `help` to get started.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            Button("Done") { onDone() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(40)
        .frame(width: 480, height: 400)
    }
}
