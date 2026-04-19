/**
 * widget-preferences.js — iOS settings handoff for widget setup.
 *
 * Important: iOS does not expose a public API for apps to detect whether users
 * have actually placed a widget on Home/Lock Screen. This module only helps
 * users jump into settings and complete manual widget placement quickly.
 */

import { Capacitor } from '@capacitor/core';

export function canConfigureWidgetFromApp() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

/**
 * Open iOS app settings to let users finish widget setup permissions/settings.
 * Returns true if settings handoff was attempted successfully.
 */
export async function openWidgetSettings() {
    if (!canConfigureWidgetFromApp()) return false;
    try {
        const { App } = await import('@capacitor/app');
        await App.openSettings();
        return true;
    } catch {
        return false;
    }
}
