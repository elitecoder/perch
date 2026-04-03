import SwiftUI

struct TokenInputView: View {
    @State private var botToken = ""
    @State private var appToken = ""
    @State private var validating = false
    @State private var error: String?
    var onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Step 3: Enter Tokens")
                .font(.title2).fontWeight(.semibold)

            Group {
                Text("Bot Token (xoxb-…)")
                    .fontWeight(.medium)
                SecureField("xoxb-...", text: $botToken)
                    .textFieldStyle(.roundedBorder)

                Text("App Token (xapp-…)")
                    .fontWeight(.medium)
                Text("Settings → Basic Information → App-Level Tokens (scope: connections:write)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                SecureField("xapp-...", text: $appToken)
                    .textFieldStyle(.roundedBorder)
            }

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            Spacer()
            HStack {
                Spacer()
                if validating { ProgressView() }
                Button("Validate & Continue →") { validate() }
                    .buttonStyle(.borderedProminent)
                    .disabled(botToken.isEmpty || appToken.isEmpty || validating)
            }
        }
        .padding(32)
        .frame(width: 480, height: 320)
    }

    private func validate() {
        guard botToken.hasPrefix("xoxb-"), appToken.hasPrefix("xapp-") else {
            error = "Bot token must start with xoxb- and app token with xapp-"
            return
        }
        validating = true
        error = nil
        DispatchQueue.global().async {
            do {
                try KeychainManager.set(key: "botToken", value: botToken)
                try KeychainManager.set(key: "appToken", value: appToken)
                DispatchQueue.main.async {
                    validating = false
                    onNext()
                }
            } catch {
                DispatchQueue.main.async {
                    validating = false
                    self.error = "Keychain error: \(error.localizedDescription)"
                }
            }
        }
    }
}
