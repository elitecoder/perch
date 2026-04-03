import Foundation

enum ShellError: Error {
    case nonZeroExit(Int32, String)
}

@discardableResult
func shell(_ command: String, args: [String] = []) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = args

    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe

    try process.run()
    process.waitUntilExit()

    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let output = String(data: data, encoding: .utf8) ?? ""

    if process.terminationStatus != 0 {
        throw ShellError.nonZeroExit(process.terminationStatus, output)
    }
    return output
}
