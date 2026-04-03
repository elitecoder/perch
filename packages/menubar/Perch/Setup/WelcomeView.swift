import SwiftUI

struct WelcomeView: View {
    var onNext: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text("🐦")
                .font(.system(size: 72))
            Text("Welcome to Perch")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Perch bridges your terminal sessions to Slack so you can monitor and control your AI coding tools from any device.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 380)
            Button("Set Up Perch →") { onNext() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding(40)
        .frame(width: 480, height: 360)
    }
}
