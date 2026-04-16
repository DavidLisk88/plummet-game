/**
 * push-notifications.js — Push notification registration for PLUMMET
 * 
 * Registers the device for remote push notifications (APNs on iOS),
 * stores the token in Supabase, and handles incoming notifications.
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase.js';

let _registered = false;
let _currentToken = null;

/**
 * Request push permission and register the device token with Supabase.
 * Safe to call multiple times — only registers once.
 */
export async function registerPushNotifications() {
    if (_registered) return;
    if (!Capacitor.isNativePlatform()) return; // No push on web

    try {
        // Check current permission status
        let permStatus = await PushNotifications.checkPermissions();
        
        if (permStatus.receive === 'prompt') {
            permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
            console.warn('[push] Permission not granted');
            return;
        }

        // Listen for registration success
        PushNotifications.addListener('registration', async (token) => {
            console.log('[push] Registered with token:', token.value.substring(0, 20) + '...');
            _currentToken = token.value;
            await _saveToken(token.value);
            _registered = true;
        });

        // Listen for registration errors
        PushNotifications.addListener('registrationError', (err) => {
            console.error('[push] Registration error:', err);
        });

        // Listen for received notifications (foreground)
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('[push] Received in foreground:', notification.title);
            // Could show an in-app toast here
        });

        // Listen for notification tap (background → app opened)
        PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            console.log('[push] Notification tapped:', action.notification.title);
            // Could deep-link to a specific screen here
        });

        // Register with APNs/FCM
        await PushNotifications.register();
    } catch (err) {
        console.error('[push] Setup failed:', err);
    }
}

/**
 * Save push token to Supabase via RPC
 */
async function _saveToken(token) {
    try {
        const platform = Capacitor.getPlatform(); // 'ios' | 'android'
        const { error } = await supabase.rpc('register_push_token', {
            p_token: token,
            p_platform: platform,
        });
        if (error) {
            console.warn('[push] Failed to save token:', error.message);
        } else {
            console.log('[push] Token saved to Supabase');
        }
    } catch (err) {
        console.warn('[push] Token save error:', err);
    }
}

/**
 * Remove the push token on logout
 */
export async function unregisterPushToken() {
    if (!_currentToken) return;
    try {
        const { error } = await supabase.rpc('unregister_push_token', {
            p_token: _currentToken,
        });
        if (error) console.warn('[push] Token removal failed:', error.message);
        _currentToken = null;
        _registered = false;
    } catch (err) {
        console.warn('[push] Token removal error:', err);
    }
}
