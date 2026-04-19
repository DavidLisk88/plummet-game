import ActivityKit
import SwiftUI
import WidgetKit

// ---------------------------------------------------------------------------
// MARK: - Helpers
// ---------------------------------------------------------------------------

private var accentColor: Color { Color(red: 0.56, green: 0.27, blue: 0.99) } // Plummet purple

// ---------------------------------------------------------------------------
// MARK: - Lock Screen / Notification view (also used for StandBy)
// ---------------------------------------------------------------------------

struct PlummetLockScreenView: View {
    let context: ActivityViewContext<PlummetActivityAttributes>

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "timer")
                .foregroundColor(accentColor)
                .font(.title2)

            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.challengeMode)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                if context.state.isFinished {
                    Text("Finished!")
                        .font(.title2.weight(.bold))
                        .foregroundColor(.primary)
                } else {
                    Text(context.state.endDate, style: .timer)
                        .font(.title2.monospacedDigit().weight(.bold))
                        .foregroundColor(.primary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("Score")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                Text("\(context.state.score)")
                    .font(.title2.monospacedDigit().weight(.bold))
                    .foregroundColor(accentColor)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// ---------------------------------------------------------------------------
// MARK: - Dynamic Island Compact (pill minimized)
// ---------------------------------------------------------------------------

struct PlummetCompactLeading: View {
    let context: ActivityViewContext<PlummetActivityAttributes>
    var body: some View {
        Image(systemName: "timer")
            .foregroundColor(accentColor)
            .font(.caption.weight(.semibold))
    }
}

struct PlummetCompactTrailing: View {
    let context: ActivityViewContext<PlummetActivityAttributes>
    var body: some View {
        if context.state.isFinished {
            Text("Done")
                .font(.caption.weight(.bold))
                .foregroundColor(.white)
        } else {
            Text(context.state.endDate, style: .timer)
                .font(.caption.monospacedDigit().weight(.bold))
                .foregroundColor(.white)
        }
    }
}

// ---------------------------------------------------------------------------
// MARK: - Dynamic Island Minimal (another app is in the island)
// ---------------------------------------------------------------------------

struct PlummetMinimalView: View {
    let context: ActivityViewContext<PlummetActivityAttributes>
    var body: some View {
        if context.state.isFinished {
            Text("✓")
                .font(.caption2.weight(.bold))
                .foregroundColor(accentColor)
        } else {
            Text(context.state.endDate, style: .timer)
                .font(.caption2.monospacedDigit().weight(.bold))
                .foregroundColor(accentColor)
        }
    }
}

// ---------------------------------------------------------------------------
// MARK: - Dynamic Island Expanded
// ---------------------------------------------------------------------------

struct PlummetExpandedView: View {
    let context: ActivityViewContext<PlummetActivityAttributes>

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: "timer")
                    .foregroundColor(accentColor)
                Text(context.attributes.challengeMode)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.primary)
                Spacer()
                if context.state.isFinished {
                    Text("Challenge Complete!")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(accentColor)
                }
            }

            HStack {
                VStack(alignment: .leading) {
                    Text("Time Left")
                        .font(.caption).foregroundColor(.secondary)
                    if context.state.isFinished {
                        Text("—")
                            .font(.title.weight(.bold))
                            .foregroundColor(.white)
                    } else {
                        Text(context.state.endDate, style: .timer)
                            .font(.title.monospacedDigit().weight(.bold))
                            .foregroundColor(.white)
                    }
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("Score")
                        .font(.caption).foregroundColor(.secondary)
                    Text("\(context.state.score)")
                        .font(.title.monospacedDigit().weight(.bold))
                        .foregroundColor(accentColor)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

// ---------------------------------------------------------------------------
// MARK: - Widget Entry Point
// ---------------------------------------------------------------------------

struct PlummetLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PlummetActivityAttributes.self) { context in
            // Lock Screen / Notification banner
            PlummetLockScreenView(context: context)
                .background(Color(.systemBackground).opacity(0.9))
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded regions
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer")
                        .foregroundColor(accentColor)
                        .font(.title3)
                        .padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.isFinished {
                        Text("Done")
                            .font(.title3.weight(.bold))
                            .foregroundColor(.white)
                            .padding(.trailing, 8)
                    } else {
                        Text(context.state.endDate, style: .timer)
                            .font(.title3.monospacedDigit().weight(.bold))
                            .foregroundColor(.white)
                            .padding(.trailing, 8)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PlummetExpandedView(context: context)
                }
            } compactLeading: {
                PlummetCompactLeading(context: context)
            } compactTrailing: {
                PlummetCompactTrailing(context: context)
            } minimal: {
                PlummetMinimalView(context: context)
            }
        }
    }
}
