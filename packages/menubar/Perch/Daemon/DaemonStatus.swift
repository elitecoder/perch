import Foundation

enum DaemonStatus {
    case running
    case stopped
    case error(String)
}
