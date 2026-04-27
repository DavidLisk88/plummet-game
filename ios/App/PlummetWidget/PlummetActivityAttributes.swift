import ActivityKit
import Foundation

/// Shared data model for Plummet Live Activities.
/// This file must be added to BOTH the App target AND the PlummetLiveActivity extension target.
struct PlummetActivityAttributes: ActivityAttributes {
    // Static data set when the activity starts
    var challengeMode: String   // e.g. "Speed Round", "Word Search"

    // Dynamic data that can be updated while the activity is live
    public struct ContentState: Codable, Hashable {
        var endDate: Date       // when the timer expires — iOS counts down natively
        var score: Int
        var isFinished: Bool
    }
}
