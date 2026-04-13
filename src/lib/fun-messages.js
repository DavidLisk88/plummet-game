/**
 * Daily Fun Message Notification Service
 * 
 * Sends a random funny message once per day at a random time.
 * Avoids sending within 2 hours of the Word of the Day notification (noon).
 * Valid times: 8am-10am or 2pm-10pm
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import funMessagesData from './fun-messages.json';

const STORAGE_KEY = 'plummet_fun_msg_history';
const HISTORY_SIZE = 100; // Track last 100 messages to avoid repeats
const NOTIFICATION_CHANNEL_ID = 'plummet-fun-messages';
const NOTIFICATION_ID = 9002; // Different from WOTD (9001)
const ENABLED_KEY = 'plummet_fun_msg_enabled';

/**
 * Get the history of recently used message indices
 */
function getMessageHistory() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Add a message index to history
 */
function addToMessageHistory(index) {
    const history = getMessageHistory();
    history.push(index);
    while (history.length > HISTORY_SIZE) {
        history.shift();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

/**
 * Select a random message that hasn't been used recently
 */
function selectRandomMessage() {
    const messages = funMessagesData.messages;
    const history = new Set(getMessageHistory());
    
    // Find eligible indices (not in recent history)
    const eligible = [];
    for (let i = 0; i < messages.length; i++) {
        if (!history.has(i)) {
            eligible.push(i);
        }
    }
    
    // If all messages used, clear history and start fresh
    if (eligible.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
        return selectRandomMessage();
    }
    
    // Random selection
    const selectedIndex = eligible[Math.floor(Math.random() * eligible.length)];
    addToMessageHistory(selectedIndex);
    
    return messages[selectedIndex];
}

/**
 * Generate a random time for today or tomorrow that avoids noon ± 2 hours
 * Valid windows: 8am-10am (morning) or 2pm-10pm (afternoon/evening)
 */
function getRandomScheduleTime() {
    const now = new Date();
    const scheduleDate = new Date();
    
    // Decide which time window to use
    // Morning window: 8am-10am (2 hours)
    // Afternoon window: 2pm-10pm (8 hours)
    // Weight afternoon more since it's a larger window
    const useMorning = Math.random() < 0.2; // 20% chance morning, 80% afternoon
    
    let hour, minute;
    
    if (useMorning) {
        // 8am to 10am (8:00 - 9:59)
        hour = 8 + Math.floor(Math.random() * 2);
        minute = Math.floor(Math.random() * 60);
    } else {
        // 2pm to 10pm (14:00 - 21:59)
        hour = 14 + Math.floor(Math.random() * 8);
        minute = Math.floor(Math.random() * 60);
    }
    
    scheduleDate.setHours(hour, minute, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (scheduleDate <= now) {
        scheduleDate.setDate(scheduleDate.getDate() + 1);
    }
    
    return scheduleDate;
}

/**
 * Create the notification channel (Android only)
 */
export async function createFunMessageChannel() {
    if (!Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() !== 'android') return;
    
    await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Daily Fun Messages',
        description: 'Random fun messages and word facts from Plummet',
        importance: 3, // DEFAULT - sound and shows in notification shade
        visibility: 1, // PUBLIC
        sound: 'wotd_chime.wav', // Same sound as WOTD
        vibration: true,
        lights: true,
        lightColor: '#e2d8a6'
    });
}

/**
 * Schedule the next fun message notification
 */
export async function scheduleFunMessage() {
    if (!Capacitor.isNativePlatform()) {
        console.log('[FUN-MSG] Not a native platform, skipping notification');
        return null;
    }
    
    // Check permissions
    const permResult = await LocalNotifications.checkPermissions();
    if (permResult.display !== 'granted') {
        console.log('[FUN-MSG] Notifications not permitted');
        return null;
    }
    
    // Cancel any existing scheduled notification
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
    
    // Select message and time
    const message = selectRandomMessage();
    const scheduleTime = getRandomScheduleTime();
    
    // Schedule the notification
    await LocalNotifications.schedule({
        notifications: [
            {
                id: NOTIFICATION_ID,
                title: message.title,
                body: message.body,
                schedule: {
                    at: scheduleTime,
                    allowWhileIdle: true
                },
                sound: 'wotd_chime.wav',
                channelId: NOTIFICATION_CHANNEL_ID,
                extra: {
                    type: 'fun-message'
                },
                smallIcon: 'ic_notification',
                largeIcon: 'ic_launcher',
                iconColor: '#e2d8a6'
            }
        ]
    });
    
    console.log(`[FUN-MSG] Scheduled "${message.title}" for ${scheduleTime.toLocaleString()}`);
    
    return {
        message,
        scheduledFor: scheduleTime
    };
}

/**
 * Enable daily fun message notifications
 */
export async function enableFunMessages() {
    if (!Capacitor.isNativePlatform()) {
        return { success: false, reason: 'not_native' };
    }
    
    // Request permissions if not granted
    const permResult = await LocalNotifications.checkPermissions();
    if (permResult.display !== 'granted') {
        const reqResult = await LocalNotifications.requestPermissions();
        if (reqResult.display !== 'granted') {
            return { success: false, reason: 'permission_denied' };
        }
    }
    
    await createFunMessageChannel();
    const result = await scheduleFunMessage();
    
    if (result) {
        localStorage.setItem(ENABLED_KEY, 'true');
        return { success: true, ...result };
    }
    
    return { success: false, reason: 'schedule_failed' };
}

/**
 * Disable fun message notifications
 */
export async function disableFunMessages() {
    localStorage.setItem(ENABLED_KEY, 'false');
    
    if (Capacitor.isNativePlatform()) {
        await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
    }
    
    return { success: true };
}

/**
 * Check if fun messages are enabled
 * Defaults to TRUE for new users (opt-out model)
 */
export function isFunMessagesEnabled() {
    const stored = localStorage.getItem(ENABLED_KEY);
    // Default to true if never set
    if (stored === null) return true;
    return stored === 'true';
}

/**
 * Re-schedule if needed (call on app open)
 */
export async function rescheduleFunMessageIfNeeded() {
    if (!isFunMessagesEnabled()) return;
    if (!Capacitor.isNativePlatform()) return;
    
    const pending = await LocalNotifications.getPending();
    const hasFunMsg = pending.notifications.some(n => n.id === NOTIFICATION_ID);
    
    if (!hasFunMsg) {
        await scheduleFunMessage();
    }
}

/**
 * Initialize fun messages on first launch
 */
export async function initializeFunMessagesOnFirstLaunch() {
    const stored = localStorage.getItem(ENABLED_KEY);
    if (stored !== null) return { alreadyInitialized: true };
    
    if (!Capacitor.isNativePlatform()) {
        localStorage.setItem(ENABLED_KEY, 'false');
        return { success: false, reason: 'not_native' };
    }
    
    return await enableFunMessages();
}

/**
 * Get a preview of what the next message would be (for testing/settings)
 */
export function getMessagePreview() {
    const messages = funMessagesData.messages;
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    return randomMsg;
}
