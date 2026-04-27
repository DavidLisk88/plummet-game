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
        entryForDate(Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (WotdEntry) -> Void) {
        completion(entryForDate(Date()))
    }

    /// Build a 7-day timeline so the widget self-updates daily without
    /// needing the app to be opened. Each entry carries the word for its day,
    /// computed natively from the bundled pool.
    func getTimeline(in context: Context, completion: @escaping (Timeline<WotdEntry>) -> Void) {
        let now = Date()
        let calendar = Calendar.current

        // Active challenge takes precedence — single entry with refresh after end.
        if let challengeEntry = activeChallengeEntry(now: now) {
            let refreshAt = (challengeEntry.challengeEndDate ?? now).addingTimeInterval(5)
            completion(Timeline(entries: [challengeEntry], policy: .after(refreshAt)))
            return
        }

        // Build entries: today (now), then midnight of next 6 days.
        var entries: [WotdEntry] = [entryForDate(now)]
        let startOfToday = calendar.startOfDay(for: now)
        for dayOffset in 1...6 {
            if let date = calendar.date(byAdding: .day, value: dayOffset, to: startOfToday) {
                entries.append(entryForDate(date))
            }
        }

        // Reload at the start of day 7 (when our last entry is no longer fresh).
        let reloadAt = calendar.date(byAdding: .day, value: 7, to: startOfToday) ?? now.addingTimeInterval(7 * 86400)
        completion(Timeline(entries: entries, policy: .after(reloadAt)))
    }

    // -----------------------------------------------------------------------
    // MARK: - Word selection (native, no app dependency)
    // -----------------------------------------------------------------------

    /// Build a WOTD entry for an arbitrary date by computing the word from
    /// the bundled pool. Falls back through:
    ///   1. Bundled pool + date hash  (primary; matches JS exactly)
    ///   2. UserDefaults from App Group (set by app on launch — only useful
    ///      if pool failed to load)
    ///   3. Hardcoded "PLUMMET" placeholder
    private func entryForDate(_ date: Date) -> WotdEntry {
        if let picked = WotdPool.shared.wordForDate(date) {
            return WotdEntry(
                date: date,
                word: picked.word.uppercased(),
                pos: picked.pos,
                definition: picked.definition,
                challengeActive: false, challengeEndDate: nil,
                challengeMode: "", challengeScore: 0
            )
        }

        // Pool unavailable → try App Group cache
        let defaults = UserDefaults(suiteName: kAppGroupID)
        let word       = defaults?.string(forKey: WotdKey.word)       ?? "PLUMMET"
        let pos        = defaults?.string(forKey: WotdKey.pos)        ?? "verb"
        let definition = defaults?.string(forKey: WotdKey.definition) ?? "To fall sharply and rapidly."
        return WotdEntry(
            date: date,
            word: word, pos: pos, definition: definition,
            challengeActive: false, challengeEndDate: nil,
            challengeMode: "", challengeScore: 0
        )
    }

    /// Returns a challenge-overlay entry if a challenge is currently active.
    private func activeChallengeEntry(now: Date) -> WotdEntry? {
        let defaults = UserDefaults(suiteName: kAppGroupID)
        let isActive  = defaults?.bool(forKey: ChallengeKey.active) ?? false
        let endUnix   = defaults?.double(forKey: ChallengeKey.endUnix) ?? 0
        guard isActive, endUnix > 0 else { return nil }
        let endDate = Date(timeIntervalSince1970: endUnix)
        guard endDate > now else { return nil }

        // Use today's WOTD as background data even while challenge is showing
        let base = entryForDate(now)
        return WotdEntry(
            date: now,
            word: base.word, pos: base.pos, definition: base.definition,
            challengeActive: true,
            challengeEndDate: endDate,
            challengeMode: defaults?.string(forKey: ChallengeKey.mode) ?? "",
            challengeScore: defaults?.integer(forKey: ChallengeKey.score) ?? 0
        )
    }
}

// ---------------------------------------------------------------------------
// MARK: - WotdPool — loads bundled wotd-pool.json once per process
// ---------------------------------------------------------------------------

struct WotdPoolEntry: Decodable {
    let word: String
    let pos: String
    let definition: String
}

final class WotdPool {
    static let shared = WotdPool()

    /// Filename used for the OTA-updatable pool inside the App Group container.
    static let appGroupPoolFilename = "wotd-pool.json"

    private let entries: [WotdPoolEntry]

    private init() {
        // 1) Prefer the App Group copy (OTA-updatable by the main app).
        // 2) Fall back to the bundled copy that shipped with this build.
        let data: Data? = Self.loadAppGroupPool() ?? Self.loadBundledPool()

        guard let raw = data,
              let decoded = try? JSONDecoder().decode([WotdPoolEntry].self, from: raw) else {
            self.entries = []
            return
        }
        // Defensive re-sort to guarantee identical ordering with JS regardless
        // of how the bundle/container was packaged.
        self.entries = decoded.sorted { $0.word < $1.word }
    }

    private static func loadAppGroupPool() -> Data? {
        guard let containerURL = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: kAppGroupID) else {
            return nil
        }
        let fileURL = containerURL.appendingPathComponent(appGroupPoolFilename)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try? Data(contentsOf: fileURL)
    }

    private static func loadBundledPool() -> Data? {
        guard let url = Bundle.main.url(forResource: "wotd-pool", withExtension: "json") else {
            return nil
        }
        return try? Data(contentsOf: url)
    }

    /// Compute the WOTD entry for the given date using the local-date hash
    /// algorithm — must stay byte-identical with `selectWordOfDay()` in JS.
    func wordForDate(_ date: Date) -> WotdPoolEntry? {
        guard !entries.isEmpty else { return nil }
        let key = Self.localDayKey(for: date)
        let hash = Self.djb2ish("plummet-wotd-" + key)
        let index = Int(hash % UInt64(entries.count))
        return entries[index]
    }

    /// "YYYY-MM-DD" in local time — matches `getLocalDayKey()` in JS.
    static func localDayKey(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// Mirrors the JS `hashString` exactly:
    ///   hash = ((hash << 5) - hash) + ch; hash |= 0;
    ///   return Math.abs(hash);
    /// Implemented with Int32 overflow operators so behavior matches JS's
    /// `|= 0` 32-bit signed truncation, then taken to UInt64 for safe modulo.
    static func djb2ish(_ str: String) -> UInt64 {
        var hash: Int32 = 0
        for scalar in str.unicodeScalars {
            let shifted = hash &<< 5
            hash = (shifted &- hash) &+ Int32(truncatingIfNeeded: scalar.value)
        }
        // Math.abs(int32) — handle Int32.min by widening to Int64 first
        let widened = Int64(hash)
        return UInt64(widened < 0 ? -widened : widened)
    }
}
