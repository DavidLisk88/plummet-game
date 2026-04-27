import SwiftUI
import WidgetKit

// ---------------------------------------------------------------------------
// MARK: - Deep link URLs (Universal Link — must match associatedDomains entitlement)
// ---------------------------------------------------------------------------

/// Tap target for the Word-of-the-Day widget views.
/// Use a Universal Link (https) so it survives App Store review and works
/// even if the URL scheme is not registered. The host page should JS-route
/// to the WOTD modal on load.
private let kWidgetWotdURL      = URL(string: "https://plummet.netlify.app/?source=widget&intent=wotd")!
private let kWidgetChallengeURL = URL(string: "https://plummet.netlify.app/?source=widget&intent=challenge")!

// ---------------------------------------------------------------------------
// MARK: - Design tokens (match game's dark-olive palette)
// ---------------------------------------------------------------------------

// Core colours — sourced from style.css CSS variables
private let appBg        = Color(red: 0.184, green: 0.188, blue: 0.161) // #2f3029
private let appSurface   = Color(red: 0.227, green: 0.231, blue: 0.200) // #3a3b34
private let appAccent    = Color(red: 0.886, green: 0.847, blue: 0.651) // #e2d8a6
private let appBonus     = Color(red: 0.831, green: 0.627, blue: 0.376) // #d4a060
private let appSuccess   = Color(red: 0.549, green: 0.722, blue: 0.376) // #8cb860
private let appFaded     = Color(red: 0.886, green: 0.847, blue: 0.651).opacity(0.45)
private let textPrimary  = Color(red: 0.886, green: 0.847, blue: 0.651) // same as accent
private let textSecondary = Color(red: 0.886, green: 0.847, blue: 0.651).opacity(0.55)

// ---------------------------------------------------------------------------
// MARK: - Small widget  (2×2 home screen)
// ---------------------------------------------------------------------------

struct WotdSmallView: View {
    let entry: WotdEntry

    var body: some View {
        ZStack {
            appBg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "text.book.closed.fill")
                        .font(.caption2)
                        .foregroundColor(appBonus)
                    Text("Word of the Day")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(appBonus)
                }
                Spacer()
                Text(entry.word)
                    .font(.title2.weight(.black))
                    .foregroundColor(textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(entry.pos)
                    .font(.caption2.italic())
                    .foregroundColor(appSuccess)
                Text(entry.definition)
                    .font(.caption2)
                    .foregroundColor(textSecondary)
                    .lineLimit(3)
                    .minimumScaleFactor(0.8)
            }
            .padding(14)
        }
    }
}

// ---------------------------------------------------------------------------
// MARK: - Medium widget  (4×2 home screen)
// ---------------------------------------------------------------------------

struct WotdMediumView: View {
    let entry: WotdEntry

    var body: some View {
        ZStack {
            appBg.ignoresSafeArea()
            HStack(alignment: .top, spacing: 14) {
                // Left: label + word + pos
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 4) {
                        Image(systemName: "text.book.closed.fill")
                            .font(.caption2)
                            .foregroundColor(appBonus)
                        Text("Word of the Day")
                            .font(.caption2.weight(.heavy))
                            .foregroundColor(appBonus)
                    }
                    Text(entry.word)
                        .font(.title.weight(.black))
                        .foregroundColor(textPrimary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Text(entry.pos)
                        .font(.caption.italic())
                        .foregroundColor(appSuccess)
                    Spacer()
                    Text("Tap to play →")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(appAccent.opacity(0.5))
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

                // Divider
                Rectangle()
                    .fill(appAccent.opacity(0.12))
                    .frame(width: 1)
                    .padding(.vertical, 4)

                // Right: definition
                VStack(alignment: .leading, spacing: 4) {
                    Text("Definition")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(appBonus)
                    Text(entry.definition)
                        .font(.caption)
                        .foregroundColor(textSecondary)
                        .lineLimit(5)
                        .minimumScaleFactor(0.8)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
        }
    }
}

// ---------------------------------------------------------------------------
// MARK: - Lock Screen (accessoryRectangular)
// ---------------------------------------------------------------------------

struct WotdLockScreenView: View {
    let entry: WotdEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "text.book.closed.fill").font(.caption2)
                Text("WORD OF THE DAY").font(.caption2.weight(.bold))
            }
            Text(entry.word)
                .font(.headline.weight(.black))
                .lineLimit(1)
            Text("\(entry.pos) — \(entry.definition)")
                .font(.caption2)
                .lineLimit(2)
        }
        .widgetAccentable()
    }
}

// ---------------------------------------------------------------------------
// MARK: - Lock Screen inline (accessoryInline)
// ---------------------------------------------------------------------------

struct WotdInlineView: View {
    let entry: WotdEntry

    var body: some View {
        Label {
            Text("\(entry.word): \(entry.definition)")
                .lineLimit(1)
        } icon: {
            Image(systemName: "text.book.closed.fill")
        }
        .widgetAccentable()
    }
}

// ---------------------------------------------------------------------------
// MARK: - Widget configuration
// ---------------------------------------------------------------------------

struct PlummetWordOfDayWidget: Widget {
    let kind: String = "PlummetWordOfDay"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WotdProvider()) { entry in
            PlummetWordOfDayWidgetView(entry: entry)
        }
        .configurationDisplayName("Word of the Day")
        .description("A new word at noon, every day.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

struct PlummetWordOfDayWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: WotdEntry

    var body: some View {
        Group {
            if entry.challengeActive, let endDate = entry.challengeEndDate {
                switch family {
                case .systemSmall:          ChallengeSmallView(entry: entry, endDate: endDate)
                case .systemMedium:         ChallengeMediumView(entry: entry, endDate: endDate)
                case .accessoryRectangular: ChallengeLockScreenView(entry: entry, endDate: endDate)
                case .accessoryInline:      ChallengeInlineView(entry: entry, endDate: endDate)
                default:                    ChallengeSmallView(entry: entry, endDate: endDate)
                }
            } else {
                switch family {
                case .systemSmall:          WotdSmallView(entry: entry)
                case .systemMedium:         WotdMediumView(entry: entry)
                case .accessoryRectangular: WotdLockScreenView(entry: entry)
                case .accessoryInline:      WotdInlineView(entry: entry)
                default:                    WotdSmallView(entry: entry)
                }
            }
        }
        // Deep-link the entire widget surface so a tap launches the app
        // with a known intent. The web layer parses ?intent= on boot.
        .widgetURL(entry.challengeActive ? kWidgetChallengeURL : kWidgetWotdURL)
    }
}

// ---------------------------------------------------------------------------
// MARK: - Challenge timer views
// ---------------------------------------------------------------------------

struct ChallengeSmallView: View {
    let entry: WotdEntry
    let endDate: Date

    var body: some View {
        ZStack {
            appBg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "timer")
                        .font(.caption2)
                        .foregroundColor(appBonus)
                    Text(entry.challengeMode.isEmpty ? "Challenge" : entry.challengeMode)
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(appBonus)
                        .lineLimit(1)
                }
                Spacer()
                Text(endDate, style: .timer)
                    .font(.title.weight(.black).monospacedDigit())
                    .foregroundColor(textPrimary)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text("Score: \(entry.challengeScore)")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(appSuccess)
            }
            .padding(14)
        }
    }
}

struct ChallengeMediumView: View {
    let entry: WotdEntry
    let endDate: Date

    var body: some View {
        ZStack {
            appBg.ignoresSafeArea()
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                            .font(.caption2)
                            .foregroundColor(appBonus)
                        Text(entry.challengeMode.isEmpty ? "Challenge" : entry.challengeMode)
                            .font(.caption2.weight(.heavy))
                            .foregroundColor(appBonus)
                            .lineLimit(1)
                    }
                    Text(endDate, style: .timer)
                        .font(.title.weight(.black).monospacedDigit())
                        .foregroundColor(textPrimary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Text("Time remaining")
                        .font(.caption2)
                        .foregroundColor(textSecondary)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

                Rectangle()
                    .fill(appAccent.opacity(0.12))
                    .frame(width: 1)
                    .padding(.vertical, 4)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Score")
                        .font(.caption2.weight(.heavy))
                        .foregroundColor(appBonus)
                    Text("\(entry.challengeScore)")
                        .font(.title2.weight(.black))
                        .foregroundColor(textPrimary)
                    Text("Tap to play →")
                        .font(.caption2.weight(.bold))
                        .foregroundColor(appAccent.opacity(0.5))
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
        }
    }
}

struct ChallengeLockScreenView: View {
    let entry: WotdEntry
    let endDate: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "timer").font(.caption2)
                Text(entry.challengeMode.isEmpty ? "CHALLENGE" : entry.challengeMode.uppercased())
                    .font(.caption2.weight(.bold))
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                Text(endDate, style: .timer)
                    .font(.headline.weight(.black).monospacedDigit())
                    .lineLimit(1)
                Text("Score: \(entry.challengeScore)")
                    .font(.caption2)
                    .lineLimit(1)
            }
        }
        .widgetAccentable()
    }
}

struct ChallengeInlineView: View {
    let entry: WotdEntry
    let endDate: Date

    var body: some View {
        Label {
            Text("\(entry.challengeMode.isEmpty ? "Challenge" : entry.challengeMode) — ")
            + Text(endDate, style: .timer)
        } icon: {
            Image(systemName: "timer")
        }
        .widgetAccentable()
    }
}
