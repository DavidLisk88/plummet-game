/**
 * onesignal.js — OneSignal push notifications for PLUMMET (native only)
 *
 * Replaces the hand-rolled @capacitor/push-notifications + send-notification
 * edge function flow. OneSignal handles APNs/FCM registration, segmentation,
 * scheduling, and delivery. We bind the device to the Supabase user via
 * `OneSignal.login(externalId)` so dashboards / API can target by user id.
 *
 * Plugin: onesignal-cordova-plugin@5.x (Capacitor-compatible)
 * Docs: https://documentation.onesignal.com/docs/capacitor-sdk-setup
 */
import { Capacitor } from '@capacitor/core';

const ONESIGNAL_APP_ID = '5af8fa81-2af8-4e85-be96-bd23cbe5f19a';

let _initialized = false;
let _currentExternalId = null;

/**
 * Initialize the OneSignal SDK. Safe to call multiple times — only runs once.
 * Should be called once at app startup on native platforms.
 */
export async function initOneSignal() {
    if (_initialized) return;
    if (!Capacitor.isNativePlatform()) return; // No-op on web

    try {
        const mod = await import('onesignal-cordova-plugin');
        const OneSignal = mod.default || mod;

        OneSignal.initialize(ONESIGNAL_APP_ID);

        // Notification tap handler — deep-link based on additionalData.intent
        OneSignal.Notifications.addEventListener('click', (event) => {
            try {
                const data = event?.notification?.additionalData || {};
                console.log('[onesignal] click:', data);
                if (data.intent === 'wotd' || data.intent === 'challenge') {
                    // Set a hint that the app boot path can read
                    try { sessionStorage.setItem('plummet_intent', data.intent); } catch {}
                }
            } catch (err) {
                console.warn('[onesignal] click handler error:', err);
            }
        });

        _initialized = true;
        console.log('[onesignal] initialized');
    } catch (err) {
        console.warn('[onesignal] init failed:', err);
    }
}

/**
 * Prompt the user for notification permission. Call after a meaningful
 * user action (e.g. opting in from settings) — not on cold start.
 * Returns true if granted.
 */
export async function requestOneSignalPermission() {
    if (!Capacitor.isNativePlatform()) return false;
    try {
        const mod = await import('onesignal-cordova-plugin');
        const OneSignal = mod.default || mod;
        const granted = await OneSignal.Notifications.requestPermission(true);
        console.log('[onesignal] permission granted:', granted);
        return !!granted;
    } catch (err) {
        console.warn('[onesignal] requestPermission failed:', err);
        return false;
    }
}

/**
 * Bind the device to a Supabase user id so push can be targeted per-user.
 * Call after a successful sign-in.
 */
export async function loginOneSignalUser(externalId) {
    if (!Capacitor.isNativePlatform()) return;
    if (!externalId) return;
    if (_currentExternalId === externalId) return;
    try {
        await initOneSignal();
        const mod = await import('onesignal-cordova-plugin');
        const OneSignal = mod.default || mod;
        OneSignal.login(externalId);
        _currentExternalId = externalId;
        console.log('[onesignal] logged in user:', externalId);
    } catch (err) {
        console.warn('[onesignal] login failed:', err);
    }
}

/**
 * Unbind the device from the current user (call on sign-out).
 */
export async function logoutOneSignalUser() {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const mod = await import('onesignal-cordova-plugin');
        const OneSignal = mod.default || mod;
        OneSignal.logout();
        _currentExternalId = null;
        console.log('[onesignal] logged out');
    } catch (err) {
        console.warn('[onesignal] logout failed:', err);
    }
}
