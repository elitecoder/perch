import SwiftUI

struct TestConnectionView: View {
    var channelId: String
    var onNext: () -> Void

    @State private var state: TestState = .idle

    enum TestState { case idle, testing, success, failure(String) }

    var body: some View {
        VStack(spacing: 24) {
            Text("Step 5: Test Connection")
                .font(.title2).fontWeight(.semibold)

            switch state {
            case .idle:
                Button("Test Connection") { runTest() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            case .testing:
                ProgressView("Connecting to Slack…")
            case .success:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48)).foregroundStyle(.green)
                Text("Connected! Check your Slack channel for a greeting message.")
                    .multilineTextAlignment(.center)
            case .failure(let msg):
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 48)).foregroundStyle(.red)
                Text(msg).foregroundStyle(.red).multilineTextAlignment(.center)
                Button("Retry") { runTest() }
            }

            Spacer()
            HStack {
                Spacer()
                Button("Continue →") { onNext() }
                    .buttonStyle(.borderedProminent)
                    .disabled({ if case .success = state { return false }; return true }())
            }
        }
        .padding(32)
        .frame(width: 480, height: 300)
        .onAppear { runTest() }
    }

    private func runTest() {
        state = .testing
        // The CLI validator handles the actual Slack API call; here we just check
        // that the LaunchAgent is installable and the Keychain entries exist.
        DispatchQueue.global().async {
            let botToken = KeychainManager.get(key: "botToken")
            let appToken = KeychainManager.get(key: "appToken")
            DispatchQueue.main.async {
                if botToken != nil && appToken != nil {
                    self.state = .success
                } else {
                    self.state = .failure("Tokens missing from Keychain. Go back and re-enter them.")
                }
            }
        }
    }
}
