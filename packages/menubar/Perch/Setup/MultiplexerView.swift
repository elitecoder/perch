import SwiftUI

struct MultiplexerView: View {
    @State private var detected: [String] = []
    @State private var selected: String = ""
    @State private var isChecking = true
    var onNext: (String) -> Void

    private let supported = ["tmux", "zellij", "cmux", "screen"]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Step 1: Terminal Multiplexer")
                .font(.title2).fontWeight(.semibold)

            if isChecking {
                HStack { ProgressView(); Text("Detecting…") }
            } else if detected.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No supported multiplexer found.")
                        .foregroundStyle(.red)
                    Text("Install tmux: brew install tmux")
                        .font(.system(.body, design: .monospaced))
                }
            } else {
                Text("Detected: \(detected.joined(separator: ", "))")
                    .foregroundStyle(.secondary)
                Picker("Use:", selection: $selected) {
                    ForEach(detected, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.menu)
                .frame(width: 200)
            }

            Spacer()
            HStack {
                Spacer()
                Button("Continue →") { onNext(selected) }
                    .buttonStyle(.borderedProminent)
                    .disabled(selected.isEmpty)
            }
        }
        .padding(32)
        .frame(width: 480, height: 280)
        .onAppear { detect() }
    }

    private func detect() {
        DispatchQueue.global().async {
            let found = supported.filter { mux in
                (try? shell("/usr/bin/which", args: [mux])) != nil
            }
            DispatchQueue.main.async {
                detected = found
                selected = found.first ?? ""
                isChecking = false
            }
        }
    }
}
