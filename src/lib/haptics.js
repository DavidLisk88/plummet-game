/**
 * haptics.js — Lightweight haptic feedback wrapper
 * Uses @capacitor/haptics on native, silently no-ops on web.
 */

let _Haptics = null;
let _isNative = false;
let _enabled = true;

async function _init() {
    if (_Haptics !== null) return;
    try {
        const { Capacitor } = await import('@capacitor/core');
        _isNative = Capacitor.isNativePlatform();
        if (_isNative) {
            const mod = await import('@capacitor/haptics');
            _Haptics = mod.Haptics;
        }
    } catch {
        _Haptics = false;
    }
}

// Eagerly init
_init();

function _fire(fn) {
    if (!_enabled || !_isNative || !_Haptics) return;
    try { fn(); } catch { /* ignore */ }
}

/** Light tap — block lock, UI buttons */
export function tapLight() {
    _fire(() => _Haptics.impact({ style: 'light' }));
}

/** Medium tap — word found, bonus activation */
export function tapMedium() {
    _fire(() => _Haptics.impact({ style: 'medium' }));
}

/** Heavy tap — bomb, line clear, combo milestone */
export function tapHeavy() {
    _fire(() => _Haptics.impact({ style: 'heavy' }));
}

/** Success notification — level up, high score */
export function notifySuccess() {
    _fire(() => _Haptics.notification({ type: 'success' }));
}

/** Warning notification — game over */
export function notifyWarning() {
    _fire(() => _Haptics.notification({ type: 'warning' }));
}

/** Error notification — time's up */
export function notifyError() {
    _fire(() => _Haptics.notification({ type: 'error' }));
}

/** Toggle haptics on/off */
export function setEnabled(on) {
    _enabled = on;
    localStorage.setItem('wf_haptics_enabled', on ? '1' : '0');
}

/** Check if haptics are enabled */
export function isEnabled() {
    return _enabled;
}

// Restore user preference
const saved = localStorage.getItem('wf_haptics_enabled');
if (saved === '0') _enabled = false;
