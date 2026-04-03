import AppKit

// Use a traditional NSApplicationDelegate rather than SwiftUI App lifecycle
// so we can suppress the Dock icon and run purely as a menu bar app.
let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
