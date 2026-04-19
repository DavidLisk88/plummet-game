/**
 * live-activity.js — Wrapper for PlummetLiveActivityPlugin (iOS native bridge).
 * Silently no-ops on Android and web.
 *
 * Usage:
 *   import * as liveActivity from './src/lib/live-activity.js';
 *
 *   await liveActivity.start({ mode: 'Speed Round', duration: 60, score: 0 });
 *   await liveActivity.update({ timeRemaining: 42, score: 320 });
 *   await liveActivity.end({ score: 750 });
 */

let _plugin = null;
let _supported = false;

async function _init() {
    if (_plugin !== null) return;
    try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
            _plugin = false;
            return;
        }
        // The plugin is registered natively; access via Capacitor.Plugins
        const plugins = Capacitor.Plugins;
        if (!plugins.PlummetLiveActivity) {
            _plugin = false;
            return;
        }
        _plugin = plugins.PlummetLiveActivity;
        const result = await _plugin.isSupported();
        _supported = result?.supported ?? false;
        if (!_supported) _plugin = false;
    } catch {
        _plugin = false;
    }
}

/**
 * Start a Live Activity for an active challenge.
 * iOS counts the timer down natively — no tick updates needed.
 * @param {{ mode: string, endTimestamp: number, score: number }} opts
 *   endTimestamp: Date.now() + durationMs  (unix ms)
 */
export async function start(opts = {}) {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.start({
            mode:         opts.mode         ?? 'Challenge',
            endTimestamp: opts.endTimestamp ?? (Date.now() + 60_000),
            score:        opts.score        ?? 0,
        });
    } catch (e) {
        console.warn('[LiveActivity] start failed:', e);
    }
}

/**
 * Update the Live Activity score (timer counts down on its own).
 * Call this when the score changes meaningfully, not every frame.
 * @param {{ score: number, isFinished?: boolean }} opts
 */
export async function update(opts = {}) {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.update({
            score:      opts.score      ?? 0,
            isFinished: opts.isFinished ?? false,
        });
    } catch (e) {
        console.warn('[LiveActivity] update failed:', e);
    }
}

/**
 * End the Live Activity (shows final score for ~4 seconds then dismisses).
 * @param {{ score: number }} opts
 */
export async function end(opts = {}) {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.end({ score: opts.score ?? 0 });
    } catch (e) {
        console.warn('[LiveActivity] end failed:', e);
    }
}

/** True only after isSupported() resolves and Live Activities are enabled by user. */
export function isSupported() {
    return _supported;
}
