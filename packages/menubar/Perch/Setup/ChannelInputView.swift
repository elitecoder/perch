import SwiftUI

struct ChannelInputView: View {
    @State private var channelId = ""
    @State private var error: String?
    var onNext: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Step 4: Slack Channel")
                .font(.title2).fontWeight(.semibold)

            Text("Paste the Channel ID where Perch should listen.")
                .foregroundStyle(.secondary)
            Text("(Right-click a channel in Slack → Copy link — the ID is the last segment, e.g. C0ABC1234)")
                .font(.caption).foregroundStyle(.secondary)

            TextField("C0ABC1234...", text: $channelId)
                .textFieldStyle(.roundedBorder)

            if let error {
                Text(error).foregroundStyle(.red).font(.caption)
            }

            Spacer()
            HStack {
                Spacer()
                Button("Continue →") {
                    guard channelId.starts(with: "C") && channelId.count > 5 else {
                        error = "Channel IDs start with C and are 9–11 characters long."
                        return
                    }
                    onNext(channelId)
                }
                .buttonStyle(.borderedProminent)
                .disabled(channelId.isEmpty)
            }
        }
        .padding(32)
        .frame(width: 480, height: 280)
    }
}
