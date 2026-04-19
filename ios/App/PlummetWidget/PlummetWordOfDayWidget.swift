import SwiftUI
import WidgetKit

// ---------------------------------------------------------------------------
// MARK: - Design tokens (match game's purple palette)
// ---------------------------------------------------------------------------

private let purpleAccent  = Color(red: 0.56, green: 0.27, blue: 0.99)
private let bgDark        = Color(red: 0.07, green: 0.07, blue: 0.10)
private let textPrimary   = Color.white
private let textSecondary = Color(white: 0.65)

// ---------------------------------------------------------------------------
// MARK: - Small widget  (2×2 home screen)
// ---------------------------------------------------------------------------

struct WotdSmallView: View {
    let entry: WotdEntry

    var body: some View {
        ZStack {
            bgDark.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "book.closed.fill")
                        .font(.caption2)
                        .foregroundColor(purpleAccent)
                    Text("Word of the Day")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(purpleAccent)
                }
                Spacer()
                Text(entry.word)
                    .font(.title2.weight(.black))
                    .foregroundColor(textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(entry.pos)
                    .font(.caption2.italic())
                    .foregroundColor(textSecondary)
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
            bgDark.ignoresSafeArea()
            HStack(alignment: .top, spacing: 16) {
                // Left: accent bar + word
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: "book.closed.fill")
                            .font(.caption2)
                            .foregroundColor(purpleAccent)
                        Text("Word of the Day")
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(purpleAccent)
                    }
                    Text(entry.word)
                        .font(.title.weight(.black))
                        .foregroundColor(textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(entry.pos)
                        .font(.caption.italic())
                        .foregroundColor(textSecondary)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

                // Right: definition
                VStack(alignment: .leading, spacing: 4) {
                    Text("Definition")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(purpleAccent)
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
                Image(systemName: "book.closed.fill").font(.caption2)
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
            Image(systemName: "book.closed.fill")
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
}

// ---------------------------------------------------------------------------
// MARK: - Challenge timer views
// ---------------------------------------------------------------------------

struct ChallengeSmallView: View {
    let entry: WotdEntry
    let endDate: Date

    var body: some View {
        ZStack {
            bgDark.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "timer")
                        .font(.caption2)
                        .foregroundColor(purpleAccent)
                    Text(entry.challengeMode.isEmpty ? "Challenge" : entry.challengeMode)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(purpleAccent)
                        .lineLimit(1)
                }
                Spacer()
                Text(endDate, style: .timer)
                    .font(.title.weight(.black).monospacedDigit())
                    .foregroundColor(textPrimary)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text("Score: \(entry.challengeScore)")
                    .font(.caption2)
                    .foregroundColor(textSecondary)
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
            bgDark.ignoresSafeArea()
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                            .font(.caption2)
                            .foregroundColor(purpleAccent)
                        Text(entry.challengeMode.isEmpty ? "Challenge" : entry.challengeMode)
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(purpleAccent)
                            .lineLimit(1)
                    }
                    Text(endDate, style: .timer)
                        .font(.title.weight(.black).monospacedDigit())
                        .foregroundColor(textPrimary)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Score")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(purpleAccent)
                    Text("\(entry.challengeScore)")
                        .font(.title2.weight(.black))
                        .foregroundColor(textPrimary)
                    Text("Time remaining")
                        .font(.caption2)
                        .foregroundColor(textSecondary)
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
