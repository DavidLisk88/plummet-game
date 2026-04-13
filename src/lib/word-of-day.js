/**
 * Word of the Day Notification Service
 * 
 * Sends daily notifications at noon (local time) with a random word,
 * its definition, and part of speech. Tracks last 500 words to avoid repeats.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

// Basic/common words to exclude (these are too simple for "word of the day")
const BASIC_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
    'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who', 'boy',
    'did', 'own', 'say', 'she', 'too', 'use', 'dad', 'mom', 'man', 'men',
    'put', 'got', 'let', 'run', 'set', 'sit', 'try', 'ask', 'big', 'eat',
    'end', 'far', 'few', 'hot', 'job', 'lot', 'low', 'pay', 'red', 'six',
    'ten', 'top', 'two', 'yes', 'bad', 'cut', 'dog', 'eye', 'add', 'ago',
    'air', 'bed', 'bit', 'box', 'buy', 'car', 'cup', 'dry', 'due', 'eat',
    'egg', 'end', 'fit', 'fly', 'fun', 'gas', 'god', 'guy', 'hat', 'hit',
    'ice', 'key', 'kid', 'lay', 'led', 'leg', 'lie', 'lot', 'map', 'met',
    'mix', 'net', 'nor', 'oil', 'own', 'per', 'pet', 'pig', 'pop', 'ran',
    'raw', 'rid', 'row', 'sad', 'sat', 'sea', 'sky', 'sun', 'tea', 'tie',
    'tip', 'toe', 'toy', 'van', 'via', 'war', 'wet', 'win', 'won', 'yet',
    'with', 'have', 'this', 'will', 'your', 'from', 'they', 'been', 'call',
    'come', 'made', 'find', 'more', 'long', 'make', 'look', 'time', 'very',
    'when', 'much', 'then', 'them', 'also', 'back', 'only', 'come', 'over',
    'such', 'take', 'into', 'year', 'good', 'some', 'know', 'well', 'most',
    'just', 'like', 'than', 'even', 'want', 'give', 'work', 'even', 'need',
    'feel', 'seem', 'show', 'tell', 'same', 'last', 'next', 'does', 'goes',
    'went', 'came', 'done', 'gave', 'knew', 'left', 'told', 'took', 'used',
    'what', 'that', 'each', 'here', 'there', 'where', 'which', 'their', 'about',
    'after', 'again', 'being', 'before', 'could', 'every', 'first', 'found',
    'great', 'house', 'large', 'later', 'never', 'other', 'place', 'point',
    'right', 'small', 'still', 'thing', 'think', 'those', 'three', 'under',
    'water', 'while', 'world', 'would', 'write', 'years', 'young', 'these',
    'hello', 'maybe', 'today', 'going', 'using', 'doing', 'night', 'money',
    'group', 'often', 'start', 'might', 'until', 'since', 'white', 'black',
    'green', 'color', 'woman', 'women', 'child', 'story', 'state', 'watch',
    'given', 'party', 'music', 'quite', 'along', 'among', 'close', 'early'
]);

const STORAGE_KEY = 'plummet_wotd_history';
const HISTORY_SIZE = 500;
const NOTIFICATION_CHANNEL_ID = 'plummet-word-of-day';
const NOTIFICATION_ID = 9001; // Unique ID for the recurring notification

/**
 * Get the last 500 words that were used for notifications
 */
function getWordHistory() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

/**
 * Add a word to the history, keeping only the last 500
 */
function addToWordHistory(word) {
    const history = getWordHistory();
    history.push(word);
    // Keep only the last 500
    while (history.length > HISTORY_SIZE) {
        history.shift();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

/**
 * Select a random word suitable for Word of the Day
 * - 4+ letters
 * - Not a basic/common word
 * - Has at least one definition
 * - Not in the last 500 words used
 */
export function selectWordOfDay(wordsData) {
    const history = new Set(getWordHistory());
    
    // Filter eligible words
    const eligible = Object.values(wordsData).filter(entry => {
        const word = entry.word;
        return (
            word.length >= 4 &&
            !BASIC_WORDS.has(word.toLowerCase()) &&
            entry.definitions?.length > 0 &&
            !history.has(word)
        );
    });
    
    if (eligible.length === 0) {
        // Fallback: clear history and try again
        localStorage.removeItem(STORAGE_KEY);
        return selectWordOfDay(wordsData);
    }
    
    // Random selection
    const selected = eligible[Math.floor(Math.random() * eligible.length)];
    addToWordHistory(selected.word);
    
    return selected;
}

/**
 * Format a word entry for notification display
 */
export function formatWordForNotification(wordEntry) {
    const word = wordEntry.word.toUpperCase();
    const def = wordEntry.definitions[0];
    const pos = def.pos.replace(' satellite', ''); // Clean up "adjective satellite" → "adjective"
    const definition = def.definition;
    
    // Full text for expanded notification
    let fullText = `${pos} — ${definition}`;
    
    // If there are multiple definitions, include them
    if (wordEntry.definitions.length > 1) {
        fullText = wordEntry.definitions
            .slice(0, 3) // Max 3 definitions
            .map((d, i) => `${i + 1}. (${d.pos.replace(' satellite', '')}) ${d.definition}`)
            .join('\n');
    }
    
    return {
        word,
        shortText: `${pos} — ${definition.slice(0, 80)}${definition.length > 80 ? '...' : ''}`,
        fullText,
        pos
    };
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermission() {
    if (!Capacitor.isNativePlatform()) {
        console.log('[WOTD] Not a native platform, skipping permission request');
        return false;
    }
    
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled() {
    if (!Capacitor.isNativePlatform()) return false;
    
    const result = await LocalNotifications.checkPermissions();
    return result.display === 'granted';
}

/**
 * Create the notification channel (Android only)
 * This enables custom sound and importance level
 */
export async function createNotificationChannel() {
    if (!Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() !== 'android') return;
    
    await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Word of the Day',
        description: 'Daily word notifications from Plummet',
        importance: 4, // HIGH - shows everywhere, makes sound
        visibility: 1, // PUBLIC
        sound: 'wotd_chime.wav', // Custom sound file (must be in android/app/src/main/res/raw/)
        vibration: true,
        lights: true,
        lightColor: '#e2d8a6' // Plummet accent color
    });
}

/**
 * Schedule the Word of the Day notification for noon today (or tomorrow if past noon)
 */
export async function scheduleWordOfDay(wordsData) {
    if (!Capacitor.isNativePlatform()) {
        console.log('[WOTD] Not a native platform, skipping notification');
        return null;
    }
    
    const hasPermission = await areNotificationsEnabled();
    if (!hasPermission) {
        console.log('[WOTD] Notifications not permitted');
        return null;
    }
    
    // Cancel any existing scheduled notification
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
    
    // Select the word
    const wordEntry = selectWordOfDay(wordsData);
    const formatted = formatWordForNotification(wordEntry);
    
    // Calculate next noon
    const now = new Date();
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    
    // If it's already past noon, schedule for tomorrow
    if (now >= noon) {
        noon.setDate(noon.getDate() + 1);
    }
    
    // Schedule the notification
    await LocalNotifications.schedule({
        notifications: [
            {
                id: NOTIFICATION_ID,
                title: `📖 Word of the Day: ${formatted.word}`,
                body: formatted.shortText,
                largeBody: formatted.fullText, // Expandable content (Android)
                summaryText: 'Tap to learn more', // Shown when collapsed (Android)
                schedule: {
                    at: noon,
                    allowWhileIdle: true // Ensure delivery even in Doze mode
                },
                sound: 'wotd_chime.wav', // Custom sound
                channelId: NOTIFICATION_CHANNEL_ID,
                extra: {
                    word: wordEntry.word,
                    type: 'word-of-day'
                },
                // iOS specific
                attachments: null,
                actionTypeId: '',
                threadIdentifier: 'plummet-wotd',
                // Android specific styling
                smallIcon: 'ic_notification', // Must exist in res/drawable
                largeIcon: 'ic_launcher', // App icon
                iconColor: '#e2d8a6' // Plummet accent
            }
        ]
    });
    
    console.log(`[WOTD] Scheduled "${formatted.word}" for ${noon.toLocaleString()}`);
    
    return {
        word: wordEntry,
        scheduledFor: noon
    };
}

/**
 * Enable daily Word of the Day notifications
 * Call this when user opts in
 */
export async function enableWordOfDay(wordsData) {
    const granted = await requestNotificationPermission();
    if (!granted) {
        return { success: false, reason: 'permission_denied' };
    }
    
    await createNotificationChannel();
    const result = await scheduleWordOfDay(wordsData);
    
    if (result) {
        localStorage.setItem('plummet_wotd_enabled', 'true');
        return { success: true, ...result };
    }
    
    return { success: false, reason: 'schedule_failed' };
}

/**
 * Disable Word of the Day notifications
 */
export async function disableWordOfDay() {
    localStorage.setItem('plummet_wotd_enabled', 'false');
    
    if (Capacitor.isNativePlatform()) {
        await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] });
    }
    
    return { success: true };
}

/**
 * Check if Word of the Day is enabled
 * Defaults to TRUE for new users (opt-out model)
 */
export function isWordOfDayEnabled() {
    const stored = localStorage.getItem('plummet_wotd_enabled');
    // Default to true if never set (new users)
    if (stored === null) return true;
    return stored === 'true';
}

/**
 * Check if this is the first launch (never seen the WOTD setting)
 */
export function isFirstLaunch() {
    return localStorage.getItem('plummet_wotd_enabled') === null;
}

/**
 * Initialize Word of the Day on first app launch
 * Automatically requests permission and enables if granted
 */
export async function initializeOnFirstLaunch(wordsData) {
    if (!isFirstLaunch()) return { alreadyInitialized: true };
    if (!Capacitor.isNativePlatform()) {
        // Mark as seen but disabled for web
        localStorage.setItem('plummet_wotd_enabled', 'false');
        return { success: false, reason: 'not_native' };
    }
    
    // Try to enable - this will prompt for permission
    const result = await enableWordOfDay(wordsData);
    
    if (!result.success) {
        // User denied or something failed - mark as disabled
        localStorage.setItem('plummet_wotd_enabled', 'false');
    }
    
    return result;
}

/**
 * Re-schedule the next notification (call this when app opens)
 * This ensures continuity even if the device was off at noon
 */
export async function rescheduleIfNeeded(wordsData) {
    if (!isWordOfDayEnabled()) return;
    if (!Capacitor.isNativePlatform()) return;
    
    // Check pending notifications
    const pending = await LocalNotifications.getPending();
    const hasWotd = pending.notifications.some(n => n.id === NOTIFICATION_ID);
    
    if (!hasWotd) {
        // Re-schedule
        await scheduleWordOfDay(wordsData);
    }
}

/**
 * Listen for notification taps
 */
export function setupNotificationListeners(onWordTapped) {
    if (!Capacitor.isNativePlatform()) return;
    
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const { notification } = action;
        if (notification.extra?.type === 'word-of-day') {
            const word = notification.extra.word;
            if (onWordTapped) {
                onWordTapped(word);
            }
        }
    });
}

/**
 * Get a preview of what the notification would look like (for settings UI)
 */
export function getNotificationPreview(wordsData) {
    const wordEntry = selectWordOfDay(wordsData);
    // Remove from history since this is just a preview
    const history = getWordHistory();
    if (history[history.length - 1] === wordEntry.word) {
        history.pop();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
    
    return formatWordForNotification(wordEntry);
}
