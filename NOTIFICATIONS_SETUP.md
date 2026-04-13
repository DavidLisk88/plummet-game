# Word of the Day Notifications Setup

## Overview
Plummet can send daily "Word of the Day" notifications at noon (user's local timezone) with a random word, its definition, and part of speech.

## Features
- ✅ Random word selection (4+ letters, non-basic)
- ✅ Last 500 words tracked to avoid repeats
- ✅ Expandable notifications (full definition without opening app)
- ✅ Custom notification sound support
- ✅ Scheduled at noon local time
- ✅ Works on both Android and iOS

## Custom Notification Sound

### Android
1. Create your sound file (WAV or MP3, max 30 seconds recommended)
2. Name it `wotd_chime.wav`
3. Place it in: `android/app/src/main/res/raw/wotd_chime.wav`
4. If the `raw` folder doesn't exist, create it

**Sound Requirements:**
- Format: WAV, MP3, or OGG
- Duration: Under 30 seconds (short chimes work best)
- Sample rate: 44.1kHz recommended

### iOS
1. Create your sound file (WAV, AIFF, or CAF format)
2. Name it `wotd_chime.wav`
3. Add it to the Xcode project:
   - Open `ios/App/App.xcworkspace` in Xcode
   - Drag the sound file into the App folder
   - Ensure "Copy items if needed" is checked
   - Ensure "Add to targets: App" is checked

**Sound Requirements:**
- Format: WAV, AIFF, or CAF (linear PCM, MA4, or μ-law)
- Duration: Under 30 seconds
- For iOS, sounds over 30 seconds will use default sound

## Notification Icon (Android)

Create a notification icon at:
- `android/app/src/main/res/drawable/ic_notification.png` (24x24dp, white/transparent)
- Or use Android Asset Studio to generate proper sizes

The icon should be:
- Monochrome (white with transparency)
- Simple silhouette style
- 24x24dp base size

## Integration

### Enable/Disable in Settings
```javascript
import { enableWordOfDay, disableWordOfDay, isWordOfDayEnabled } from './src/lib/word-of-day.js';

// Check current status
const enabled = isWordOfDayEnabled();

// Enable (shows permission dialog if needed)
const result = await enableWordOfDay(wordsData);
if (result.success) {
    console.log(`Scheduled: ${result.word.word} at ${result.scheduledFor}`);
}

// Disable
await disableWordOfDay();
```

### On App Launch (reschedule if needed)
```javascript
import { rescheduleIfNeeded } from './src/lib/word-of-day.js';

// Call this when app initializes
await rescheduleIfNeeded(wordsData);
```

### Handle Notification Tap
```javascript
import { setupNotificationListeners } from './src/lib/word-of-day.js';

setupNotificationListeners((word) => {
    // User tapped notification - open dictionary to this word
    showDictionaryWithWord(word);
});
```

## Notification Appearance

### Android (Expanded)
```
┌─────────────────────────────────────────────┐
│ 📖 Word of the Day: EPHEMERAL              │
│ adjective — lasting for a very short time   │
│                                             │
│ 1. (adjective) lasting for a very short    │
│    time                                     │
│ 2. (noun) an ephemeral plant               │
│                                             │
│ Tap to learn more                          │
└─────────────────────────────────────────────┘
```

### iOS (Expanded via 3D Touch/Long Press)
Similar expandable format with full definitions visible.

## Testing

### Test on Device
1. Build and run on a real device
2. Enable Word of the Day in settings
3. Change device time to 11:59 to test (or modify code to use a shorter delay)
4. Notification should appear at noon

### Debug in Console
```javascript
import { getNotificationPreview } from './src/lib/word-of-day.js';

const preview = getNotificationPreview(wordsData);
console.log('Preview:', preview);
// { word: 'EPHEMERAL', shortText: '...', fullText: '...', pos: 'adjective' }
```

## Troubleshooting

### Notifications Not Appearing
1. Check app has notification permissions in device settings
2. Check battery optimization isn't blocking the app (Android)
3. Ensure `POST_NOTIFICATIONS` permission is granted (Android 13+)

### Custom Sound Not Playing
1. Verify sound file is in correct location
2. Check file format is supported
3. On iOS, file must be added to Xcode project bundle

### Notification Channel (Android)
If you change channel settings, users may need to:
1. Go to App Settings → Notifications
2. Delete the "Word of the Day" channel
3. Reopen the app to recreate it
