# PLUMMET — Comprehensive Threat Model & Red Team Analysis

## Executive Summary

PLUMMET is a browser-based word puzzle game with a Supabase backend, deployed via Netlify, with Android/iOS Capacitor builds. This document threat-models every layer of the system — from client-side game logic to database schema to deployment pipeline — and red-teams each subsystem with divergent, creative attack vectors.

---

## 1. ARCHITECTURE OVERVIEW

```
Client (browser/mobile)
  ├── script.js (14,600+ lines monolith)
  │   ├── ProfileManager (localStorage save/load)
  │   ├── Game engines (main grid, Word Search, Word Runner)
  │   ├── Scoring / XP / Coin calculators
  │   └── Supabase SDK calls
  ├── src/lib/
  │   ├── supabase.js (auth, CRUD, RPC)
  │   ├── verification.js (email codes via localStorage)
  │   ├── notifications.js (EmailJS REST API)
  │   ├── leaderboard-service.js (cache + fetch)
  │   ├── skill-engine.js (client-side skill calc)
  │   └── player-analysis.js (AI text generation)
  └── words.json (DICTIONARY)
  
Backend (Supabase)
  ├── PostgreSQL with RLS
  ├── Triggers (SECURITY DEFINER)
  ├── RPC functions (skill computation, leaderboard)
  └── Realtime subscriptions (leaderboard)
```

---

## 2. THREAT CATEGORIES

### 2.1 SCORE INTEGRITY — CLIENT-TRUSTED SCORING (CRITICAL)

**Finding:** All scoring, XP, and coin calculations happen client-side. The client computes the final score/XP/coins and sends them to Supabase via `recordGameScore()`. The server has CHECK constraints (score 0-100,000) but **no server-side validation of the actual gameplay.**

**Attack vectors:**
- **Direct API injection:** An attacker with a valid Supabase JWT can call `game_scores INSERT` directly with fabricated data (e.g., score: 99,999, words_found: 4999).
- **Client-side manipulation:** Opening DevTools → `this.profileMgr.getActive()` → modify `coins`, `xp`, `level` → the ProfileManager saves to localStorage and syncs to Supabase.
- **Word Runner specific:** `wr.score`, `wr.coins`, `wr.wordScore` are all mutable in-memory. A simple `game._wr.score = 99999` in the console gives arbitrary scores.
- **Replay attack:** Record a valid `recordGameScore` payload and replay it thousands of times to farm XP/coins/games_played.

**Database constraints present:**
- `score >= 0 AND score <= 100000`
- `words_found >= 0 AND words_found <= 5000`
- `best_combo >= 0 AND best_combo <= 500`
- `longest_word_length >= 0 AND longest_word_length <= 50`

**What's missing:**
- No rate limiting on game_scores INSERT (could insert thousands per second)
- No server-side plausibility check (e.g., "a 3-minute game can't produce 50,000 points")
- No game session tokens or proof-of-work
- No timestamp validation (client sends `played_at`, server doesn't verify freshness)
- XP and coins are computed client-side, then both stored locally AND sent to Supabase — but the Supabase record is decoupled from the local state

**Risk: HIGH — Leaderboard pollution, unfair rankings**

**Recommendations:**
1. Server-side score plausibility function: `validate_game_score(score, words_found, time_limit, grid_size)` that checks statistical bounds
2. Rate limit: max 1 game_score INSERT per 30 seconds per profile_id (use a Supabase Edge Function or database constraint with last_played tracking)
3. Game session tokens: issue a signed token at game start, require it at submission
4. Move XP/coin calculation to a server-side function triggered by the INSERT

---

### 2.2 AUTHENTICATION & SESSION SECURITY (MEDIUM)

**Finding:** Uses Supabase Auth (email/password) with auto-refresh tokens, persistent sessions. Account rows are created client-side via `ensureAccountRow()` upsert.

**Attack vectors:**
- **Account enumeration:** `signUp()` error messages may reveal whether an email is already registered.
- **No rate limiting on auth:** Supabase's default rate limits apply, but custom brute-force protection is absent.
- **Session hijack:** Supabase stores the JWT in localStorage by default. XSS → full account takeover.

**Risk: MEDIUM — Mitigated by Supabase's built-in auth protections**

**Recommendations:**
1. Enable Supabase's rate limiting on auth endpoints
2. Use `httpOnly` cookie auth mode if possible to prevent XSS JWT theft
3. Add CAPTCHA on signup/login forms

---

### 2.3 VERIFICATION CODE SYSTEM (MEDIUM-HIGH)

**Finding:** `verification.js` generates 5-digit numeric codes stored in **localStorage** (not server-side). Codes expire after 30 minutes.

**Attack vectors:**
- **Client-side bypass:** Verification codes are in localStorage under `plummet_verification_codes`. An attacker can read `localStorage.getItem('plummet_verification_codes')` directly.
- **Brute force:** 5-digit code = 90,000 possibilities. No rate limiting on `verifyCode()` — can try all codes in seconds.
- **Cross-tab access:** Any script running on the same origin can read the verification store.
- **Code never sent to server:** The code is generated client-side, stored client-side, and verified client-side. It's purely a UX gate, not a security control.

**Risk: MEDIUM-HIGH — Verification is cosmetic, not enforced server-side**

**Recommendations:**
1. Move verification to Supabase Edge Functions (generate + verify server-side)
2. Use 6+ digit codes with exponential backoff on failed attempts
3. Or use Supabase's built-in email confirmation flow instead

---

### 2.4 EMAIL NOTIFICATIONS — EMAILJS EXPOSURE (LOW-MEDIUM)

**Finding:** `notifications.js` uses EmailJS REST API with public key, service ID, and template ID embedded in the built JS bundle (from `import.meta.env.VITE_EMAILJS_*`).

**Attack vectors:**
- **API key extraction:** The EmailJS public key is baked into the production bundle. Anyone can extract it and send emails through the account (up to the 200/mo free tier limit).
- **Email bombing:** Repeated calls to the EmailJS API using the extracted credentials to send spam through the account's email service.
- **Template parameter injection:** The `message` parameter is passed directly — if the email template uses HTML, this could inject content.

**Risk: LOW-MEDIUM — Limited by EmailJS free tier (200 emails/mo)**

**Recommendations:**
1. Move email sending to a Supabase Edge Function (keep EmailJS key server-side)
2. Rate limit verification code requests per email address (server-side)
3. Consider Supabase's built-in email service instead

---

### 2.5 CLIENT-SIDE DATA STORAGE (MEDIUM)

**Finding:** ProfileManager stores all game state in localStorage under `wf_profiles`. This includes: level, XP, coins, high scores, inventory, equipped cosmetics, challenge stats, unique words, play streaks.

**Attack vectors:**
- **Direct localStorage manipulation:** `JSON.parse(localStorage.getItem('wf_profiles'))` → edit → `localStorage.setItem('wf_profiles', ...)` gives unlimited coins, max level, all items, etc.
- **Inventory theft:** Add any `item_id` to the local inventory array without purchasing.
- **Play streak inflation:** Set `lastPlayDate` and `playStreak` to arbitrary values for streak bonuses.
- **Dual-state desync:** Local state and Supabase state can diverge. A player could have max coins locally while Supabase shows 0 — or vice versa.

**Risk: MEDIUM — Affects single-player experience; leaderboard impact depends on sync**

**Recommendations:**
1. Treat localStorage as a cache, not the source of truth
2. Validate inventory purchases server-side before granting items
3. Sync critical state (coins, XP, inventory) from Supabase on login
4. Sign/HMAC the localStorage blob to detect tampering

---

### 2.6 DICTIONARY INTEGRITY (LOW-MEDIUM)

**Finding:** `DICTIONARY` is loaded from `words.json` at startup as a `Set`. The `_wrRandomLetter()` function builds a prefix set from this dictionary. Validation checks `DICTIONARY.has(candidate)`.

**Attack vectors:**
- **Dictionary replacement:** Intercepting the `words.json` fetch (service worker, proxy) to inject words that score high but aren't real.
- **Dictionary expansion via DevTools:** `DICTIONARY.add("ZZZZZZZZ")` → 8-letter word with all Z tiles = massive LETTER_VALUES bonus.
- **Race condition:** If DICTIONARY loads async, there's a window where `DICTIONARY.has()` returns false for valid words.

**Risk: LOW-MEDIUM — Only affects client-side scoring (server doesn't validate words)**

**Recommendations:**
1. Freeze the DICTIONARY Set after loading: `Object.freeze(DICTIONARY)` won't work on Sets, but wrapping in a frozen Map would
2. Hash verify the words.json content on load
3. Server-side word validation for leaderboard-eligible scores

---

### 2.7 ROW LEVEL SECURITY ANALYSIS (LOW)

**Finding:** RLS policies are well-structured:
- Accounts: own-row CRUD via `auth.uid()`
- Profiles: own-account via `account_id = auth.uid()`
- Game scores: own-profile (subquery check) for SELECT + INSERT only (no UPDATE/DELETE)
- High scores, challenge stats, category stats: SELECT only (triggers handle writes via SECURITY DEFINER)
- Leaderboard: public SELECT, no user-level writes
- Inventory: own-profile CRUD

**Potential issues:**
- **No UPDATE/DELETE on game_scores:** Good — prevents score history tampering. But also means a bad score can never be removed by the user.
- **SECURITY DEFINER trigger functions:** These bypass RLS. If a trigger has a SQL injection vulnerability, it runs with DB owner privileges. The current triggers use `NEW.field` references (safe), not dynamic SQL (except `update_category_stats` which builds a column name — but it's only used in a comment, the actual update uses CASE statements).
- **Leaderboard public read:** Usernames are visible to all users. No PII beyond username, but consider privacy.
- **Profile deletion cascade:** Deleting a profile cascades to all related data. An attacker who gains account access could wipe all game history.

**Risk: LOW — RLS is solid, trigger functions are safe**

**Recommendations:**
1. Add soft-delete for profiles (archive instead of CASCADE DELETE)
2. Audit `update_category_stats` — the `grid_col` variable is built dynamically but never actually used in a vulnerable way (it's a dead variable). Clean it up.

---

### 2.8 CROSS-SITE SCRIPTING (XSS) (LOW-MEDIUM)

**Finding:** The codebase extensively uses `innerHTML` (~30+ occurrences in script.js). Most set static HTML or use template literals with game-generated data (scores, words, perk names). The `_escapeHtml()` utility exists but isn't consistently used.

**Attack vectors:**
- **Username injection:** If a user sets their username to `<img onerror=alert(1) src=x>`, and that username is rendered via innerHTML on leaderboard screens, XSS occurs.
- **Word injection:** If a word from the dictionary contains HTML characters and is rendered via innerHTML in word-found lists.
- **Profile card rendering:** Line ~7665: `card.innerHTML = \`...\`` — if username is user-controlled and not escaped, stored XSS.
- **Leaderboard rendering:** Line ~7978: `container.innerHTML = html` — if leaderboard data includes unescaped usernames from Supabase.

**Mitigation found:** Line 12762: `_escapeHtml(str)` method exists using `textContent → innerHTML` pattern (safe).

**Risk: LOW-MEDIUM — Depends on whether usernames are escaped before innerHTML**

**Recommendations:**
1. Audit every innerHTML usage that renders user-controlled data (usernames, word lists)
2. Apply `_escapeHtml()` consistently to all user/external data before innerHTML insertion
3. Set Content-Security-Policy header in netlify.toml to block inline scripts
4. Consider migrating to textContent/Preact components for user-controlled data display

---

### 2.9 DEPLOYMENT & BUILD CHAIN (LOW)

**Finding:** Deployed via Netlify (`netlify.toml`), built with Vite 8.0.3. Environment variables for Supabase and EmailJS are injected at build time via `import.meta.env.VITE_*`.

**Considerations:**
- Vite environment variables prefixed `VITE_` are embedded in the client bundle — this is expected behavior. Supabase anon key is designed to be public (RLS enforces security).
- No `.env` file is committed (good — checked via grep).
- No source maps in production build (not explicitly disabled; check Vite config).
- Dependencies: 61 modules in build; supply chain attacks possible but standard risk.

**Risk: LOW**

---

## 3. WORD RUNNER — GAME-SPECIFIC THREAT MODEL

### 3.1 Spawn System Fairness

**Current state (after fixes):**
- Letters have 50px minimum center-to-center separation with 40px vertical check
- Ground letters: 80-140px step, 50% spawn chance
- Air letters: 110-200px step, 30% spawn chance  
- Platforms clamped to `groundY - maxJumpH*0.85` (reachable)
- Gaps physics-validated: never wider than 85% of max jump distance

**Red team concerns:**
- **Letter drought:** With 50% ground + 30% air probability per step, and ~3-4 steps per segment, a player could go 2-3 segments without a single letter. That's ~600-900px of running with nothing to collect.
- **Prefix bias creates dead-end words:** `_wrRandomLetter()` biases towards word-completing letters at 45% rate. But if the first 2 letters are "QZ", the prefix set has no extensions — every subsequent letter is fully random, making word formation impossible until boxes are cleared.
- **Speed scaling makes late game impossible:** Speed increases +6 per word. After 10 words: 200 base speed. After 20: 260. At max scroll speed (500), reaction time for letter collection drops to ~80ms. The difficulty curve may become a hard wall.

**Recommendations:**
1. Add a "drought protection" — if 0 letters spawned in 300+px, force-spawn one
2. When prefix has no extensions in the prefix set, add a chance to clear boxes automatically (or at least stop biasing and let randomness reset)
3. Consider logarithmic speed scaling: `speed = 140 + 60 * ln(1 + wordsFormed)` instead of linear +6

### 3.2 Validation Edge Cases

**Current logic:** Scan from longest prefix down to 3, find first DICTIONARY match, keep remaining letters.

**Edge cases found:**
- **0-2 letters → tap box:** Returns early (protected by `if (letters.length < 3) return`)
- **All 8 boxes filled, no valid prefix exists:** Clears all 8 letters, loses streak, -120 point penalty (8 × 15). This is harsh — player may have a valid 3-letter word at positions 3-5, but the scan only checks prefixes starting at index 0.
- **Remaining letters after word:** If "CATBIRD" and "CAT" is found, remaining is ["B","I","R","D"]. Next validation checks "BIRD" — valid! This cascading behavior is actually a feature, enabling strategic play.
- **Double-tap race condition:** `_validating` flag prevents double-submit (good).

**Critical gap:** The validation only checks consecutive letters from the START. If a player has [C, X, A, T], "CAT" won't be found because it checks "CXAT", "CXA", "CX" — all invalid. The player MUST collect letters in exact word order, but the game doesn't explain this.

**Recommendations:**
1. Document the "letters must be in order" constraint clearly in-game (e.g., glow boxes when a valid prefix exists)
2. Consider allowing non-contiguous letter matching (find any subsequence that forms a word) — this is much more fun but computationally expensive. Could limit to checking removals of 1-2 letters.
3. Add a "peek" indicator: when the first N letters form a valid prefix, show a subtle glow

### 3.3 Collision Detection Accuracy

**Player hitbox:** 16×38px, centered on worldX, top at `y-38`
**Letter hitbox:** `Math.abs(dx) < 24 && Math.abs(dy) < 28` where dy uses player center at `y - playerH/2`
**Rock hitbox:** AABB with 3px inset on sides, 4px inset on top

**Issue:** Letter collection uses Manhattan-distance-like box check, not true circle-circle collision. A letter at the corner of the hitbox (24px horizontal, 28px vertical) is 37px away — but the visual letter circle has radius 20. So letters can be "collected" when they appear 17px away from the player, or missed when they're visually overlapping at the wrong angle.

**Recommendation:** Use actual distance check: `Math.sqrt(dx*dx + dy*dy) < 28` for more natural feel.

---

## 4. RED TEAM — DIVERGENT THINKING ANALYSIS

### 4.1 Gameplay Exploits

| # | Exploit | Impact | Effort |
|---|---------|--------|--------|
| 1 | Open DevTools → `game._wr.score = 99999` | Fake high score | Trivial |
| 2 | Modify DICTIONARY Set → add gibberish words | Unlimited scoring | Trivial |
| 3 | Set `wr.scrollSpeed = 1` in console | Infinite play time | Trivial |
| 4 | Replay `recordGameScore` XHR with max values | Pollute leaderboard | Easy |
| 5 | Modify localStorage profiles blob | Free coins/items/XP | Trivial |
| 6 | Automate letter collection + validation with Tampermonkey | Bot plays perfectly | Medium |
| 7 | Fork words.json, add every permutation → 100% hit rate | Never fail validation | Easy |

### 4.2 UX/Design Weaknesses

| # | Issue | Impact |
|---|-------|--------|
| 1 | No visual indicator that letters must be in sequence order | Confusing — players will try to spell words from any combination |
| 2 | Penalty for invalid word (-120 at 8 letters) is harsh when the game doesn't explain rules | Frustrating new player experience |
| 3 | Speed increment is linear (+6/word) — creates a hard ceiling at ~15 words | Games end abruptly instead of gradually |
| 4 | No pause during word validation flash (300ms valid, 500ms invalid) — player still runs | Could die during animation |
| 5 | Word boxes at top of canvas may be obscured by phone notch/status bar on some devices | Canvas content invisible in safe area |
| 6 | HI score at `(w-12, 20)` could overlap with word boxes positioned at `top: 6px` | Visual clash on narrow screens |
| 7 | Stick figure hitbox (16×38) is much smaller than visual appearance | Feels unfair when "clearly" jumping over a rock |

### 4.3 Performance Concerns

| # | Issue | Risk |
|---|-------|------|
| 1 | Prefix set built from entire DICTIONARY on first `_wrRandomLetter()` call — iterates all words, builds all substrings | Could cause 100-300ms freeze on low-end devices |
| 2 | `_letterOk()` iterates all wr.letters on every letter spawn attempt | O(n) per spawn, ~5-10 spawns per frame |
| 3 | 30+ `innerHTML` assignments rebuild DOM trees frequently | Forced reflows during gameplay |
| 4 | Particle system uses `splice(i, 1)` in a reverse loop — O(n²) for many particles | Jank with 100+ particles |
| 5 | No object pooling for letters/rocks/platforms — GC pressure from continuous `push()` + `filter()` | Micro-stutters from GC pauses |

### 4.4 Backend Integrity

| # | Finding | Severity |
|---|---------|----------|
| 1 | No server-side gameplay validation — client is trusted for all scores | HIGH |
| 2 | No rate limit on game_scores INSERT — can flood the table | MEDIUM |
| 3 | Verification codes stored in localStorage, not server-side | MEDIUM |
| 4 | EmailJS credentials extractable from JS bundle | LOW |
| 5 | No HMAC/signature on localStorage data | LOW |
| 6 | No Content-Security-Policy header configured | LOW |
| 7 | `_escapeHtml()` exists but not applied everywhere usernames render | LOW-MEDIUM |

---

## 5. IMPROVEMENT ROADMAP

### Tier 1 — Quick Wins (No server changes needed)
- [ ] Add visual prefix indicator (glow boxes green when current prefix is in DICTIONARY)
- [ ] Logarithmic speed curve instead of linear
- [ ] Letter drought protection (force-spawn after 300px dry)
- [ ] Fix HI score position to avoid word-box overlap
- [ ] Freeze DICTIONARY after load (`DICTIONARY.add = undefined`)
- [ ] Apply `_escapeHtml()` to all innerHTML username injections

### Tier 2 — Game Feel Improvements
- [ ] Brief invulnerability during validation flash (pause scrolling for 300ms)
- [ ] Better on-screen rules/tutorial for Word Runner
- [ ] Smooth difficulty curve (logarithmic speed, gradual rock density increase)
- [ ] Object pooling for letters and particles
- [ ] Distance-based letter collection instead of AABB
- [ ] Safe area awareness for word boxes on notched devices

### Tier 3 — Server-Side Security (Requires Supabase Edge Functions)
- [ ] Server-side score plausibility validation
- [ ] Rate limiting on game_scores INSERT (1 per 30s per profile)
- [ ] Game session tokens (signed start → validated end)
- [ ] Server-side verification code generation
- [ ] Move EmailJS credentials to Edge Function
- [ ] Content-Security-Policy headers in netlify.toml

### Tier 4 — Architecture
- [ ] Split 14,600-line script.js into modules (game engines, UI, managers)
- [ ] Server-authoritative score calculation
- [ ] Anti-cheat telemetry (input pattern analysis, score distribution anomaly detection)
- [ ] Progressive dictionary loading (load common words first, rare words lazy)

---

## 6. RISK MATRIX

| Risk | Likelihood | Impact | Priority |
|------|-----------|--------|----------|
| Score injection via API | High | High (leaderboard integrity) | P0 |
| localStorage coin/XP manipulation | High | Medium (single-player) | P1 |
| Verification code brute-force | Medium | Medium (account creation gate) | P1 |
| XSS via username in innerHTML | Low | High (account takeover) | P1 |
| EmailJS credential abuse | Medium | Low (200 emails/mo cap) | P2 |
| Dictionary tampering | Low | Low (client-only impact) | P3 |
| Replay attacks on game_scores | Medium | Medium (XP/coin farming) | P1 |
| DDoS via leaderboard queries | Low | Medium (Supabase rate limits) | P2 |

---

*Generated: Comprehensive threat model covering client-side game logic, server-side database, authentication, scoring integrity, and deployment pipeline for the PLUMMET word game.*
