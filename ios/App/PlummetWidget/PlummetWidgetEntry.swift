import WidgetKit
import SwiftUI

// ---------------------------------------------------------------------------
// MARK: - Shared constants
// ---------------------------------------------------------------------------

/// Must match the App Group registered in both the App target and this widget target.
let kAppGroupID = "group.com.plummetgame.app"

/// Keys written by PlummetAppGroupPlugin from JS.
enum WotdKey {
    static let word       = "wotd_word"
    static let pos        = "wotd_pos"
    static let definition = "wotd_definition"
    static let date       = "wotd_date"        // "YYYY-MM-DD" the word was picked
}

/// Keys written by PlummetAppGroupPlugin when a challenge is active.
enum ChallengeKey {
    static let active   = "challenge_active"
    static let endUnix  = "challenge_end_unix"  // Double: seconds since epoch
    static let mode     = "challenge_mode"
    static let score    = "challenge_score"
}

// ---------------------------------------------------------------------------
// MARK: - Timeline Entry
// ---------------------------------------------------------------------------

struct WotdEntry: TimelineEntry {
    let date: Date
    // Word of the Day fields
    let word: String
    let pos: String
    let definition: String
    // Challenge overlay fields (nil = no active challenge)
    let challengeActive: Bool
    let challengeEndDate: Date?
    let challengeMode: String
    let challengeScore: Int
}

// ---------------------------------------------------------------------------
// MARK: - Timeline Provider
// ---------------------------------------------------------------------------

struct WotdProvider: TimelineProvider {

    func placeholder(in context: Context) -> WotdEntry {
        WotdEntry(date: Date(), word: "PLUMMET", pos: "verb",
                  definition: "To fall straight down; drop sharply and rapidly.",
                  challengeActive: false, challengeEndDate: nil,
                  challengeMode: "", challengeScore: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (WotdEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WotdEntry>) -> Void) {
        let entry = currentEntry()

        let policy: TimelineReloadPolicy
        if entry.challengeActive, let endDate = entry.challengeEndDate, endDate > Date() {
            // Refresh shortly after the challenge ends so the widget reverts to WOTD
            let refreshAt = endDate.addingTimeInterval(5)
            policy = .after(refreshAt)
        } else {
            // Refresh at the next noon so the word updates in sync with the notification
            let calendar = Calendar.current
            var noonComponents = calendar.dateComponents([.year, .month, .day], from: Date())
            noonComponents.hour = 12
            noonComponents.minute = 0
            noonComponents.second = 0
            var nextNoon = calendar.date(from: noonComponents) ?? Date().addingTimeInterval(86400)
            if nextNoon <= Date() {
                nextNoon = calendar.date(byAdding: .day, value: 1, to: nextNoon) ?? nextNoon
            }
            policy = .after(nextNoon)
        }

        let timeline = Timeline(entries: [entry], policy: policy)
        completion(timeline)
    }

    // -----------------------------------------------------------------------
    private func currentEntry() -> WotdEntry {
        let defaults = UserDefaults(suiteName: kAppGroupID)

        // Word of the Day data
        let word       = defaults?.string(forKey: WotdKey.word)       ?? "PLUMMET"
        let pos        = defaults?.string(forKey: WotdKey.pos)        ?? "verb"
        let definition = defaults?.string(forKey: WotdKey.definition) ?? "To fall sharply and rapidly."

        // Challenge state
        let isActive     = defaults?.bool(forKey: ChallengeKey.active) ?? false
        let endUnix      = defaults?.double(forKey: ChallengeKey.endUnix) ?? 0
        let challengeEnd = endUnix > 0 ? Date(timeIntervalSince1970: endUnix) : nil
        let mode         = defaults?.string(forKey: ChallengeKey.mode)  ?? ""
        let score        = defaults?.integer(forKey: ChallengeKey.score) ?? 0

        // Only treat as active if the end date is in the future
        let stillActive  = isActive && (challengeEnd.map { $0 > Date() } ?? false)

        return WotdEntry(
            date: Date(),
            word: word, pos: pos, definition: definition,
            challengeActive: stillActive,
            challengeEndDate: challengeEnd,
            challengeMode: mode,
            challengeScore: score
        )
    }
}
