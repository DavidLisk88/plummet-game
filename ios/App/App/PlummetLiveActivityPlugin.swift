import ActivityKit
import Capacitor
import Foundation

/// Capacitor plugin that lets JavaScript start, update, and end a Plummet Live Activity.
/// Add this file to the main App target only (not the extension target).
@objc(PlummetLiveActivityPlugin)
public class PlummetLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlummetLiveActivityPlugin"
    public let jsName = "PlummetLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
    ]

    // Hold a reference so we can update / end it
    private var currentActivity: Activity<PlummetActivityAttributes>?

    // -----------------------------------------------------------------------
    // MARK: - isSupported
    // -----------------------------------------------------------------------

    /// Returns { supported: true/false }.
    /// Supported on iOS 16.2+ only.
    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    // -----------------------------------------------------------------------
    // MARK: - start
    // -----------------------------------------------------------------------

    /// Start a new Live Activity.
    /// Expected JS call:
    ///   PlummetLiveActivity.start({ mode: "Speed Round", endTimestamp: Date.now() + 60000, score: 0 })
    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2+")
            return
        }

        let mode           = call.getString("mode")          ?? "Challenge"
        let endTimestampMs = call.getDouble("endTimestamp")  ?? (Double(Date().timeIntervalSince1970 * 1000) + 60000)
        let score          = call.getInt("score")             ?? 0

        let endDate = Date(timeIntervalSince1970: endTimestampMs / 1000.0)

        // End any existing activity first
        Task {
            await self.endCurrentActivity()

            let attributes = PlummetActivityAttributes(challengeMode: mode)
            let contentState = PlummetActivityAttributes.ContentState(
                endDate: endDate,
                score: score,
                isFinished: false
            )

            do {
                let activity = try Activity<PlummetActivityAttributes>.request(
                    attributes: attributes,
                    content: .init(state: contentState, staleDate: endDate.addingTimeInterval(5)),
                    pushType: nil
                )
                self.currentActivity = activity
                call.resolve(["activityId": activity.id])
            } catch {
                call.reject("Failed to start Live Activity: \(error.localizedDescription)")
            }
        }
    }

    // -----------------------------------------------------------------------
    // MARK: - update
    // -----------------------------------------------------------------------

    /// Update the running Live Activity (e.g. when score changes).
    /// Expected JS call:
    ///   PlummetLiveActivity.update({ score: 450 })
    /// Note: endDate is not re-sent — iOS keeps counting down from the original.
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2+")
            return
        }

        guard let activity = currentActivity else {
            call.reject("No active Live Activity")
            return
        }

        let score      = call.getInt("score")       ?? 0
        let isFinished = call.getBool("isFinished") ?? false

        // Preserve the existing endDate; only score/isFinished change
        let currentEndDate = activity.content.state.endDate
        let newState = PlummetActivityAttributes.ContentState(
            endDate: currentEndDate,
            score: score,
            isFinished: isFinished
        )

        Task {
            await activity.update(.init(state: newState, staleDate: nil))
            call.resolve()
        }
    }

    // -----------------------------------------------------------------------
    // MARK: - end
    // -----------------------------------------------------------------------

    /// End the Live Activity.
    /// Expected JS call:
    ///   PlummetLiveActivity.end({ score: 750 })
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }

        let score = call.getInt("score") ?? 0

        Task {
            if let activity = self.currentActivity {
                let finalState = PlummetActivityAttributes.ContentState(
                    endDate: Date(),   // timer is over
                    score: score,
                    isFinished: true
                )
                await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .after(Date.now.addingTimeInterval(4)))
                self.currentActivity = nil
            }
            call.resolve()
        }
    }

    // -----------------------------------------------------------------------
    // MARK: - Private helpers
    // -----------------------------------------------------------------------

    @available(iOS 16.2, *)
    private func endCurrentActivity() async {
        if let activity = currentActivity {
            await activity.end(nil, dismissalPolicy: .immediate)
            currentActivity = nil
        }
    }
}
