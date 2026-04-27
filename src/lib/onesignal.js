/**
 * onesignal.js — STUBBED OUT for v1.4.x release.
 *
 * Push notifications via OneSignal are temporarily disabled while we resolve
 * iOS SPM/Cordova plugin compatibility. All exported functions are no-ops so
 * existing callers continue to work without changes. Restore from git history
 * once OneSignal is properly integrated.
 */

export async function initOneSignal() {
    // no-op (push disabled)
}

export async function requestOneSignalPermission() {
    return false;
}

export async function loginOneSignalUser(_externalId) {
    // no-op
}

export async function logoutOneSignalUser() {
    // no-op
}
