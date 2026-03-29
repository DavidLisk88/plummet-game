# Plummet — App Store Deployment Guide

## What's Done (Capacitor Setup)

- **Capacitor initialized** with iOS platform (`ios/` folder)
- **App icon** generated from `logo.svg` (1024×1024)
- **Build script** (`build-web.js`) copies web assets → `www/`
- **Config** locked to portrait, dark splash screen, status bar styled
- **Bundle ID**: `com.plummetgame.app` (change in `capacitor.config.ts` if needed)

## NPM Commands

| Command | What it does |
|---------|-------------|
| `npm run build` | Copy web assets to `www/` |
| `npm run ios` | Build + sync + open Xcode |
| `npm run cap:sync` | Sync web assets to native project |

---

## Steps to Complete (on a Mac)

### 1. Transfer the Project to Your Mac

Copy or clone the entire project folder to your Mac. Then:

```bash
npm install
npm run build
npx cap sync ios
```

### 2. Open in Xcode

```bash
npx cap open ios
```

This opens the `ios/App/App.xcworkspace` in Xcode.

### 3. Configure Signing in Xcode

1. Select the **App** project in the left sidebar
2. Go to **Signing & Capabilities** tab
3. Check **"Automatically manage signing"**
4. Select your **Team** (your Apple Developer account)
5. The Bundle Identifier should be `com.plummetgame.app`
   - If it's taken, change it here AND in `capacitor.config.ts`
6. Xcode will create the provisioning profile automatically

### 4. Set Version & Build Number

1. In Xcode → **General** tab
2. Set **Version** to `1.0.0`
3. Set **Build** to `1`
4. Increment **Build** for each upload (1, 2, 3...)

### 5. Set Deployment Target

1. In **General** → **Minimum Deployments**
2. Set to **iOS 16.0** (good balance of features vs. device coverage)

### 6. Test on Device / Simulator

1. Select an iPhone simulator (e.g., iPhone 15 Pro) from the device dropdown
2. Press **Cmd+R** to build and run
3. Test all game features: gameplay, music, profiles, tutorials
4. Test on a physical device too if possible (connect via USB)

### 7. Archive & Upload to App Store Connect

1. Select **"Any iOS Device (arm64)"** as the build target
2. **Product → Archive** (Cmd+B first to verify it builds)
3. When archive completes, the Organizer opens
4. Click **"Distribute App"**
5. Choose **"App Store Connect"** → **Upload**
6. Follow the prompts (automatic signing should work)

### 8. App Store Connect Setup

Go to [App Store Connect](https://appstoreconnect.apple.com):

1. **My Apps → "+" → New App**
   - Platform: iOS
   - Name: **Plummet**
   - Primary Language: English
   - Bundle ID: select `com.plummetgame.app`
   - SKU: `plummet-001` (any unique string)

2. **App Information**
   - Category: **Games**
   - Subcategory: **Word** (or Puzzle)
   - Content Rights: assert you own the content
   - Age Rating: fill out the questionnaire (likely 4+, no objectionable content)

3. **Pricing and Availability**
   - Price: **Free** (or set your price)
   - Availability: select countries

4. **App Privacy**
   - Your app uses **localStorage** for profiles/scores
   - Since data stays on-device and nothing is sent to a server:
     - Data types collected: **None** (or "Gameplay Content" linked to device)
   - No analytics SDKs, no tracking → simple privacy nutrition label

5. **Prepare Screenshots** (required sizes)
   - **6.7" iPhone** (1290×2796) — iPhone 15 Pro Max
   - **6.5" iPhone** (1284×2778) — iPhone 14 Plus
   - **5.5" iPhone** (1242×2208) — iPhone 8 Plus
   - **iPad Pro 12.9"** (2048×2732) — if supporting iPad
   
   Take these in Simulator: **Cmd+S** saves a screenshot.
   Show: menu screen, active gameplay, word being cleared, game over/score.

6. **App Description**
   
   Suggested:
   > **Plummet** is a fast-paced word puzzle game where letter blocks fall into a grid. Slide them into position and spell words horizontally, vertically, or diagonally to clear the board and score big!
   >
   > Features:
   > • Multiple grid sizes (3×3 to 8×8)
   > • Sandbox, Timed, and Challenge modes
   > • Bonus powers: Wildcard, Bomb, Freeze, Shuffle, Row Clear, Score 2×
   > • Chain reactions for massive combos
   > • XP leveling system with 500 levels
   > • Multiple player profiles
   > • Built-in music player
   > • Dark theme with gold accents
   
   **Keywords**: word game, puzzle, falling blocks, vocabulary, brain teaser, word puzzle, letter game, spelling

7. **Submit for Review**
   - Select your uploaded build
   - Fill in review notes: "Single-player offline word puzzle game. No login required. No in-app purchases. No network access needed."
   - Submit!

---

## Common Gotchas

| Issue | Fix |
|-------|-----|
| Xcode says "No signing certificate" | Xcode → Settings → Accounts → your Apple ID → Manage Certificates → add "Apple Development" |
| Build fails with "module not found" | Run `npx cap sync ios` again |
| White flash on launch | The splash screen config in `capacitor.config.ts` is set to dark (#111111) to match the game |
| Music doesn't play on iOS | WebKit requires user interaction before audio plays — the game already handles this with click-to-play |
| localStorage lost on update | Capacitor uses WKWebView which persists localStorage between updates — no issue |
| App rejected for "minimum functionality" | Ensure all game modes work, include screenshots of varied gameplay |

---

## Google Play Store (Android)

### Prerequisites
- [Google Play Developer account](https://play.google.com/console) — **$25 one-time fee**
- **Android Studio** installed (free from [developer.android.com/studio](https://developer.android.com/studio))
- The Android platform is already set up in this project

### NPM Commands

| Command | What it does |
|---------|-------------|
| `npm run android` | Build + sync + open Android Studio |
| `npx cap sync android` | Sync web assets to Android project |
| `npx cap open android` | Open Android Studio |

### 1. Open in Android Studio

```bash
npm run build
npx cap sync android
npx cap open android
```

### 2. Test on Emulator

1. In Android Studio, click the **device dropdown** → **Device Manager** → create a **Pixel 8 Pro** emulator
2. Click the green **Run** button (▶) to build and launch
3. Test the game on the emulator

### 3. Generate Signed APK / AAB

Google Play requires a signed **Android App Bundle (.aab)**:

1. In Android Studio: **Build → Generate Signed Bundle / APK**
2. Choose **Android App Bundle**
3. **Create new keystore** (first time only):
   - Click **Create new...** 
   - Choose a location to save it (e.g., `plummet-release.jks`)
   - Set a **keystore password** (SAVE THIS — you need it for every update)
   - Fill in the key alias (e.g., `plummet`), key password, and your name
   - Click **OK**
4. Select **release** build variant
5. Click **Finish** — the `.aab` file is generated in `android/app/release/`

⚠️ **IMPORTANT**: Back up your keystore file and passwords! If you lose them, you can never update your app.

### 4. Google Play Console Setup

Go to [play.google.com/console](https://play.google.com/console):

1. **Create app**
   - App name: **Plummet**
   - Default language: English
   - App type: Game
   - Free or paid: Free (or set your price)

2. **Store listing**
   - Short description (80 chars): `A fast-paced falling letter word puzzle — spell words to clear the board!`
   - Full description:
     > Plummet is a fast-paced word puzzle game where letter blocks fall into a grid. Slide them into position and spell words horizontally, vertically, or diagonally to clear the board and score big!
     >
     > Features:
     > • Multiple grid sizes (3×3 to 8×8)
     > • Sandbox, Timed, and Challenge modes
     > • Bonus powers: Wildcard, Bomb, Freeze, Shuffle, Row Clear, Score 2×
     > • Chain reactions for massive combos
     > • XP leveling system with 500 levels
     > • Multiple player profiles
     > • Built-in music player
     > • Dark theme with gold accents
   - Category: **Game → Word**
   - Tags: Word game, Puzzle, Brain game

3. **Graphics**
   - **App icon**: Upload `android/app/src/main/res/../playstore-icon.png` (512×512) — already generated
   - **Feature graphic**: 1024×500 banner (create one showing the game logo + gameplay)
   - **Screenshots**: Take from Android emulator (at least 2, recommended 4-8)
     - In the emulator, press the **camera icon** in the toolbar to screenshot

4. **Content rating**
   - Fill out the IARC questionnaire
   - No violence, no user-generated content, no purchases → likely rated **Everyone / PEGI 3**

5. **Privacy policy**
   - Google Play requires a privacy policy URL for all apps
   - Since the game is offline with no data collection, you can host a simple one on GitHub Pages or any free site
   - Should state: "Plummet does not collect, store, or transmit any personal data. All game data is stored locally on your device."

6. **App content declarations**
   - Ads: No
   - Target audience: All ages
   - News app: No
   - Data safety: No data collected, no data shared

7. **Release**
   - Go to **Production → Create new release**
   - Upload the `.aab` file
   - Add release notes: "Initial release of Plummet — a falling letter word puzzle game"
   - **Review and roll out**

### Android Gotchas

| Issue | Fix |
|-------|-----|
| "SDK location not found" | Open Android Studio → SDK Manager → install SDK 34+ |
| Gradle build fails | In Android Studio: File → Sync Project with Gradle Files |
| App crashes on launch | Check Logcat in Android Studio for errors |
| Play Store rejects for "Broken functionality" | Test thoroughly on emulator first |
| "You need a privacy policy" | Required even for offline apps — host a simple page |

---

## Build Workflow (After Any Code Change)

```bash
# Edit index.html / script.js / style.css as usual
npm run build          # copy to www/
npx cap sync ios       # push to Xcode project
npx cap sync android   # push to Android Studio project
# Then build/run in Xcode or Android Studio
```

Or the shortcut: `npm run ios` (does all three).
