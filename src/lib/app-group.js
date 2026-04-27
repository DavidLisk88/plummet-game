/**
 * app-group.js — Wrapper for PlummetAppGroupPlugin (iOS bridge to App Group UserDefaults).
 * Silently no-ops on Android and web.
 *
 * Usage:
 *   import * as appGroup from './src/lib/app-group.js';
 *   await appGroup.setWordOfDay({ word, pos, definition, date });
 */

let _plugin = null;

async function _init() {
    if (_plugin !== null) return;
    try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
            _plugin = false;
            return;
        }
        const p = Capacitor.Plugins?.PlummetAppGroup;
        _plugin = p ?? false;
    } catch {
        _plugin = false;
    }
}

/**
 * Write the word of the day to the iOS App Group so the widget can read it.
 * Also triggers a WidgetKit timeline reload.
 * @param {{ word: string, pos: string, definition: string, date?: string }} opts
 */
export async function setWordOfDay(opts = {}) {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.setWordOfDay({
            word:       opts.word       ?? '',
            pos:        opts.pos        ?? '',
            definition: opts.definition ?? '',
            date:       opts.date       ?? new Date().toISOString().slice(0, 10),
        });
    } catch (e) {
        console.warn('[AppGroup] setWordOfDay failed:', e);
    }
}

/**
 * Read the word currently stored in the App Group (what the widget shows).
 * @returns {Promise<{word:string, pos:string, definition:string, date:string}|null>}
 */
export async function getWordOfDay() {
    await _init();
    if (!_plugin) return null;
    try {
        return await _plugin.getWordOfDay();
    } catch (e) {
        console.warn('[AppGroup] getWordOfDay failed:', e);
        return null;
    }
}

/**
 * Force the widget to refresh its timeline (e.g. after midnight to pick up new word).
 */
export async function reloadWidget() {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.reloadWidget();
    } catch (e) {
        console.warn('[AppGroup] reloadWidget failed:', e);
    }
}

/**
 * Write active challenge state to the App Group so the widget shows a countdown timer.
 * @param {{ endTimestamp: number, mode: string, score: number }} opts
 *   endTimestamp — Date.now() + duration in ms (same value passed to liveActivity.start)
 */
export async function setChallengeState(opts = {}) {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.setChallengeState({
            endTimestamp: opts.endTimestamp ?? (Date.now() + 60_000),
            mode:         opts.mode  ?? '',
            score:        opts.score ?? 0,
        });
    } catch (e) {
        console.warn('[AppGroup] setChallengeState failed:', e);
    }
}

/**
 * Clear active challenge state so the widget reverts to Word of the Day.
 */
export async function clearChallengeState() {
    await _init();
    if (!_plugin) return;
    try {
        await _plugin.clearChallengeState();
    } catch (e) {
        console.warn('[AppGroup] clearChallengeState failed:', e);
    }
}

/**
 * Push the full WOTD pool to the iOS App Group container so the widget can use
 * the latest word list without requiring a new App Store build. Safe to call
 * on every app launch — the widget only re-reads on its next timeline refresh.
 *
 * @param {Array<{word:string,pos:string,definition:string}>} entries
 * @param {string} [version] Optional version tag (e.g. "v2", build hash) for diagnostics.
 * @returns {Promise<{count:number,version:string,bytes:number}|null>}
 */
export async function setPool(entries, version = '') {
    await _init();
    if (!_plugin) return null;
    if (!Array.isArray(entries) || entries.length === 0) return null;
    try {
        return await _plugin.setPool({ entries, version });
    } catch (e) {
        console.warn('[AppGroup] setPool failed:', e);
        return null;
    }
}

/**
 * Get metadata about the pool currently used by the widget.
 * @returns {Promise<{count:number,version:string,source:'appgroup'|'bundle'|'none'}|null>}
 */
export async function getPoolInfo() {
    await _init();
    if (!_plugin) return null;
    try {
        return await _plugin.getPoolInfo();
    } catch (e) {
        console.warn('[AppGroup] getPoolInfo failed:', e);
        return null;
    }
}

/**
 * Convenience: fetch the bundled (OTA-updatable) wotd-pool.json and push it to
 * the App Group. Call once on app launch on iOS. Cheap & idempotent.
 */
export async function syncPoolFromBundle() {
    try {
        const res = await fetch('wotd-pool.json', { cache: 'no-store' });
        if (!res.ok) return null;
        const entries = await res.json();
        const version = res.headers.get('etag') || res.headers.get('last-modified') || '';
        return await setPool(entries, version);
    } catch (e) {
        console.warn('[AppGroup] syncPoolFromBundle failed:', e);
        return null;
    }
}
