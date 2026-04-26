# Plummet — Launch Post Kit

Drop-in copy for Product Hunt, Reddit, Hacker News, Indie Hackers, and X/Twitter.

---

## 1. PRODUCT HUNT

### Tagline (60 chars max)
**The word game with 5 modes, daily challenges, and zero ads**

> Alts:
> - `Wordle, Scrabble & Word Search — all in one free app` (54)
> - `5 word games. 1 app. No ads. Free forever.` (43)

### Description (260 chars — shows in feed)
```
Plummet is a free word game with 5 modes — Word Search, Speed Round, Target Word, Word Category, and Word Runner (an endless runner you've never seen before). Daily challenges, global leaderboards, 500 levels, no mid-game ads. Built solo over 18 months.
```

### First comment (the maker comment — pinned at top)
```
Hey Product Hunt 👋

I'm the solo dev behind Plummet. I built it because I love Wordle and Word Search but kept wishing there was ONE app that combined them — plus a daily reason to come back, plus something genuinely new.

So I shipped 5 modes:

🔍 Word Search — Faster, smarter classic
⚡ Speed Round — 60 seconds, max words
🎯 Target Word — Wordle-style guessing
🏷️ Word Category — Themed brain teasers
🏃 Word Runner — Endless runner where you collect letters mid-air to spell words. Nobody else has this. It's my favorite mode.

What you'll find:
• Daily challenge with streak rewards
• 500-level XP system
• 100+ achievements
• Global leaderboards
• Built-in lo-fi music player
• Beautiful dark + gold theme
• Multiple player profiles (share with family)

What you WON'T find:
• Mid-game ads
• Energy/stamina paywalls
• "Unlock this mode for $4.99"
• Tracking SDKs

It's just a word game, made with love.

Tech: Preact + Vite + Capacitor + Supabase. Web + iOS + Android.

Roast my screenshots, tell me which mode is your favorite, and report any bugs — I'm shipping updates fast 🚀

iOS: https://apps.apple.com/us/app/plummet-word-fall/id6761784552
Android: [your Play Store link]

❤️
```

### Topics to tag
- Games
- Mobile
- iOS
- Android
- Education
- Word Games

### Launch day checklist
- [ ] Schedule launch for **12:01 AM PT Tuesday** (best traffic day)
- [ ] Have 8-10 friends ready to upvote in first 2 hours (PH algorithm boost)
- [ ] Post in PH Slack/Discord communities you're in
- [ ] Reply to every single comment within 30 minutes
- [ ] Tweet about your launch at 8 AM PT linking to PH page
- [ ] Cross-post to LinkedIn at 10 AM PT
- [ ] Email friends asking for genuine feedback (not just upvotes)

---

## 2. REDDIT

> Reddit hates promotion. Lead with a story or genuine ask, not a pitch. NEVER post the same thing in multiple subs same day.

### r/WordGames
**Title:** I built a word game with 5 modes including an endless-runner-meets-vocabulary mode — looking for honest feedback

**Body:**
```
Hey r/WordGames,

Been lurking here for years. I'm a solo dev who got obsessed with the question "what if Word Search and Wordle had a baby — and then that baby went to a Pixar movie?"

Ended up building 5 modes in one app:
• Word Search (the classic, but tighter)
• Speed Round (60s, max words)
• Target Word (Wordle-style)
• Word Category (themed)
• Word Runner — an endless-runner where you collect falling letters to spell words. This is the one I haven't seen anywhere else.

Free, no mid-game ads, no paywalls. Daily challenge + leaderboards.

I'd genuinely love feedback from this community before I push it harder. What works? What's broken? What would make you actually keep playing?

iOS: [link]
Android: [link]

Roast freely 🙏
```

### r/iosgaming
**Title:** [Free] Plummet — 5 word game modes, daily challenges, zero ads. Solo indie dev launch.

**Body:** *(shorter, more product-focused — this sub is more tolerant of indie launches)*
```
Hi r/iosgaming!

Launched my word game today after 18 months of solo work. 5 game modes (Word Search, Speed Round, Target Word, Word Category, Word Runner — last one is an endless runner that's pretty unique). Free, no ads, no IAPs blocking content.

Daily challenges + leaderboards if you want competition, sandbox modes if you don't.

iOS: [link]

Happy to answer any questions about the build or the design choices. Feedback welcomed!
```

### r/AndroidGaming — same as r/iosgaming with Android link

### r/SideProject
**Title:** I shipped my word game after 18 months — 5 modes, daily challenges, zero ads

**Body:** *(focus on the journey, not the product)*
```
Solo dev. 18 months. 0 funding. 1 app.

Plummet is a word game with 5 modes including one I haven't seen anywhere else (Word Runner — endless runner where you collect letters mid-air).

Lessons learned the hard way:
1. Building gameplay is 20% of the work. Onboarding is 40%. Polish is 40%.
2. The first 5 minutes of UX matters more than every feature combined.
3. "Just one more mode" is the indie dev's "five more minutes."
4. Your friends will say it's great. Your TikTok comments will say what's actually true.
5. Apple's review process gets faster the more you submit.

Tech: Preact + Vite + Capacitor + Supabase.

Anyone else here ship a game solo? Would love to swap stories.

[link]
```

### r/IndieDev
*(Same as r/SideProject — both are dev-friendly. Space them 3 days apart.)*

---

## 3. HACKER NEWS

> HN is brutal but rewards honesty + technical depth. Post on a Tuesday/Wednesday morning PT.

### Title
**Show HN: Plummet – A word game with 5 modes (built solo with Preact + Capacitor)**

### Body (auto-included as first comment)
```
Hi HN,

Plummet is a word game I built solo over the past 18 months. It has 5 modes: Word Search, Speed Round, Target Word, Word Category, and Word Runner (an endless runner where you collect letters mid-air to spell words).

Free, no ads, no IAPs, no tracking. Just a word game.

A few technical things that might be interesting:

- Stack: Preact + Vite + Capacitor for cross-platform (web/iOS/Android), Supabase for auth + leaderboards
- The Word Runner mode uses Phaser Arcade Physics at fps:120 — got there after one disastrous detour through a custom fixed-timestep accumulator
- Word list: ~80k words enriched with definitions, sourced from WordNet + Wiktionary
- Music: built-in lo-fi player; tracks are user-replaceable
- ~100k LOC of vanilla JS in a single script.js (yes, a single file — refactor pending, change my mind)

Things I learned that I wish someone had told me:

1. localStorage migrations between Capacitor versions are a minefield
2. Apple's "minimum functionality" rejection actually means "your screenshots look bad"
3. The first signup prompt in a free game is the single highest-leverage UX decision
4. A word game's app size grows linearly with dictionary size — compress aggressively

iOS: [link]
Android: [link]
Web: [link]

Roasts and questions welcome.
```

---

## 4. X / TWITTER (launch thread)

### Tweet 1 (the hook)
```
After 18 months of solo dev, Plummet is live.

5 word game modes. Daily challenges. Global leaderboards. Zero ads.

It's free.

🧵 + links below 👇
```
*(Attach: 15s gameplay clip)*

### Tweet 2
```
The 5 modes:

🔍 Word Search — classic, but tighter
⚡ Speed Round — 60 seconds, max words
🎯 Target Word — crack the hidden word
🏷️ Word Category — themed brain teasers
🏃 Word Runner — endless runner where you collect letters mid-air. Nobody else has this.
```
*(Attach: 4-up screenshot of all modes)*

### Tweet 3
```
Why I built it:

I love Wordle. I love Word Search. I hated needing 5 different apps to play them all — and I REALLY hated mid-game ads.

So I built one app with 5 modes and no ads. Forever free. Forever ad-free.
```

### Tweet 4
```
The stack for the curious:

⚛️ Preact + Vite (small bundle, fast)
📱 Capacitor (web, iOS, Android)
🐘 Supabase (auth, leaderboards, push)
🎮 Phaser (Word Runner physics)
🎵 Custom HTML5 audio player

Total: ~100k LOC. One dev. Many caffeine-fueled nights.
```

### Tweet 5 (the CTA)
```
Try it:

iOS → https://apps.apple.com/us/app/plummet-word-fall/id6761784552
Android → [link]
Web → [link]

Tell me which mode is your favorite. Roast my screenshots. Find a bug = I'll @ you when it's fixed.

Tag a friend who needs a new word game ❤️
```

---

## 5. INDIE HACKERS

### Title
**I shipped my word game after 18 months — here's what I'd do differently**

### Body
```
Plummet is a word game with 5 modes. Free, no ads, no IAPs. Launched today.

What went well:
1. Building 5 modes instead of 1 — gives players variety + makes the app harder to bounce from
2. Using Capacitor — one codebase, web + iOS + Android
3. Supabase for backend — a solo dev shouldn't be writing auth from scratch

What I'd do differently:
1. Ship after 6 months with 2 modes, not 18 months with 5. Time-to-market killed me.
2. Skip the custom physics engine. Use Phaser/Pixi from day 1 (I rebuilt twice).
3. Do ASO research BEFORE coding. I picked "Plummet" as a name — it's beautiful but has zero search volume.
4. Build the share/invite loop in week 1, not week 75.
5. Talk to users every week from day 1. I waited 6 months. Big mistake.

Currently focused on: getting the install number above 1k organically before spending on UA.

Anyone want to swap notes on launch tactics?

[link]
```

---

## Universal launch-day checklist

- [ ] Privacy policy & terms hosted at public URLs
- [ ] All store links work (iOS, Android, web)
- [ ] At least 5 hero screenshots uploaded
- [ ] App Preview / promo video uploaded
- [ ] What's New / release notes filled in
- [ ] Press kit (logo, screenshots, 1-paragraph description) zipped & ready to send
- [ ] Personal email auto-responder set up (you'll get bug reports)
- [ ] Analytics dashboard open (App Store Connect, Play Console, Supabase) so you can see installs in real time
- [ ] Social posts pre-scheduled or drafted
- [ ] Block your calendar for the launch day — replying to comments IS the work

Good luck. Ship it. 🚀
