import SwiftUI

struct LogViewerView: View {
    @State private var logContent: String = ""
    @State private var isAutoScrolling = true
    private let logPath = NSHomeDirectory() + "/.config/perch/perch.log"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Perch Logs")
                    .font(.headline)
                Spacer()
                Toggle("Auto-scroll", isOn: $isAutoScrolling)
                    .toggleStyle(.checkbox)
                Button("Clear") { logContent = "" }
                    .buttonStyle(.borderless)
            }
            .padding(8)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    Text(logContent.isEmpty ? "(no log output yet)" : logContent)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .id("bottom")
                }
                .onChange(of: logContent) { _ in
                    if isAutoScrolling {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
        }
        .frame(minWidth: 600, minHeight: 400)
        .onAppear { startTailing() }
    }

    private func startTailing() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: logPath) else { return }
        DispatchQueue.global(qos: .background).async {
            guard let handle = FileHandle(forReadingAtPath: logPath) else { return }
            handle.seekToEndOfFile()
            // Read existing content first
            handle.seek(toFileOffset: 0)
            let existing = String(data: handle.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async { logContent = existing }
            // Poll for new content
            Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                let newData = handle.readDataToEndOfFile()
                guard !newData.isEmpty, let newText = String(data: newData, encoding: .utf8) else { return }
                DispatchQueue.main.async { logContent += newText }
            }
            RunLoop.current.run()
        }
    }
}
