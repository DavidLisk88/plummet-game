import Capacitor
import Foundation
import WidgetKit

/// Capacitor plugin that writes Word-of-the-Day data to the iOS App Group shared
/// UserDefaults container and reloads the home screen widget timeline.
///
/// Add this file to the main App target only.
///
/// JS API:
///   PlummetAppGroup.setWordOfDay({ word, pos, definition, date })
///   PlummetAppGroup.getWordOfDay() → { word, pos, definition, date }
///   PlummetAppGroup.reloadWidget()
@objc(PlummetAppGroupPlugin)
public class PlummetAppGroupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier       = "PlummetAppGroupPlugin"
    public let jsName           = "PlummetAppGroup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWordOfDay",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWordOfDay",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reloadWidget",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setChallengeState",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearChallengeState",returnType: CAPPluginReturnPromise),
    ]

    private let appGroupID = "group.com.plummetgame.app"

    private var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    // -----------------------------------------------------------------------
    // MARK: - setWordOfDay
    // -----------------------------------------------------------------------

    /// Write word data to App Group and reload the widget timeline.
    /// JS call: PlummetAppGroup.setWordOfDay({ word, pos, definition, date })
    @objc func setWordOfDay(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults else {
            call.reject("App Group '\(appGroupID)' not available — check entitlements")
            return
        }

        let word       = call.getString("word")       ?? ""
        let pos        = call.getString("pos")        ?? ""
        let definition = call.getString("definition") ?? ""
        let date       = call.getString("date")       ?? todayString()

        defaults.set(word,       forKey: "wotd_word")
        defaults.set(pos,        forKey: "wotd_pos")
        defaults.set(definition, forKey: "wotd_definition")
        defaults.set(date,       forKey: "wotd_date")
        defaults.synchronize()

        // Trigger WidgetKit reload
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: "PlummetWordOfDay")
        }

        call.resolve()
    }

    // -----------------------------------------------------------------------
    // MARK: - getWordOfDay
    // -----------------------------------------------------------------------

    /// Read the current word from App Group storage.
    @objc func getWordOfDay(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults else {
            call.resolve([:])
            return
        }
        call.resolve([
            "word":       defaults.string(forKey: "wotd_word")       ?? "",
            "pos":        defaults.string(forKey: "wotd_pos")        ?? "",
            "definition": defaults.string(forKey: "wotd_definition") ?? "",
            "date":       defaults.string(forKey: "wotd_date")       ?? "",
        ])
    }

    // -----------------------------------------------------------------------
    // MARK: - reloadWidget
    // -----------------------------------------------------------------------

    /// Force a widget timeline reload (call after updating any app group data).
    @objc func reloadWidget(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: "PlummetWordOfDay")
        }
        call.resolve()
    }

    // -----------------------------------------------------------------------
    // MARK: - setChallengeState
    // -----------------------------------------------------------------------

    /// Write active challenge data to App Group so the widget can show a timer instead.
    /// JS call: PlummetAppGroup.setChallengeState({ endTimestamp, mode, score })
    @objc func setChallengeState(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults else {
            call.reject("App Group '\(appGroupID)' not available — check entitlements")
            return
        }

        let endTimestamp = call.getDouble("endTimestamp") ?? 0  // ms since epoch
        let mode         = call.getString("mode")         ?? ""
        let score        = call.getInt("score")           ?? 0

        defaults.set(true,                                forKey: "challenge_active")
        defaults.set(endTimestamp / 1000.0,               forKey: "challenge_end_unix")  // store as seconds
        defaults.set(mode,                                forKey: "challenge_mode")
        defaults.set(score,                               forKey: "challenge_score")
        defaults.synchronize()

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: "PlummetWordOfDay")
        }

        call.resolve()
    }

    // -----------------------------------------------------------------------
    // MARK: - clearChallengeState
    // -----------------------------------------------------------------------

    /// Remove challenge data so the widget reverts to Word of the Day.
    @objc func clearChallengeState(_ call: CAPPluginCall) {
        guard let defaults = sharedDefaults else {
            call.resolve()
            return
        }

        defaults.set(false,  forKey: "challenge_active")
        defaults.removeObject(forKey: "challenge_end_unix")
        defaults.removeObject(forKey: "challenge_mode")
        defaults.removeObject(forKey: "challenge_score")
        defaults.synchronize()

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadTimelines(ofKind: "PlummetWordOfDay")
        }

        call.resolve()
    }

    // -----------------------------------------------------------------------
    private func todayString() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: Date())
    }
}
