/* ========================================
   PLUMMET - Game Logic
   Pure vanilla JS, no dependencies.
   ======================================== */

// ────────────────────────────────────────
// DICTIONARY
// Loaded at startup from words.json (bundled, uppercase, 3+ letters).
// ────────────────────────────────────────
let DICTIONARY = new Set();
// Sets used for hint detection: sequences one letter away from a complete word
let HINT_PREFIXES = new Set(); // word.slice(0,-1): add one letter at the END to complete
let HINT_SUFFIXES = new Set(); // word.slice(1):    add one letter at the START to complete

function _buildHintSets() {
    HINT_PREFIXES = new Set();
    HINT_SUFFIXES = new Set();
    for (const word of DICTIONARY) {
        if (word.length >= 4) {
            HINT_PREFIXES.add(word.slice(0, -1));
            HINT_SUFFIXES.add(word.slice(1));
        }
    }
}

// ── Load dictionary from the bundled words.json ──
let WORD_CATEGORIES = {};   // { food: { label, icon, words: Set }, ... }

async function loadDictionary() {
    try {
        const resp = await fetch("./words.json");
        if (!resp.ok) throw new Error(`words.json fetch failed: ${resp.status}`);
        const data = await resp.json();
        // Support both old flat array and new {words, categories} format
        const words = Array.isArray(data) ? data : data.words;
        DICTIONARY = new Set(words);
        console.log(`Dictionary ready: ${DICTIONARY.size} valid words`);
        // Load categories if present
        if (data.categories) {
            for (const [key, cat] of Object.entries(data.categories)) {
                WORD_CATEGORIES[key] = { label: cat.label, icon: cat.icon, words: new Set(cat.words) };
            }
            console.log(`Categories loaded: ${Object.keys(WORD_CATEGORIES).length}`);
        }
    } catch (err) {
        console.error("Failed to load words.json; no words will be valid.", err);
        DICTIONARY = new Set();
    }
    _buildHintSets();
}

// ────────────────────────────────────────
// LETTER FREQUENCY WEIGHTS
// Tuned for playability: vowels very common, common consonants
// frequent, rare letters (Q, X, Z, J) almost never appear.
// Uses a cooldown system so no letter repeats too soon,
// and a deficit tracker to ensure every letter eventually appears.
// ────────────────────────────────────────
const LETTER_FREQ = {
    A:12, B:3, C:4, D:4, E:14, F:3, G:3, H:3, I:10, J:1,
    K:2,  L:6, M:4, N:7, O:10, P:4, Q:1, R:8, S:8, T:8,
    U:6,  V:2, W:3, X:1, Y:3, Z:1
};
const _FREQ_TOTAL = Object.values(LETTER_FREQ).reduce((a, b) => a + b, 0);
const _letterHistory = [];       // last N letters picked
const _HISTORY_MAX = 14;         // track last 14 letters for cooldown
const _letterCounts = {};        // how many times each letter has been picked
let _totalPicks = 0;

for (const ch of Object.keys(LETTER_FREQ)) _letterCounts[ch] = 0;

function randomLetter() {
    const letters = Object.keys(LETTER_FREQ);

    // Build effective weights: base frequency, smooth cooldown, deficit/surplus balancing
    const weights = [];
    for (const ch of letters) {
        let w = LETTER_FREQ[ch];

        // ── Smooth cooldown ──
        // Recently picked letters get a penalty that smoothly decays
        // using a power curve: near-zero for very recent, approaches 1.0
        // as the letter ages out of the history window.
        const histIdx = _letterHistory.lastIndexOf(ch);
        if (histIdx !== -1) {
            const recency = _letterHistory.length - histIdx; // 1 = most recent
            const cooldown = Math.pow(recency / _HISTORY_MAX, 1.5);
            w *= Math.max(cooldown, 0.005);
        }

        // ── Deficit / surplus balancing ──
        // Aggressively boost underrepresented letters and dampen
        // overrepresented ones to keep the distribution diverse.
        if (_totalPicks > 8) {
            const expected = (LETTER_FREQ[ch] / _FREQ_TOTAL) * _totalPicks;
            const actual = _letterCounts[ch];
            const ratio = expected > 0 ? actual / expected : 0;

            if (ratio < 0.25)      w *= 4.0;   // severely underrepresented
            else if (ratio < 0.5)  w *= 2.8;   // very underrepresented
            else if (ratio < 0.75) w *= 1.8;   // moderately underrepresented
            else if (ratio < 0.9)  w *= 1.3;   // slightly underrepresented
            else if (ratio > 2.0)  w *= 0.3;   // heavily overrepresented
            else if (ratio > 1.5)  w *= 0.5;   // quite overrepresented
            else if (ratio > 1.2)  w *= 0.7;   // somewhat overrepresented
        }

        // ── Never-seen guarantee ──
        // After enough picks, any letter that hasn't appeared at all
        // gets a strong floor boost so it actually shows up.
        if (_totalPicks >= 20 && _letterCounts[ch] === 0) {
            w = Math.max(w, 5);
        }

        weights.push(Math.max(w, 0.01)); // absolute floor
    }

    // Weighted random selection
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let picked = letters[0];
    for (let i = 0; i < letters.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { picked = letters[i]; break; }
    }

    // Update tracking
    _letterHistory.push(picked);
    if (_letterHistory.length > _HISTORY_MAX) _letterHistory.shift();
    _letterCounts[picked]++;
    _totalPicks++;

    return picked;
}

const WILDCARD_SYMBOL = "★";

function isWordLetter(value) {
    return typeof value === "string" && (/^[A-Z]$/.test(value) || value === WILDCARD_SYMBOL);
}

// Resolve wildcard characters (★) in a word string.
// If no wildcards, returns [word]. If wildcards, tries all 26 replacements.
// Only handles up to 2 wildcards to keep performance reasonable.
function _resolveWildcards(word) {
    const idx = word.indexOf(WILDCARD_SYMBOL);
    if (idx === -1) return [word];
    const results = [];
    for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const replaced = word.substring(0, idx) + letter + word.substring(idx + 1);
        const sub = _resolveWildcards(replaced);
        for (const s of sub) results.push(s);
    }
    return results;
}

const BONUS_TYPES = Object.freeze({
    LETTER_PICK: "letter-pick",
    BOMB: "bomb",
    WILDCARD: "wildcard",
    ROW_CLEAR: "row-clear",
    FREEZE: "freeze",
    SHUFFLE: "shuffle",
    SCORE_2X: "score-2x",
});

const GAME_MODES = Object.freeze({
    SANDBOX: "sandbox",
    TIMED: "timed",
});

const CHALLENGE_TYPES = Object.freeze({
    TARGET_WORD: "target-word",
    SPEED_ROUND: "speed-round",
    WORD_CATEGORY: "word-category",
});

const CHALLENGE_META = Object.freeze({
    [CHALLENGE_TYPES.TARGET_WORD]: {
        title: "Target Word",
        description: "Spell target words for bonus points! Spelling the target word earns 200 bonus points.",
        icon: "🎯",
    },
    [CHALLENGE_TYPES.SPEED_ROUND]: {
        title: "Speed Round",
        description: "Blocks fall faster and faster as your score climbs. How long can you survive?",
        icon: "⚡",
    },
    [CHALLENGE_TYPES.WORD_CATEGORY]: {
        title: "Word Category",
        description: "Choose a category and find matching words for bonus points! Harder categories earn more.",
        icon: "📂",
    },
});

const CHALLENGE_GRID_SIZES = [6, 7, 8];
const CHALLENGE_TIME_LIMIT = 7 * 60; // 7 minutes

// Category difficulty tiers — higher tier = harder words = more reward
// ptsMult applies to bonus-match scoring, xpMult applies to section 7 XP bonus
const CATEGORY_TIERS = Object.freeze({
    food:       { tier: 1, ptsMult: 1.0,  xpMult: 1.0,  label: "" },
    animals:    { tier: 2, ptsMult: 1.35, xpMult: 1.3,  label: "" },
    sports:     { tier: 2, ptsMult: 1.35, xpMult: 1.3,  label: "" },
    nature:     { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "Hard" },
    technology: { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "Hard" },
    adjectives: { tier: 3, ptsMult: 1.7,  xpMult: 1.6,  label: "Hard" },
});

const TIMED_MODE_OPTIONS_MINUTES = [1, 3, 5, 8, 10, 15, 20];

const BONUS_TYPE_POOL = [
    BONUS_TYPES.LETTER_PICK,
    BONUS_TYPES.BOMB,
    BONUS_TYPES.WILDCARD,
    BONUS_TYPES.ROW_CLEAR,
    BONUS_TYPES.FREEZE,
    BONUS_TYPES.SHUFFLE,
    BONUS_TYPES.SCORE_2X,
];

const BOMB_SYMBOL = "💣";
const BONUS_UNLOCK_SCORE_INTERVAL = 1000;
const FREEZE_DURATION = 10; // seconds
const STANDARD_CLEAR_FLASH_DURATION = 1.2;
const BOMB_CLEAR_FLASH_DURATION = 1.8;

// ────────────────────────────────────────
// LEVELING / XP SYSTEM
// ────────────────────────────────────────
const MAX_LEVEL = 500;

/** XP required to advance from `level` to `level + 1`. */
function xpRequiredForLevel(level) {
    return Math.floor(100 + 20 * Math.pow(Math.max(level - 1, 0), 1.3));
}

/**
 * Calculate XP earned from a single game using multi-factor analysis.
 *
 * Factors weighted:
 *   1. Base XP          – score^0.75 (diminishing returns via power curve)
 *   2. Grid difficulty   – 6/gridSize ratio (smaller grid = harder = more XP)
 *   3. Word quality      – average word length (sigmoid), longest word (log),
 *                          total words found (square root)
 *   4. Difficulty mode   – hard ×1.5
 *   5. Game mode         – timed ×1.3, challenge speed ×1.5, challenge target ×1.35
 *   6. Time pressure     – quadratic curve rewarding surviving longer in timed modes
 *   7. Target words      – logarithmic stacking bonus per target completed
 *   8. Performance vs PB – sigmoid curve (smooth bonus/penalty vs personal best)
 *   9. Level scaling     – log₁₀ progression to keep pace with rising thresholds
 */
function calculateGameXP({ score, wordsFound, gridSize, difficulty, gameMode,
                            isChallenge, challengeType, previousBest, playerLevel,
                            timeLimitSeconds, timeRemainingSeconds, targetWordsCompleted,
                            bonusWordsCompleted, categoryKey }) {
    if (score <= 0) return 1;

    // ═══ 1. BASE XP (power-curve diminishing returns) ═══
    // score^0.75 rewards all ranges while compressing extremes.
    // 100pts→16, 500pts→42, 1000pts→71, 2000pts→119, 5000pts→238
    let xp = Math.max(1, Math.floor(0.4 * Math.pow(score, 0.75)));

    // ═══ 2. GRID DIFFICULTY FACTOR ═══
    // Derived from cell-count ratio: fewer cells = harder placement.
    // 6×6 is the reference (1.0×). 3×3→2.0×, 4×4→1.5×, 5×5→1.2×,
    // 7×7→0.857×, 8×8→0.75×
    const gridFactor = 6 / gridSize;
    xp = Math.floor(xp * gridFactor);

    // ═══ 3. WORD QUALITY ANALYSIS ═══
    const wordEntries = Array.isArray(wordsFound) ? wordsFound : [];
    const wordLengths = wordEntries
        .map(w => (w.word || "").length)
        .filter(l => l > 0);
    const totalWords = wordLengths.length;

    if (totalWords > 0) {
        const avgLen = wordLengths.reduce((a, b) => a + b, 0) / totalWords;
        const longestLen = Math.max(...wordLengths);

        // a) Average word length bonus — sigmoid centered at 4.5 letters
        //    avgLen 3→+2%, 4→+10%, 5→+24%, 6+→+30%
        const avgBonus = 0.3 / (1 + Math.exp(-2 * (avgLen - 4.5)));

        // b) Longest word bonus — log scale, caps at +20%
        //    5-letter→+8%, 6→+13%, 7→+17%, 8+→+20%
        const longBonus = Math.min(0.2, Math.log2(Math.max(1, longestLen - 2)) * 0.07);

        // c) Word count bonus — sqrt diminishing returns (additive)
        //    5 words→+11xp, 10→+16, 20→+22, 50→+35
        const wordCountXP = Math.floor(5 * Math.sqrt(totalWords));

        xp = Math.floor(xp * (1 + avgBonus + longBonus)) + wordCountXP;
    }

    // ═══ 4. DIFFICULTY MULTIPLIER ═══
    if (difficulty === "hard") xp = Math.floor(xp * 1.5);

    // ═══ 5. GAME MODE MULTIPLIER ═══
    if (isChallenge) {
        xp = Math.floor(xp * (challengeType === CHALLENGE_TYPES.SPEED_ROUND ? 1.5 : 1.35));
    } else if (gameMode === GAME_MODES.TIMED) {
        xp = Math.floor(xp * 1.3);
    }

    // ═══ 6. TIME PRESSURE BONUS (timed modes only) ═══
    // Reward surviving longer — quadratic curve so the final stretch
    // of the timer is worth more than the opening seconds.
    // 0% used→1.0×, 50%→1.05×, 80%→1.13×, 100%→1.2×
    if (timeLimitSeconds > 0) {
        const timeUsed = Math.max(0, timeLimitSeconds - (timeRemainingSeconds || 0));
        const usageRatio = timeUsed / timeLimitSeconds;
        xp = Math.floor(xp * (1 + 0.2 * Math.pow(usageRatio, 2)));
    }

    // ═══ 7. TARGET / CATEGORY WORD BONUS ═══
    // Logarithmic stacking: each successive bonus word is worth more.
    // 1→+12xp, 3→+48, 5→+93, 10→+230
    // Category tier multiplies the bonus (tech/nature 1.6×, sports/animals 1.3×, food 1.0×)
    const isBonusChallenge = isChallenge && (
        challengeType === CHALLENGE_TYPES.TARGET_WORD
        || challengeType === CHALLENGE_TYPES.WORD_CATEGORY);
    const totalBonusWords = (targetWordsCompleted || 0) + (bonusWordsCompleted || 0);
    if (isBonusChallenge && totalBonusWords > 0) {
        const tierXpMult = (categoryKey && CATEGORY_TIERS[categoryKey])
            ? CATEGORY_TIERS[categoryKey].xpMult : 1.0;
        xp += Math.floor(totalBonusWords * 12
            * Math.log2(totalBonusWords + 1) * tierXpMult);
    }
    // Penalty: if no bonus words found in a bonus challenge, slash XP
    if (isBonusChallenge && totalBonusWords === 0) {
        xp = Math.floor(xp * 0.3);
    }

    // ═══ 8. PERFORMANCE VS PERSONAL BEST (sigmoid curve) ═══
    // Smooth continuous function instead of stepped brackets.
    if (previousBest > 0) {
        const ratio = score / previousBest;
        if (score > previousBest) {
            // New PB! Sigmoid bonus: smooth 1.0→1.7× as improvement grows.
            // 5% over PB→1.15×, 25% over→1.45×, 50%+ over→1.65×
            const improv = (score - previousBest) / previousBest;
            const pbBonus = 1 + 0.7 / (1 + Math.exp(-4 * (improv - 0.25)));
            xp = Math.floor(xp * pbBonus) + 50;
        } else {
            // Below PB: sigmoid penalty centered at 65% of best.
            // ratio 0.9→0.93×, 0.7→0.65×, 0.5→0.42×, 0.3→0.33×
            const penaltyMult = 0.3 + 0.7 / (1 + Math.exp(-7 * (ratio - 0.65)));
            xp = Math.floor(xp * penaltyMult);
        }
    }

    // ═══ 9. LEVEL SCALING ═══
    // Gentle log₁₀ progression so XP keeps pace with rising thresholds.
    // Lv1→1.0×, Lv10→1.27×, Lv50→1.46×, Lv100→1.54×, Lv500→1.73×
    const lvl = Math.max(1, playerLevel || 1);
    xp = Math.floor(xp * (1 + Math.log10(lvl) * 0.27));

    return Math.max(1, xp);
}

const BONUS_METADATA = Object.freeze({
    [BONUS_TYPES.LETTER_PICK]: {
        buttonLabel: "Bonus: Letter",
        buttonTitle: "Choose the next falling letter",
        modalTitle: "Choose Your Letter",
        modalText: "Pick the next falling letter for this drop.",
        acceptLabel: "",
        previewSymbol: "",
    },
    [BONUS_TYPES.BOMB]: {
        buttonLabel: "Bonus: Bomb",
        buttonTitle: "Replace the current falling letter with a bomb",
        modalTitle: "Bomb Bonus",
        modalText: "Accept to swap the current falling letter for a bomb. When it lands, every occupied cell in its row and column will explode and clear.",
        acceptLabel: "Accept",
        previewSymbol: BOMB_SYMBOL,
    },
    [BONUS_TYPES.WILDCARD]: {
        buttonLabel: "Bonus: Wild",
        buttonTitle: "Replace the current letter with a wildcard that matches any letter",
        modalTitle: "Wildcard Bonus",
        modalText: "Accept to turn the current falling block into a wildcard (★). It matches any letter when forming words!",
        acceptLabel: "Accept",
        previewSymbol: WILDCARD_SYMBOL,
    },
    [BONUS_TYPES.ROW_CLEAR]: {
        buttonLabel: "Bonus: Row",
        buttonTitle: "Drag across a row to clear it",
        modalTitle: "Row Clear Bonus",
        modalText: "Drag your finger or mouse across any row to clear it! Letters turn green as you drag. Swipe the entire row to complete the bonus.",
        acceptLabel: "Start Dragging",
        previewSymbol: "🧹",
    },
    [BONUS_TYPES.FREEZE]: {
        buttonLabel: "Bonus: Freeze",
        buttonTitle: "Pause block falling for 10 seconds",
        modalTitle: "Freeze Bonus",
        modalText: "Accept to freeze all block movement for 10 seconds. Take your time to plan your next move!",
        acceptLabel: "Freeze!",
        previewSymbol: "❄️",
    },
    [BONUS_TYPES.SHUFFLE]: {
        buttonLabel: "Bonus: Shuffle",
        buttonTitle: "Randomize all letters on the grid",
        modalTitle: "Shuffle Bonus",
        modalText: "Accept to randomly rearrange all the letters currently on the grid. Maybe you'll get luckier!",
        acceptLabel: "Shuffle!",
        previewSymbol: "🔀",
    },
    [BONUS_TYPES.SCORE_2X]: {
        buttonLabel: "Bonus: 2×",
        buttonTitle: "Double points for the next word you form",
        modalTitle: "Score Multiplier",
        modalText: "Accept to earn DOUBLE points on the next word you form!",
        acceptLabel: "Activate 2×",
        previewSymbol: "2×",
    },
});

function getMusicControlIcon(iconName) {
    const icons = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
        prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="2.2" height="14" rx="1"/><path d="M18.2 6v12l-8.1-6z"/><path d="M10.6 6v12l-8.1-6z"/></svg>',
        next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="17.8" y="5" width="2.2" height="14" rx="1"/><path d="M5.8 6v12l8.1-6z"/><path d="M13.4 6v12l8.1-6z"/></svg>',
    };
    return icons[iconName] || "";
}

function shuffleList(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
    }
    return shuffled;
}

function drawRandomBonusType(bonusBag, lastBonusType = null, recentHistory = []) {
    // Base weights for each bonus type (higher = more likely)
    const baseWeights = {
        [BONUS_TYPES.LETTER_PICK]: 18,
        [BONUS_TYPES.SCORE_2X]:    16,
        [BONUS_TYPES.FREEZE]:      14,
        [BONUS_TYPES.ROW_CLEAR]:   12,
        [BONUS_TYPES.WILDCARD]:    10,
        [BONUS_TYPES.SHUFFLE]:      8,
        [BONUS_TYPES.BOMB]:         7,
    };

    // Build effective weights with recency penalty
    const weights = {};
    for (const type of BONUS_TYPE_POOL) {
        weights[type] = baseWeights[type] || 10;
    }

    // Penalize recently awarded types (heavier penalty for more recent)
    for (let i = 0; i < recentHistory.length; i++) {
        const recent = recentHistory[i];
        if (weights[recent] !== undefined) {
            // Most recent gets heaviest penalty, older ones less
            const penalty = i === 0 ? 0.15 : i === 1 ? 0.4 : 0.7;
            weights[recent] *= penalty;
        }
    }

    // Never repeat the immediately previous bonus
    if (lastBonusType && weights[lastBonusType] !== undefined) {
        weights[lastBonusType] = 0;
    }

    // Weighted random selection
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let bonusType = BONUS_TYPE_POOL[0];
    for (const type of BONUS_TYPE_POOL) {
        roll -= weights[type];
        if (roll <= 0) { bonusType = type; break; }
    }

    // Update history (keep last 3)
    const nextHistory = [bonusType, ...recentHistory].slice(0, 3);

    return { bonusType, nextBag: bonusBag, nextHistory };
}

// Number of buffer rows above the grid where the block is visible but outside play area
const BUFFER_ROWS = 2;

// ────────────────────────────────────────
// GAME STATES
// ────────────────────────────────────────
const State = Object.freeze({ MENU: 0, PLAYING: 1, PAUSED: 2, CLEARING: 3, GAMEOVER: 4 });

// ────────────────────────────────────────
// AUDIO MANAGER  (Web Audio API, no files)
// ────────────────────────────────────────
class AudioManager {
    constructor() {
        this.muted = false;
        this.ctx = null;
    }

    _ensureCtx() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    _beep(freq, duration, type = "square", vol = 0.12) {
        if (this.muted) return;
        try {
            this._ensureCtx();
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain).connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (_) { /* ignore audio errors */ }
    }

    land()     { this._beep(220, 0.1, "triangle"); }
    clear()    { this._beep(660, 0.25, "sine", 0.15); }
    chain()    { this._beep(880, 0.3, "sine", 0.18); }
    bomb() {
        this._beep(140, 0.2, "sawtooth", 0.12);
        setTimeout(() => this._beep(90, 0.35, "triangle", 0.1), 80);
    }
    gameOver() {
        this._beep(200, 0.4, "sawtooth", 0.10);
        setTimeout(() => this._beep(150, 0.5, "sawtooth", 0.08), 400);
    }

    toggle() {
        this.muted = !this.muted;
        return this.muted;
    }
}

// ────────────────────────────────────────
// PARTICLE (simple clear effect)
// ────────────────────────────────────────
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 80;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 0.5 + Math.random() * 0.3;
        this.maxLife = this.life;
        this.radius = 2 + Math.random() * 3;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

// ────────────────────────────────────────
// FLOATING BACKGROUND LETTERS
// ────────────────────────────────────────
class FloatingLetter {
    constructor(w, h) {
        this.char = String.fromCharCode(65 + Math.floor(Math.random() * 26));
        this.x = Math.random() * w;
        this.y = h + 20;
        this.size = 14 + Math.random() * 22;
        this.alpha = 0.04 + Math.random() * 0.08;
        this.vy = -(8 + Math.random() * 18);
        this.vx = (Math.random() - 0.5) * 12;
        this.wobbleSpeed = 1 + Math.random() * 2;
        this.wobbleAmp = 8 + Math.random() * 15;
        this.rotation = (Math.random() - 0.5) * 0.6;
        this.rotSpeed = (Math.random() - 0.5) * 0.4;
        this.t = Math.random() * Math.PI * 2;
    }
    update(dt) {
        this.t += dt * this.wobbleSpeed;
        this.x += (this.vx + Math.sin(this.t) * this.wobbleAmp * 0.3) * dt;
        this.y += this.vy * dt;
        this.rotation += this.rotSpeed * dt;
    }
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.font = `bold ${this.size}px 'Segoe UI', sans-serif`;
        ctx.fillStyle = "#ffd700";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.char, 0, 0);
        ctx.restore();
    }
    get dead() { return this.y < -30; }
}

class BackgroundAnimation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.letters = [];
        this.confetti = [];
        this.running = false;
        this._animId = null;
        this._lastTime = 0;
        this._spawnTimer = 0;
        this._resize();
    }
    _resize() {
        const r = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = r.width;
        this.canvas.height = r.height;
    }
    start() {
        if (this.running) return;
        this.running = true;
        this._resize();
        this._lastTime = performance.now();
        this._tick = this._tick.bind(this);
        this._animId = requestAnimationFrame(this._tick);
    }
    stop() {
        this.running = false;
        if (this._animId) cancelAnimationFrame(this._animId);
        this._animId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    addConfetti(particles) {
        this.confetti.push(...particles);
    }
    _tick(now) {
        if (!this.running) return;
        const dt = Math.min((now - this._lastTime) / 1000, 0.1);
        this._lastTime = now;
        const w = this.canvas.width, h = this.canvas.height;

        this._spawnTimer -= dt;
        if (this._spawnTimer <= 0) {
            this.letters.push(new FloatingLetter(w, h));
            this._spawnTimer = 0.4 + Math.random() * 0.6;
        }

        this.ctx.clearRect(0, 0, w, h);
        for (let i = this.letters.length - 1; i >= 0; i--) {
            this.letters[i].update(dt);
            this.letters[i].draw(this.ctx);
            if (this.letters[i].dead) this.letters.splice(i, 1);
        }
        // Draw confetti on top of floating letters
        for (let i = this.confetti.length - 1; i >= 0; i--) {
            this.confetti[i].update(dt);
            this.confetti[i].draw(this.ctx);
            if (this.confetti[i].dead) this.confetti.splice(i, 1);
        }
        this._animId = requestAnimationFrame(this._tick);
    }
}

// ────────────────────────────────────────
// CONFETTI PARTICLE (game over celebration)
// ────────────────────────────────────────
class ConfettiParticle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const speed = 200 + Math.random() * 350;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.gravity = 250 + Math.random() * 100;
        this.life = 1.5 + Math.random() * 1.0;
        this.maxLife = this.life;
        this.size = 4 + Math.random() * 6;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 10;
        const colors = ["#ffd700", "#ff6b6b", "#4ecdc4", "#45b7d1", "#f9ca24", "#ff9ff3", "#54a0ff", "#5f27cd"];
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }
    update(dt) {
        this.x += this.vx * dt;
        this.vy += this.gravity * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        this.rotation += this.rotSpeed * dt;
    }
    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
        ctx.restore();
    }
    get dead() { return this.life <= 0; }
}

// ────────────────────────────────────────
// GRID  (data model + word detection)
// ────────────────────────────────────────
class Grid {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.cells = Array.from({ length: rows }, () => Array(cols).fill(null));
    }

    get(r, c) { return this.cells[r]?.[c] ?? null; }
    set(r, c, v) { if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) this.cells[r][c] = v; }
    inBounds(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols; }
    isEmpty(r, c) { return this.inBounds(r, c) && this.cells[r][c] === null; }
    isGridFull() {
        for (let c = 0; c < this.cols; c++) {
            if (this.isEmpty(0, c)) return false;
        }
        return true;
    }

    // 8 direction vectors (we only need 4 unique lines through a cell)
    static DIRS = [
        [0, 1],   // horizontal →
        [1, 0],   // vertical ↓
        [1, 1],   // diagonal ↘
        [1, -1],  // diagonal ↙
    ];

    // Find all valid words passing through (row, col). Returns { words: [...], cells: Set }
    findWordsThrough(row, col, minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();
        const wordCellMap = []; // [{word, cells: Set}]

        for (const [dr, dc] of Grid.DIRS) {
            // Walk backward to find start of contiguous segment
            let sr = row, sc = col;
            while (this.inBounds(sr - dr, sc - dc) && isWordLetter(this.get(sr - dr, sc - dc))) {
                sr -= dr;
                sc -= dc;
            }

            // Collect the full contiguous segment
            const segment = [];
            let cr = sr, cc = sc;
            while (this.inBounds(cr, cc) && isWordLetter(this.get(cr, cc))) {
                segment.push({ r: cr, c: cc, letter: this.get(cr, cc) });
                cr += dr;
                cc += dc;
            }

            if (segment.length < minWordLength) continue;

            // Check all substrings of length ≥ 3 in both forward AND reverse order.
            // Reverse is needed because letters stack bottom-up (e.g. CAT placed
            // naturally in a column reads T-A-C top-to-bottom, but CAT bottom-to-top).
            // Keep only the longest valid word per direction so that each direction
            // contributes independently to scoring.
            let bestWord = null;
            let bestCells = null;
            const reversed = [...segment].reverse();
            for (const seq of [segment, reversed]) {
                for (let start = 0; start < seq.length; start++) {
                    for (let end = start + minWordLength; end <= seq.length; end++) {
                        const sub = seq.slice(start, end);
                        const raw = sub.map(s => s.letter).join("");
                        const matches = _resolveWildcards(raw);
                        for (const word of matches) {
                            if (DICTIONARY.has(word)) {
                                if (!bestWord || word.length > bestWord.length) {
                                    bestWord = word;
                                    bestCells = sub;
                                }
                                break; // first match is enough for this substring
                            }
                        }
                    }
                }
            }

            if (bestWord) {
                foundWords.push(bestWord);
                const wordCells = new Set();
                for (const s of bestCells) {
                    const key = `${s.r},${s.c}`;
                    cellsToRemove.add(key);
                    wordCells.add(key);
                }
                wordCellMap.push({ word: bestWord, cells: wordCells });
            }
        }

        return { words: foundWords, cells: cellsToRemove, wordCellMap };
    }

    // Full-board scan for any valid words (used during chain reactions)
    findAllWords(minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();
        const allWordCellMap = [];

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (isWordLetter(this.cells[r][c])) {
                    const { words, cells, wordCellMap } = this.findWordsThrough(r, c, minWordLength);
                    for (const w of words) foundWords.push(w);
                    for (const cell of cells) cellsToRemove.add(cell);
                    for (const wc of wordCellMap) allWordCellMap.push(wc);
                }
            }
        }

        // Deduplicate: collapse identical word names, then remove any word
        // whose cells are a strict subset of a longer word on the same line.
        const seenKeys = new Set();
        let dedupedMap = [];
        for (const wc of allWordCellMap) {
            // Unique key = word + sorted cell keys (same word at same position)
            const cellKey = [...wc.cells].sort().join("|");
            const key = wc.word + "~" + cellKey;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                dedupedMap.push(wc);
            }
        }
        // Sort longest-first so the subset filter is order-independent
        dedupedMap.sort((a, b) => b.word.length - a.word.length);
        dedupedMap = dedupedMap.filter((wc, i) => {
            // Drop this word if a strictly longer word covers all its cells
            for (let j = 0; j < i; j++) {
                const longer = dedupedMap[j];
                if (longer.word.length > wc.word.length
                    && [...wc.cells].every(k => longer.cells.has(k))) {
                    return false;
                }
            }
            return true;
        });
        return { words: dedupedMap.map(wc => wc.word), cells: cellsToRemove, wordCellMap: dedupedMap };
    }

    // Remove cells and apply gravity. Returns list of gravity animations [{r,c,fromR}]
    removeCells(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            this.cells[r][c] = null;
        }
    }

    // Apply gravity, return animation descriptors
    applyGravity() {
        const moves = []; // {col, fromRow, toRow, letter}
        for (let c = 0; c < this.cols; c++) {
            let writeRow = this.rows - 1;
            for (let r = this.rows - 1; r >= 0; r--) {
                if (this.cells[r][c] !== null) {
                    if (r !== writeRow) {
                        moves.push({ col: c, fromRow: r, toRow: writeRow, letter: this.cells[r][c] });
                        this.cells[writeRow][c] = this.cells[r][c];
                        this.cells[r][c] = null;
                    }
                    writeRow--;
                }
            }
        }
        return moves;
    }
}

// ────────────────────────────────────────
// FALLING BLOCK
// ────────────────────────────────────────
class FallingBlock {
    constructor(letter, col, rows, kind = "letter") {
        this.letter = letter;
        this.kind = kind;
        this.col = col;
        this.row = -BUFFER_ROWS;  // spawn above the grid in the buffer zone
        this.maxRow = rows - 1;
        // Visual position for smooth interpolation (in cell units)
        this.visualRow = -BUFFER_ROWS;
        this.dropAnimating = false;
    }
}

// ────────────────────────────────────────
// RENDERER  (canvas drawing)
// ────────────────────────────────────────
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.particles = [];
        this.flashCells = new Set();   // cells flashing before removal
        this.flashTimer = 0;
        this.gravityAnims = [];        // {col, fromRow, toRow, letter, progress}
        this.shuffleAnims = [];        // {letter, fromRow, fromCol, toRow, toCol, progress}
        this.hintCells = new Set();    // cells glowing orange (hint mode)
        this.validatedCells = new Set(); // cells highlighted green (target word challenge)
        this.rowDragCells = new Set();   // cells highlighted green during row-drag bonus
        this.blastCells = new Set();
        this.blastCenterKey = null;
        this.blastProgress = 0;
    }

    // Convert pixel coordinates (relative to canvas) to grid row/col, or null if outside
    pixelToCell(px, py) {
        const col = Math.floor((px - this.offsetX) / this.cellSize);
        const row = Math.floor((py - this.offsetY) / this.cellSize);
        return { row, col };
    }

    getGhostRow(grid, block) {
        if (!block) return null;
        if (block.row < 0 && !grid.isEmpty(0, block.col)) return null;

        let landingRow = Math.max(0, block.row);
        while (landingRow + 1 < grid.rows && grid.isEmpty(landingRow + 1, block.col)) {
            landingRow++;
        }

        return landingRow;
    }

    // Resize canvas to fit wrapper while keeping square grid + buffer rows on top
    resize(rows, cols) {
        const totalRows = rows + BUFFER_ROWS;
        const wrapper = this.canvas.parentElement;
        const maxW = wrapper.clientWidth;
        const maxH = wrapper.clientHeight;
        const maxCellW = Math.floor(maxW / cols);
        const maxCellH = Math.floor(maxH / totalRows);
        this.cellSize = Math.min(maxCellW, maxCellH);
        const w = this.cellSize * cols;
        const h = this.cellSize * totalRows;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.offsetX = 0;
        // Grid starts below the buffer zone
        this.offsetY = this.cellSize * BUFFER_ROWS;
        this.totalH = h;
    }

    // Convert grid (row, col) to pixel center
    cellCenter(row, col) {
        return {
            x: this.offsetX + col * this.cellSize + this.cellSize / 2,
            y: this.offsetY + row * this.cellSize + this.cellSize / 2
        };
    }

    _getTokenFont(value, size) {
        const family = (value === BOMB_SYMBOL || value === WILDCARD_SYMBOL)
            ? '"Segoe UI Emoji", "Apple Color Emoji", sans-serif'
            : "monospace";
        return `bold ${Math.floor(size)}px ${family}`;
    }

    _drawToken(value, x, y, cellSize, color, scale = 1, alpha = 1) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.font = this._getTokenFont(value, cellSize * 0.55 * scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(value, x, y + 1);
        ctx.restore();
    }

    draw(grid, block, dt) {
        const ctx = this.ctx;
        const cs = this.cellSize;
        const rows = grid.rows;
        const cols = grid.cols;
        const w = cs * cols;
        const h = this.totalH || cs * (rows + BUFFER_ROWS);

        // Background (full canvas including buffer)
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, w, h);

        // Buffer zone subtle background
        ctx.fillStyle = "#151515";
        ctx.fillRect(0, 0, w, this.offsetY);

        // Separator line between buffer and grid
        ctx.strokeStyle = "#ffd70055";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.offsetY);
        ctx.lineTo(w, this.offsetY);
        ctx.stroke();

        // Grid cells
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = this.offsetX + c * cs;
                const y = this.offsetY + r * cs;
                const key = `${r},${c}`;

                // Cell background
                ctx.fillStyle = "#2a2a2a";
                ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);

                const isBlastCell = this.blastCells.has(key);

                if (isBlastCell) {
                    const pulse = 0.35 + 0.25 * Math.sin(this.blastProgress * Math.PI * 6);
                    ctx.fillStyle = `rgba(255, 120, 20, ${0.22 + pulse * 0.45})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = `rgba(255, 220, 120, ${0.4 + pulse * 0.35})`;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Hint border (orange) — one letter away from a word
                if (this.hintCells.has(key) && !this.flashCells.has(key) && !isBlastCell && !this.validatedCells.has(key)) {
                    ctx.strokeStyle = "rgba(255, 140, 0, 0.85)";
                    ctx.lineWidth = 3;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Validated cells glow (green) — tap to claim in Target Word challenge
                if (this.validatedCells.has(key) && !this.flashCells.has(key) && !isBlastCell) {
                    ctx.fillStyle = "rgba(0, 200, 80, 0.3)";
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = "rgba(0, 220, 100, 0.8)";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Row drag cells glow (green) — interactive row clear bonus
                if (this.rowDragCells.has(key) && !this.flashCells.has(key) && !isBlastCell) {
                    ctx.fillStyle = "rgba(0, 200, 80, 0.35)";
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = "rgba(0, 220, 100, 0.9)";
                    ctx.lineWidth = 2.5;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Flash effect
                if (this.flashCells.has(key) && !isBlastCell) {
                    const alpha = 0.5 + 0.5 * Math.sin(this.flashTimer * 15);
                    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                }

                // Letter
                const letter = grid.get(r, c);
                if (letter && this.shuffleAnims.length === 0) {
                    let color = "#fff";
                    if (this.rowDragCells.has(key) && !this.flashCells.has(key)) color = "#00e664"; // green for row drag
                    else if (this.validatedCells.has(key) && !this.flashCells.has(key)) color = "#00e664"; // green for validated
                    else if (letter === WILDCARD_SYMBOL && !this.flashCells.has(key)) color = "#da70d6"; // orchid purple for wildcards
                    let scale = 1;
                    let alpha = 1;
                    if (isBlastCell) {
                        if (key === this.blastCenterKey) {
                            scale = 0.95 + 0.12 * Math.sin(this.blastProgress * Math.PI * 4);
                        } else {
                            color = "#ffe082";
                            scale = Math.max(0.2, 1 - this.blastProgress * 0.55);
                            alpha = Math.max(0.12, 1 - this.blastProgress * 0.9);
                        }
                    }
                    this._drawToken(letter, x + cs / 2, y + cs / 2, cs, color, scale, alpha);
                }
            }
        }

        // Gravity animations (letters sliding down)
        for (const anim of this.gravityAnims) {
            const currentRow = anim.fromRow + (anim.toRow - anim.fromRow) * anim.progress;
            const x = this.offsetX + anim.col * cs;
            const y = this.offsetY + currentRow * cs;
            ctx.fillStyle = "#2a2a2a";
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            this._drawToken(anim.letter, x + cs / 2, y + cs / 2, cs, "#fff");
        }

        // Shuffle animations (letters flying to new positions)
        for (const anim of this.shuffleAnims) {
            if (anim.progress <= 0) continue;
            const t = anim.progress;
            // Ease-in-out for smooth arcing flight
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const curRow = anim.fromRow + (anim.toRow - anim.fromRow) * ease;
            const curCol = anim.fromCol + (anim.toCol - anim.fromCol) * ease;
            // Arc upward in the middle of the flight
            const arc = -1.5 * Math.sin(t * Math.PI);
            const x = this.offsetX + curCol * cs;
            const y = this.offsetY + (curRow + arc) * cs;
            const scale = 0.8 + 0.4 * Math.sin(t * Math.PI); // grow slightly mid-flight
            ctx.fillStyle = "#2a2a3e";
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            this._drawToken(anim.letter, x + cs / 2, y + cs / 2, cs, "#ffd700", scale);
        }

        // Grid lines
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX, this.offsetY + r * cs);
            ctx.lineTo(this.offsetX + cols * cs, this.offsetY + r * cs);
            ctx.stroke();
        }
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX + c * cs, this.offsetY);
            ctx.lineTo(this.offsetX + c * cs, this.offsetY + rows * cs);
            ctx.stroke();
        }

        const ghostRow = block ? this.getGhostRow(grid, block) : null;

        if (block && ghostRow !== null) {
            const ghostX = this.offsetX + block.col * cs;
            const ghostY = this.offsetY + ghostRow * cs;
            ctx.fillStyle = "rgba(255, 215, 0, 0.08)";
            ctx.fillRect(ghostX + 1, ghostY + 1, cs - 2, cs - 2);
            ctx.strokeStyle = "rgba(255, 215, 0, 0.45)";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(ghostX + 3, ghostY + 3, cs - 6, cs - 6);
            ctx.setLineDash([]);
            this._drawToken(block.letter, ghostX + cs / 2, ghostY + cs / 2, cs, "rgba(255, 215, 0, 0.45)");
        }

        // Falling block (smooth position)
        if (block) {
            const x = this.offsetX + block.col * cs;
            const y = this.offsetY + block.visualRow * cs;
            // Highlight border
            ctx.fillStyle = "#3a3520";
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.strokeStyle = "#ffd700";
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
            // Letter
            this._drawToken(block.letter, x + cs / 2, y + cs / 2, cs, "#ffd700");
        }

        // Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            this.particles[i].draw(ctx);
            if (this.particles[i].dead) this.particles.splice(i, 1);
        }
    }

    // Spawn particles at cell centers
    spawnParticles(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            const { x, y } = this.cellCenter(r, c);
            for (let i = 0; i < 6; i++) {
                this.particles.push(new Particle(x, y));
            }
        }
    }
}

// ────────────────────────────────────────
// DEFAULT TRACK LIST
// Auto-generated by running:  node scan-music.js
// The game tries to load Music/tracks.json at startup.
// If that fails (e.g. file:// protocol), it uses FALLBACK_TRACKS below.
// Update FALLBACK_TRACKS when you add/remove music files.
// ────────────────────────────────────────
const FALLBACK_TRACKS = [
    { id: "track01", title: "Red Velvet Cake", artist: "Freddy River", file: "Music/Red Velvet Cake.wav" },
];

let DEFAULT_TRACKS = [...FALLBACK_TRACKS];

// Try to load from tracks.json (works when served via HTTP, not file://)
async function loadTrackList() {
    try {
        const resp = await fetch("Music/tracks.json");
        if (!resp.ok) throw new Error(resp.status);
        const tracks = await resp.json();
        if (Array.isArray(tracks) && tracks.length > 0) {
            DEFAULT_TRACKS = tracks;
            console.log(`♪ Loaded ${tracks.length} track(s) from Music/tracks.json`);
            return;
        }
    } catch (_) {
        // fetch failed (file:// or missing) — use fallback
    }
    DEFAULT_TRACKS = [...FALLBACK_TRACKS];
    console.log(`♪ Using ${DEFAULT_TRACKS.length} fallback track(s).`);
}

// ────────────────────────────────────────
// PLAYLIST MANAGER (persists custom playlists & reorder to localStorage)
// ────────────────────────────────────────
class PlaylistManager {
    constructor(defaultTracks) {
        this.allTracks = defaultTracks;
        this.trackMap = new Map(defaultTracks.map(t => [t.id, t]));
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_playlists") || "null");
            if (data && data.version === 1) {
                this.defaultOrder = data.defaultOrder || this.allTracks.map(t => t.id);
                this.custom = data.custom || [];  // [{name, trackIds}]
            } else {
                this._reset();
            }
        } catch {
            this._reset();
        }
        this._cleanIds();
    }

    _reset() {
        this.defaultOrder = this.allTracks.map(t => t.id);
        this.custom = [];
    }

    // Remove any track IDs that no longer exist in allTracks
    _cleanIds() {
        const validIds = new Set(this.allTracks.map(t => t.id));
        this.defaultOrder = this.defaultOrder.filter(id => validIds.has(id));
        // Add any new tracks not in saved order
        for (const t of this.allTracks) {
            if (!this.defaultOrder.includes(t.id)) this.defaultOrder.push(t.id);
        }
        for (const pl of this.custom) {
            pl.trackIds = pl.trackIds.filter(id => validIds.has(id));
        }
    }

    _save() {
        localStorage.setItem("wf_playlists", JSON.stringify({
            version: 1,
            defaultOrder: this.defaultOrder,
            custom: this.custom,
        }));
    }

    getTrack(id) { return this.trackMap.get(id) || null; }

    getDefaultPlaylist() {
        return this.defaultOrder.map(id => this.trackMap.get(id)).filter(Boolean);
    }

    getCustomPlaylists() { return this.custom; }

    getPlaylistTracks(playlist) {
        if (playlist === "__default") return this.getDefaultPlaylist();
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? pl.trackIds.map(id => this.trackMap.get(id)).filter(Boolean) : [];
    }

    getPlaylistTrackIds(playlist) {
        if (playlist === "__default") return [...this.defaultOrder];
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? [...pl.trackIds] : [];
    }

    // Reorder a track within a playlist
    moveTrack(playlist, fromIndex, toIndex) {
        const ids = playlist === "__default" ? this.defaultOrder
            : this.custom.find(p => p.name === playlist)?.trackIds;
        if (!ids || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return;
        const [item] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, item);
        this._save();
    }

    createPlaylist(name, trackIds) {
        if (this.custom.some(p => p.name === name)) return false;
        this.custom.push({ name, trackIds: [...trackIds] });
        this._save();
        return true;
    }

    renamePlaylist(oldName, newName) {
        const pl = this.custom.find(p => p.name === oldName);
        if (!pl || this.custom.some(p => p.name === newName)) return false;
        pl.name = newName;
        this._save();
        return true;
    }

    deletePlaylist(name) {
        this.custom = this.custom.filter(p => p.name !== name);
        this._save();
    }

    removeTrackFromPlaylist(playlistName, trackId) {
        const pl = this.custom.find(p => p.name === playlistName);
        if (!pl) return;
        pl.trackIds = pl.trackIds.filter(id => id !== trackId);
        this._save();
    }
}

// ────────────────────────────────────────
// MUSIC MANAGER (handles audio playback)
// ────────────────────────────────────────
class MusicManager {
    constructor(playlistManager) {
        this.plMgr = playlistManager;
        this.audio = new Audio();
        this.audio.volume = 0.5;
        this.playing = false;
        this.currentTrackId = null;
        this.activePlaylist = "__default"; // name of active playlist
        this.queue = [];       // ordered track IDs for current playlist
        this.queueIndex = -1;

        // Auto-advance to next track
        this.audio.addEventListener("ended", () => this.next());

        // Callbacks for UI updates
        this.onStateChange = null;  // () => void
        this.onTimeUpdate = null;   // (currentTime, duration) => void

        this._lastSavedTime = 0; // throttle position saves
        this.audio.addEventListener("timeupdate", () => {
            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
            }
            // Save playback position every 3 seconds
            const now = Date.now();
            if (now - this._lastSavedTime > 3000) {
                this._lastSavedTime = now;
                this._saveMusicState();
            }
        });

        // Build initial queue
        this._buildQueue();

        // Restore previous session's music state
        this._restoreMusicState();
    }

    _buildQueue() {
        this.queue = this.plMgr.getPlaylistTrackIds(this.activePlaylist);
    }

    setActivePlaylist(name) {
        this.activePlaylist = name;
        this._buildQueue();
        // If a track is playing that's still in this playlist, keep playing it
        if (this.currentTrackId) {
            const idx = this.queue.indexOf(this.currentTrackId);
            if (idx >= 0) { this.queueIndex = idx; return; }
        }
        // Otherwise reset
        this.queueIndex = -1;
    }

    refreshQueue() {
        this._buildQueue();
        if (this.currentTrackId) {
            const idx = this.queue.indexOf(this.currentTrackId);
            if (idx >= 0) this.queueIndex = idx;
        }
    }

    playTrackById(trackId) {
        const track = this.plMgr.getTrack(trackId);
        if (!track) return;
        const idx = this.queue.indexOf(trackId);
        if (idx >= 0) this.queueIndex = idx;
        else {
            // Track not in current queue—switch to default and find it
            this.setActivePlaylist("__default");
            this.queueIndex = this.queue.indexOf(trackId);
        }
        this.currentTrackId = trackId;
        this.audio.src = track.file;
        this.audio.muted = !!this.muted;
        this.audio.play().catch(() => {});
        this.playing = true;
        this._saveMusicState();
        this._notify();
    }

    play() {
        if (this.currentTrackId) {
            this.audio.play().catch(() => {});
            this.playing = true;
            localStorage.setItem("wf_music_paused", "0");
            this._notify();
        } else if (this.queue.length > 0) {
            this.queueIndex = 0;
            this.playTrackById(this.queue[0]);
        }
    }

    pause() {
        this.audio.pause();
        this.playing = false;
        this._saveMusicState();
        localStorage.setItem("wf_music_paused", "1");
        this._notify();
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    next() {
        if (this.queue.length === 0) return;
        this.queueIndex = (this.queueIndex + 1) % this.queue.length;
        this.playTrackById(this.queue[this.queueIndex]);
    }

    prev() {
        if (this.queue.length === 0) return;
        // If more than 3 seconds in, restart current; otherwise go to previous
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
        this.playTrackById(this.queue[this.queueIndex]);
    }

    seek(fraction) {
        if (this.audio.duration) {
            this.audio.currentTime = fraction * this.audio.duration;
        }
    }

    setMuted(muted) {
        this.muted = muted;
        this.audio.muted = muted;
    }

    getCurrentTrack() {
        return this.currentTrackId ? this.plMgr.getTrack(this.currentTrackId) : null;
    }

    _saveMusicState() {
        if (!this.currentTrackId) return;
        localStorage.setItem("wf_music_state", JSON.stringify({
            trackId: this.currentTrackId,
            position: this.audio.currentTime || 0,
            playlist: this.activePlaylist,
            queueIndex: this.queueIndex,
        }));
    }

    _restoreMusicState() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_music_state") || "null");
            if (!data || !data.trackId) return;
            const track = this.plMgr.getTrack(data.trackId);
            if (!track) return;

            // Restore playlist context
            if (data.playlist) {
                this.activePlaylist = data.playlist;
                this._buildQueue();
            }

            // Set up track without auto-playing
            this.currentTrackId = data.trackId;
            const idx = this.queue.indexOf(data.trackId);
            this.queueIndex = idx >= 0 ? idx : (data.queueIndex || 0);
            this.audio.src = track.file;
            this.audio.muted = !!this.muted;

            // Seek to saved position once audio is ready
            if (data.position > 0) {
                const seekOnce = () => {
                    this.audio.currentTime = data.position;
                    this.audio.removeEventListener("canplay", seekOnce);
                };
                this.audio.addEventListener("canplay", seekOnce);
            }

            // Don't auto-play here; _autoplayMusicFromUserAction will handle that
            this.playing = false;
            this._notify();
        } catch {}
    }

    _notify() {
        if (this.onStateChange) this.onStateChange();
    }
}

// ────────────────────────────────────────
// PROFILE MANAGER (multiple save files, localStorage)
// Each profile stores: username, highScore, gamesPlayed, totalWords, gridSize, difficulty, gameMode
// ────────────────────────────────────────
class ProfileManager {
    constructor() {
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_profiles") || "null");
            if (data && data.version === 1) {
                this.profiles = data.profiles || [];
                this.activeId = data.activeId || null;
            } else {
                this.profiles = [];
                this.activeId = null;
            }
        } catch {
            this.profiles = [];
            this.activeId = null;
        }
    }

    _save() {
        localStorage.setItem("wf_profiles", JSON.stringify({
            version: 1,
            profiles: this.profiles,
            activeId: this.activeId,
        }));
    }

    getAll() { return this.profiles; }

    getActive() {
        return this.profiles.find(p => p.id === this.activeId) || null;
    }

    create(username) {
        const id = "prof_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const profile = {
            id,
            username,
            highScore: 0,
            gamesPlayed: 0,
            totalWords: 0,
            uniqueWordsFound: [],
            gridSize: 5,
            difficulty: "casual",
            gameMode: GAME_MODES.SANDBOX,
            createdAt: Date.now(),
            level: 1,
            xp: 0,
            totalXp: 0,
            bestScores: {},
        };
        this.profiles.push(profile);
        this.activeId = id;
        this._save();
        return profile;
    }

    select(id) {
        const p = this.profiles.find(p => p.id === id);
        if (p) {
            this.activeId = id;
            this._save();
        }
        return p;
    }

    delete(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        if (this.activeId === id) {
            this.activeId = this.profiles.length > 0 ? this.profiles[0].id : null;
        }
        this._save();
    }

    // Update stats for the active profile after a game ends
    recordGame(score, wordsFound) {
        const p = this.getActive();
        if (!p) return;
        p.gamesPlayed++;
        p.totalWords += wordsFound.length;
        if (!Array.isArray(p.uniqueWordsFound)) p.uniqueWordsFound = [];
        const uniqueSet = new Set(p.uniqueWordsFound);
        for (const { word } of wordsFound) uniqueSet.add(word);
        p.uniqueWordsFound = [...uniqueSet];
        if (score > p.highScore) p.highScore = score;
        this._save();
    }

    // Save preferred grid size for the active profile
    setGridSize(size) {
        const p = this.getActive();
        if (!p) return;
        p.gridSize = size;
        this._save();
    }

    // Save preferred difficulty for the active profile
    setDifficulty(difficulty) {
        const p = this.getActive();
        if (!p) return;
        p.difficulty = difficulty;
        this._save();
    }

    setGameMode(gameMode) {
        const p = this.getActive();
        if (!p) return;
        p.gameMode = gameMode;
        this._save();
    }

    getChallengeStats(challengeType) {
        const p = this.getActive();
        if (!p) return { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [] };
        if (!p.challengeStats) p.challengeStats = {};
        return p.challengeStats[challengeType] || { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [] };
    }

    recordChallengeGame(challengeType, score, wordsFound) {
        const p = this.getActive();
        if (!p) return;
        if (!p.challengeStats) p.challengeStats = {};
        if (!p.challengeStats[challengeType]) {
            p.challengeStats[challengeType] = { highScore: 0, gamesPlayed: 0, totalWords: 0, uniqueWordsFound: [] };
        }
        const cs = p.challengeStats[challengeType];
        cs.gamesPlayed++;
        cs.totalWords += wordsFound.length;
        if (!Array.isArray(cs.uniqueWordsFound)) cs.uniqueWordsFound = [];
        const uniqueSet = new Set(cs.uniqueWordsFound);
        for (const { word } of wordsFound) uniqueSet.add(word);
        cs.uniqueWordsFound = [...uniqueSet];
        if (score > cs.highScore) cs.highScore = score;
        this._save();
    }

    hasProfiles() { return this.profiles.length > 0; }

    /** Ensure legacy profiles have XP fields. */
    _ensureXPFields(p) {
        if (!p) return;
        if (p.level === undefined) p.level = 1;
        if (p.xp === undefined) p.xp = 0;
        if (p.totalXp === undefined) p.totalXp = 0;
        if (!p.bestScores) p.bestScores = {};
    }

    /** Build a key for bestScores lookup. */
    bestScoreKey(gridSize, difficulty, gameMode, isChallenge, challengeType) {
        if (isChallenge) return `ch-${challengeType}`;
        return `${gridSize}-${difficulty}-${gameMode}`;
    }

    /** Get the best score for a specific mode combination. */
    getBestScore(key) {
        const p = this.getActive();
        if (!p) return 0;
        this._ensureXPFields(p);
        return p.bestScores[key] || 0;
    }

    /** Update best score if new score is higher. */
    updateBestScore(key, score) {
        const p = this.getActive();
        if (!p) return;
        this._ensureXPFields(p);
        if (score > (p.bestScores[key] || 0)) {
            p.bestScores[key] = score;
            this._save();
        }
    }

    /** Check if the active profile has ZERO game history (truly brand new). */
    isFirstGameEver() {
        const p = this.getActive();
        if (!p) return false;
        if (p.gamesPlayed > 0) return false;
        if (p.challengeStats) {
            for (const key of Object.keys(p.challengeStats)) {
                if (p.challengeStats[key].gamesPlayed > 0) return false;
            }
        }
        return true;
    }

    /**
     * Award XP to the active profile. Returns info about the result.
     * @param {number} amount - XP to add
     * @returns {{ leveled, oldLevel, newLevel, oldXp, newXp, oldXpReq, newXpReq, totalXp }}
     */
    awardXP(amount) {
        const p = this.getActive();
        if (!p) return { leveled: false, oldLevel: 1, newLevel: 1, oldXp: 0, newXp: 0, oldXpReq: 100, newXpReq: 100, totalXp: 0 };
        this._ensureXPFields(p);

        const oldLevel = p.level;
        const oldXp = p.xp;
        const oldXpReq = xpRequiredForLevel(p.level);

        p.totalXp += amount;
        p.xp += amount;

        let leveled = false;
        while (p.level < MAX_LEVEL && p.xp >= xpRequiredForLevel(p.level)) {
            p.xp -= xpRequiredForLevel(p.level);
            p.level++;
            leveled = true;
        }
        // Cap at max level
        if (p.level >= MAX_LEVEL) {
            p.level = MAX_LEVEL;
            p.xp = 0;
        }

        this._save();

        return {
            leveled,
            oldLevel,
            newLevel: p.level,
            oldXp,
            newXp: p.xp,
            oldXpReq,
            newXpReq: xpRequiredForLevel(p.level),
            totalXp: p.totalXp,
        };
    }

    /** Get level info for the active profile. */
    getLevelInfo() {
        const p = this.getActive();
        if (!p) return { level: 1, xp: 0, xpRequired: 100, totalXp: 0 };
        this._ensureXPFields(p);
        return {
            level: p.level,
            xp: p.xp,
            xpRequired: xpRequiredForLevel(p.level),
            totalXp: p.totalXp,
        };
    }
}

// ────────────────────────────────────────
// GAME
// ────────────────────────────────────────
class Game {
    constructor() {
        this.audio = new AudioManager();
        this.canvas = document.getElementById("game-canvas");
        this.renderer = new Renderer(this.canvas);
        this.usesTouchSwipeInput = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;

        // Music system
        this.plMgr = new PlaylistManager(DEFAULT_TRACKS);
        this.music = new MusicManager(this.plMgr);
        this.activePlaylistTab = "__default";
        this._editingPlaylist = null;

        // Profile system
        this.profileMgr = new ProfileManager();

        // UI elements
        this.els = {
            profilesScreen: document.getElementById("profiles-screen"),
            profilesList:   document.getElementById("profiles-list"),
            newProfileBtn:  document.getElementById("new-profile-btn"),
            profileModal:   document.getElementById("profile-modal"),
            profileModalTitle: document.getElementById("profile-modal-title"),
            profileNameInput: document.getElementById("profile-name-input"),
            profileSaveBtn: document.getElementById("profile-save-btn"),
            profileCancelBtn: document.getElementById("profile-cancel-btn"),
            menuScreen:     document.getElementById("menu-screen"),
            menuProfileName: document.getElementById("menu-profile-name"),
            switchProfileBtn: document.getElementById("switch-profile-btn"),
            menuGamesPlayed: document.getElementById("menu-games-played"),
            menuTotalWords: document.getElementById("menu-total-words"),
            playScreen:     document.getElementById("play-screen"),
            canvasWrapper:  document.getElementById("canvas-wrapper"),
            gameoverScreen: document.getElementById("gameover-screen"),
            musicScreen:    document.getElementById("music-screen"),
            pauseOverlay:   document.getElementById("pause-overlay"),
            timeSelectModal: document.getElementById("time-select-modal"),
            timeSelectCancelBtn: document.getElementById("time-select-cancel-btn"),
            gameTimer: document.getElementById("game-timer"),
            timerScoreItem: document.getElementById("timer-score-item"),
            letterChoiceModal: document.getElementById("letter-choice-modal"),
            letterChoiceTitle: document.getElementById("letter-choice-title"),
            letterChoiceText: document.getElementById("letter-choice-text"),
            letterChoicePreview: document.getElementById("letter-choice-preview"),
            letterChoiceGrid: document.getElementById("letter-choice-grid"),
            letterChoiceCloseBtn: document.getElementById("letter-choice-close-btn"),
            letterChoiceAcceptBtn: document.getElementById("letter-choice-accept-btn"),
            letterChoiceLaterBtn: document.getElementById("letter-choice-later-btn"),
            playlistModal:  document.getElementById("playlist-modal"),
            menuHighScore:  document.getElementById("menu-high-score"),
            playHighScore:  document.getElementById("play-high-score"),
            currentScore:   document.getElementById("current-score"),
            finalScore:     document.getElementById("final-score-text"),
            newHighScore:   document.getElementById("new-high-score-text"),
            bonusBtn:       document.getElementById("bonus-btn"),
            startBtn:       document.getElementById("start-btn"),
            resumeGameBtn:  document.getElementById("resume-game-btn"),
            restartBtn:     document.getElementById("restart-btn"),
            menuBtn:        document.getElementById("menu-btn"),
            pauseBtn:       document.getElementById("pause-btn"),
            hintsBtn:       document.getElementById("hints-btn"),
            resumeBtn:      document.getElementById("resume-btn"),
            pauseWordsFoundBtn: document.getElementById("pause-words-found-btn"),
            pauseMusicBtn:  document.getElementById("pause-music-btn"),
            quitBtn:        document.getElementById("quit-btn"),
            globalMuteBtn:  document.getElementById("global-mute-btn"),
            nextLetter:     document.getElementById("next-letter"),
            playWordsFoundBtn: document.getElementById("play-words-found-btn"),
            btnLeft:        document.getElementById("btn-left"),
            btnRight:       document.getElementById("btn-right"),
            btnDrop:        document.getElementById("btn-drop"),
            // Music
            musicMenuBtn:   document.getElementById("music-menu-btn"),
            musicBackBtn:   document.getElementById("music-back-btn"),
            npTitle:        document.getElementById("np-title"),
            npArtist:       document.getElementById("np-artist"),
            npPrev:         document.getElementById("np-prev"),
            npPlay:         document.getElementById("np-play"),
            npNext:         document.getElementById("np-next"),
            npProgressBar:  document.getElementById("np-progress-bar"),
            npProgressFill: document.getElementById("np-progress-fill"),
            npCurrentTime:  document.getElementById("np-current-time"),
            npDuration:     document.getElementById("np-duration"),
            playlistTabs:   document.getElementById("playlist-tabs"),
            newPlaylistTab: document.getElementById("new-playlist-tab"),
            trackList:      document.getElementById("track-list"),
            playlistActions: document.getElementById("playlist-actions"),
            editSongsBtn:      document.getElementById("edit-songs-btn"),
            renamePlaylistBtn: document.getElementById("rename-playlist-btn"),
            deletePlaylistBtn: document.getElementById("delete-playlist-btn"),
            playlistModalTitle: document.getElementById("playlist-modal-title"),
            playlistNameInput: document.getElementById("playlist-name-input"),
            playlistTrackPicker: document.getElementById("playlist-track-picker"),
            playlistSaveBtn: document.getElementById("playlist-save-btn"),
            playlistCancelBtn: document.getElementById("playlist-cancel-btn"),
            npMiniTitle:    document.getElementById("np-mini-title"),
            npMiniPrev:     document.getElementById("np-mini-prev"),
            npMiniToggle:   document.getElementById("np-mini-toggle"),
            npMiniNext:     document.getElementById("np-mini-next"),
            // Words Found
            wordsFoundScreen: document.getElementById("words-found-screen"),
            wordsFoundBtn:    document.getElementById("words-found-btn"),
            wordsFoundBackBtn: document.getElementById("words-found-back-btn"),
            wordsFoundTitle:  document.getElementById("words-found-title"),
            wordsFoundCount:  document.getElementById("words-found-count"),
            wordsFoundList:   document.getElementById("words-found-list"),
            wfDots:           document.getElementById("wf-dots"),
            wfSlideView:      document.getElementById("wf-slide-view"),
            wfSlideStrip:     document.getElementById("wf-slide-strip"),
            bonusWordsCount:  document.getElementById("bonus-words-count"),
            bonusWordsList:   document.getElementById("bonus-words-list"),
            gameModeSelector: document.getElementById("game-mode-selector"),
            difficultySelector: document.getElementById("difficulty-selector"),
            wordPopup: document.getElementById("word-popup"),
            // Tutorial
            tutorialBtnProfiles: document.getElementById("tutorial-btn-profiles"),
            tutorialBtnMenu: document.getElementById("tutorial-btn-menu"),
            tutorialOverlay: document.getElementById("tutorial-overlay"),
            tutorialMenu: document.getElementById("tutorial-menu"),
            tutorialMenuList: document.getElementById("tutorial-menu-list"),
            tutorialCloseBtn: document.getElementById("tutorial-close-btn"),
            tutorialSlides: document.getElementById("tutorial-slides"),
            tutorialBackBtn: document.getElementById("tutorial-back-btn"),
            tutorialSlidesCloseBtn: document.getElementById("tutorial-slides-close-btn"),
            tutorialSlideView: document.getElementById("tutorial-slide-view"),
            tutorialSlideStrip: document.getElementById("tutorial-slide-strip"),
            tutorialDots: document.getElementById("tutorial-dots"),
            tutorialCounter: document.getElementById("tutorial-counter"),
            tutorialPrevBtn: document.getElementById("tutorial-prev-btn"),
            tutorialNextBtn: document.getElementById("tutorial-next-btn"),
            // Challenges
            challengesBtn: document.getElementById("challenges-btn"),
            challengesScreen: document.getElementById("challenges-screen"),
            challengesBackBtn: document.getElementById("challenges-back-btn"),
            challengesGrid: document.getElementById("challenges-grid"),
            challengeSetupScreen: document.getElementById("challenge-setup-screen"),
            challengeSetupName: document.getElementById("challenge-setup-name"),
            challengeCategorySelector: document.getElementById("challenge-category-selector"),
            challengeCategoryButtons: document.getElementById("challenge-category-buttons"),
            challengeStartBtn: document.getElementById("challenge-start-btn"),
            challengeResumeBtn: document.getElementById("challenge-resume-btn"),
            challengeBackToSelectBtn: document.getElementById("challenge-back-to-select-btn"),
            challengeSetupMusicBtn: document.getElementById("challenge-setup-music-btn"),
            challengesMusicBtn: document.getElementById("challenges-music-btn"),
            challengeMainMenuBtn: document.getElementById("challenge-main-menu-btn"),
            challengeTutorialBtn: document.getElementById("challenge-tutorial-btn"),
            challengeTutorialOverlay: document.getElementById("challenge-tutorial-overlay"),
            challengeTutorialTitle: document.getElementById("challenge-tutorial-title"),
            challengeTutorialText: document.getElementById("challenge-tutorial-text"),
            challengeTutorialCanvas: document.getElementById("challenge-tutorial-canvas"),
            challengeTutorialCloseBtn: document.getElementById("challenge-tutorial-close-btn"),
            targetWordDisplay: document.getElementById("target-word-display"),
            targetWordText: document.getElementById("target-word-text"),
            freezeIndicator: document.getElementById("freeze-indicator"),
            freezeTimer: document.getElementById("freeze-timer"),
            score2xIndicator: document.getElementById("score-2x-indicator"),
            rowDragIndicator: document.getElementById("row-drag-indicator"),
            bgCanvas: document.getElementById("bg-canvas"),
            // Level / XP
            levelBar: document.getElementById("level-bar"),
            levelText: document.getElementById("level-text"),
            xpBarFill: document.getElementById("xp-bar-fill"),
            xpText: document.getElementById("xp-text"),
            menuLevelNum: document.getElementById("menu-level-num"),
            menuXpBarFill: document.getElementById("menu-xp-bar-fill"),
            menuXpText: document.getElementById("menu-xp-text"),
            xpEarnedDisplay: document.getElementById("xp-earned-display"),
            xpEarnedText: document.getElementById("xp-earned-text"),
            gameoverLevelText: document.getElementById("gameover-level-text"),
            gameoverXpBarFill: document.getElementById("gameover-xp-bar-fill"),
            levelUpOverlay: document.getElementById("level-up-overlay"),
            levelUpLevel: document.getElementById("level-up-level"),
            levelUpBarFill: document.getElementById("level-up-bar-fill"),
            levelUpOkBtn: document.getElementById("level-up-ok-btn"),
            xpTutorialOverlay: document.getElementById("xp-tutorial-overlay"),
            xpTutorialCanvas: document.getElementById("xp-tutorial-canvas"),
            xpTutorialOkBtn: document.getElementById("xp-tutorial-ok-btn"),
        };

        this.state = State.MENU;
        this.gridSize = 5;
        this.difficulty = "casual";
        this.gameMode = GAME_MODES.SANDBOX;
        this.pendingStartMode = null;
        this.timeLimitSeconds = 0;
        this.timeRemainingSeconds = 0;
        this.highScore = 0;
        this.score = 0;
        this.grid = null;
        this.block = null;
        this.nextLetter = randomLetter();
        this.fallInterval = 0.5; // seconds per row
        this.fallTimer = 0;
        this.spawnFreezeTimer = 0; // 2s pause at top before falling
        this.lastTime = 0;
        this._autoSaveTimer = 0;

        // Clearing / chain state
        this.clearing = false;
        this.clearPhase = ""; // "flash", "gravity", "check"
        this.clearTimer = 0;
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.pendingGravityMoves = [];
        this.foundWordsThisGame = new Set();
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.wordsFoundBackTarget = "gameover";
        this.wordsFoundResumeState = null;
        this.swipeState = null;

        // New bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;

        // Row drag state
        this.rowDragActive = false;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;

        // Challenge state
        this.activeChallenge = null; // null or CHALLENGE_TYPES value
        this._gameOverChallenge = null;
        this._gameOverCategoryKey = null;
        this.challengeGridSize = 7;
        this.targetWord = null;
        this.targetWordsCompleted = 0;
        this.speedRoundBaseInterval = 0.9;
        this._challengePreviewAnimations = [];

        // Target Word challenge: tap-to-claim state
        this._validatedWordGroups = []; // [{word, cells: Set of "r,c", pts}]
        this._claimAnimating = false;

        document.body.classList.toggle("touch-input", this.usesTouchSwipeInput);

        this._bindUI();
        this._bindInput();
        this._bindMusic();
        this._bindProfiles();
        this._bindLetterChoice();
        this._bindCanvasTap();
        this._bindRowDrag();
        this._bindLevelUpUI();
        this._initMutePref();
        this.hintsEnabled = localStorage.getItem("wf_hints_enabled") === "1";
        this._updateHintsBtn();

        // Show profiles screen or menu depending on whether a profile is active
        if (this.profileMgr.getActive()) {
            this._loadActiveProfile();
            this._showScreen("menu");
        } else {
            this._showScreen("profiles");
        }
        this._highlightSizeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();

        // Music UI callbacks
        this.music.onStateChange = () => this._updateMusicUI();
        this.music.onTimeUpdate = (cur, dur) => this._updateMusicProgress(cur, dur);

        // Music starts when the player presses Start (see _startGame)

        // Background floating letters animation
        this.bgAnim = new BackgroundAnimation(this.els.bgCanvas);
        this.bgAnim.start();

        // Confetti state (handled by bgAnim)

        // Wrap title letters for wave animation
        this._wrapTitleLetters();

        // Start RAF loop
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── UI binding ──
    _bindUI() {
        // Grid size buttons
        document.querySelectorAll(".size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const size = parseInt(btn.dataset.size, 10);
                if (btn.disabled) return;
                this.gridSize = size;
                this.profileMgr.setGridSize(this.gridSize);
                this._highlightSizeButton();
                this._updateDifficultySelector();
            });
        });

        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.difficulty = btn.dataset.difficulty || "casual";
                this.profileMgr.setDifficulty(this.difficulty);
                // If switching to Hard and grid is too small, bump to 6
                if (this.difficulty === "hard" && this.gridSize < 6) {
                    this.gridSize = 6;
                    this.profileMgr.setGridSize(this.gridSize);
                }
                this._highlightDifficultyButton();
                this._highlightSizeButton();
            });
        });

        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.gameMode = btn.dataset.mode || GAME_MODES.SANDBOX;
                this.profileMgr.setGameMode(this.gameMode);
                this._highlightGameModeButton();
            });
        });

        this.els.startBtn.addEventListener("click", () => this._startGame());
        this.els.resumeGameBtn.addEventListener("click", () => this._resumeGame());
        this.els.restartBtn.addEventListener("click", () => {
            if (this._gameOverChallenge) {
                this.activeChallenge = this._gameOverChallenge;
                this._gameOverChallenge = null;
                this._gameOverCategoryKey = null;
                this._startChallengeGame();
            } else {
                this._startGame();
            }
        });
        this.els.menuBtn.addEventListener("click", () => {
            if (this._gameOverChallenge) {
                this._gameOverChallenge = null;
                this._gameOverCategoryKey = null;
                this._showScreen("challenges");
            } else {
                this._showScreen("menu");
            }
        });
        this.els.pauseBtn.addEventListener("click", () => this._togglePause());
        this.els.hintsBtn.addEventListener("click", () => {
            this.hintsEnabled = !this.hintsEnabled;
            localStorage.setItem("wf_hints_enabled", this.hintsEnabled ? "1" : "0");
            this._updateHintsBtn();
            this._computeHintCells();
        });
        this.els.resumeBtn.addEventListener("click", () => this._togglePause());
        this.els.pauseWordsFoundBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._openWordsFound("pause");
        });
        this.els.pauseMusicBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._musicBackTarget = "pause";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.quitBtn.addEventListener("click", () => {
            this._saveGameState();
            this.state = State.MENU;
            this.els.pauseOverlay.classList.remove("active");
            if (this.activeChallenge) {
                this._showScreen("challenges");
            } else {
                this._showScreen("menu");
            }
        });

        // Switch Profile
        this.els.switchProfileBtn.addEventListener("click", () => {
            this._renderProfilesList();
            this._showScreen("profiles");
        });

        // Challenges
        this.els.challengesBtn.addEventListener("click", () => {
            this._showScreen("challenges");
        });
        this.els.challengesBackBtn.addEventListener("click", () => {
            this._stopChallengePreviewAnimations();
            this._showScreen("menu");
        });
        this.els.challengeStartBtn.addEventListener("click", () => this._startChallengeGame());
        this.els.challengeResumeBtn.addEventListener("click", () => this._resumeChallengeGame());
        this.els.challengeBackToSelectBtn.addEventListener("click", () => {
            this._showScreen("challenges");
        });
        this.els.challengeMainMenuBtn.addEventListener("click", () => {
            this._showScreen("menu");
        });
        this.els.challengesMusicBtn.addEventListener("click", () => {
            this._musicBackTarget = "challenges";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.challengeSetupMusicBtn.addEventListener("click", () => {
            this._musicBackTarget = "challenge-setup";
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.challengeTutorialBtn.addEventListener("click", () => this._openChallengeTutorial());
        this.els.challengeTutorialCloseBtn.addEventListener("click", () => this._closeChallengeTutorial());

        // Challenge grid size buttons
        document.querySelectorAll(".challenge-size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.challengeGridSize = parseInt(btn.dataset.size, 10);
                document.querySelectorAll(".challenge-size-btn").forEach(b => b.classList.toggle("selected", b === btn));
            });
        });

        // Words Found
        this.els.playWordsFoundBtn.addEventListener("click", () => this._openWordsFound("play"));
        this.els.wordsFoundBtn.addEventListener("click", () => {
            this._openWordsFound("gameover");
        });
        this.els.wordsFoundBackBtn.addEventListener("click", () => this._closeWordsFound());

        this.els.bonusBtn.addEventListener("click", () => {
            if (this.rowDragActive) {
                this._cancelRowDragMode();
                return;
            }
            this._openLetterChoiceModal();
        });

        // Music menu button
        this.els.musicMenuBtn.addEventListener("click", () => {
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.musicBackBtn.addEventListener("click", () => {
            if (this._musicBackTarget === "pause") {
                this._musicBackTarget = null;
                this._showScreen("play");
                this.els.pauseOverlay.classList.add("active");
            } else if (this._musicBackTarget === "challenges") {
                this._musicBackTarget = null;
                this._showScreen("challenges");
            } else if (this._musicBackTarget === "challenge-setup") {
                this._musicBackTarget = null;
                this._showScreen("challenge-setup");
            } else {
                this._showScreen("menu");
            }
        });

        // Global mute button
        this.els.globalMuteBtn.addEventListener("click", () => {
            const nowMuted = !this.musicMuted;
            this._setMuted(nowMuted);
            localStorage.setItem("wf_music_muted", nowMuted ? "1" : "0");
        });

        this.els.timeSelectCancelBtn.addEventListener("click", () => this._closeTimeSelectModal());
        document.querySelectorAll(".time-select-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                if (!Number.isFinite(minutes)) return;
                this._closeTimeSelectModal();
                this._beginNewGame(minutes * 60);
            });
        });
    }

    _bindLetterChoice() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        this.els.letterChoiceGrid.innerHTML = "";
        this.els.letterChoiceCloseBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));
        this.els.letterChoiceAcceptBtn.addEventListener("click", () => this._acceptActiveBonus());
        this.els.letterChoiceLaterBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));

        for (const letter of letters) {
            const btn = document.createElement("button");
            btn.className = "letter-choice-btn";
            btn.type = "button";
            btn.textContent = letter;
            btn.addEventListener("click", () => this._applyLetterChoice(letter));
            this.els.letterChoiceGrid.appendChild(btn);
        }
    }

    // ── Mute helpers ──
    _initMutePref() {
        const saved = localStorage.getItem("wf_music_muted");
        const muted = saved === "1"; // default is unmuted
        this._setMuted(muted);
    }

    _setMuted(muted) {
        this.musicMuted = muted;
        this.audio.muted = muted;
        this.music.setMuted(muted);
        this.els.globalMuteBtn.textContent = muted ? "🔇" : "🔊";
        this.els.globalMuteBtn.classList.toggle("muted", muted);
    }

    // ── Hints ──
    _updateHintsBtn() {
        this.els.hintsBtn.style.opacity = this.hintsEnabled ? "1" : "0.4";
        this.els.hintsBtn.title = this.hintsEnabled ? "Hints ON" : "Hints OFF";
    }

    _detectBoardWords() {
        if (!this.grid || this.clearing) return;
        const minLen = this._getMinWordLength();
        const result = this.grid.findAllWords(minLen);
        if (result.words.length === 0) return;
        this._addValidatedWords(result, result.words);
    }

    _computeHintCells() {
        // First, detect any valid words sitting on the board and validate them green
        this._detectBoardWords();

        if (!this.hintsEnabled || !this.grid) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }
        const { rows, cols } = this.grid;
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        // Collect every distinct hint sequence as an array of cell keys
        const allHints = []; // each entry: { key: string, cells: Set }

        for (const [dr, dc] of dirs) {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Only start at the beginning of a run in this direction
                    const pr = r - dr, pc = c - dc;
                    if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && isWordLetter(this.grid.get(pr, pc))) continue;

                    // Build the full consecutive run from this start cell
                    let seq = "";
                    const keys = [];
                    let cr = r, cc = c;
                    while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
                        const letter = this.grid.get(cr, cc);
                        if (!isWordLetter(letter)) break;
                        seq += letter;
                        keys.push(`${cr},${cc}`);
                        cr += dr;
                        cc += dc;
                    }
                    if (keys.length < 2) continue;
                    const rKeys = [...keys].reverse();
                    const rSeq = seq.split("").reverse().join("");

                    // For each orientation (forward and reversed), check prefix/suffix hints
                    for (const [hSeq, hKeys, nr, nc] of [
                        // forward: completing letter goes AFTER (at cr,cc)
                        [seq,  keys,  cr, cc],
                        // reverse: completing letter goes AFTER the reversed run (at pr,pc)
                        [rSeq, rKeys, pr, pc],
                    ]) {
                        const afterFree = nr >= 0 && nr < rows && nc >= 0 && nc < cols && !this.grid.get(nr, nc);
                        if (afterFree) {
                            for (let start = 0; start < hKeys.length; start++) {
                                const sub = hSeq.slice(start);
                                if (sub.length >= 3 && HINT_PREFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(start);
                                    const hintKey = hintKeys.join("|") + ">" + `${nr},${nc}`;
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }

                    // HINT_SUFFIXES: completing letter goes BEFORE the run.
                    for (const [hSeq, hKeys, bfr, bfc] of [
                        // forward: completing letter goes BEFORE (at pr,pc)
                        [seq,  keys,  pr, pc],
                        // reverse: completing letter goes BEFORE reversed run (at cr,cc)
                        [rSeq, rKeys, cr, cc],
                    ]) {
                        const beforeFree = bfr >= 0 && bfr < rows && bfc >= 0 && bfc < cols && !this.grid.get(bfr, bfc);
                        if (beforeFree) {
                            for (let end = 3; end <= hKeys.length; end++) {
                                const sub = hSeq.slice(0, end);
                                if (HINT_SUFFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(0, end);
                                    const hintKey = `<${bfr},${bfc}` + hintKeys.join("|");
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }
                }
            }
        }

        if (allHints.length === 0) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }

        // If the current active hint is still present, keep showing it
        if (this._activeHintKey) {
            const current = allHints.find(h => h.key === this._activeHintKey);
            if (current) {
                this.renderer.hintCells = current.cells;
                return;
            }
        }

        // Active hint is gone — pick the longest available one
        allHints.sort((a, b) => b.cells.size - a.cells.size);
        this._activeHintKey = allHints[0].key;
        this.renderer.hintCells = allHints[0].cells;
    }

    // ── Music binding ──
    _bindMusic() {
        this._setMusicControlButton(this.els.npPrev, "prev", "Previous Track");
        this._setMusicControlButton(this.els.npNext, "next", "Next Track");
        this._setMusicControlButton(this.els.npMiniPrev, "prev", "Previous Track");
        this._setMusicControlButton(this.els.npMiniNext, "next", "Next Track");

        // Now Playing controls (full bar on music screen)
        this.els.npPlay.addEventListener("click", () => this.music.toggle());
        this.els.npPrev.addEventListener("click", () => this.music.prev());
        this.els.npNext.addEventListener("click", () => this.music.next());

        // Progress bar seek
        this.els.npProgressBar.addEventListener("click", (e) => {
            const rect = this.els.npProgressBar.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.music.seek(frac);
        });

        // Mini now-playing toggle (in-game)
        this.els.npMiniPrev.addEventListener("click", () => this.music.prev());
        this.els.npMiniToggle.addEventListener("click", () => this.music.toggle());
        this.els.npMiniNext.addEventListener("click", () => this.music.next());

        // New playlist tab
        this.els.newPlaylistTab.addEventListener("click", () => this._openPlaylistModal(null));

        // Tutorial buttons
        this.els.tutorialBtnProfiles.addEventListener("click", () => this._openTutorial());
        this.els.tutorialBtnMenu.addEventListener("click", () => this._openTutorial());
        this.els.tutorialCloseBtn.addEventListener("click", () => this._closeTutorial());
        this.els.tutorialSlidesCloseBtn.addEventListener("click", () => this._closeTutorial());
        this.els.tutorialBackBtn.addEventListener("click", () => this._tutorialBackToMenu());
        this.els.tutorialPrevBtn.addEventListener("click", () => this._goToTutorialSlide(this._tutorialIndex - 1));
        this.els.tutorialNextBtn.addEventListener("click", () => this._goToTutorialSlide(this._tutorialIndex + 1));

        // Playlist modal
        this.els.playlistSaveBtn.addEventListener("click", () => this._savePlaylistModal());
        this.els.playlistCancelBtn.addEventListener("click", () => {
            this.els.playlistModal.classList.remove("active");
        });

        // Playlist actions
        this.els.editSongsBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            this._openPlaylistModal(this.activePlaylistTab);
        });
        this.els.renamePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            const newName = prompt("Rename playlist:", this.activePlaylistTab);
            if (newName && newName.trim()) {
                this.plMgr.renamePlaylist(this.activePlaylistTab, newName.trim());
                this.activePlaylistTab = newName.trim();
                this.music.refreshQueue();
                this._renderMusicScreen();
            }
        });
        this.els.deletePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            if (confirm(`Delete playlist "${this.activePlaylistTab}"?`)) {
                this.plMgr.deletePlaylist(this.activePlaylistTab);
                if (this.music.activePlaylist === this.activePlaylistTab) {
                    this.music.setActivePlaylist("__default");
                }
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            }
        });
    }

    _setMusicControlButton(button, iconName, label) {
        if (!button) return;
        button.innerHTML = getMusicControlIcon(iconName);
        if (label) button.setAttribute("aria-label", label);
    }

    // ── Input binding ──
    _bindInput() {
        // Keyboard
        document.addEventListener("keydown", (e) => {
            if (this.state !== State.PLAYING || this.clearing || this.rowDragActive) return;
            if (!this.block) return;
            switch (e.code) {
                case "ArrowLeft":
                case "KeyA":
                    e.preventDefault();
                    this._moveBlock(-1);
                    break;
                case "ArrowRight":
                case "KeyD":
                    e.preventDefault();
                    this._moveBlock(1);
                    break;
                case "Space":
                case "ArrowDown":
                case "KeyS":
                    e.preventDefault();
                    this._fastDrop();
                    break;
                case "Escape":
                case "KeyP":
                    e.preventDefault();
                    this._togglePause();
                    break;
            }
        });

        // Mobile buttons
        const preventAndDo = (el, fn) => {
            const handler = (e) => {
                e.preventDefault();
                if (this.state === State.PLAYING && !this.clearing && !this.rowDragActive && this.block) fn();
            };

            if (window.PointerEvent) {
                el.addEventListener("pointerdown", (e) => {
                    if (e.pointerType === "mouse" && e.button !== 0) return;
                    handler(e);
                });
                return;
            }

            el.addEventListener("touchstart", handler, { passive: false });
            el.addEventListener("mousedown", handler);
        };
        preventAndDo(this.els.btnLeft, () => this._moveBlock(-1));
        preventAndDo(this.els.btnRight, () => this._moveBlock(1));
        preventAndDo(this.els.btnDrop, () => this._fastDrop());

        if (this.usesTouchSwipeInput) {
            this._bindSwipeInput();
        }
    }

    _bindSwipeInput() {
        const swipeThreshold = 26;
        const dropThreshold = 32;
        const swipeSurface = this.els.canvasWrapper;
        if (!swipeSurface) return;

        const startSwipe = (clientX, clientY, pointerId = null) => {
            this.swipeState = {
                pointerId,
                startX: clientX,
                startY: clientY,
                lastX: clientX,
                dropTriggered: false,
            };
        };

        const moveSwipe = (clientX, clientY) => {
            if (!this.swipeState || this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;

            const totalDx = clientX - this.swipeState.startX;
            const totalDy = clientY - this.swipeState.startY;

            if (!this.swipeState.dropTriggered && totalDy >= dropThreshold && totalDy > Math.abs(totalDx) * 1.15) {
                if (this.spawnFreezeTimer > 0) {
                    // Cancel spawn freeze — block starts falling normally
                    this.spawnFreezeTimer = 0;
                } else {
                    this._fastDrop(true);
                }
                this.swipeState.dropTriggered = true;
                return;
            }

            if (Math.abs(totalDx) <= Math.abs(totalDy)) return;

            const deltaSinceLastMove = clientX - this.swipeState.lastX;
            if (Math.abs(deltaSinceLastMove) < swipeThreshold) return;

            const direction = deltaSinceLastMove > 0 ? 1 : -1;
            const steps = Math.floor(Math.abs(deltaSinceLastMove) / swipeThreshold);
            for (let step = 0; step < steps; step++) {
                this._moveBlock(direction);
            }
            this.swipeState.lastX += direction * steps * swipeThreshold;
        };

        const endSwipe = (pointerId = null) => {
            if (!this.swipeState) return;
            if (pointerId !== null && this.swipeState.pointerId !== null && pointerId !== this.swipeState.pointerId) return;
            this.swipeState = null;
        };

        if (window.PointerEvent) {
            swipeSurface.addEventListener("pointerdown", (e) => {
                if (e.pointerType === "mouse") return;
                if (this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;
                startSwipe(e.clientX, e.clientY, e.pointerId);
            });
            swipeSurface.addEventListener("pointermove", (e) => {
                if (!this.swipeState) return;
                if (this.swipeState.pointerId !== null && e.pointerId !== this.swipeState.pointerId) return;
                moveSwipe(e.clientX, e.clientY);
            });
            swipeSurface.addEventListener("pointerup", (e) => endSwipe(e.pointerId));
            swipeSurface.addEventListener("pointercancel", (e) => endSwipe(e.pointerId));
            return;
        }

        swipeSurface.addEventListener("touchstart", (e) => {
            if (this.state !== State.PLAYING || this.clearing || this.rowDragActive || !this.block) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            startSwipe(touch.clientX, touch.clientY, touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchmove", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (!touch) return;
            moveSwipe(touch.clientX, touch.clientY);
        }, { passive: true });

        swipeSurface.addEventListener("touchend", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchcancel", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });
    }

    _highlightSizeButton() {
        const minSize = this.difficulty === "hard" ? 6 : 3;
        document.querySelectorAll(".size-btn").forEach(btn => {
            const size = parseInt(btn.dataset.size, 10);
            const disabled = size < minSize;
            btn.classList.toggle("selected", size === this.gridSize);
            btn.disabled = disabled;
            btn.classList.toggle("btn-disabled", disabled);
        });
    }

    _highlightDifficultyButton() {
        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            const isSelected = btn.dataset.difficulty === this.difficulty;
            btn.classList.toggle("selected", isSelected);
            btn.classList.toggle("hard-selected", isSelected && this.difficulty === "hard");
        });
        const hint = document.getElementById("hard-mode-hint");
        if (hint) hint.classList.toggle("hidden", this.difficulty !== "hard");
    }

    _highlightGameModeButton() {
        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.mode === this.gameMode);
        });
    }

    _isDifficultyActiveGrid() {
        return true;
    }

    _updateDifficultySelector() {
        if (!this.els.difficultySelector) return;
        this.els.difficultySelector.classList.toggle("hidden", !this._isDifficultyActiveGrid());
        if (this.els.gameModeSelector) {
            this.els.gameModeSelector.classList.remove("hidden");
        }
    }

    _getSelectedGameMode() {
        return this.gameMode;
    }

    _formatCountdownTime(seconds) {
        const safeSeconds = Math.max(0, Math.ceil(seconds));
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    _updateTimerDisplay() {
        const isTimed = (this._getSelectedGameMode() === GAME_MODES.TIMED || this.activeChallenge) && this.timeLimitSeconds > 0;
        this.els.timerScoreItem.classList.toggle("hidden", !isTimed);
        if (isTimed) {
            this.els.gameTimer.textContent = this._formatCountdownTime(this.timeRemainingSeconds);
        }
    }

    _openTimeSelectModal() {
        this.pendingStartMode = this._getSelectedGameMode();
        this.els.timeSelectModal.classList.add("active");
    }

    _closeTimeSelectModal() {
        this.pendingStartMode = null;
        this.els.timeSelectModal.classList.remove("active");
    }

    _getMinWordLength() {
        if (this.difficulty === "hard") return 4;
        if (this.gridSize <= 4) return 2;
        return 3;
    }

    _showScreen(name) {
        this.els.profilesScreen.classList.toggle("active", name === "profiles");
        this.els.menuScreen.classList.toggle("active", name === "menu");
        this.els.playScreen.classList.toggle("active", name === "play");
        this.els.gameoverScreen.classList.toggle("active", name === "gameover");
        this.els.musicScreen.classList.toggle("active", name === "music");
        this.els.wordsFoundScreen.classList.toggle("active", name === "wordsfound");
        this.els.challengesScreen.classList.toggle("active", name === "challenges");
        this.els.challengeSetupScreen.classList.toggle("active", name === "challengesetup");
        if (name === "menu") {
            this._updateHighScoreDisplay();
            this._updateMenuStats();
            const hasSaved = this._hasSavedGame(null);
            this.els.resumeGameBtn.classList.toggle("hidden", !hasSaved);
        }
        if (name === "challenges") {
            this._renderChallengesGrid();
        }
        if (name === "challengesetup") {
            const hasSaved = this.activeChallenge && this._hasSavedGame(this.activeChallenge);
            this.els.challengeResumeBtn.classList.toggle("hidden", !hasSaved);
        }
        if (name === "play") this._updateMiniNowPlaying();
        if (name === "profiles") this._renderProfilesList();

        // Control background animation (hide during gameplay)
        if (this.bgAnim) {
            if (name === "play") {
                this.bgAnim.stop();
            } else {
                this.bgAnim.start();
            }
        }

        // Confetti on game over
        if (name === "gameover") this._spawnConfetti();
    }

    _wrapTitleLetters() {
        document.querySelectorAll(".title").forEach(el => {
            const text = el.textContent.trim();
            el.textContent = "";
            [...text].forEach((ch, i) => {
                const span = document.createElement("span");
                span.className = "title-letter";
                span.textContent = ch === " " ? "\u00A0" : ch;
                span.style.animationDelay = `${i * 0.15}s`;
                el.appendChild(span);
            });
        });
    }

    _spawnConfetti() {
        if (!this.bgAnim) return;
        const rect = this.els.gameoverScreen.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height * 0.3;
        const particles = [];
        for (let i = 0; i < 80; i++) {
            particles.push(new ConfettiParticle(
                cx + (Math.random() - 0.5) * rect.width * 0.6,
                cy + (Math.random() - 0.5) * 40
            ));
        }
        this.bgAnim.addConfetti(particles);
    }

    _openWordsFound(fromScreen) {
        this.wordsFoundBackTarget = fromScreen;
        this.wordsFoundResumeState = fromScreen === "play" ? this.state : null;
        if (fromScreen === "play" && this.state === State.PLAYING) {
            this.state = State.PAUSED;
        }
        this._renderWordsFound();
        // Reset to page 0
        this._wfPage = 0;
        this._goToWfPage(0);
        this._showScreen("wordsfound");
        this._bindWfSwipe();
    }

    _closeWordsFound() {
        this._unbindWfSwipe();
        const target = this.wordsFoundBackTarget || "gameover";
        this._showScreen(target === "pause" ? "play" : target);
        if (target === "pause") {
            this.state = State.PAUSED;
            this.els.pauseOverlay.classList.add("active");
        }
        if (target === "play" && this.wordsFoundResumeState === State.PLAYING) {
            this.state = State.PLAYING;
        }
        this.wordsFoundResumeState = null;
    }

    _hasBonusWordsView() {
        return this._gameOverChallenge === CHALLENGE_TYPES.TARGET_WORD
            || this._gameOverChallenge === CHALLENGE_TYPES.WORD_CATEGORY
            || this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
            || this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY;
    }

    _goToWfPage(index) {
        const total = this._hasBonusWordsView() ? 2 : 1;
        this._wfPage = Math.max(0, Math.min(index, total - 1));
        this.els.wfSlideStrip.classList.remove("swiping");
        this.els.wfSlideStrip.style.transform = `translateX(-${this._wfPage * 100}%)`;
        // Update dots
        this.els.wfDots.querySelectorAll(".wf-dot").forEach((d, i) =>
            d.classList.toggle("active", i === this._wfPage));
        // Update title
        this.els.wordsFoundTitle.textContent = this._wfPage === 0 ? "Words Found" : "Bonus Words";
    }

    _bindWfSwipe() {
        this._unbindWfSwipe();
        if (!this._hasBonusWordsView()) return;
        const view = this.els.wfSlideView;
        const strip = this.els.wfSlideStrip;
        let startX = 0, dragging = false, moved = false;
        const total = 2;

        this._wfPointerDown = (e) => {
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            strip.classList.add("swiping");
        };
        this._wfPointerMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX;
            if (!moved && Math.abs(dx) > 10) moved = true;
            if (moved && e.cancelable) e.preventDefault();
            if (moved) {
                const viewW = view.offsetWidth || 300;
                const base = -this._wfPage * viewW;
                const atStart = this._wfPage === 0 && dx > 0;
                const atEnd = this._wfPage === total - 1 && dx < 0;
                const dampened = (atStart || atEnd) ? dx * 0.25 : dx;
                strip.style.transform = `translateX(${base + dampened}px)`;
            }
        };
        this._wfPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            strip.classList.remove("swiping");
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            const viewW = view.offsetWidth || 300;
            const threshold = viewW * 0.15;
            if (Math.abs(dx) > threshold) {
                if (dx < 0 && this._wfPage < total - 1) this._wfPage++;
                else if (dx > 0 && this._wfPage > 0) this._wfPage--;
            }
            this._goToWfPage(this._wfPage);
        };

        view.addEventListener("touchstart", this._wfPointerDown, { passive: true });
        view.addEventListener("touchmove", this._wfPointerMove, { passive: false });
        view.addEventListener("touchend", this._wfPointerUp);
        view.addEventListener("mousedown", this._wfPointerDown);
        view.addEventListener("mousemove", this._wfPointerMove);
        view.addEventListener("mouseup", this._wfPointerUp);
        view.addEventListener("mouseleave", this._wfPointerUp);

        // Dot clicks
        this.els.wfDots.querySelectorAll(".wf-dot").forEach(d => {
            d.addEventListener("click", () => this._goToWfPage(parseInt(d.dataset.page)));
        });
    }

    _unbindWfSwipe() {
        const view = this.els.wfSlideView;
        if (this._wfPointerDown) {
            view.removeEventListener("touchstart", this._wfPointerDown);
            view.removeEventListener("touchmove", this._wfPointerMove);
            view.removeEventListener("touchend", this._wfPointerUp);
            view.removeEventListener("mousedown", this._wfPointerDown);
            view.removeEventListener("mousemove", this._wfPointerMove);
            view.removeEventListener("mouseup", this._wfPointerUp);
            view.removeEventListener("mouseleave", this._wfPointerUp);
        }
    }

    _updateHighScoreDisplay() {
        if (this.activeChallenge) {
            const cs = this.profileMgr.getChallengeStats(this.activeChallenge);
            this.els.playHighScore.textContent = cs.highScore;
        } else {
            this.els.playHighScore.textContent = this.highScore;
        }
        this.els.menuHighScore.textContent = this.highScore;
    }

    _updateScoreDisplay() {
        this.els.currentScore.textContent = this.score;
        this._updateBonusButton();
    }

    _updateBonusButton() {
        if (this.rowDragActive) {
            this.els.bonusBtn.classList.remove("hidden");
            this.els.bonusBtn.textContent = "Cancel Row";
            this.els.bonusBtn.title = "Cancel row clear bonus";
            this.els.bonusBtn.disabled = false;
            return;
        }
        const canUseBonus = Boolean(this.availableBonusType);
        const bonusMeta = canUseBonus ? BONUS_METADATA[this.availableBonusType] : null;
        this.els.bonusBtn.classList.toggle("hidden", !canUseBonus);
        this.els.bonusBtn.textContent = bonusMeta?.buttonLabel || "Bonus!";
        this.els.bonusBtn.title = bonusMeta?.buttonTitle || "Use Bonus";
        this.els.bonusBtn.disabled = !this.block || this.letterChoiceActive;
    }

    // ── Save / Resume game state ──

    _saveKey(challengeType) {
        const profile = this.profileMgr.getActive();
        if (!profile) return null;
        const ct = challengeType !== undefined ? challengeType : this.activeChallenge;
        return ct ? `wf_savedgame_${profile.id}_${ct}` : `wf_savedgame_${profile.id}`;
    }

    _saveGameState() {
        const key = this._saveKey();
        if (!key || !this.grid || this.state === State.GAMEOVER || this.state === State.MENU) return;
        const state = {
            version: 2,
            gridSize: this.gridSize,
            difficulty: this.difficulty,
            gameMode: this._getSelectedGameMode(),
            timeLimitSeconds: this.timeLimitSeconds,
            timeRemainingSeconds: this.timeRemainingSeconds,
            cells: this.grid.cells,
            score: this.score,
            nextLetter: this.nextLetter,
            wordsFound: this.wordsFound || [],
            bonusAvailable: Boolean(this.availableBonusType),
            availableBonusType: this.availableBonusType,
            bonusBag: this.bonusBag,
            lastAwardedBonusType: this.lastAwardedBonusType,
            nextBonusScore: this.nextBonusScore,
            block: this.block ? { letter: this.block.letter, col: this.block.col, row: this.block.row, kind: this.block.kind } : null,
            fallInterval: this.fallInterval,
            activeChallenge: this.activeChallenge || null,
            targetWord: this.targetWord || null,
            targetWordsCompleted: this.targetWordsCompleted || 0,
            activeCategoryKey: this.activeCategoryKey || null,
            categoryWordsFound: this.categoryWordsFound || [],
        };
        localStorage.setItem(key, JSON.stringify(state));
    }

    _loadGameState(challengeType) {
        const key = this._saveKey(challengeType);
        if (!key) return null;
        try {
            const data = JSON.parse(localStorage.getItem(key) || "null");
            if (data && (data.version === 1 || data.version === 2)) return data;
        } catch {}
        return null;
    }

    _clearGameState() {
        const key = this._saveKey();
        if (key) localStorage.removeItem(key);
    }

    _hasSavedGame(challengeType) {
        return this._loadGameState(challengeType) !== null;
    }

    _autoplayMusicFromUserAction() {
        if (this.music.playing) return;
        if (this.music.queue.length === 0) {
            this.music.refreshQueue();
        }
        if (this.music.queue.length > 0) {
            this.music.play();
        }
    }

    _checkBonusUnlock(prevScore, newScore) {
        if (this.availableBonusType) return;
        if (prevScore < this.nextBonusScore && newScore >= this.nextBonusScore) {
            if (!this._bonusHistory) this._bonusHistory = [];
            const draw = drawRandomBonusType(this.bonusBag, this.lastAwardedBonusType, this._bonusHistory);
            this.availableBonusType = draw.bonusType;
            this.bonusBag = draw.nextBag;
            this._bonusHistory = draw.nextHistory;
            this.lastAwardedBonusType = draw.bonusType;
            this._updateBonusButton();
            const bonusMeta = BONUS_METADATA[this.availableBonusType];
            this._showBonusPopup(bonusMeta.previewSymbol || "🎁", bonusMeta.buttonLabel || "Bonus!");
        }
    }

    _showBonusPopup(icon, label) {
        const overlay = document.getElementById("bonus-popup-overlay");
        const card = document.getElementById("bonus-popup-card");
        const iconEl = document.getElementById("bonus-popup-icon");
        const labelEl = document.getElementById("bonus-popup-label");

        iconEl.textContent = icon;
        labelEl.textContent = label;
        card.classList.remove("dust-out");
        overlay.classList.remove("hidden");

        // Hold time matches card entrance animation (0.5s) + 0.5s buffer
        const holdMs = 1000;

        setTimeout(() => {
            // Start dust-out on the card
            card.classList.add("dust-out");

            // Spawn dust particles that travel to the bonus button
            const cardRect = card.getBoundingClientRect();
            const btnRect = this.els.bonusBtn.getBoundingClientRect();
            const targetX = btnRect.left + btnRect.width / 2;
            const targetY = btnRect.top + btnRect.height / 2;
            const cx = cardRect.left + cardRect.width / 2;
            const cy = cardRect.top + cardRect.height / 2;

            const particleCount = 18;
            for (let i = 0; i < particleCount; i++) {
                const p = document.createElement("div");
                p.className = "bonus-dust-particle";
                // Scatter starting positions around the card center
                const angle = (Math.PI * 2 * i) / particleCount;
                const spread = 30 + Math.random() * 30;
                const sx = cx + Math.cos(angle) * spread;
                const sy = cy + Math.sin(angle) * spread;
                p.style.left = sx + "px";
                p.style.top = sy + "px";
                document.body.appendChild(p);

                const delay = i * 20;
                const duration = 500 + Math.random() * 200;
                p.animate([
                    { left: sx + "px", top: sy + "px", opacity: 1, transform: "scale(1)" },
                    { left: targetX + "px", top: targetY + "px", opacity: 0.3, transform: "scale(0.3)" }
                ], { duration, delay, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });

                setTimeout(() => p.remove(), delay + duration + 50);
            }

            // Hide overlay after dust animation
            setTimeout(() => {
                overlay.classList.add("hidden");
                card.classList.remove("dust-out");
            }, 700);
        }, holdMs);
    }

    _openLetterChoiceModal() {
        if (!this.availableBonusType || !this.block || this.clearing || this.letterChoiceActive) {
            return;
        }

        this.letterChoiceResumeState = this.state;
        this.letterChoiceActive = true;
        this.state = State.PAUSED;
        this._renderBonusModal();
        this.els.letterChoiceModal.classList.add("active");
        this._updateBonusButton();
    }

    _renderBonusModal() {
        const bonusMeta = BONUS_METADATA[this.availableBonusType] || BONUS_METADATA[BONUS_TYPES.LETTER_PICK];
        const showLetterGrid = this.availableBonusType === BONUS_TYPES.LETTER_PICK;

        this.els.letterChoiceTitle.textContent = bonusMeta.modalTitle;
        this.els.letterChoiceText.textContent = bonusMeta.modalText;
        this.els.letterChoiceGrid.classList.toggle("hidden", !showLetterGrid);
        this.els.letterChoicePreview.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.textContent = bonusMeta.acceptLabel || "Accept";
        this.els.letterChoicePreview.textContent = bonusMeta.previewSymbol || "";
        this.els.letterChoicePreview.dataset.bonusType = this.availableBonusType || "";
    }

    _closeLetterChoiceModal(consumeBonus) {
        if (!this.letterChoiceActive) return;

        this.letterChoiceActive = false;
        this.els.letterChoiceModal.classList.remove("active");
        if (consumeBonus) {
            this.availableBonusType = null;
            this.nextBonusScore = this.score + BONUS_UNLOCK_SCORE_INTERVAL;
        }
        this.state = this.letterChoiceResumeState === State.PAUSED ? State.PAUSED : State.PLAYING;
        this.letterChoiceResumeState = null;
        this._updateBonusButton();
    }

    _acceptActiveBonus() {
        if (!this.block || !this.letterChoiceActive) return;
        const type = this.availableBonusType;
        if (type === BONUS_TYPES.BOMB) {
            this.block.kind = "bomb";
            this.block.letter = BOMB_SYMBOL;
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.WILDCARD) {
            this.block.kind = "wildcard";
            this.block.letter = WILDCARD_SYMBOL;
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.ROW_CLEAR) {
            this._startRowDragMode();
            this._closeLetterChoiceModal(false);
        } else if (type === BONUS_TYPES.FREEZE) {
            this.freezeActive = true;
            this.freezeTimeRemaining = FREEZE_DURATION;
            this.els.freezeIndicator.classList.remove("hidden");
            this.els.freezeTimer.textContent = Math.ceil(this.freezeTimeRemaining);
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.SHUFFLE) {
            this._executeShuffle();
            this._closeLetterChoiceModal(true);
        } else if (type === BONUS_TYPES.SCORE_2X) {
            this.scoreMultiplier = 2;
            this.els.score2xIndicator.classList.remove("hidden");
            this._closeLetterChoiceModal(true);
        }
    }

    _applyLetterChoice(letter) {
        if (!this.block || !this.letterChoiceActive || this.availableBonusType !== BONUS_TYPES.LETTER_PICK) return;
        this.block.letter = letter;
        this.block.kind = "letter";
        this._closeLetterChoiceModal(true);
    }

    _executeRowClear() {
        // Find the bottom-most row that has at least one letter
        let targetRow = -1;
        for (let r = this.grid.rows - 1; r >= 0; r--) {
            for (let c = 0; c < this.grid.cols; c++) {
                if (this.grid.get(r, c) !== null) {
                    targetRow = r;
                    break;
                }
            }
            if (targetRow >= 0) break;
        }
        if (targetRow < 0) return; // grid is empty, nothing to clear

        const cellsToClear = new Set();
        for (let c = 0; c < this.grid.cols; c++) {
            if (this.grid.get(targetRow, c) !== null) {
                cellsToClear.add(`${targetRow},${c}`);
            }
        }

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _executeRowClearAtRow(targetRow) {
        const cellsToClear = new Set();
        for (let c = 0; c < this.grid.cols; c++) {
            if (this.grid.get(targetRow, c) !== null) {
                cellsToClear.add(`${targetRow},${c}`);
            }
        }
        if (cellsToClear.size === 0) return;

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _startRowDragMode() {
        this.rowDragActive = true;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.remove("hidden");
        this._updateBonusButton();
    }

    _cancelRowDragMode() {
        this.rowDragActive = false;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.add("hidden");
        this._updateBonusButton();
    }

    _clientToGridCell(clientX, clientY) {
        const rect = this.renderer.canvas.getBoundingClientRect();
        const scaleX = this.renderer.canvas.width / (window.devicePixelRatio || 1) / rect.width;
        const scaleY = this.renderer.canvas.height / (window.devicePixelRatio || 1) / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;
        return this.renderer.pixelToCell(px, py);
    }

    _handleRowDragStart(clientX, clientY) {
        if (!this.rowDragActive || !this.grid) return;
        const { row, col } = this._clientToGridCell(clientX, clientY);
        if (row < 0 || row >= this.grid.rows || col < 0 || col >= this.grid.cols) return;
        // Must start on a cell that has a letter
        if (this.grid.get(row, col) === null) return;

        this.rowDragRow = row;
        this.rowDragStartCol = col;
        this.rowDragCurrentCol = col;
        this._updateRowDragHighlight();
    }

    _handleRowDragMove(clientX, clientY) {
        if (!this.rowDragActive || this.rowDragRow < 0 || !this.grid) return;
        const { row, col } = this._clientToGridCell(clientX, clientY);
        // Clamp col to grid bounds
        const clampedCol = Math.max(0, Math.min(this.grid.cols - 1, col));

        // If dragged to a different row, reset to that row if it has letters
        if (row !== this.rowDragRow && row >= 0 && row < this.grid.rows) {
            // Check if the new row has any letters
            let hasLetters = false;
            for (let c = 0; c < this.grid.cols; c++) {
                if (this.grid.get(row, c) !== null) { hasLetters = true; break; }
            }
            if (hasLetters) {
                this.rowDragRow = row;
                this.rowDragStartCol = clampedCol;
            }
        }

        this.rowDragCurrentCol = clampedCol;
        this._updateRowDragHighlight();
    }

    _handleRowDragEnd() {
        if (!this.rowDragActive || this.rowDragRow < 0 || !this.grid) {
            // Reset partial state
            this.rowDragRow = -1;
            this.rowDragStartCol = -1;
            this.rowDragCurrentCol = -1;
            this.renderer.rowDragCells.clear();
            return;
        }

        // Check if all non-empty cells in the row are highlighted
        const row = this.rowDragRow;
        let allCovered = true;
        for (let c = 0; c < this.grid.cols; c++) {
            if (this.grid.get(row, c) !== null && !this.renderer.rowDragCells.has(`${row},${c}`)) {
                allCovered = false;
                break;
            }
        }

        if (allCovered) {
            // Complete the bonus!
            this._completeRowDrag();
        } else {
            // Not complete — reset the drag so player can try again
            this.rowDragRow = -1;
            this.rowDragStartCol = -1;
            this.rowDragCurrentCol = -1;
            this.renderer.rowDragCells.clear();
        }
    }

    _updateRowDragHighlight() {
        this.renderer.rowDragCells.clear();
        if (this.rowDragRow < 0) return;

        const minCol = Math.min(this.rowDragStartCol, this.rowDragCurrentCol);
        const maxCol = Math.max(this.rowDragStartCol, this.rowDragCurrentCol);
        for (let c = minCol; c <= maxCol; c++) {
            if (this.grid.get(this.rowDragRow, c) !== null) {
                this.renderer.rowDragCells.add(`${this.rowDragRow},${c}`);
            }
        }
    }

    _completeRowDrag() {
        const row = this.rowDragRow;
        // End drag mode
        this.rowDragActive = false;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;
        this.renderer.rowDragCells.clear();
        this.els.rowDragIndicator.classList.add("hidden");

        // Consume the bonus
        this.availableBonusType = null;
        this.nextBonusScore = this.score + BONUS_UNLOCK_SCORE_INTERVAL;
        this._updateBonusButton();

        // Execute the actual row clear at the selected row
        this._executeRowClearAtRow(row);
    }

    _executeShuffle() {
        // Collect all letters and their current positions
        const entries = [];
        for (let r = 0; r < this.grid.rows; r++) {
            for (let c = 0; c < this.grid.cols; c++) {
                const letter = this.grid.get(r, c);
                if (letter !== null) entries.push({ letter, fromRow: r, fromCol: c });
            }
        }
        if (entries.length === 0) return;

        // Advanced randomization: multiple Fisher-Yates passes for thorough mixing
        const letters = entries.map(e => e.letter);
        for (let pass = 0; pass < 3; pass++) {
            for (let i = letters.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [letters[i], letters[j]] = [letters[j], letters[i]];
            }
        }

        // Distribute letters randomly across columns with gravity
        // Randomize column assignment order so letters don't fill left-to-right
        const cols = this.grid.cols;
        const rows = this.grid.rows;
        const colFill = new Array(cols).fill(0); // how many letters stacked in each column

        // Assign each letter to a random column (weighted toward less-full columns)
        const assignments = [];
        for (let i = 0; i < letters.length; i++) {
            // Build list of columns that still have space
            const available = [];
            for (let c = 0; c < cols; c++) {
                if (colFill[c] < rows) available.push(c);
            }
            // Pick a random available column
            const col = available[Math.floor(Math.random() * available.length)];
            const row = rows - 1 - colFill[col];
            colFill[col]++;
            assignments.push({ letter: letters[i], toRow: row, toCol: col });
        }

        // Clear grid and place shuffled letters
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.grid.cells[r][c] = null;
            }
        }
        for (const a of assignments) {
            this.grid.cells[a.toRow][a.toCol] = a.letter;
        }

        // Build animation data — each letter flies from old position to new position
        this._shuffleAnims = [];
        for (let i = 0; i < entries.length; i++) {
            this._shuffleAnims.push({
                letter: assignments[i].letter,
                fromRow: entries[i].fromRow,
                fromCol: entries[i].fromCol,
                toRow: assignments[i].toRow,
                toCol: assignments[i].toCol,
                progress: 0,
                delay: Math.random() * 0.15, // stagger starts slightly
            });
        }
        this._shuffleAnimActive = true;
        this._shuffleAnimTimer = 0;

        this._validatedWordGroups = [];
        this._rebuildValidatedCells();
        this._computeHintCells();
    }

    _updateShuffleAnim(dt) {
        if (!this._shuffleAnimActive) return;
        this._shuffleAnimTimer += dt;
        const duration = 0.55; // seconds for the flight
        let allDone = true;
        for (const a of this._shuffleAnims) {
            const elapsed = this._shuffleAnimTimer - a.delay;
            if (elapsed <= 0) { allDone = false; continue; }
            a.progress = Math.min(1, elapsed / duration);
            if (a.progress < 1) allDone = false;
        }
        this.renderer.shuffleAnims = this._shuffleAnims;
        if (allDone) {
            this._shuffleAnimActive = false;
            this._shuffleAnims = [];
            this.renderer.shuffleAnims = [];
        }
    }

    _resumeGame() {
        const saved = this._loadGameState(null);
        if (!saved) { this._startGame(); return; }

        this.gridSize = saved.gridSize;
        this.difficulty = saved.difficulty || this.profileMgr.getActive()?.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        this.gameMode = saved.gameMode || this.profileMgr.getActive()?.gameMode || GAME_MODES.SANDBOX;
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.grid.cells = saved.cells;
        this.score = saved.score;
        this.timeLimitSeconds = saved.timeLimitSeconds || 0;
        this.timeRemainingSeconds = saved.timeRemainingSeconds || 0;
        this.nextLetter = saved.nextLetter;
        this.wordsFound = saved.wordsFound || [];
        this.foundWordsThisGame = new Set(this.wordsFound.map(({ word }) => word));
        this.availableBonusType = saved.availableBonusType || (saved.bonusAvailable ? BONUS_TYPES.LETTER_PICK : null);
        this.bonusBag = Array.isArray(saved.bonusBag) ? saved.bonusBag.filter(type => BONUS_TYPE_POOL.includes(type)) : [];
        this.lastAwardedBonusType = BONUS_TYPE_POOL.includes(saved.lastAwardedBonusType) ? saved.lastAwardedBonusType : this.availableBonusType;
        this.nextBonusScore = saved.nextBonusScore || BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.fallInterval = saved.fallInterval || (this.difficulty === "casual" ? 1.5 : 0.9);
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.pendingGravityMoves = [];
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.renderer.validatedCells = new Set();
        this.activeChallenge = null;
        this._updateScoreDisplay();
        this._updateHighScoreDisplay();
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateTimerDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;

        this._autoplayMusicFromUserAction();

        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            // Restore falling block or spawn a new one
            if (saved.block) {
                this.block = new FallingBlock(saved.block.letter, saved.block.col, this.gridSize, saved.block.kind || "letter");
                const savedRow = typeof saved.block.row === "number" ? saved.block.row : -1;
                this.block.row = savedRow;
                this.block.visualRow = savedRow;
            } else {
                this._spawnBlock();
            }
            this.els.nextLetter.textContent = this.nextLetter;
            this._updateBonusButton();
        });
    }

    _resumeChallengeGame() {
        if (!this.activeChallenge) return;
        const saved = this._loadGameState(this.activeChallenge);
        if (!saved) { this._startChallengeGame(); return; }

        this.gridSize = saved.gridSize;
        this.difficulty = saved.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.grid.cells = saved.cells;
        this.score = saved.score;
        this.timeLimitSeconds = saved.timeLimitSeconds || 0;
        this.timeRemainingSeconds = saved.timeRemainingSeconds || 0;
        this.nextLetter = saved.nextLetter;
        this.wordsFound = saved.wordsFound || [];
        this.foundWordsThisGame = new Set(this.wordsFound.map(({ word }) => word));
        this.availableBonusType = saved.availableBonusType || null;
        this.bonusBag = Array.isArray(saved.bonusBag) ? saved.bonusBag.filter(type => BONUS_TYPE_POOL.includes(type)) : [];
        this.lastAwardedBonusType = BONUS_TYPE_POOL.includes(saved.lastAwardedBonusType) ? saved.lastAwardedBonusType : this.availableBonusType;
        this.nextBonusScore = saved.nextBonusScore || BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.fallInterval = saved.fallInterval || (this.difficulty === "casual" ? 1.5 : 0.9);
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.pendingGravityMoves = [];
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.renderer.validatedCells = new Set();

        // Reset bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;
        this.rowDragActive = false;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;
        this.renderer.rowDragCells.clear();
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.rowDragIndicator.classList.add("hidden");

        // Restore challenge-specific state
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            this.targetWord = saved.targetWord || null;
            this.targetWordsCompleted = saved.targetWordsCompleted || 0;
            if (this.targetWord) {
                this.els.targetWordDisplay.classList.remove("hidden");
                this.els.targetWordText.textContent = this.targetWord;
            }
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            this.fallInterval = Math.min(this.fallInterval, 0.9);
            this.speedRoundBaseInterval = 0.9;
            this.els.targetWordDisplay.classList.add("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            this.activeCategoryKey = saved.activeCategoryKey || null;
            this.categoryWordsFound = saved.categoryWordsFound || [];
            if (this.activeCategoryKey && WORD_CATEGORIES[this.activeCategoryKey]) {
                this.activeCategorySet = WORD_CATEGORIES[this.activeCategoryKey].words;
                const cat = WORD_CATEGORIES[this.activeCategoryKey];
                this.els.targetWordDisplay.classList.remove("hidden");
                this.els.targetWordDisplay.querySelector(".target-label").textContent = "CATEGORY:";
                this.els.targetWordText.textContent = `${cat.icon} ${cat.label}`;
            }
        }

        this._updateScoreDisplay();
        this._updateTimerDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;

        this._autoplayMusicFromUserAction();

        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            if (saved.block) {
                this.block = new FallingBlock(saved.block.letter, saved.block.col, this.gridSize, saved.block.kind || "letter");
                const savedRow = typeof saved.block.row === "number" ? saved.block.row : -1;
                this.block.row = savedRow;
                this.block.visualRow = savedRow;
            } else {
                this._spawnBlock();
            }
            this.els.nextLetter.textContent = this.nextLetter;
            this._updateBonusButton();
        });
    }

    // ── Game start / reset ──
    _startGame() {
        this.activeChallenge = null;
        if (this._getSelectedGameMode() === GAME_MODES.TIMED) {
            this._openTimeSelectModal();
            return;
        }
        this._beginNewGame(0);
    }

    _beginNewGame(timeLimitSeconds = 0) {
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.score = 0;
        this.timeLimitSeconds = timeLimitSeconds;
        this.timeRemainingSeconds = timeLimitSeconds;
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this._wordPopupCount = 0;
        this.els.wordPopup.innerHTML = "";
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.renderer.hintCells = new Set();
        this.renderer.validatedCells = new Set();
        this._activeHintKey = null;
        this.pendingGravityMoves = [];
        this.nextLetter = randomLetter();
        this.wordsFound = [];  // track all words found this round
        this.foundWordsThisGame = new Set();
        this.categoryWordsFound = [];  // track category words found this round
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;

        // Reset bonus state
        this.freezeActive = false;
        this.freezeTimeRemaining = 0;
        this.scoreMultiplier = 1;
        this.rowDragActive = false;
        this.rowDragRow = -1;
        this.rowDragStartCol = -1;
        this.rowDragCurrentCol = -1;
        this.renderer.rowDragCells.clear();
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.rowDragIndicator.classList.add("hidden");

        // Reset challenge state (activeChallenge is set before calling this for challenges)
        this.targetWord = null;
        this.targetWordsCompleted = 0;
        this._validatedWordGroups = [];
        this._claimAnimating = false;
        this.els.targetWordDisplay.classList.add("hidden");

        this._updateScoreDisplay();
        this._updateTimerDisplay();
        this._updateHighScoreDisplay();
        this._updateLevelDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;
        this.fallInterval = this.difficulty === "casual" ? 1.5 : 0.9;

        // Start or resume music from the player's start-game action.
        this._autoplayMusicFromUserAction();

        // Resize canvas
        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            this._spawnBlock();
        });
    }

    _spawnBlock() {
        const centerCol = Math.floor(this.gridSize / 2);
        this.block = new FallingBlock(this.nextLetter, centerCol, this.gridSize, "letter");
        this.nextLetter = randomLetter();
        this.els.nextLetter.textContent = this.nextLetter;
        this.fallTimer = 0;
        this.spawnFreezeTimer = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND ? 0 : 2.0;
        this._updateBonusButton();
    }

    _moveBlock(dc) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        const newCol = this.block.col + dc;
        if (newCol < 0 || newCol >= this.gridSize) return;
        // In buffer zone (row < 0) there are no obstacles
        if (this.block.row >= 0 && !this.grid.isEmpty(this.block.row, newCol)) return;
        this.block.col = newCol;
    }

    _fastDrop(animate = false) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        // If the block is hovering over a full column, don't drop
        if (this.block.row < 0 && !this.grid.isEmpty(0, this.block.col)) return;
        // Start from row 0 if still in buffer
        let r = Math.max(0, this.block.row);
        while (r + 1 < this.gridSize && this.grid.isEmpty(r + 1, this.block.col)) {
            r++;
        }

        if (animate && r !== this.block.row) {
            this.block.row = r;
            this.block.dropAnimating = true;
            this.fallTimer = 0;
            return;
        }

        this.block.row = r;
        this.block.visualRow = r;
        this._landBlock();
    }

    _landBlock() {
        if (!this.block) return;
        this.grid.set(this.block.row, this.block.col, this.block.letter);
        const landedRow = this.block.row;
        const landedCol = this.block.col;
        const landedKind = this.block.kind;
        this.block = null;
        this._updateBonusButton();
        this._saveGameState();

        if (landedKind === "bomb") {
            this.audio.bomb();
            this._triggerBombClear(landedRow, landedCol);
            return;
        }

        this._computeHintCells();
        this.audio.land();

        // Start word detection chain
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._checkWords(landedRow, landedCol);
    }

    _triggerBombClear(row, col) {
        const cellsToClear = new Set();

        for (let currentCol = 0; currentCol < this.grid.cols; currentCol++) {
            if (this.grid.get(row, currentCol) !== null) {
                cellsToClear.add(`${row},${currentCol}`);
            }
        }

        for (let currentRow = 0; currentRow < this.grid.rows; currentRow++) {
            if (this.grid.get(currentRow, col) !== null) {
                cellsToClear.add(`${currentRow},${col}`);
            }
        }

        this.renderer.hintCells = new Set();
        this._activeHintKey = null;

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = BOMB_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "bomb";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells = new Set(cellsToClear);
        this.renderer.blastCenterKey = `${row},${col}`;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _checkWords(triggerRow, triggerCol) {
        // If triggerRow < 0, do a full-board scan (chain reaction)
        let result;
        if (triggerRow >= 0) {
            result = this.grid.findWordsThrough(triggerRow, triggerCol, this._getMinWordLength());
        } else {
            result = this.grid.findAllWords(this._getMinWordLength());
        }

        if (result.words.length === 0 && result.cells.size === 0) {
            // Word check already ran above and found nothing.
            // If the grid is now completely full, the last placed letter
            // didn't form any word — game over (unless validated words can be claimed).
            if (this.grid.isGridFull()) {
                if (this._validatedWordGroups.length > 0) {
                    // Player can still tap green cells to free space
                    this.clearing = false;
                    this._claimAnimating = false;
                    return;
                }
                this._gameOver();
                return;
            }
            // No more words but grid still has space — apply chain bonus and continue.
            if (this.totalWordsInChain > 0) {
                const prevScore = this.score;
                this.score += this.totalWordsInChain * 50;
                this._checkBonusUnlock(prevScore, this.score);
                this._updateScoreDisplay();
            }
            this.clearing = false;
            this._claimAnimating = false;
            this._computeHintCells();

            // Chain words were already shown via _addWordPopupRow during claiming
            if (this._chainWords && this._chainWords.length > 0) {
                this._chainWords = [];
                return;
            }
            // Don't spawn a new block if one already exists (e.g. after tap-to-claim)
            if (!this.block) this._spawnBlock();
            return;
        }

        // ── Tap-to-claim mode ──
        // Highlight validated words green and let the player tap to claim them.
        if (result.words.length > 0) {
            this._addValidatedWords(result, result.words);
        }
        // Don't enter clearing state — spawn next block
        this.clearing = false;
        this._computeHintCells();
        if (!this.block) this._spawnBlock();
        return;
    }

    _processClearPhase(dt) {
        if (this.clearPhase === "flash") {
            this.renderer.flashTimer += dt;
            this.clearTimer += dt;
            if (this.pendingClearMode === "bomb") {
                this.renderer.blastProgress = Math.min(1, this.clearTimer / this.clearFlashDuration);
            }
            if (this.clearTimer >= this.clearFlashDuration) {
                // Remove cells
                this.grid.removeCells(this._pendingClearCells);
                this.renderer.flashCells.clear();
                this.renderer.flashTimer = 0;
                this.renderer.blastCells.clear();
                this.renderer.blastCenterKey = null;
                this.renderer.blastProgress = 0;
                this.pendingClearMode = "";

                // Invalidate validated groups whose cells were just removed
                this._validatedWordGroups = this._validatedWordGroups.filter(g => {
                    for (const key of this._pendingClearCells) {
                        if (g.cells.has(key)) return false;
                    }
                    return true;
                });
                this._rebuildValidatedCells();

                // Apply gravity
                const moves = this.grid.applyGravity();
                if (moves.length > 0) {
                    // Gravity shifts cells — clear all validated groups (rescan will re-detect)
                    this._validatedWordGroups = [];
                    this._rebuildValidatedCells();
                    this.pendingGravityMoves = moves.map(m => ({ ...m, progress: 0 }));
                    this.renderer.gravityAnims = this.pendingGravityMoves;
                    this.clearPhase = "gravity";
                    this.clearTimer = 0;
                } else {
                    this.clearPhase = "check";
                    this.clearTimer = 0;
                }
            }
        } else if (this.clearPhase === "gravity") {
            this.clearTimer += dt;
            const speed = 6; // cells per second
            let allDone = true;
            for (const m of this.pendingGravityMoves) {
                m.progress += speed * dt / Math.max(1, m.toRow - m.fromRow);
                if (m.progress < 1) allDone = false;
                else m.progress = 1;
            }
            if (allDone || this.clearTimer > 0.5) {
                this.renderer.gravityAnims = [];
                this.pendingGravityMoves = [];
                this.clearPhase = "check";
                this.clearTimer = 0;
            }
        } else if (this.clearPhase === "check") {
            // Full board scan for chain reactions
            this._checkWords(-1, -1);
        }
    }

    _togglePause() {
        if (this.letterChoiceActive) return;
        if (this.state === State.PLAYING) {
            this.state = State.PAUSED;
            this.els.quitBtn.textContent = this.activeChallenge ? "Quit to Challenges" : "Quit to Menu";
            this.els.pauseOverlay.classList.add("active");
        } else if (this.state === State.PAUSED) {
            this.state = State.PLAYING;
            this.els.pauseOverlay.classList.remove("active");
        }
    }

    _showWordPopup(words) {
        for (const entry of words) {
            this._addWordPopupRow(entry);
        }
    }

    _addWordPopupRow(entry) {
        const container = this.els.wordPopup;

        const row = document.createElement("div");
        row.className = "word-popup-row";

        const letters = entry.word.split("");
        letters.forEach((ch, i) => {
            const span = document.createElement("span");
            span.className = "word-popup-letter";
            span.textContent = ch;
            const randomRot = Math.floor(Math.random() * 120) - 60;
            span.style.setProperty("--r", randomRot);
            span.style.setProperty("--d", i * 0.06 + "s");
            row.appendChild(span);
        });

        const pts = document.createElement("span");
        pts.className = "word-popup-pts";
        pts.textContent = "+" + entry.pts;
        pts.style.setProperty("--d", letters.length * 0.06 + 0.1 + "s");
        row.appendChild(pts);

        container.appendChild(row);

        // Pause falling while any popup row is visible
        this._wordPopupActive = true;
        if (!this._wordPopupCount) this._wordPopupCount = 0;
        this._wordPopupCount++;

        // Hold time = animation duration + small buffer to read
        const animDuration = letters.length * 0.06 + 0.1 + 0.3; // pts is last to finish
        const holdMs = (animDuration + 0.5) * 1000;

        // Each row exits on its own timer after its animation completes
        setTimeout(() => {
            row.classList.add("pop-out");
            setTimeout(() => {
                row.remove();
                this._wordPopupCount--;
                if (this._wordPopupCount <= 0) {
                    this._wordPopupCount = 0;
                    this._wordPopupActive = false;
                    if (!this.block) this._spawnBlock();
                }
            }, 400);
        }, holdMs);
    }


    _gameOver(reason = "board") {
        if (this.state === State.GAMEOVER) return;
        const timedOut = reason === "time";
        if (timedOut) {
            this.timeRemainingSeconds = 0;
            this._updateTimerDisplay();
        }
        this.state = State.GAMEOVER;
        this.block = null;
        this.audio.gameOver();
        this.renderer.hintCells = new Set();
        this.renderer.validatedCells = new Set();
        this.renderer.rowDragCells.clear();
        this.rowDragActive = false;
        this.els.rowDragIndicator.classList.add("hidden");
        this._activeHintKey = null;
        this._validatedWordGroups = [];
        this._claimAnimating = false;

        // Clean up bonus indicators
        this.freezeActive = false;
        this.els.freezeIndicator.classList.add("hidden");
        this.els.score2xIndicator.classList.add("hidden");
        this.els.targetWordDisplay.classList.add("hidden");
        this.els.targetWordDisplay.querySelector(".target-label").textContent = "TARGET:";

        // Clear saved game — this run is over
        this._clearGameState();

        // ── XP System: check first-game status BEFORE recording ──
        const wasFirstGame = this.profileMgr.isFirstGameEver();

        // Record stats to profile
        const wordsCount = (this.wordsFound || []);
        if (this.activeChallenge) {
            this.profileMgr.recordChallengeGame(this.activeChallenge, this.score, wordsCount);
        } else {
            this.profileMgr.recordGame(this.score, wordsCount);
        }

        // Update high score
        let isNew = false;
        if (this.activeChallenge) {
            const cs = this.profileMgr.getChallengeStats(this.activeChallenge);
            isNew = this.score > 0 && this.score >= cs.highScore;
        } else {
            const profile = this.profileMgr.getActive();
            if (profile && this.score >= profile.highScore) {
                this.highScore = profile.highScore;
                isNew = this.score > 0;
            }
        }

        // ── XP Calculation ──
        const gs = this.activeChallenge ? this.challengeGridSize : this.gridSize;
        const bsKey = this.profileMgr.bestScoreKey(
            gs, this.difficulty, this.gameMode,
            !!this.activeChallenge, this.activeChallenge);
        const previousBest = this.profileMgr.getBestScore(bsKey);

        let xpEarned;
        if (wasFirstGame) {
            xpEarned = xpRequiredForLevel(1); // guarantee level 2
        } else {
            const lvlInfo = this.profileMgr.getLevelInfo();
            xpEarned = calculateGameXP({
                score: this.score,
                wordsFound: wordsCount,
                gridSize: gs,
                difficulty: this.difficulty,
                gameMode: this.gameMode,
                isChallenge: !!this.activeChallenge,
                challengeType: this.activeChallenge,
                previousBest,
                playerLevel: lvlInfo.level,
                timeLimitSeconds: this.timeLimitSeconds,
                timeRemainingSeconds: this.timeRemainingSeconds,
                targetWordsCompleted: this.targetWordsCompleted || 0,
                bonusWordsCompleted: (this.categoryWordsFound || []).length,
                categoryKey: this.activeCategoryKey || null,
            });
        }

        // Update best score for this mode combo
        this.profileMgr.updateBestScore(bsKey, this.score);

        // Award XP
        const xpResult = this.profileMgr.awardXP(xpEarned);

        // Build final score text (add challenge info if applicable)
        let finalText = `Score: ${this.score}`;
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            finalText += `\nTarget Words: ${this.targetWordsCompleted}`;
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            finalText += `\nFinal Speed: ${this.fallInterval.toFixed(2)}s`;
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            const catCount = (this.categoryWordsFound || []).length;
            const cat = this.activeCategoryKey && WORD_CATEGORIES[this.activeCategoryKey];
            finalText += `\n${cat ? cat.icon + " " : ""}Category Words: ${catCount}`;
        }

        this.els.finalScore.textContent = finalText;
        this.els.newHighScore.classList.toggle("hidden", !isNew);

        // Store challenge type for gameover screen buttons before resetting
        this._gameOverChallenge = this.activeChallenge;
        this._gameOverCategoryKey = this.activeCategoryKey;

        // Reset challenge state
        this.activeChallenge = null;

        // Update gameover buttons based on whether this was a challenge game
        this.els.menuBtn.textContent = this._gameOverChallenge ? "Back to Challenges" : "Main Menu";
        this.els.restartBtn.textContent = this._gameOverChallenge ? "Play Again" : "Play Again";

        // ── Show gameover screen with XP animation ──
        this._showGameOverXP(xpEarned, xpResult, wasFirstGame);
    }

    // ── Level / XP display methods ──

    _updateLevelDisplay() {
        const info = this.profileMgr.getLevelInfo();
        const pct = info.xpRequired > 0 ? Math.min(100, (info.xp / info.xpRequired) * 100) : 0;

        // Play screen bar
        this.els.levelText.textContent = `Lv. ${info.level}`;
        this.els.xpBarFill.style.width = pct + "%";
        this.els.xpText.textContent = `${info.xp} / ${info.xpRequired}`;

        // Menu screen
        this.els.menuLevelNum.textContent = info.level;
        this.els.menuXpBarFill.style.width = pct + "%";
        this.els.menuXpText.textContent = `${info.xp} / ${info.xpRequired} XP`;
    }

    _showGameOverXP(xpEarned, xpResult, wasFirstGame) {
        // Set initial gameover XP state (before animation)
        const startPct = xpResult.oldXpReq > 0
            ? Math.min(100, (xpResult.oldXp / xpResult.oldXpReq) * 100) : 0;

        this.els.gameoverLevelText.textContent = `Level ${xpResult.oldLevel}`;
        this.els.gameoverXpBarFill.style.transition = "none";
        this.els.gameoverXpBarFill.style.width = startPct + "%";
        this.els.xpEarnedText.textContent = `+${xpEarned} XP`;
        this.els.xpEarnedText.classList.remove("visible");

        this._showScreen("gameover");

        // Animate after a brief delay
        setTimeout(() => {
            this.els.xpEarnedText.classList.add("visible");
        }, 300);

        setTimeout(() => {
            this.els.gameoverXpBarFill.style.transition = "width 1.2s cubic-bezier(0.22,1,0.36,1)";

            if (xpResult.leveled) {
                // Animate to 100%, then after the transition show level-up
                this.els.gameoverXpBarFill.style.width = "100%";

                setTimeout(() => {
                    // Update to new level state
                    this.els.gameoverLevelText.textContent = `Level ${xpResult.newLevel}`;
                    this.els.gameoverXpBarFill.style.transition = "none";
                    this.els.gameoverXpBarFill.style.width = "0%";

                    setTimeout(() => {
                        const endPct = xpResult.newXpReq > 0
                            ? Math.min(100, (xpResult.newXp / xpResult.newXpReq) * 100) : 0;
                        this.els.gameoverXpBarFill.style.transition = "width 0.6s cubic-bezier(0.22,1,0.36,1)";
                        this.els.gameoverXpBarFill.style.width = endPct + "%";

                        // Show level-up popup after bar settles
                        setTimeout(() => {
                            if (wasFirstGame) {
                                this._showXPTutorial(xpResult.newLevel);
                            } else {
                                this._showLevelUpPopup(xpResult.newLevel, xpResult.newXp, xpResult.newXpReq);
                            }
                        }, 700);
                    }, 50);
                }, 1250);
            } else {
                // No level up — just animate to final position
                const endPct = xpResult.newXpReq > 0
                    ? Math.min(100, (xpResult.newXp / xpResult.newXpReq) * 100) : 0;
                this.els.gameoverXpBarFill.style.width = endPct + "%";
            }
        }, 600);

        // Also update the play-screen bar and menu bar
        this._updateLevelDisplay();
    }

    _showLevelUpPopup(newLevel, newXp, newXpReq) {
        this.els.levelUpLevel.textContent = `Level ${newLevel}`;
        const pct = newXpReq > 0 ? Math.min(100, (newXp / newXpReq) * 100) : 0;
        this.els.levelUpBarFill.style.transition = "none";
        this.els.levelUpBarFill.style.width = "0%";
        this.els.levelUpOverlay.classList.add("active");

        setTimeout(() => {
            this.els.levelUpBarFill.style.transition = "width 0.8s cubic-bezier(0.22,1,0.36,1)";
            this.els.levelUpBarFill.style.width = pct + "%";
        }, 400);

        // Confetti burst
        if (this.bgAnim && this.bgAnim.spawnConfetti) {
            this.bgAnim.spawnConfetti();
        }
    }

    _showXPTutorial(newLevel) {
        this.els.levelUpOverlay.classList.remove("active");
        this.els.xpTutorialOverlay.classList.add("active");
        this._animateXPTutorialCanvas();
    }

    _animateXPTutorialCanvas() {
        const canvas = this.els.xpTutorialCanvas;
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 300 * dpr;
        canvas.height = 180 * dpr;
        ctx.scale(dpr, dpr);
        const w = 300, h = 180;
        let start = null;
        let animId = null;

        const draw = (timestamp) => {
            if (!start) start = timestamp;
            const t = (timestamp - start) / 1000;
            ctx.clearRect(0, 0, w, h);

            // Draw a mini XP bar animation
            ctx.fillStyle = "#0d1117";
            ctx.fillRect(0, 0, w, h);

            // Level badge
            const lvl = Math.min(Math.floor(t * 0.8) + 1, 5);
            ctx.font = "bold 28px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#7eb8ff";
            ctx.fillText(`Lv. ${lvl}`, w / 2, 30);

            // XP bar background
            const barX = 40, barY = 55, barW = 220, barH = 16;
            ctx.fillStyle = "#1a2a3e";
            ctx.fillRect(barX, barY, barW, barH);
            ctx.strokeStyle = "#2a3a50";
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, barY, barW, barH);

            // XP bar fill (animated cycling)
            const cycle = t % 3;
            const fillPct = cycle < 2 ? Math.min(cycle / 2, 1) : 1;
            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
            grad.addColorStop(0, "#3b82f6");
            grad.addColorStop(1, "#60a5fa");
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, barW * fillPct, barH);

            // "LEVEL UP!" flash
            if (cycle >= 2) {
                const flash = Math.sin(t * 8) > 0;
                ctx.font = "bold 20px sans-serif";
                ctx.fillStyle = flash ? "#ffd700" : "#ff9800";
                ctx.fillText("LEVEL UP!", w / 2, 95);
            }

            // Info text
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#888";
            ctx.fillText("Earn XP by playing games", w / 2, 125);
            ctx.fillText("Harder modes = more XP", w / 2, 142);
            ctx.fillText("Beat your best = bonus XP!", w / 2, 159);

            animId = requestAnimationFrame(draw);
        };

        animId = requestAnimationFrame(draw);
        this._xpTutorialAnimId = animId;
    }

    _stopXPTutorialAnim() {
        if (this._xpTutorialAnimId) {
            cancelAnimationFrame(this._xpTutorialAnimId);
            this._xpTutorialAnimId = null;
        }
    }

    _bindLevelUpUI() {
        this.els.levelUpOkBtn.addEventListener("click", () => {
            this.els.levelUpOverlay.classList.remove("active");
        });
        this.els.xpTutorialOkBtn.addEventListener("click", () => {
            this._stopXPTutorialAnim();
            this.els.xpTutorialOverlay.classList.remove("active");
        });
    }

    // ── Profile methods ──

    _bindProfiles() {
        this.els.newProfileBtn.addEventListener("click", () => {
            this.els.profileNameInput.value = "";
            this.els.profileModal.classList.add("active");
            this.els.profileNameInput.focus();
        });
        this.els.profileSaveBtn.addEventListener("click", () => this._createProfile());
        this.els.profileCancelBtn.addEventListener("click", () => {
            this.els.profileModal.classList.remove("active");
        });
        // Allow Enter to submit
        this.els.profileNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._createProfile();
        });
    }

    _createProfile() {
        const name = this.els.profileNameInput.value.trim();
        if (!name) { this.els.profileNameInput.focus(); return; }
        this.profileMgr.create(name);
        this._autoplayMusicFromUserAction();
        this.els.profileModal.classList.remove("active");
        this._loadActiveProfile();
        this._showScreen("menu");
    }

    _loadActiveProfile() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.gridSize = profile.gridSize || 5;
        this.difficulty = profile.difficulty || "casual";
        if (this.difficulty === "challenging") this.difficulty = "hard";
        // Enforce Hard mode grid minimum
        if (this.difficulty === "hard" && this.gridSize < 6) {
            this.gridSize = 6;
            this.profileMgr.setGridSize(this.gridSize);
        }
        this.gameMode = profile.gameMode || GAME_MODES.SANDBOX;
        this.highScore = profile.highScore || 0;
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateHighScoreDisplay();
        this._updateMenuStats();
        this._updateLevelDisplay();
    }

    _renderProfilesList() {
        const list = this.els.profilesList;
        list.innerHTML = "";
        const profiles = this.profileMgr.getAll();

        if (profiles.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No profiles yet. Create one to get started!</p>';
            return;
        }

        for (const p of profiles) {
            const card = document.createElement("div");
            card.className = "profile-card";
            const initial = p.username.charAt(0).toUpperCase();
            const lvl = p.level || 1;
            card.innerHTML = `
                <div class="profile-avatar">${initial}</div>
                <div class="profile-info">
                    <div class="profile-name">${p.username} <span class="profile-level">Lv.${lvl}</span></div>
                    <div class="profile-stats">High Score: ${p.highScore} · Games: ${p.gamesPlayed} · Words: ${p.totalWords}</div>
                </div>
                <button class="profile-delete-btn" title="Delete profile">🗑</button>
            `;

            // Select profile
            card.addEventListener("click", (e) => {
                if (e.target.closest(".profile-delete-btn")) return;
                this.profileMgr.select(p.id);
                this._autoplayMusicFromUserAction();
                this._loadActiveProfile();
                this._showScreen("menu");
            });

            // Delete profile
            card.querySelector(".profile-delete-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`Delete profile "${p.username}"? This cannot be undone.`)) {
                    this.profileMgr.delete(p.id);
                    this._renderProfilesList();
                    // If no profiles left, stay on profiles screen
                    if (!this.profileMgr.hasProfiles()) return;
                    // If active was deleted, load new active
                    if (this.profileMgr.getActive()) {
                        this._loadActiveProfile();
                    }
                }
            });

            list.appendChild(card);
        }
    }

    _updateMenuStats() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.els.menuProfileName.textContent = `👤 ${profile.username}`;
        this.els.menuGamesPlayed.textContent = profile.gamesPlayed;
        this.els.menuTotalWords.textContent = Array.isArray(profile.uniqueWordsFound) ? profile.uniqueWordsFound.length : profile.totalWords;
    }

    // ── Words Found rendering ──

    _getUniqueWordsFound() {
        const uniqueWords = new Map();

        for (const { word, pts, bonus } of this.wordsFound || []) {
            const existing = uniqueWords.get(word);
            if (existing) {
                existing.count += 1;
                existing.totalPts += pts;
                if (bonus) existing.bonus = true;
                continue;
            }

            uniqueWords.set(word, {
                word,
                count: 1,
                totalPts: pts,
                bonus: !!bonus,
            });
        }

        return [...uniqueWords.values()];
    }

    _renderWordsFound() {
        const list = this.els.wordsFoundList;
        list.innerHTML = "";
        const words = this._getUniqueWordsFound();
        this.els.wordsFoundCount.textContent = `${words.length} unique word${words.length !== 1 ? "s" : ""} found`;

        if (words.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No words found this round.</p>';
        } else {
            for (const { word, count, totalPts, bonus } of words) {
                const item = document.createElement("div");
                item.className = "word-found-item" + (bonus ? " bonus-word" : "");
                item.innerHTML = `
                    <span class="word-found-text">${word}</span>
                    <span class="word-found-pts">${count > 1 ? `x${count} · ` : ""}+${totalPts} pts</span>
                `;
                list.appendChild(item);
            }
        }

        // Populate bonus words page
        const bonusList = this.els.bonusWordsList;
        bonusList.innerHTML = "";
        const bonusWords = words.filter(w => w.bonus);
        const hasBonus = this._hasBonusWordsView();

        if (hasBonus) {
            this.els.wfDots.classList.remove("hidden");
            // Determine bonus label
            const ch = this.activeChallenge || this._gameOverChallenge;
            let label = "Bonus Words";
            if (ch === CHALLENGE_TYPES.TARGET_WORD) {
                label = "🎯 Target Words";
            } else if (ch === CHALLENGE_TYPES.WORD_CATEGORY) {
                const catKey = this.activeCategoryKey || this._gameOverCategoryKey;
                const catMeta = catKey && WORD_CATEGORIES[catKey];
                label = catMeta ? `${catMeta.icon} ${catMeta.label}` : "📂 Category Words";
            }
            this.els.bonusWordsCount.textContent = `${bonusWords.length} ${label} found`;

            if (bonusWords.length === 0) {
                bonusList.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No bonus words found.</p>';
            } else {
                for (const { word, count, totalPts } of bonusWords) {
                    const item = document.createElement("div");
                    item.className = "word-found-item bonus-word";
                    item.innerHTML = `
                        <span class="word-found-text">${word}</span>
                        <span class="word-found-pts">${count > 1 ? `x${count} · ` : ""}+${totalPts} pts</span>
                    `;
                    bonusList.appendChild(item);
                }
            }
        } else {
            this.els.wfDots.classList.add("hidden");
            this.els.bonusWordsCount.textContent = "";
        }
    }

    // ── Music UI rendering ──

    _formatTrackTime(seconds) {
        if (!seconds || !isFinite(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    }

    _updateMusicUI() {
        const track = this.music.getCurrentTrack();
        const playing = this.music.playing;

        // Full now-playing bar (music screen)
        this.els.npTitle.textContent = track ? track.title : "No track playing";
        this.els.npArtist.textContent = track ? track.artist : "";
        this._setMusicControlButton(this.els.npPlay, playing ? "pause" : "play", playing ? "Pause" : "Play");

        // Highlight playing track in list
        this.els.trackList.querySelectorAll(".track-item").forEach(el => {
            el.classList.toggle("playing", el.dataset.trackId === this.music.currentTrackId);
            const btn = el.querySelector(".track-play-btn");
            if (btn) btn.textContent = (el.dataset.trackId === this.music.currentTrackId && playing) ? "⏸" : "▶";
        });

        // Mini bar
        this._updateMiniNowPlaying();
    }

    _updateMusicProgress(currentTime, duration) {
        const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.els.npProgressFill.style.width = pct + "%";
        this.els.npCurrentTime.textContent = this._formatTrackTime(currentTime);
        this.els.npDuration.textContent = this._formatTrackTime(duration);
    }

    _updateMiniNowPlaying() {
        const track = this.music.getCurrentTrack();
        this.els.npMiniTitle.textContent = track ? `♪ ${track.title} – ${track.artist}` : "♪ ---";
        this._setMusicControlButton(this.els.npMiniToggle, this.music.playing ? "pause" : "play", this.music.playing ? "Pause" : "Play");
    }

    // ── Tutorial System (Sub-menu + Animated Canvas Slides) ──

    _initTutorialSlides() {
        if (this._tutorialCategories) return;

        // ── Drawing helpers (shared by all slide animations) ──
        const gL = (w, h, gs, yBias = 0) => {
            const cs = Math.floor(Math.min(w * 0.8, h * 0.6) / gs);
            return { cs, ox: (w - cs * gs) / 2, oy: (h - cs * gs) / 2 + yBias };
        };
        const gBg = (ctx, ox, oy, cs, gs) => {
            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                ctx.fillStyle = '#1e1e30';
                ctx.fillRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
                ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                ctx.strokeRect(ox + c * cs, oy + r * cs, cs, cs);
            }
        };
        const gC = (ctx, ox, oy, cs, r, c, ltr, bg, glw) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.fillStyle = bg || '#2a2a3e';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            if (glw) {
                ctx.save(); ctx.shadowColor = glw; ctx.shadowBlur = 10;
                ctx.strokeStyle = glw; ctx.lineWidth = 2;
                ctx.strokeRect(x + 3, y + 3, cs - 6, cs - 6); ctx.restore();
            }
            if (ltr) {
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(ltr, x + cs / 2, y + cs / 2);
            }
        };
        const gF = (ctx, ox, oy, cs, r, c, ltr) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.fillStyle = '#3a3a5e';
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.save(); ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 12;
            ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4); ctx.restore();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(ltr, x + cs / 2, y + cs / 2);
        };
        const gG = (ctx, ox, oy, cs, r, c) => {
            const x = ox + c * cs, y = oy + r * cs;
            ctx.save(); ctx.strokeStyle = 'rgba(255,215,0,0.2)'; ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
            ctx.setLineDash([]); ctx.restore();
        };
        const gT = (ctx, x, y, txt, clr, sz, a) => {
            ctx.save();
            if (a !== undefined) ctx.globalAlpha = a;
            ctx.fillStyle = clr || '#ffd700';
            ctx.font = `bold ${sz || 16}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(txt, x, y); ctx.restore();
        };
        const gA = (ctx, x, y, dir, sz) => {
            sz = sz || 18;
            ctx.save(); ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
            const h = sz * 0.4;
            if (dir === 'left') {
                ctx.moveTo(x + sz, y); ctx.lineTo(x, y);
                ctx.lineTo(x + h, y - h); ctx.moveTo(x, y); ctx.lineTo(x + h, y + h);
            } else if (dir === 'right') {
                ctx.moveTo(x - sz, y); ctx.lineTo(x, y);
                ctx.lineTo(x - h, y - h); ctx.moveTo(x, y); ctx.lineTo(x - h, y + h);
            } else {
                ctx.moveTo(x, y - sz); ctx.lineTo(x, y);
                ctx.lineTo(x - h, y - h); ctx.moveTo(x, y); ctx.lineTo(x + h, y - h);
            }
            ctx.stroke(); ctx.restore();
        };
        const gTap = (ctx, x, y, t) => {
            const p = 0.5 + 0.5 * Math.sin(t * 6);
            ctx.save();
            ctx.beginPath(); ctx.arc(x, y, 10 + p * 12, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,215,0,${0.3 + p * 0.5})`; ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700'; ctx.fill(); ctx.restore();
        };
        const ease = v => v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
        const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        // ── Slide Definitions ──

        this._tutorialCategories = [
            // ═══ ADD TO PHONE ═══
            {
                id: 'addphone', icon: '📱', label: 'Add Game to Phone',
                desc: 'Install the game on your iPhone home screen',
                slides: [
                    { title: 'Step 1: Open in Safari', desc: 'Open this game\'s URL in Safari on your iPhone. This only works in Safari — Chrome and other browsers don\'t support adding web apps to the home screen.', img: 'TUTORIAL/1.png' },
                    { title: 'Step 2: Tap the Share Button', desc: 'Tap the Share button at the bottom of Safari (the square with an arrow pointing up). This opens the share menu with all your options.', img: 'TUTORIAL/2.png' },
                    { title: 'Step 3: Add to Home Screen', desc: 'Scroll down in the share menu and tap "Add to Home Screen". You can customize the name if you want, then tap "Add" in the top-right corner.', img: 'TUTORIAL/3.png' },
                    { title: 'Step 4: Launch Like an App!', desc: 'The game now appears as an icon on your home screen! Tap it to launch — it opens in full-screen mode just like a real app, with no browser bars or distractions. Enjoy!', img: 'TUTORIAL/4.png' }
                ]
            },

            // ═══ HOW TO PLAY ═══
            {
                id: 'basics', icon: '🎮', label: 'How to Play',
                desc: 'Learn the basics — dropping letters, forming words, and scoring points',
                slides: [
                    {
                        title: 'Falling Letters',
                        desc: 'Letter blocks fall one at a time from the top of the grid. Each block contains a random letter. When a block reaches the bottom — or lands on top of another letter — it locks in place. You can see the NEXT letter coming in the preview above the grid. The game ends when a new block has no room to spawn because the grid is full!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'W'],[4,1,'O'],[4,2,'R'],[4,3,'D'],[4,4,'S'],
                                            [3,1,'A'],[3,3,'L'],[3,4,'E']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const ltrs = 'TSPKRN', cyc = t % 3;
                            const ltr = ltrs[Math.floor(t / 3) % ltrs.length];
                            const tgtR = 2, col = 2;
                            const row = cyc < 2.2 ? lerp(-1, tgtR, ease(Math.min(cyc / 2.2, 1))) : tgtR;
                            gG(ctx, ox, oy, cs, tgtR, col);
                            gF(ctx, ox, oy, cs, clamp(row, -0.5, tgtR), col, ltr);
                            const nx = ltrs[(Math.floor(t / 3) + 1) % ltrs.length];
                            gT(ctx, w / 2, oy - cs * 0.9, 'Next: ' + nx, '#777', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Moving & Dropping',
                        desc: 'While a block is falling, SWIPE LEFT or RIGHT to move it to a different column. SWIPE DOWN to instantly hard-drop it straight to the bottom. On desktop, use the LEFT/RIGHT arrow keys to move and SPACE or DOWN arrow to drop. Plan your placement carefully — once a block locks in, you can\'t move it!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,1,'H'],[4,2,'E'],[4,3,'L'],[4,4,'P'],[3,3,'A']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const ph = t % 7;
                            let col, row;
                            if (ph < 2) {
                                col = 2 + ease(Math.min(ph, 1)) * 2; row = 0.5;
                                const ax = ox + 3.5 * cs, ay = oy + 0.5 * cs;
                                gA(ctx, ax, ay, 'right', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, 'Swipe Right →', '#ffd700', Math.floor(cs * 0.3));
                            } else if (ph < 4) {
                                const p = ph - 2;
                                col = 4 - ease(Math.min(p, 1)) * 4; row = 0.5;
                                const ax = ox + 1.5 * cs, ay = oy + 0.5 * cs;
                                gA(ctx, ax, ay, 'left', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, '← Swipe Left', '#ffd700', Math.floor(cs * 0.3));
                            } else {
                                const p = ph - 4;
                                col = 0; row = clamp(ease(Math.min(p * 2, 1)) * 3, 0, 3);
                                gA(ctx, ox + 0.5 * cs, oy + 1.5 * cs, 'down', cs * 0.35);
                                gT(ctx, w / 2, oy - cs * 0.7, 'Swipe Down ↓', '#ffd700', Math.floor(cs * 0.3));
                            }
                            col = clamp(Math.round(col), 0, gs - 1);
                            gG(ctx, ox, oy, cs, col === 0 ? 3 : 4, col);
                            gF(ctx, ox, oy, cs, clamp(row, 0, 4), col, 'M');
                        }
                    },
                    {
                        title: 'Forming Words',
                        desc: 'The game automatically scans for valid English words of 3 or more letters in ALL eight directions — horizontal (left-to-right, right-to-left), vertical (top-to-bottom, bottom-to-top), and all four diagonals. When a valid word is found, those letters light up GREEN to let you know a word is ready to claim. The dictionary contains the top 20,000 most common English words!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const grid = [
                                [' ',' ',' ',' ','D'],
                                [' ',' ',' ','O',' '],
                                [' ',' ','G',' ',' '],
                                [' ','A','O',' ',' '],
                                ['C','A','T','E','R']
                            ];
                            const words = [
                                { cells:[[4,0],[4,1],[4,2]], label:'→ Horizontal', name:'CAT' },
                                { cells:[[4,2],[3,2],[2,2]], label:'↕ Vertical', name:'TOG' },
                                { cells:[[4,2],[3,1],[2,0]], label:'↗ Diagonal', name:'TAX' }
                            ];
                            const wi = Math.floor(t * 0.5) % 3;
                            const active = words[wi];
                            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                if (grid[r][c] === ' ') continue;
                                const hit = active.cells.some(([wr,wc]) => wr === r && wc === c);
                                gC(ctx, ox, oy, cs, r, c, grid[r][c],
                                   hit ? '#2e5c2e' : '#2a2a3e',
                                   hit ? '#4caf50' : null);
                            }
                            gT(ctx, w / 2, oy - cs * 0.7, active.label, '#4caf50', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Tap to Claim',
                        desc: 'When letters glow green showing a valid word, TAP anywhere on the highlighted word to claim it! The word\'s letters are cleared from the grid, you earn points based on word length (longer words = way more points!), and all the letters above drop down to fill the empty spaces. You can tap to claim at ANY time — even while another block is falling!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 4;
                            const placed = [[4,0,'F'],[4,1,'U'],[4,2,'N'],[4,3,'K'],[4,4,'Y'],
                                            [3,0,'R'],[3,2,'S'],[3,4,'E']];
                            const wordCells = [[4,0],[4,1],[4,2]];
                            if (cyc < 2.5) {
                                for (const [r,c,l] of placed) {
                                    const hit = wordCells.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l,
                                       hit ? '#2e5c2e' : '#2a2a3e',
                                       hit ? '#4caf50' : null);
                                }
                                if (cyc > 0.5) {
                                    const tapX = ox + 1 * cs + cs / 2;
                                    const tapY = oy + 4 * cs + cs / 2;
                                    gTap(ctx, tapX, tapY, t);
                                    gT(ctx, w / 2, oy - cs * 0.7, 'TAP to claim!', '#ffd700', Math.floor(cs * 0.35));
                                } else {
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Word found!', '#4caf50', Math.floor(cs * 0.35));
                                }
                            } else {
                                const alpha = 1 - (cyc - 2.5) * 2;
                                for (const [r,c,l] of placed) {
                                    const hit = wordCells.some(([wr,wc]) => wr === r && wc === c);
                                    if (hit) {
                                        ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
                                        gC(ctx, ox, oy, cs, r, c, l, '#2e5c2e', '#4caf50');
                                        ctx.restore();
                                    } else {
                                        gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                                    }
                                }
                                const pts = Math.floor(clamp(1 - alpha, 0, 1) * 90);
                                if (alpha < 0.5) gT(ctx, w / 2, oy + 2 * cs, '+' + pts + ' pts!', '#ffd700',
                                    Math.floor(cs * 0.5), clamp(1 - (cyc - 3) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Multi-Word Claims',
                        desc: 'If a green letter sits at the intersection of two or more valid words, tapping that shared letter claims ALL of them at once! Look for spots where words cross — one tap on the shared letter scores every connected word simultaneously. This is a powerful strategy to rack up massive points in a single tap!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 5;
                            const placed = [[2,2,'T'],[3,2,'A'],
                                            [4,0,'R'],[4,1,'A'],[4,2,'N'],[4,3,'K']];
                            const word1 = [[4,0],[4,1],[4,2],[4,3]]; // RANK
                            const word2 = [[2,2],[3,2],[4,2]]; // TAN
                            const allGreen = [...word1, ...word2];
                            const sharedR = 4, sharedC = 2; // N is shared
                            if (cyc < 3) {
                                for (const [r,c,l] of placed) {
                                    const hit = allGreen.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l,
                                       hit ? '#2e5c2e' : '#2a2a3e',
                                       hit ? '#4caf50' : null);
                                }
                                if (cyc < 1.5) {
                                    gT(ctx, w / 2, oy - cs * 0.7, '"RANK" + "TAN"', '#4caf50', Math.floor(cs * 0.3));
                                } else {
                                    const tapX = ox + sharedC * cs + cs / 2;
                                    const tapY = oy + sharedR * cs + cs / 2;
                                    gTap(ctx, tapX, tapY, t);
                                    gT(ctx, w / 2, oy - cs * 0.7, 'TAP shared letter!', '#ffd700', Math.floor(cs * 0.3));
                                }
                            } else {
                                const alpha = 1 - (cyc - 3) * 0.8;
                                for (const [r,c,l] of placed) {
                                    const hit = allGreen.some(([wr,wc]) => wr === r && wc === c);
                                    if (hit) {
                                        ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
                                        gC(ctx, ox, oy, cs, r, c, l, '#2e5c2e', '#4caf50');
                                        ctx.restore();
                                    } else {
                                        gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                                    }
                                }
                                const pts = Math.floor(clamp(1 - alpha, 0, 1) * 340);
                                if (alpha < 0.5) gT(ctx, w / 2, oy + 2 * cs, '+' + pts + ' pts!', '#ffd700',
                                    Math.floor(cs * 0.5), clamp(1 - (cyc - 3.8) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Chains & Scoring',
                        desc: 'Scoring formula: word length² × 10 (so a 3-letter word = 90 pts, 5-letter word = 250 pts!). After you claim a word, letters above fall down — if they form a NEW valid word, that\'s a CHAIN REACTION worth +50 bonus points per chain! Chains can keep going as long as new words keep forming. Strategic letter placement is the key to triggering massive chain combos.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 6;
                            if (cyc < 2) {
                                const cells = [[4,0,'S'],[4,1,'E'],[4,2,'T'],[4,3,'X'],[4,4,'L'],
                                               [3,0,'R'],[3,1,'A'],[3,2,'N'],[3,4,'D'],
                                               [2,2,'C'],[2,4,'O']];
                                const word1 = [[4,0],[4,1],[4,2]];
                                for (const [r,c,l] of cells) {
                                    const hit = word1.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l, hit ? '#2e5c2e' : '#2a2a3e', hit ? '#4caf50' : null);
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '"SET" found!', '#4caf50', Math.floor(cs * 0.35));
                            } else if (cyc < 3.5) {
                                const p = cyc - 2;
                                const fallCells = [[3,0,'R'],[3,1,'A'],[3,2,'N'],[3,4,'D'],
                                                   [2,2,'C'],[2,4,'O']];
                                const landedCells = [[4,0,'R'],[4,1,'A'],[4,2,'N'],[4,4,'D'],
                                                     [3,2,'C'],[3,4,'O'],[4,3,'X'],[4,4,'L']];
                                const cells = p < 0.8 ? fallCells.map(([r,c,l]) =>
                                    [lerp(r, r + 1, ease(Math.min(p / 0.8, 1))), c, l]
                                ) : landedCells.map(([r,c,l]) => [r,c,l]);
                                for (const [r,c,l] of cells) gC(ctx, ox, oy, cs, Math.round(r), c, l, '#2a2a3e');
                                gT(ctx, w / 2, oy - cs * 0.7, 'Letters fall...', '#aaa', Math.floor(cs * 0.35));
                            } else {
                                const cells = [[4,0,'R'],[4,1,'A'],[4,2,'N'],[4,3,'X'],[4,4,'D'],
                                               [3,2,'C'],[3,4,'O']];
                                const word2 = [[4,0],[4,1],[4,2]];
                                for (const [r,c,l] of cells) {
                                    const hit = word2.some(([wr,wc]) => wr === r && wc === c);
                                    gC(ctx, ox, oy, cs, r, c, l, hit ? '#2e5c2e' : '#2a2a3e', hit ? '#4caf50' : null);
                                }
                                const flash = Math.sin(t * 8) > 0;
                                gT(ctx, w / 2, oy - cs * 0.7, '⚡ CHAIN +50!', flash ? '#ff9800' : '#ffd700',
                                    Math.floor(cs * 0.4));
                            }
                        }
                    },
                    {
                        title: 'Spawn Freeze',
                        desc: 'After each block lands, there\'s a 2-second pause before the next block appears. This is your planning window — scan the grid for words, decide where you want the next letter, and get ready! If you\'re ready early, SWIPE DOWN once to break the freeze timer, then SWIPE DOWN again to drop the next block faster. In Speed Round challenges, there is NO freeze — the next block falls immediately!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'P'],[4,1,'L'],[4,2,'A'],[4,3,'N'],[4,4,'E'],
                                            [3,2,'T']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const cyc = t % 5;
                            if (cyc < 2) {
                                const row = lerp(-1, 2, ease(Math.min(cyc / 1.5, 1)));
                                gG(ctx, ox, oy, cs, 2, 2);
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 2), 2, 'H');
                            } else if (cyc < 4) {
                                gC(ctx, ox, oy, cs, 2, 2, 'H', '#2a2a3e');
                                const remain = 2 - (cyc - 2);
                                const barW = cs * 3, barH = 8;
                                const bx = (w - barW) / 2, by = oy - cs * 1.2;
                                ctx.fillStyle = '#333';
                                ctx.fillRect(bx, by, barW, barH);
                                ctx.fillStyle = '#ffd700';
                                ctx.fillRect(bx, by, barW * (remain / 2), barH);
                                gT(ctx, w / 2, by - 14, remain.toFixed(1) + 's', '#ffd700', Math.floor(cs * 0.3));
                                if (cyc > 3) {
                                    gA(ctx, w / 2, by + cs * 0.8, 'down', 14);
                                    gT(ctx, w / 2, by + cs * 1.4, 'Swipe ↓ to skip', '#888', Math.floor(cs * 0.22));
                                }
                            } else {
                                gC(ctx, ox, oy, cs, 2, 2, 'H', '#2a2a3e');
                                gF(ctx, ox, oy, cs, -0.5, 2, 'R');
                                gT(ctx, w / 2, oy - cs * 0.9, 'Next block!', '#4caf50', Math.floor(cs * 0.3));
                            }
                        }
                    },
                    {
                        title: 'Pause & Resume',
                        desc: 'Need a break? Tap the ⏸ pause button in the top-right corner during gameplay to freeze the action. The game pauses completely — no blocks fall and the timer stops. From the pause menu you can also view your found words list or toggle music. Tap Resume to pick up right where you left off. On desktop, press ESCAPE or P to toggle pause.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'G'],[4,1,'A'],[4,2,'M'],[4,3,'E'],[4,4,'S'],
                                            [3,1,'R'],[3,2,'I'],[3,3,'D']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const cyc = t % 4;
                            // Pause button position - right side, near top (spawn area)
                            const btnX = ox + cs * gs + cs * 0.5, btnY = oy + cs * 0.5;
                            const btnR = cs * 0.35;
                            if (cyc < 1.5) {
                                // Show the pause icon pulsing
                                const pulse = 1 + Math.sin(t * 4) * 0.1;
                                ctx.save();
                                ctx.translate(btnX, btnY);
                                ctx.scale(pulse, pulse);
                                ctx.beginPath();
                                ctx.arc(0, 0, btnR, 0, Math.PI * 2);
                                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                                ctx.fill();
                                ctx.fillStyle = '#fff';
                                ctx.font = `bold ${Math.floor(btnR * 1.1)}px sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillText('⏸', 0, 1);
                                ctx.restore();
                                gTap(ctx, btnX, btnY, t);
                                gT(ctx, w / 2, oy - cs * 1.3, 'Tap ⏸ to pause!', '#ffd700', Math.floor(cs * 0.3));
                            } else {
                                // Show "PAUSED" overlay
                                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                                ctx.fillRect(ox, oy, cs * gs, cs * gs);
                                const flash = Math.sin(t * 3) > 0 ? '#fff' : '#ccc';
                                gT(ctx, w / 2, oy + cs * 2.5, '⏸ PAUSED', flash, Math.floor(cs * 0.55));
                                gT(ctx, w / 2, oy + cs * 3.3, 'Tap Resume to continue', '#999', Math.floor(cs * 0.22));
                            }
                        }
                    }
                ]
            },

            // ═══ BONUSES & POWER-UPS ═══
            {
                id: 'bonuses', icon: '⭐', label: 'Bonuses & Power-Ups',
                desc: 'Earn powerful abilities every 1,000 points — 7 different types!',
                slides: [
                    {
                        title: 'Earning Bonuses',
                        desc: 'Every 1,000 points you score, you unlock a random bonus power-up! A glowing bonus button appears in the corner of the screen. Tap it whenever you\'re ready to activate it — you don\'t have to use it right away. There are 7 different bonus types: Letter Pick, Bomb, Wildcard, Row Clear, Freeze, Shuffle, and Score ×2. Each one is drawn randomly from a shuffled bag so you won\'t get the same bonus twice in a row.',
                        draw(ctx, w, h, t) {
                            const cyc = t % 4;
                            const score = cyc < 2 ? Math.floor(lerp(800, 1000, ease(Math.min(cyc / 2, 1)))) : 1000;
                            gT(ctx, w / 2, h * 0.25, 'Score: ' + score, '#fff', 28);
                            if (cyc >= 2) {
                                const p = (cyc - 2) / 2;
                                const scale = 1 + Math.sin(p * Math.PI) * 0.3;
                                ctx.save();
                                ctx.translate(w / 2, h * 0.5);
                                ctx.scale(scale, scale);
                                gT(ctx, 0, 0, '🎁 BONUS!', '#ffd700', 32);
                                ctx.restore();
                                const icons = ['🔤', '💣', '★', '🧹', '❄️', '🔀', '×2'];
                                const ic = icons[Math.floor(t * 3) % icons.length];
                                gT(ctx, w / 2, h * 0.68, ic, '#fff', 36, 0.5 + p * 0.5);
                            }
                            const barW = w * 0.5, barH = 10;
                            const bx = (w - barW) / 2, by = h * 0.35;
                            ctx.fillStyle = '#333'; ctx.fillRect(bx, by, barW, barH);
                            ctx.fillStyle = '#ffd700';
                            ctx.fillRect(bx, by, barW * ((score % 1000) / 1000 || (cyc >= 2 ? 1 : 0)), barH);
                        }
                    },
                    {
                        title: 'Letter Pick 🔤',
                        desc: 'The Letter Pick bonus lets you choose EXACTLY which letter you want for your next falling block. A full alphabet grid appears — tap any letter to select it. This is perfect when you\'re one letter away from completing a big word or setting up a chain reaction. Think strategically about which letter will score the most points!',
                        draw(ctx, w, h, t) {
                            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                            const cols = 7, bsz = Math.floor(w / (cols + 2));
                            const rows = Math.ceil(26 / cols);
                            const gw = cols * bsz, gh = rows * bsz;
                            const ox = (w - gw) / 2, oy = (h - gh) / 2 - 20;
                            const selected = Math.floor(t * 2) % 26;
                            for (let i = 0; i < 26; i++) {
                                const r = Math.floor(i / cols), c = i % cols;
                                const x = ox + c * bsz, y = oy + r * bsz;
                                const sel = i === selected;
                                ctx.fillStyle = sel ? '#3a5a3a' : '#2a2a3e';
                                ctx.fillRect(x + 2, y + 2, bsz - 4, bsz - 4);
                                if (sel) {
                                    ctx.save(); ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10;
                                    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                                    ctx.strokeRect(x + 3, y + 3, bsz - 6, bsz - 6); ctx.restore();
                                }
                                ctx.fillStyle = sel ? '#ffd700' : '#ccc';
                                ctx.font = `bold ${Math.floor(bsz * 0.5)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(alphabet[i], x + bsz / 2, y + bsz / 2);
                            }
                            gT(ctx, w / 2, oy - bsz * 0.6, 'Pick your letter:', '#ffd700', 16);
                            gT(ctx, w / 2, oy + gh + bsz * 0.6,
                                'Selected: ' + alphabet[selected], '#4caf50', 18);
                        }
                    },
                    {
                        title: 'Bomb 💣',
                        desc: 'The Bomb replaces your next block with a 💣 that falls just like a normal letter. When it lands, it EXPLODES — clearing every letter in its entire landing ROW and the entire COLUMN it\'s in, forming a cross-shaped blast! This is incredibly useful when your grid is getting full and you need to make space. Drop it in a crowded intersection for maximum destruction!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 4;
                            const bombCol = 2, bombRow = 2;
                            for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                if (r >= 3 || (r === 2 && c !== bombCol))
                                    gC(ctx, ox, oy, cs, r, c, 'XYZAB'[c], '#2a2a3e');
                            }
                            if (cyc < 1.5) {
                                const row = lerp(-1, bombRow, ease(Math.min(cyc / 1.2, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, bombRow), bombCol, '💣');
                            } else if (cyc < 2.5) {
                                const p = (cyc - 1.5);
                                const flash = Math.sin(p * 20) > 0;
                                for (let r = 0; r < gs; r++) {
                                    if (r === bombRow || true) {
                                        const x = ox + bombCol * cs, y2 = oy + r * cs;
                                        ctx.fillStyle = flash ? 'rgba(255,100,0,0.5)' : 'rgba(255,200,0,0.3)';
                                        ctx.fillRect(x, y2, cs, cs);
                                    }
                                }
                                for (let c = 0; c < gs; c++) {
                                    const x2 = ox + c * cs, y = oy + bombRow * cs;
                                    ctx.fillStyle = flash ? 'rgba(255,100,0,0.5)' : 'rgba(255,200,0,0.3)';
                                    ctx.fillRect(x2, y, cs, cs);
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '💥 BOOM!', '#ff6600', Math.floor(cs * 0.45));
                            } else {
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                    if (r === bombRow || c === bombCol) continue;
                                    if (r >= 3) gC(ctx, ox, oy, cs, r, c, 'XYZAB'[c], '#2a2a3e');
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, 'Row + Column cleared!', '#ff9800', Math.floor(cs * 0.3));
                            }
                        }
                    },
                    {
                        title: 'Wildcard ★',
                        desc: 'The Wildcard places a golden ★ star block that counts as ANY letter! When checking for words, the game tries all 26 letters in that position to see if a valid word can be formed. It works in every direction — horizontal, vertical, and diagonal. A single wildcard can even complete MULTIPLE words at once if it\'s positioned at an intersection. It\'s the most versatile bonus in the game!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'C'],[4,2,'T'],[4,3,'S'],[3,0,'R'],[3,2,'E']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const cyc = t % 5;
                            if (cyc < 2) {
                                const row = lerp(-1, 4, ease(Math.min(cyc / 1.5, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 4), 1, '★');
                            } else {
                                const morphLetters = 'AEIOU';
                                const mi = Math.floor((cyc - 2) * 2) % morphLetters.length;
                                const ml = morphLetters[mi];
                                const x = ox + 1 * cs, y = oy + 4 * cs;
                                ctx.fillStyle = '#4a3a1e';
                                ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                                ctx.save(); ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 15;
                                ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                                ctx.strokeRect(x + 3, y + 3, cs - 6, cs - 6); ctx.restore();
                                ctx.fillStyle = '#ffd700';
                                ctx.font = `bold ${Math.floor(cs * 0.45)}px sans-serif`;
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText('★' + ml, x + cs / 2, y + cs / 2);
                                if (ml === 'A') {
                                    const word = [[4,0],[4,1],[4,2]];
                                    for (const [wr,wc] of word) {
                                        ctx.save(); ctx.shadowColor = '#4caf50'; ctx.shadowBlur = 8;
                                        ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2;
                                        ctx.strokeRect(ox + wc * cs + 3, oy + wr * cs + 3, cs - 6, cs - 6);
                                        ctx.restore();
                                    }
                                    gT(ctx, w / 2, oy - cs * 0.7, '"CAT" found!', '#4caf50', Math.floor(cs * 0.35));
                                } else {
                                    gT(ctx, w / 2, oy - cs * 0.7, '★ = ' + ml + '?', '#ffd700', Math.floor(cs * 0.35));
                                }
                            }
                        }
                    },
                    {
                        title: 'Row Clear & Freeze',
                        desc: 'ROW CLEAR (🧹) instantly sweeps away every letter in the bottom-most occupied row, and all letters above drop down to fill the gap. Great for clearing out junk letters stuck at the bottom! FREEZE (❄️) pauses block falling for 10 full seconds — no new blocks spawn, giving you time to carefully scan the grid, claim any words you see, and plan your next moves without pressure.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, -10);
                            gBg(ctx, ox, oy, cs, gs);
                            const cyc = t % 8;
                            if (cyc < 4) {
                                for (let r = 2; r < gs; r++) for (let c = 0; c < gs; c++)
                                    gC(ctx, ox, oy, cs, r, c, 'ABCDE'[c], '#2a2a3e');
                                if (cyc < 1.5) {
                                    gT(ctx, w / 2, oy - cs * 0.7, '🧹 Row Clear!', '#ff9800', Math.floor(cs * 0.35));
                                    const sweep = ease(Math.min(cyc / 1.2, 1));
                                    const sw = sweep * gs * cs;
                                    ctx.fillStyle = 'rgba(255,165,0,0.4)';
                                    ctx.fillRect(ox, oy + 4 * cs, sw, cs);
                                } else if (cyc < 2.5) {
                                    for (let c = 0; c < gs; c++)
                                        gC(ctx, ox, oy, cs, 4, c, ' ', '#1e1e30');
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Bottom row gone!', '#ff9800', Math.floor(cs * 0.3));
                                } else {
                                    for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                        gC(ctx, ox, oy, cs, r + 1 < gs ? r + 1 : r, c, 'ABCDE'[c], '#2a2a3e');
                                    gT(ctx, w / 2, oy - cs * 0.7, 'Letters drop down', '#aaa', Math.floor(cs * 0.3));
                                }
                            } else {
                                for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                    gC(ctx, ox, oy, cs, r, c, 'FGHIJ'[c], '#2a2a3e');
                                const remain = 10 - (cyc - 4) * 2.5;
                                gT(ctx, w / 2, oy - cs * 0.9, '❄️ FREEZE', '#64b5f6', Math.floor(cs * 0.4));
                                const barW = gs * cs * 0.8, barH = 8;
                                const bx = (w - barW) / 2, by = oy - cs * 0.3;
                                ctx.fillStyle = '#333'; ctx.fillRect(bx, by, barW, barH);
                                ctx.fillStyle = '#64b5f6';
                                ctx.fillRect(bx, by, barW * Math.max(0, remain / 10), barH);
                                gT(ctx, w / 2, by - 14, remain.toFixed(1) + 's', '#64b5f6', Math.floor(cs * 0.25));
                                const snowT = t * 2;
                                for (let i = 0; i < 6; i++) {
                                    const sx = ox + (Math.sin(snowT + i * 1.5) * 0.5 + 0.5) * gs * cs;
                                    const sy = oy + ((snowT * 0.3 + i * 0.2) % 1) * gs * cs;
                                    gT(ctx, sx, sy, '❄', '#64b5f6', 10, 0.4);
                                }
                            }
                        }
                    },
                    {
                        title: 'Shuffle & Score ×2',
                        desc: 'SHUFFLE (🔀) randomly rearranges ALL letters currently on the grid into new positions — this can break up dead-end layouts and sometimes accidentally create new words! Great when you feel stuck. SCORE ×2 (💰) activates a point multiplier that DOUBLES the score of your very next claimed word. Save it for a long word or a chain to maximize points — a 5-letter word goes from 250 to 500!',
                        draw(ctx, w, h, t) {
                            const gs = 4, { cs, ox, oy } = gL(w, h, gs, -10);
                            const cyc = t % 8;
                            if (cyc < 4) {
                                gBg(ctx, ox, oy, cs, gs);
                                const ltrs1 = 'ABCDEFGHIJKLMNOP';
                                const shuffled = 'DKBOPFMACGJELNIH';
                                const p = ease(clamp((cyc - 0.5) / 1.5, 0, 1));
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++) {
                                    const i = r * gs + c;
                                    const l = cyc < 2 ? ltrs1[i] : shuffled[i];
                                    const jitter = cyc > 0.5 && cyc < 2 ? Math.sin(t * 20 + i) * 3 : 0;
                                    ctx.save(); ctx.translate(jitter, jitter * 0.5);
                                    gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                                    ctx.restore();
                                }
                                gT(ctx, w / 2, oy - cs * 0.7, '🔀 Shuffle!',
                                   '#e040fb', Math.floor(cs * 0.4));
                            } else {
                                gBg(ctx, ox, oy, cs, gs);
                                for (let r = 0; r < gs; r++) for (let c = 0; c < gs; c++)
                                    gC(ctx, ox, oy, cs, r, c, 'WORD'[c], '#2a2a3e');
                                const flash = Math.sin(t * 5) > 0;
                                const badge = '×2';
                                gT(ctx, w / 2, oy - cs * 0.8, '💰 Score ×2 Active!',
                                    flash ? '#ffd700' : '#ff9800', Math.floor(cs * 0.35));
                                const word = [[3,0],[3,1],[3,2],[3,3]];
                                for (const [r,c] of word) {
                                    ctx.save(); ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 8;
                                    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                                    ctx.strokeRect(ox + c * cs + 3, oy + r * cs + 3, cs - 6, cs - 6);
                                    ctx.restore();
                                }
                                if (cyc > 5.5) {
                                    const pts = '×2 = 180 pts!';
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.5, pts, '#ffd700', Math.floor(cs * 0.35));
                                }
                            }
                        }
                    }
                ]
            },

            // ═══ GAME MODES ═══
            {
                id: 'modes', icon: '⚙️', label: 'Game Modes',
                desc: 'Choose your playstyle — modes, grid sizes, difficulty & hints',
                slides: [
                    {
                        title: 'Sandbox & Timed',
                        desc: 'Two main game modes to choose from! SANDBOX is relaxed with no time limit — play as long as you want until the grid fills up. Perfect for practicing and learning. TIMED mode gives you a countdown clock — score as many points as possible before time runs out! The game ends when either the timer hits zero or the grid fills up, whichever comes first.',
                        draw(ctx, w, h, t) {
                            const mid = w / 2;
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(mid, h * 0.15); ctx.lineTo(mid, h * 0.85);
                            ctx.stroke();
                            gT(ctx, mid * 0.5, h * 0.2, 'SANDBOX', '#4caf50', 18);
                            gT(ctx, mid * 0.5, h * 0.35, '∞', '#4caf50', 48);
                            gT(ctx, mid * 0.5, h * 0.52, 'No timer', '#888', 13);
                            gT(ctx, mid * 0.5, h * 0.62, 'Relaxed play', '#888', 13);
                            const gs1 = 3, cs1 = Math.floor(mid * 0.22);
                            const ox1 = (mid - gs1 * cs1) / 2, oy1 = h * 0.68;
                            for (let r = 0; r < gs1; r++) for (let c = 0; c < gs1; c++) {
                                ctx.fillStyle = '#1e1e30'; ctx.fillRect(ox1 + c * cs1 + 1, oy1 + r * cs1 + 1, cs1 - 2, cs1 - 2);
                                ctx.strokeStyle = '#333'; ctx.strokeRect(ox1 + c * cs1, oy1 + r * cs1, cs1, cs1);
                            }
                            gT(ctx, mid * 1.5, h * 0.2, 'TIMED', '#f44336', 18);
                            const timeLeft = 300 - (t % 300);
                            const mm = Math.floor(timeLeft / 60), ss = Math.floor(timeLeft % 60);
                            gT(ctx, mid * 1.5, h * 0.35, `${mm}:${String(ss).padStart(2,'0')}`, '#f44336', 32);
                            gT(ctx, mid * 1.5, h * 0.52, 'Beat the clock', '#888', 13);
                            gT(ctx, mid * 1.5, h * 0.62, 'Race for points', '#888', 13);
                            const gs2 = 3, cs2 = cs1;
                            const ox2 = mid + (mid - gs2 * cs2) / 2, oy2 = h * 0.68;
                            for (let r = 0; r < gs2; r++) for (let c = 0; c < gs2; c++) {
                                ctx.fillStyle = '#1e1e30'; ctx.fillRect(ox2 + c * cs2 + 1, oy2 + r * cs2 + 1, cs2 - 2, cs2 - 2);
                                ctx.strokeStyle = '#333'; ctx.strokeRect(ox2 + c * cs2, oy2 + r * cs2, cs2, cs2);
                            }
                        }
                    },
                    {
                        title: 'Grid Sizes & Difficulty',
                        desc: 'Pick your grid from 3×3 (tiny and intense!) up to 8×8 (spacious for big words). Larger grids give you more room to build words but also more letters to manage. On 3×3 and 4×4 grids, 2-letter words like "IT" or "GO" are valid! Larger grids require 3+ letters. Two difficulty levels: CASUAL accepts the minimum word length, while HARD requires 4+ letters — short words won\'t count, forcing you to think bigger!',
                        draw(ctx, w, h, t) {
                            const sizes = [3, 5, 8];
                            const si = Math.floor(t * 0.4) % sizes.length;
                            const gs = sizes[si];
                            const { cs, ox, oy } = gL(w, h, gs, -15);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = gs - 2; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#2a2a3e');
                            gT(ctx, w / 2, oy - cs * 0.9, gs + '×' + gs + ' Grid', '#ffd700', 20);
                            const diffY = oy + gs * cs + 25;
                            gT(ctx, w * 0.3, diffY, 'Casual', '#4caf50', 14);
                            gT(ctx, w * 0.3, diffY + 20, '3+ letters', '#888', 11);
                            gT(ctx, w * 0.7, diffY, 'Hard', '#f44336', 14);
                            gT(ctx, w * 0.7, diffY + 20, '4+ letters', '#888', 11);
                        }
                    },
                    {
                        title: 'Hints System',
                        desc: 'Keep an eye out for cells glowing ORANGE — these are hints! An orange glow means that cell is just ONE letter away from completing a valid word. If you can drop the right letter into that spot, the word will form instantly. Hints update in real-time as the grid changes, so check after every move. They\'re your best friend for spotting opportunities you might otherwise miss!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            const placed = [[4,0,'C'],[4,1,'A'],[4,3,'S'],[4,4,'E'],
                                            [3,0,'R'],[3,2,'N']];
                            for (const [r,c,l] of placed) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const cyc = t % 5;
                            const hintGlow = `rgba(255,165,0,${0.4 + 0.3 * Math.sin(t * 4)})`;
                            gC(ctx, ox, oy, cs, 4, 2, '', '#2a2a3e', hintGlow);
                            gT(ctx, w / 2, oy - cs * 0.7, '🔶 Hint: one letter away!', '#ff9800', Math.floor(cs * 0.3));
                            if (cyc > 2) {
                                const row = lerp(-1, 4, ease(clamp((cyc - 2) / 1.5, 0, 1)));
                                gF(ctx, ox, oy, cs, clamp(row, -0.5, 4), 2, 'T');
                                if (cyc > 3.8) {
                                    const word = [[4,0],[4,1],[4,2]];
                                    for (const [wr,wc] of word) {
                                        ctx.save(); ctx.shadowColor = '#4caf50'; ctx.shadowBlur = 8;
                                        ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 2;
                                        ctx.strokeRect(ox + wc * cs + 3, oy + wr * cs + 3, cs - 6, cs - 6);
                                        ctx.restore();
                                    }
                                    gC(ctx, ox, oy, cs, 4, 2, 'T', '#2e5c2e', '#4caf50');
                                    gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '"CAT" complete!', '#4caf50', Math.floor(cs * 0.3));
                                }
                            }
                        }
                    }
                ]
            },

            // ═══ CHALLENGES ═══
            {
                id: 'challenges', icon: '🏆', label: 'Challenges',
                desc: 'Special timed modes with unique twists',
                slides: [
                    {
                        title: 'Target Word',
                        desc: 'In Target Word challenge, a specific word (3-5 letters) appears at the top of the screen. Your goal: spell that exact word somewhere in the grid — horizontally, vertically, or diagonally! When you do, you earn a 200-point bonus on top of the normal word score, and a new target word is assigned. All challenges are 7 minutes long, use Casual difficulty, and are limited to 6×6, 7×7, or 8×8 grids. Your stats are tracked separately for each challenge!',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, 15);
                            gBg(ctx, ox, oy, cs, gs);
                            const target = 'PLAY';
                            const targetY = oy - cs * 1.4;
                            ctx.fillStyle = '#1a1a2e';
                            const tw = cs * 5, th = cs * 0.8;
                            ctx.fillRect((w - tw) / 2, targetY - th / 2, tw, th);
                            ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
                            ctx.strokeRect((w - tw) / 2, targetY - th / 2, tw, th);
                            gT(ctx, w / 2, targetY, '🎯 ' + target, '#ffd700', Math.floor(cs * 0.4));
                            const cyc = t % 6;
                            const letters = [
                                { l:'P', r:4, c:0, t:0 },
                                { l:'L', r:4, c:1, t:1.2 },
                                { l:'A', r:4, c:2, t:2.4 },
                                { l:'Y', r:4, c:3, t:3.6 }
                            ];
                            const otherCells = [[4,4,'E'],[3,0,'S'],[3,2,'T']];
                            for (const [r,c,l] of otherCells) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            for (const lt of letters) {
                                if (cyc < lt.t) continue;
                                const p = cyc - lt.t;
                                if (p < 1) {
                                    const row = lerp(-1, lt.r, ease(Math.min(p / 0.8, 1)));
                                    gF(ctx, ox, oy, cs, clamp(row, -0.5, lt.r), lt.c, lt.l);
                                } else {
                                    const complete = letters.every(x => cyc >= x.t + 1);
                                    gC(ctx, ox, oy, cs, lt.r, lt.c, lt.l,
                                        complete ? '#2e5c2e' : '#2a2a3e',
                                        complete ? '#4caf50' : null);
                                }
                            }
                            if (cyc > 5) {
                                gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '+200 BONUS!', '#ffd700',
                                    Math.floor(cs * 0.4), clamp((cyc - 5) * 3, 0, 1));
                            }
                        }
                    },
                    {
                        title: 'Speed Round',
                        desc: 'Speed Round starts at normal pace, but every 500 points the falling speed INCREASES! Blocks drop faster and faster, leaving you less time to think and place them. There is NO spawn freeze — the next block starts falling immediately! The speed keeps ramping up until it hits maximum velocity. Score as high as you can in 3 minutes before the grid fills up! This challenge tests your reaction time and quick thinking.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#2a2a3e');
                            const speed = 0.5 + (t % 10) * 0.15;
                            const meterX = ox + gs * cs + 12, meterY = oy;
                            const meterH = gs * cs, meterW = 12;
                            ctx.fillStyle = '#333'; ctx.fillRect(meterX, meterY, meterW, meterH);
                            const fill = Math.min(speed / 2, 1);
                            const grad = ctx.createLinearGradient(0, meterY + meterH, 0, meterY);
                            grad.addColorStop(0, '#4caf50'); grad.addColorStop(0.5, '#ff9800'); grad.addColorStop(1, '#f44336');
                            ctx.fillStyle = grad;
                            ctx.fillRect(meterX, meterY + meterH * (1 - fill), meterW, meterH * fill);
                            gT(ctx, meterX + meterW / 2, meterY - 14, '⚡', '#fff', 14);
                            const fallSpeed = 0.3 + fill * 2;
                            const fallRow = ((t * fallSpeed) % (gs + 1)) - 1;
                            gF(ctx, ox, oy, cs, clamp(fallRow, -0.5, 2), 2, 'Z');
                            gT(ctx, ox + gs * cs / 2, oy - cs * 0.7,
                                `Speed: ${speed.toFixed(1)}×`, '#ff9800', Math.floor(cs * 0.35));
                        }
                    },
                    {
                        title: 'Word Category',
                        desc: 'In Word Category challenge, you are given a category like "Food & Cooking" or "Animals" at the top of the screen. Your goal: find as many words that fit the category as possible! Category words earn 2× points, while other words earn only ¼ the usual points. The more category words you find, the more XP you earn. Finding zero category words slashes your XP! Swipe left on the Words Found screen to see your category matches. Game lasts 7 minutes.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, 15);
                            gBg(ctx, ox, oy, cs, gs);
                            // Category banner
                            const catY = oy - cs * 1.4;
                            ctx.fillStyle = '#1a1a2e';
                            const tw = cs * 5, th = cs * 0.8;
                            ctx.fillRect((w - tw) / 2, catY - th / 2, tw, th);
                            ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 1;
                            ctx.strokeRect((w - tw) / 2, catY - th / 2, tw, th);
                            gT(ctx, w / 2, catY, '📂 Food', '#4caf50', Math.floor(cs * 0.4));
                            const foodCells = [
                                [3,0,'C'],[3,1,'A'],[3,2,'K'],[3,3,'E'],
                                [4,1,'P'],[4,2,'I'],[4,3,'E']
                            ];
                            const otherCells = [[4,0,'X'],[4,4,'R'],[3,4,'W'],[2,0,'N'],[2,3,'H']];
                            for (const [r,c,l] of otherCells) gC(ctx, ox, oy, cs, r, c, l, '#2a2a3e');
                            const cyc = t % 4;
                            for (let i = 0; i < foodCells.length; i++) {
                                const [r,c,l] = foodCells[i];
                                const lit = cyc > 2;
                                gC(ctx, ox, oy, cs, r, c, l, lit ? '#2e5c2e' : '#2a2a3e', lit ? '#4caf50' : null);
                            }
                            if (cyc > 2.5) {
                                gT(ctx, w / 2, oy + gs * cs + cs * 0.5, '2× POINTS!', '#4caf50',
                                    Math.floor(cs * 0.4), clamp((cyc - 2.5) * 3, 0, 1));
                            }
                        }
                    }
                ]
            },

            // ═══ MUSIC ═══
            {
                id: 'music', icon: '🎵', label: 'Music',
                desc: 'Background music player with custom playlists',
                slides: [
                    {
                        title: 'Browsing & Playing',
                        desc: 'Tap the 🎵 Music button on the main menu to open the music screen. You\'ll see a list of all available tracks with their title and artist. Tap the circular ▶ play button next to any track to start playing it — the currently playing track is highlighted with a gold border. Music continues playing in the background while you play the game, so pick your vibe before you start!',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 30, cw, h - 60);
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 30, cw, h - 60);
                            gT(ctx, w / 2, 55, '🎵 Music', '#ffd700', 18);
                            const tabs = ['All Songs', 'My Mix', '+ New'];
                            const tabW = cw / tabs.length;
                            for (let i = 0; i < tabs.length; i++) {
                                const tx = pad + i * tabW, ty = 72;
                                const active = i === 0;
                                ctx.fillStyle = active ? '#ffd700' : '#333';
                                ctx.fillRect(tx + 4, ty, tabW - 8, 26);
                                ctx.fillStyle = active ? '#111' : '#888';
                                ctx.font = 'bold 11px sans-serif';
                                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(tabs[i], tx + tabW / 2, ty + 13);
                            }
                            const tracks = [
                                { title: 'Sunset Vibes', artist: 'ChillBeats' },
                                { title: 'Focus Flow', artist: 'LofiLab' },
                                { title: 'Night Drive', artist: 'SynthWave' },
                                { title: 'Pixel Dreams', artist: 'RetroFM' }
                            ];
                            const playing = Math.floor(t * 0.4) % tracks.length;
                            for (let i = 0; i < tracks.length; i++) {
                                const ty = 108 + i * 44;
                                const pl = i === playing;
                                ctx.fillStyle = pl ? 'rgba(255,215,0,0.1)' : 'transparent';
                                ctx.fillRect(pad + 10, ty, cw - 20, 38);
                                ctx.strokeStyle = pl ? '#ffd700' : '#444';
                                ctx.strokeRect(pad + 10, ty, cw - 20, 38);
                                const btnX = pad + 28, btnY = ty + 19;
                                ctx.beginPath(); ctx.arc(btnX, btnY, 12, 0, Math.PI * 2);
                                ctx.fillStyle = pl ? '#ffd700' : '#444'; ctx.fill();
                                ctx.fillStyle = pl ? '#111' : '#aaa';
                                ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(pl ? '⏸' : '▶', btnX, btnY);
                                ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
                                ctx.fillText(tracks[i].title, pad + 48, ty + 14);
                                ctx.fillStyle = '#888'; ctx.font = '9px sans-serif';
                                ctx.fillText(tracks[i].artist, pad + 48, ty + 28);
                                if (pl) {
                                    gTap(ctx, btnX, btnY, t);
                                }
                            }
                            const barY = h - 60, barW = cw - 40;
                            ctx.fillStyle = '#333'; ctx.fillRect(pad + 20, barY, barW, 5);
                            const prog = (t * 0.05) % 1;
                            ctx.fillStyle = '#ffd700'; ctx.fillRect(pad + 20, barY, barW * prog, 5);
                        }
                    },
                    {
                        title: 'Reordering Tracks',
                        desc: 'Want to change the play order? Each track has ▲ UP and ▼ DOWN arrow buttons on the right side. Tap them to move that song higher or lower in the list. The order you set is saved and used for auto-play — when one song finishes, the next one in your list starts automatically. Reorder the default "All Songs" list or any custom playlist you create!',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(pad, 40, cw, h - 80);
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.strokeRect(pad, 40, cw, h - 80);
                            gT(ctx, w / 2, 60, 'Reorder Tracks', '#ffd700', 16);
                            const names = ['Sunset Vibes', 'Focus Flow', 'Night Drive'];
                            const cyc = t % 4;
                            const swapA = 0, swapB = 1;
                            let order = [0, 1, 2];
                            if (cyc > 2) order = [1, 0, 2];
                            for (let i = 0; i < 3; i++) {
                                const idx = order[i];
                                const ty = 85 + i * 56;
                                const moving = (cyc > 1 && cyc < 2.5 && idx === 0);
                                const yOff = moving ? Math.sin((cyc - 1) * Math.PI) * -20 : 0;
                                ctx.save(); ctx.translate(0, yOff);
                                ctx.fillStyle = moving ? 'rgba(255,215,0,0.15)' : 'transparent';
                                ctx.fillRect(pad + 10, ty, cw - 20, 46);
                                ctx.strokeStyle = moving ? '#ffd700' : '#444';
                                ctx.strokeRect(pad + 10, ty, cw - 20, 46);
                                ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
                                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText(names[idx], pad + 22, ty + 23);
                                const arX = pad + cw - 50;
                                ctx.fillStyle = '#555'; ctx.font = '16px sans-serif';
                                ctx.textAlign = 'center';
                                ctx.fillText('▲', arX, ty + 14);
                                ctx.fillText('▼', arX + 24, ty + 14);
                                ctx.fillStyle = '#444'; ctx.font = '10px sans-serif';
                                ctx.fillText('▲', arX, ty + 34);
                                ctx.fillText('▼', arX + 24, ty + 34);
                                ctx.restore();
                            }
                            if (cyc > 0.5 && cyc < 2) {
                                const arX = pad + cw - 50;
                                const ty = 85;
                                gTap(ctx, arX, ty + 14, t);
                                gT(ctx, w / 2, h - 50, '▲ Move up!', '#ffd700', 14);
                            } else if (cyc > 2.5) {
                                gT(ctx, w / 2, h - 50, 'Track moved ✓', '#4caf50', 14);
                            }
                        }
                    },
                    {
                        title: 'Custom Playlists',
                        desc: 'Create your own playlists! Tap the "+ New" tab at the top of the music screen to open the playlist creator. Give your playlist a name, then check the boxes next to the songs you want to include. Tap Save and your playlist appears as a new tab! You can switch between playlists by tapping the tabs. Each custom playlist can be renamed, deleted, or have tracks removed with the ✕ button.',
                        draw(ctx, w, h, t) {
                            const pad = 20, cw = w - pad * 2;
                            const cyc = t % 8;
                            if (cyc < 4) {
                                ctx.fillStyle = '#1a1a2e';
                                ctx.fillRect(pad, 30, cw, h - 60);
                                ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad, 30, cw, h - 60);
                                gT(ctx, w / 2, 52, 'Create Playlist', '#ffd700', 16);
                                const inputY = 68;
                                ctx.fillStyle = '#222'; ctx.fillRect(pad + 16, inputY, cw - 32, 28);
                                ctx.strokeStyle = '#555'; ctx.strokeRect(pad + 16, inputY, cw - 32, 28);
                                const nameProgress = clamp(cyc / 1.5, 0, 1);
                                const typedName = 'Chill Vibes'.substring(0, Math.floor(nameProgress * 11));
                                ctx.fillStyle = typedName ? '#fff' : '#666';
                                ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText(typedName || 'Playlist name...', pad + 24, inputY + 14);
                                if (nameProgress < 1) {
                                    ctx.fillStyle = '#ffd700'; ctx.fillRect(pad + 24 + ctx.measureText(typedName).width, inputY + 4, 2, 20);
                                }
                                const songs = ['Sunset Vibes', 'Focus Flow', 'Night Drive', 'Pixel Dreams', 'Ocean Waves'];
                                const checkOrder = [0, 2, 4];
                                for (let i = 0; i < songs.length; i++) {
                                    const sy = 106 + i * 32;
                                    const checkTime = checkOrder.indexOf(i);
                                    const checked = checkTime !== -1 && cyc > 1.5 + checkTime * 0.6;
                                    ctx.fillStyle = '#222'; ctx.fillRect(pad + 16, sy, cw - 32, 28);
                                    ctx.strokeStyle = '#444'; ctx.strokeRect(pad + 16, sy, cw - 32, 28);
                                    const bx = pad + 24, by = sy + 6;
                                    ctx.strokeStyle = checked ? '#ffd700' : '#555'; ctx.lineWidth = 1.5;
                                    ctx.strokeRect(bx, by, 16, 16);
                                    if (checked) {
                                        ctx.fillStyle = '#ffd700'; ctx.font = 'bold 13px sans-serif';
                                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                        ctx.fillText('✓', bx + 8, by + 9);
                                    }
                                    ctx.fillStyle = '#ccc'; ctx.font = '11px sans-serif';
                                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                    ctx.fillText(songs[i], bx + 24, sy + 14);
                                }
                                if (cyc > 3.2) {
                                    const saveW = 80, saveH = 30;
                                    const saveX = (w - saveW) / 2, saveY = h - 75;
                                    ctx.fillStyle = '#ffd700'; ctx.fillRect(saveX, saveY, saveW, saveH);
                                    ctx.fillStyle = '#111'; ctx.font = 'bold 13px sans-serif';
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText('Save', saveX + saveW / 2, saveY + saveH / 2);
                                    gTap(ctx, saveX + saveW / 2, saveY + saveH / 2, t);
                                }
                            } else {
                                ctx.fillStyle = '#1a1a2e';
                                ctx.fillRect(pad, 30, cw, h - 60);
                                ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                                ctx.strokeRect(pad, 30, cw, h - 60);
                                gT(ctx, w / 2, 52, '🎵 Music', '#ffd700', 16);
                                const tabs = ['All Songs', 'Chill Vibes', '+ New'];
                                const tabW = cw / tabs.length;
                                const activeTab = 1;
                                for (let i = 0; i < tabs.length; i++) {
                                    const tx = pad + i * tabW, ty = 68;
                                    ctx.fillStyle = i === activeTab ? '#ffd700' : '#333';
                                    ctx.fillRect(tx + 3, ty, tabW - 6, 24);
                                    ctx.fillStyle = i === activeTab ? '#111' : '#888';
                                    ctx.font = 'bold 10px sans-serif';
                                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                    ctx.fillText(tabs[i], tx + tabW / 2, ty + 12);
                                }
                                const plTracks = ['Sunset Vibes', 'Night Drive', 'Ocean Waves'];
                                for (let i = 0; i < plTracks.length; i++) {
                                    const ty = 104 + i * 44;
                                    ctx.fillStyle = 'transparent';
                                    ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
                                    ctx.strokeRect(pad + 10, ty, cw - 20, 38);
                                    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
                                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                    ctx.fillText(plTracks[i], pad + 24, ty + 19);
                                    ctx.fillStyle = '#f44336'; ctx.font = '12px sans-serif';
                                    ctx.textAlign = 'center';
                                    ctx.fillText('✕', pad + cw - 30, ty + 19);
                                }
                                const flash = Math.sin(t * 4) > 0;
                                gT(ctx, w / 2, h - 55, 'Playlist created! ✓',
                                    flash ? '#ffd700' : '#4caf50', 14);
                            }
                        }
                    },
                    {
                        title: 'In-Game Controls',
                        desc: 'You don\'t have to leave the game to control your music! A mini now-playing bar appears at the bottom of the screen showing the current track name. It has ◁ previous, ▶ play/pause, and ▷ next buttons so you can skip songs or pause without interrupting your game. Music auto-advances to the next track in your playlist when a song finishes.',
                        draw(ctx, w, h, t) {
                            const gs = 5, { cs, ox, oy } = gL(w, h, gs, -30);
                            gBg(ctx, ox, oy, cs, gs);
                            for (let r = 3; r < gs; r++) for (let c = 0; c < gs; c++)
                                gC(ctx, ox, oy, cs, r, c, String.fromCharCode(65 + (r * gs + c) % 26), '#2a2a3e');
                            const fallRow = ((t * 0.5) % 4) - 1;
                            gF(ctx, ox, oy, cs, clamp(fallRow, -0.5, 2), 2, 'M');
                            gT(ctx, w / 2, oy - cs * 0.7, 'Score: 1250', '#fff', Math.floor(cs * 0.3));
                            const barH = 48, barY = h - barH - 10;
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(10, barY, w - 20, barH);
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.strokeRect(10, barY, w - 20, barH);
                            const songNames = ['♪ Sunset Vibes – ChillBeats', '♪ Focus Flow – LofiLab'];
                            const si = Math.floor(t * 0.15) % songNames.length;
                            ctx.fillStyle = '#ccc'; ctx.font = '10px sans-serif';
                            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                            ctx.fillText(songNames[si], 22, barY + 18);
                            const btnY = barY + 34;
                            const btns = ['◁', '▶', '▷'];
                            const btnSpace = 40;
                            const btnStartX = w / 2 - btnSpace;
                            for (let i = 0; i < 3; i++) {
                                const bx = btnStartX + i * btnSpace;
                                ctx.beginPath(); ctx.arc(bx, btnY, 12, 0, Math.PI * 2);
                                ctx.fillStyle = i === 1 ? '#ffd700' : '#444'; ctx.fill();
                                ctx.fillStyle = i === 1 ? '#111' : '#ccc';
                                ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                                ctx.fillText(btns[i], bx, btnY);
                            }
                            const progW = w - 60, progY = barY + 6;
                            ctx.fillStyle = '#333'; ctx.fillRect(22, progY + 16, progW, 3);
                            const prog = (t * 0.04) % 1;
                            ctx.fillStyle = '#ffd700'; ctx.fillRect(22, progY + 16, progW * prog, 3);
                            const cyc = t % 5;
                            if (cyc > 2 && cyc < 3.5) {
                                const nextX = btnStartX + 2 * btnSpace;
                                gTap(ctx, nextX, btnY, t);
                                gT(ctx, w / 2, barY - 14, 'Skip to next ▷', '#ffd700', 12);
                            }
                        }
                    },
                    {
                        title: 'Mute & Unmute',
                        desc: 'The 🔊 speaker button in the top-right corner of the screen is always visible — on every screen and during gameplay. Tap it once to MUTE all music (the icon changes to 🔇). Tap it again to UNMUTE and resume playback right where you left off. Your mute preference is saved, so it stays muted or unmuted across sessions. Perfect for when you need to quickly silence the music without pausing your game!',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#1a1a2e';
                            ctx.fillRect(20, 30, w - 40, h - 60);
                            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
                            ctx.strokeRect(20, 30, w - 40, h - 60);
                            const cyc = t % 6;
                            const muted = cyc > 3;
                            const btnX = w - 55, btnY = 55;
                            const btnSz = 36;
                            ctx.save();
                            const pulse = 1 + Math.sin(t * 4) * 0.08;
                            ctx.translate(btnX, btnY); ctx.scale(pulse, pulse); ctx.translate(-btnX, -btnY);
                            ctx.fillStyle = muted ? '#444' : 'rgba(255,215,0,0.2)';
                            ctx.beginPath(); ctx.arc(btnX, btnY, btnSz / 2, 0, Math.PI * 2); ctx.fill();
                            ctx.strokeStyle = muted ? '#666' : '#ffd700'; ctx.lineWidth = 1.5;
                            ctx.stroke();
                            ctx.fillStyle = '#fff'; ctx.font = `${Math.floor(btnSz * 0.5)}px sans-serif`;
                            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText(muted ? '🔇' : '🔊', btnX, btnY);
                            ctx.restore();
                            if (!muted) {
                                const waves = 3;
                                for (let i = 0; i < waves; i++) {
                                    const r = btnSz / 2 + 8 + i * 10;
                                    const alpha = 0.3 - i * 0.08 + Math.sin(t * 3 + i) * 0.1;
                                    ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
                                    ctx.beginPath();
                                    ctx.arc(btnX, btnY, r, -Math.PI * 0.35, Math.PI * 0.35);
                                    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.stroke();
                                    ctx.restore();
                                }
                            }
                            const barMid = h / 2 + 10;
                            if (!muted) {
                                const barCount = 7;
                                const barW = 12, barGap = 8;
                                const totalW = barCount * barW + (barCount - 1) * barGap;
                                const startX = (w - totalW) / 2;
                                for (let i = 0; i < barCount; i++) {
                                    const bh = 20 + Math.sin(t * 3 + i * 0.8) * 18 + Math.cos(t * 5 + i) * 10;
                                    const x = startX + i * (barW + barGap);
                                    const grad = ctx.createLinearGradient(0, barMid - bh / 2, 0, barMid + bh / 2);
                                    grad.addColorStop(0, '#ffd700'); grad.addColorStop(1, '#ff9800');
                                    ctx.fillStyle = grad;
                                    ctx.fillRect(x, barMid - bh / 2, barW, bh);
                                }
                                gT(ctx, w / 2, barMid + 50, '♪ Now Playing...', '#ffd700', 14);
                            } else {
                                const barCount = 7;
                                const barW = 12, barGap = 8;
                                const totalW = barCount * barW + (barCount - 1) * barGap;
                                const startX = (w - totalW) / 2;
                                for (let i = 0; i < barCount; i++) {
                                    const x = startX + i * (barW + barGap);
                                    ctx.fillStyle = '#333';
                                    ctx.fillRect(x, barMid - 3, barW, 6);
                                }
                                gT(ctx, w / 2, barMid + 50, 'Music Muted', '#666', 14);
                                ctx.save(); ctx.strokeStyle = '#f44336'; ctx.lineWidth = 3;
                                ctx.beginPath();
                                ctx.moveTo(w / 2 - 30, barMid - 20);
                                ctx.lineTo(w / 2 + 30, barMid + 20);
                                ctx.stroke(); ctx.restore();
                            }
                            if (cyc > 2.5 && cyc < 3.5) {
                                gTap(ctx, btnX, btnY, t);
                                gT(ctx, w / 2, h - 50, 'Tap to mute', '#ffd700', 13);
                            } else if (cyc > 5 && cyc < 6) {
                                gTap(ctx, btnX, btnY, t);
                                gT(ctx, w / 2, h - 50, 'Tap to unmute', '#4caf50', 13);
                            }
                        }
                    }
                ]
            },

            // ═══ LEVELING ═══
            {
                id: 'leveling', icon: '⬆️', label: 'Leveling & XP',
                desc: 'Earn XP to level up — push yourself to climb higher!',
                slides: [
                    {
                        title: 'How XP Works',
                        desc: 'Every game earns XP based on multiple factors: your score, grid size (smaller grids give more XP!), word quality (longer words = bigger bonus), difficulty, game mode, time pressure, and how you perform against your personal best. Finding long words, beating your high score, surviving timed modes, and playing on small grids all boost your XP!',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            // Animated level badge
                            const lvl = Math.min(Math.floor(t * 0.6) + 1, 10);
                            ctx.font = 'bold 26px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = '#7eb8ff';
                            ctx.fillText(`Lv. ${lvl}`, w / 2, 28);

                            // XP bar
                            const barX = 40, barY = 50, barW = w - 80, barH = 14;
                            ctx.fillStyle = '#1a2a3e';
                            ctx.fillRect(barX, barY, barW, barH);
                            ctx.strokeStyle = '#2a3a50';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(barX, barY, barW, barH);
                            const cycle = t % 4;
                            const fill = cycle < 3 ? Math.min(cycle / 3, 1) : 1;
                            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                            grad.addColorStop(0, '#3b82f6');
                            grad.addColorStop(1, '#60a5fa');
                            ctx.fillStyle = grad;
                            ctx.fillRect(barX, barY, barW * fill, barH);

                            if (cycle >= 3) {
                                const fl = Math.sin(t * 8) > 0;
                                ctx.font = 'bold 18px sans-serif';
                                ctx.fillStyle = fl ? '#ffd700' : '#ff9800';
                                ctx.fillText('LEVEL UP!', w / 2, 88);
                            }

                            // Multiplier icons
                            const items = [
                                { icon: '🎯', label: 'Hard Mode', mult: '1.5×', color: '#f44336' },
                                { icon: '⏱️', label: 'Timed', mult: '1.3×', color: '#ff9800' },
                                { icon: '🏆', label: 'Challenge', mult: '1.4×', color: '#ffd700' },
                                { icon: '📏', label: 'Small Grid', mult: '1.8×', color: '#4caf50' },
                            ];
                            for (let i = 0; i < items.length; i++) {
                                const x = 20, y = 108 + i * 24;
                                ctx.font = '12px sans-serif';
                                ctx.textAlign = 'left';
                                ctx.fillStyle = '#fff';
                                ctx.fillText(items[i].icon + ' ' + items[i].label, x, y);
                                ctx.textAlign = 'right';
                                ctx.fillStyle = items[i].color;
                                ctx.fillText(items[i].mult + ' XP', w - 20, y);
                            }
                        }
                    },
                    {
                        title: 'Beating Your Best',
                        desc: 'Your best score in each mode combo (grid size + difficulty + game type) is tracked. Score higher than your personal best to get bonus XP! The bigger the improvement, the bigger the bonus. If you score much lower, you still get XP, but less. The system compares every game against YOUR history — you\'re always competing with yourself.',
                        draw(ctx, w, h, t) {
                            ctx.fillStyle = '#0d1117';
                            ctx.fillRect(0, 0, w, h);

                            gT(ctx, w / 2, 24, 'Your Best: 500 pts', '#888', 14);

                            const cyc = t % 6;
                            const scenarios = [
                                { score: 720, label: 'Beat PB by 44%!', color: '#4caf50', bonus: '+50 bonus XP!', mult: '1.22×' },
                                { score: 480, label: '96% of PB', color: '#ff9800', bonus: 'Normal XP', mult: '1.0×' },
                                { score: 200, label: '40% of PB', color: '#f44336', bonus: 'Reduced XP', mult: '0.5×' },
                            ];
                            const si = Math.floor(cyc / 2) % scenarios.length;
                            const s = scenarios[si];

                            ctx.font = 'bold 28px sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillStyle = s.color;
                            ctx.fillText(`Score: ${s.score}`, w / 2, 65);

                            ctx.font = '14px sans-serif';
                            ctx.fillStyle = '#aaa';
                            ctx.fillText(s.label, w / 2, 90);

                            // XP bar animation
                            const barX = 40, barY = 110, barW = w - 80, barH = 12;
                            ctx.fillStyle = '#1a2a3e';
                            ctx.fillRect(barX, barY, barW, barH);
                            const phase = (cyc % 2);
                            const fillPct = Math.min(phase / 1.5, 1);
                            const g2 = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                            g2.addColorStop(0, '#3b82f6'); g2.addColorStop(1, '#60a5fa');
                            ctx.fillStyle = g2;
                            ctx.fillRect(barX, barY, barW * fillPct * (si === 0 ? 0.9 : si === 1 ? 0.5 : 0.2), barH);

                            ctx.font = 'bold 16px sans-serif';
                            ctx.fillStyle = s.color;
                            ctx.fillText(s.bonus, w / 2, 148);

                            ctx.font = '12px sans-serif';
                            ctx.fillStyle = '#666';
                            ctx.fillText(`XP multiplier: ${s.mult}`, w / 2, 170);
                        }
                    }
                ]
            }
        ];
    }

    _openTutorial() {
        this._initTutorialSlides();
        this._stopTutorialAnim();

        // Build category buttons
        const list = this.els.tutorialMenuList;
        list.innerHTML = '';
        for (let i = 0; i < this._tutorialCategories.length; i++) {
            const cat = this._tutorialCategories[i];
            const btn = document.createElement('button');
            btn.className = 'tutorial-category-btn';
            btn.innerHTML = `<span class="tutorial-cat-icon">${cat.icon}</span>
                <span class="tutorial-cat-info">
                    <span class="tutorial-cat-label">${cat.label}</span>
                    <span class="tutorial-cat-desc">${cat.desc}</span>
                </span>`;
            btn.addEventListener('click', () => this._openTutorialCategory(i));
            list.appendChild(btn);
        }

        this.els.tutorialMenu.style.display = '';
        this.els.tutorialSlides.classList.add('hidden');
        this.els.tutorialOverlay.classList.add('active');
    }

    _openTutorialCategory(catIndex) {
        this._tutorialCatIndex = catIndex;
        this._tutorialIndex = 0;
        const cat = this._tutorialCategories[catIndex];
        this._tutorialSlides = cat.slides;
        this._tutorialTotal = cat.slides.length;

        // Build dots
        const dots = this.els.tutorialDots;
        dots.innerHTML = '';
        for (let i = 0; i < this._tutorialTotal; i++) {
            const dot = document.createElement('button');
            dot.className = 'tutorial-dot' + (i === 0 ? ' active' : '');
            dot.addEventListener('click', () => this._goToTutorialSlide(i));
            dots.appendChild(dot);
        }

        // Build all slide panels in the strip
        const strip = this.els.tutorialSlideStrip;
        strip.innerHTML = '';
        strip.style.transform = 'translateX(0)';
        this._tutorialCanvases = [];
        for (let i = 0; i < this._tutorialTotal; i++) {
            const slide = this._tutorialSlides[i];
            const panel = document.createElement('div');
            panel.className = 'tutorial-slide-panel';

            if (slide.img) {
                const img = document.createElement('img');
                img.src = slide.img;
                img.alt = slide.title;
                panel.appendChild(img);
                this._tutorialCanvases.push(null);
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = 360;
                canvas.height = 360;
                panel.appendChild(canvas);
                this._tutorialCanvases.push(canvas);
            }

            const title = document.createElement('h3');
            title.textContent = slide.title;
            panel.appendChild(title);

            const desc = document.createElement('p');
            desc.textContent = slide.desc;
            panel.appendChild(desc);

            strip.appendChild(panel);
        }

        this.els.tutorialMenu.style.display = 'none';
        this.els.tutorialSlides.classList.remove('hidden');
        this._updateTutorialNav();
        this._startTutorialAnim();
        this._bindTutorialSwipe();
    }

    _tutorialBackToMenu() {
        this._stopTutorialAnim();
        this._unbindTutorialSwipe();
        this.els.tutorialSlides.classList.add('hidden');
        this.els.tutorialMenu.style.display = '';
    }

    _closeTutorial() {
        this._stopTutorialAnim();
        this._unbindTutorialSwipe();
        this.els.tutorialOverlay.classList.remove('active');
    }

    _goToTutorialSlide(index) {
        this._tutorialIndex = Math.max(0, Math.min(index, this._tutorialTotal - 1));
        const strip = this.els.tutorialSlideStrip;
        strip.classList.remove('swiping');
        strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
        this._updateTutorialNav();
    }

    _updateTutorialNav() {
        this.els.tutorialCounter.textContent = `${this._tutorialIndex + 1} / ${this._tutorialTotal}`;
        const dots = this.els.tutorialDots.querySelectorAll('.tutorial-dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === this._tutorialIndex));
        this.els.tutorialPrevBtn.disabled = this._tutorialIndex === 0;
        this.els.tutorialNextBtn.disabled = this._tutorialIndex === this._tutorialTotal - 1;
    }

    _startTutorialAnim() {
        this._stopTutorialAnim();
        this._tutorialAnimStart = performance.now();

        // Set up all canvases
        this._tutorialCanvasContexts = [];
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 0; i < this._tutorialTotal; i++) {
            const canvas = this._tutorialCanvases[i];
            if (!canvas) { this._tutorialCanvasContexts.push(null); continue; }
            const ctx = canvas.getContext('2d');
            const rect = canvas.getBoundingClientRect();
            if (rect.width > 0) {
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                this._tutorialCanvasContexts.push({ ctx, w: rect.width, h: rect.height });
            } else {
                this._tutorialCanvasContexts.push(null);
            }
        }

        const tick = () => {
            if (!this._tutorialAnimId) return;
            const t = (performance.now() - this._tutorialAnimStart) / 1000;
            // Only draw the current slide's canvas (and neighbors for mid-swipe)
            for (let i = Math.max(0, this._tutorialIndex - 1); i <= Math.min(this._tutorialTotal - 1, this._tutorialIndex + 1); i++) {
                const info = this._tutorialCanvasContexts[i];
                const slide = this._tutorialSlides[i];
                if (info && slide && slide.draw) {
                    info.ctx.clearRect(0, 0, info.w, info.h);
                    slide.draw(info.ctx, info.w, info.h, t);
                }
            }
            this._tutorialAnimId = requestAnimationFrame(tick);
        };
        // Delay first frame slightly so canvas getBoundingClientRect has valid dimensions
        requestAnimationFrame(() => {
            // Re-measure any canvases that had 0 dimensions
            for (let i = 0; i < this._tutorialTotal; i++) {
                if (this._tutorialCanvasContexts[i]) continue;
                const canvas = this._tutorialCanvases[i];
                if (!canvas) continue;
                const ctx = canvas.getContext('2d');
                const rect = canvas.getBoundingClientRect();
                if (rect.width > 0) {
                    canvas.width = rect.width * dpr;
                    canvas.height = rect.height * dpr;
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    this._tutorialCanvasContexts[i] = { ctx, w: rect.width, h: rect.height };
                }
            }
            this._tutorialAnimId = requestAnimationFrame(tick);
        });
    }

    _stopTutorialAnim() {
        if (this._tutorialAnimId) {
            cancelAnimationFrame(this._tutorialAnimId);
            this._tutorialAnimId = null;
        }
    }

    _bindTutorialSwipe() {
        const view = this.els.tutorialSlides;
        const strip = this.els.tutorialSlideStrip;
        let startX = 0, startY = 0, dragging = false, moved = false;

        this._tutorialPointerDown = (e) => {
            dragging = true; moved = false;
            startX = e.touches ? e.touches[0].clientX : e.clientX;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            strip.classList.add('swiping');
        };

        this._tutorialPointerMove = (e) => {
            if (!dragging) return;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            const dx = x - startX, dy = y - startY;
            if (!moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
                dragging = false;
                strip.classList.remove('swiping');
                strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
                return;
            }
            if (Math.abs(dx) > 10) moved = true;
            if (moved && e.cancelable) e.preventDefault();
            if (moved) {
                const viewW = this.els.tutorialSlideView.offsetWidth || 300;
                const baseOffset = -this._tutorialIndex * viewW;
                const atStart = this._tutorialIndex === 0 && dx > 0;
                const atEnd = this._tutorialIndex === this._tutorialTotal - 1 && dx < 0;
                const dampened = (atStart || atEnd) ? dx * 0.25 : dx;
                strip.style.transform = `translateX(${baseOffset + dampened}px)`;
            }
        };

        this._tutorialPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            strip.classList.remove('swiping');
            const x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const dx = x - startX;
            const viewW = this.els.tutorialSlideView.offsetWidth || 300;
            const threshold = viewW * 0.15;

            if (Math.abs(dx) > threshold) {
                if (dx < 0 && this._tutorialIndex < this._tutorialTotal - 1) {
                    this._tutorialIndex++;
                } else if (dx > 0 && this._tutorialIndex > 0) {
                    this._tutorialIndex--;
                }
            }
            strip.style.transform = `translateX(-${this._tutorialIndex * 100}%)`;
            this._updateTutorialNav();
        };

        view.addEventListener('touchstart', this._tutorialPointerDown, { passive: true });
        view.addEventListener('touchmove', this._tutorialPointerMove, { passive: false });
        view.addEventListener('touchend', this._tutorialPointerUp);
        view.addEventListener('mousedown', this._tutorialPointerDown);
        view.addEventListener('mousemove', this._tutorialPointerMove);
        view.addEventListener('mouseup', this._tutorialPointerUp);
        view.addEventListener('mouseleave', this._tutorialPointerUp);
    }

    _unbindTutorialSwipe() {
        const view = this.els.tutorialSlides;
        if (this._tutorialPointerDown) {
            view.removeEventListener('touchstart', this._tutorialPointerDown);
            view.removeEventListener('touchmove', this._tutorialPointerMove);
            view.removeEventListener('touchend', this._tutorialPointerUp);
            view.removeEventListener('mousedown', this._tutorialPointerDown);
            view.removeEventListener('mousemove', this._tutorialPointerMove);
            view.removeEventListener('mouseup', this._tutorialPointerUp);
            view.removeEventListener('mouseleave', this._tutorialPointerUp);
        }
    }

    _renderMusicScreen() {
        this._renderPlaylistTabs();
        this._renderTrackList();
        this._updateMusicUI();
        // Show/hide playlist actions for custom playlists
        this.els.playlistActions.classList.toggle("hidden", this.activePlaylistTab === "__default");
    }

    _renderPlaylistTabs() {
        // Remove old custom tabs
        this.els.playlistTabs.querySelectorAll(".playlist-tab:not(.add-tab)").forEach(el => {
            if (el.dataset.playlist !== "__default") el.remove();
        });
        // Remove default tab's active class and re-query
        const defaultTab = this.els.playlistTabs.querySelector('[data-playlist="__default"]');
        if (defaultTab) defaultTab.classList.toggle("active", this.activePlaylistTab === "__default");

        // Add custom playlist tabs before the "+ New" button
        for (const pl of this.plMgr.getCustomPlaylists()) {
            const tab = document.createElement("button");
            tab.className = "playlist-tab" + (this.activePlaylistTab === pl.name ? " active" : "");
            tab.dataset.playlist = pl.name;
            tab.textContent = pl.name;
            tab.addEventListener("click", () => {
                this.activePlaylistTab = pl.name;
                this._renderMusicScreen();
            });
            this.els.playlistTabs.insertBefore(tab, this.els.newPlaylistTab);
        }

        // Default tab click
        if (defaultTab) {
            defaultTab.onclick = () => {
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            };
        }
    }

    _renderTrackList() {
        const container = this.els.trackList;
        container.innerHTML = "";
        const isCustom = this.activePlaylistTab !== "__default";
        const tracks = this.plMgr.getPlaylistTracks(this.activePlaylistTab);
        const trackIds = this.plMgr.getPlaylistTrackIds(this.activePlaylistTab);

        if (tracks.length === 0) {
            container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No tracks in this playlist.</p>';
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement("div");
            item.className = "track-item" + (track.id === this.music.currentTrackId ? " playing" : "");
            item.dataset.trackId = track.id;

            const isPlaying = track.id === this.music.currentTrackId && this.music.playing;

            item.innerHTML = `
                <button class="track-play-btn">${isPlaying ? "⏸" : "▶"}</button>
                <div class="track-info">
                    <div class="track-name">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="track-reorder">
                    <button class="reorder-btn move-up" ${index === 0 ? "disabled" : ""}>▲</button>
                    <button class="reorder-btn move-down" ${index === tracks.length - 1 ? "disabled" : ""}>▼</button>
                </div>
                ${isCustom ? '<button class="track-remove-btn" title="Remove from playlist">✕</button>' : ""}
            `;

            // Play button
            item.querySelector(".track-play-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                if (track.id === this.music.currentTrackId && this.music.playing) {
                    this.music.pause();
                } else {
                    this.music.setActivePlaylist(this.activePlaylistTab);
                    this.music.playTrackById(track.id);
                }
            });

            // Reorder buttons
            item.querySelector(".move-up")?.addEventListener("click", (e) => {
                e.stopPropagation();
                if (index > 0) {
                    this.plMgr.moveTrack(this.activePlaylistTab, index, index - 1);
                    this.music.refreshQueue();
                    this._renderTrackList();
                }
            });
            item.querySelector(".move-down")?.addEventListener("click", (e) => {
                e.stopPropagation();
                if (index < tracks.length - 1) {
                    this.plMgr.moveTrack(this.activePlaylistTab, index, index + 1);
                    this.music.refreshQueue();
                    this._renderTrackList();
                }
            });

            // Remove from custom playlist
            const removeBtn = item.querySelector(".track-remove-btn");
            if (removeBtn) {
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.plMgr.removeTrackFromPlaylist(this.activePlaylistTab, track.id);
                    this.music.refreshQueue();
                    this._renderTrackList();
                });
            }

            // Click row to play
            item.addEventListener("click", () => {
                this.music.setActivePlaylist(this.activePlaylistTab);
                this.music.playTrackById(track.id);
            });

            container.appendChild(item);
        });
    }

    _openPlaylistModal(editName) {
        this._editingPlaylist = editName;
        this.els.playlistModalTitle.textContent = editName ? `Edit: ${editName}` : "New Playlist";
        this.els.playlistNameInput.value = editName || "";

        const existing = editName ? new Set(this.plMgr.getPlaylistTrackIds(editName)) : new Set();
        const picker = this.els.playlistTrackPicker;
        picker.innerHTML = "";

        for (const track of this.plMgr.allTracks) {
            const div = document.createElement("div");
            div.className = "picker-item";
            div.innerHTML = `
                <input type="checkbox" value="${track.id}" ${existing.has(track.id) ? "checked" : ""}>
                <div>
                    <div class="picker-track-name">${track.title}</div>
                    <div class="picker-track-artist">${track.artist}</div>
                </div>
            `;
            div.addEventListener("click", (e) => {
                if (e.target.tagName !== "INPUT") {
                    const cb = div.querySelector("input");
                    cb.checked = !cb.checked;
                }
            });
            picker.appendChild(div);
        }

        this.els.playlistModal.classList.add("active");
        this.els.playlistNameInput.focus();
    }

    _savePlaylistModal() {
        const name = this.els.playlistNameInput.value.trim();
        if (!name) { this.els.playlistNameInput.focus(); return; }

        const checked = [...this.els.playlistTrackPicker.querySelectorAll("input:checked")];
        const trackIds = checked.map(cb => cb.value);

        if (this._editingPlaylist) {
            // Rename if name changed
            if (this._editingPlaylist !== name) {
                this.plMgr.renamePlaylist(this._editingPlaylist, name);
            }
            // Update tracks: delete and recreate
            this.plMgr.deletePlaylist(name);
            this.plMgr.createPlaylist(name, trackIds);
        } else {
            if (!this.plMgr.createPlaylist(name, trackIds)) {
                alert("A playlist with that name already exists.");
                return;
            }
        }

        this.els.playlistModal.classList.remove("active");
        this.activePlaylistTab = name;
        this.music.refreshQueue();
        this._renderMusicScreen();
    }

    // ── Target Word: tap-to-claim ──

    _addValidatedWords(result, words) {
        // Use per-word cell mapping from the detection result.
        // Process longest words first so shorter subsets are always caught.
        const newWordSet = new Set(words);
        const incoming = result.wordCellMap
            .filter(wc => newWordSet.has(wc.word))
            .sort((a, b) => b.word.length - a.word.length);

        for (const wc of incoming) {
            const newCells = new Set(wc.cells);

            // Skip if these exact cells are already validated
            const alreadyValidated = this._validatedWordGroups.some(g => {
                if (g.cells.size !== newCells.size) return false;
                for (const k of g.cells) if (!newCells.has(k)) return false;
                return true;
            });
            if (alreadyValidated) continue;

            // If a longer (or equal-length) existing word already covers all these cells, skip
            const coveredByLonger = this._validatedWordGroups.some(g =>
                g.word.length >= wc.word.length && [...newCells].every(k => g.cells.has(k))
            );
            if (coveredByLonger) continue;

            // Remove any existing shorter words whose cells are entirely within this new longer word
            this._validatedWordGroups = this._validatedWordGroups.filter(g => {
                if (g.word.length >= wc.word.length) return true;
                return ![...g.cells].every(k => newCells.has(k));
            });

            let pts = wc.word.length * 10 * wc.word.length;

            // Word complexity bonus: longer words get progressively more
            // 3-letter base, 4→+15%, 5→+35%, 6→+60%, 7→+90%, 8+→+125%
            const len = wc.word.length;
            if (len >= 4) {
                const complexityMult = 1 + 0.15 * Math.pow(len - 3, 1.4);
                pts = Math.floor(pts * complexityMult);
            }

            // In Target Word / Category challenges, reduce base pts for non-matching words
            const isBonusChallenge = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                || this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY;
            if (isBonusChallenge) {
                const isMatch = this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                    ? (this.targetWord && wc.word === this.targetWord)
                    : (this.activeCategorySet && this.activeCategorySet.has(wc.word));
                if (isMatch) {
                    // Bonus match: 2× base, scaled by category tier
                    const tier = CATEGORY_TIERS[this.activeCategoryKey];
                    const tierMult = tier ? tier.ptsMult : 1.0;
                    pts = Math.floor(pts * 2 * tierMult);
                } else {
                    pts = Math.floor(pts * 0.25);
                }
            }

            this._validatedWordGroups.push({ word: wc.word, cells: newCells, pts });
        }
        this._rebuildValidatedCells();
    }

    _rebuildValidatedCells() {
        const allCells = new Set();
        for (const group of this._validatedWordGroups) {
            for (const key of group.cells) allCells.add(key);
        }
        this.renderer.validatedCells = allCells;
    }

    _handleCanvasTap(clientX, clientY) {
        if (this._validatedWordGroups.length === 0) return;
        if (this.state !== State.PLAYING) return;
        if (this.rowDragActive) return;

        // Convert client coordinates to canvas-relative coordinates
        const rect = this.renderer.canvas.getBoundingClientRect();
        const scaleX = this.renderer.canvas.width / (window.devicePixelRatio || 1) / rect.width;
        const scaleY = this.renderer.canvas.height / (window.devicePixelRatio || 1) / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;

        const { row, col } = this.renderer.pixelToCell(px, py);
        if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) return;

        const key = `${row},${col}`;
        if (!this.renderer.validatedCells.has(key)) return;

        // Found a green cell tap — claim all word groups containing this cell
        this._claimValidatedAt(key);
    }

    _claimValidatedAt(tappedKey) {
        // If a clear animation is in progress, force-finish it immediately
        if (this.clearing && this._pendingClearCells) {
            this.grid.removeCells(this._pendingClearCells);
            this.grid.applyGravity();
            this.renderer.flashCells.clear();
            this.renderer.flashTimer = 0;
            this.renderer.blastCells.clear();
            this.renderer.blastCenterKey = null;
            this.renderer.blastProgress = 0;
            this.renderer.gravityAnims = [];
            this.pendingGravityMoves = [];
            this.clearing = false;
            this._claimAnimating = false;
            this._pendingClearCells = null;
        }

        // Find all validated word groups that include the tapped cell
        const toClaim = [];
        const remaining = [];
        for (const group of this._validatedWordGroups) {
            if (group.cells.has(tappedKey)) {
                toClaim.push(group);
            } else {
                remaining.push(group);
            }
        }
        if (toClaim.length === 0) return;

        // Score claimed words
        const prevScore = this.score;
        const claimedWords = [];
        for (const group of toClaim) {
            let pts = group.pts;
            if (this.scoreMultiplier > 1) {
                pts *= this.scoreMultiplier;
                this.scoreMultiplier = 1;
                this.els.score2xIndicator.classList.add("hidden");
            }
            this.score += pts;
            this.totalWordsInChain++;
            const isBonus = this._isChallengeBonusWord(group.word);
            this.wordsFound.push({ word: group.word, pts, bonus: isBonus });
            claimedWords.push({ word: group.word, pts });
            if (!this._chainWords) this._chainWords = [];
            this._chainWords.push({ word: group.word, pts });

            // Check for target word match
            if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD
                && this.targetWord && group.word === this.targetWord) {
                this.targetWordsCompleted++;
                this.score += 200;
                this._pickTargetWord();
            }

            // Track category word matches
            if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY && isBonus) {
                if (!this.categoryWordsFound) this.categoryWordsFound = [];
                this.categoryWordsFound.push(group.word);
            }
        }
        this._checkBonusUnlock(prevScore, this.score);
        this._updateScoreDisplay();
        this._updateSpeedRound();

        // Collect all cells from claimed groups
        const cellsToClear = new Set();
        for (const group of toClaim) {
            for (const key of group.cells) cellsToClear.add(key);
        }

        // Remove claimed groups; also remove remaining groups whose cells overlap
        // (since those cells are about to be cleared)
        this._validatedWordGroups = remaining.filter(g => {
            for (const key of cellsToClear) {
                if (g.cells.has(key)) return false;
            }
            return true;
        });
        this._rebuildValidatedCells();

        // Show word popup for each claimed word immediately
        if (claimedWords.length > 0) {
            this._showWordPopup(claimedWords);
        }

        // Flash and clear the claimed cells
        if (this.totalWordsInChain > 1) {
            this.audio.chain();
        } else {
            this.audio.clear();
        }
        this._claimAnimating = true;
        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;

        // Reset the falling block back to the top so the player has time to think
        if (this.block) {
            this.block.row = -BUFFER_ROWS;
            this.block.visualRow = -BUFFER_ROWS;
            this.block.dropAnimating = false;
            this.fallTimer = 0;
            this.spawnFreezeTimer = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND ? 0 : 2.0;
        }
    }

    _bindCanvasTap() {
        const canvas = this.renderer.canvas;

        // Click for desktop
        canvas.addEventListener("click", (e) => {
            this._handleCanvasTap(e.clientX, e.clientY);
        });

        // For touch: we need to detect taps (not swipes) on green cells
        // Use a short-distance threshold to distinguish tap from swipe
        let tapStart = null;
        canvas.addEventListener("touchstart", (e) => {
            if (this._validatedWordGroups.length === 0) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            tapStart = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
        }, { passive: true });

        canvas.addEventListener("touchend", (e) => {
            if (!tapStart) return;
            const touch = [...e.changedTouches].find(t => t.identifier === tapStart.id);
            if (!touch) { tapStart = null; return; }
            const dx = touch.clientX - tapStart.x;
            const dy = touch.clientY - tapStart.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 20) {
                // Short enough to be a tap
                this._handleCanvasTap(touch.clientX, touch.clientY);
            }
            tapStart = null;
        }, { passive: true });
    }

    _bindRowDrag() {
        const canvas = this.renderer.canvas;
        let dragPointerId = null;

        // ── Mouse (desktop) ──
        canvas.addEventListener("mousedown", (e) => {
            if (!this.rowDragActive || this.state !== State.PLAYING) return;
            e.preventDefault();
            this._handleRowDragStart(e.clientX, e.clientY);
            dragPointerId = "mouse";
        });
        window.addEventListener("mousemove", (e) => {
            if (dragPointerId !== "mouse") return;
            this._handleRowDragMove(e.clientX, e.clientY);
        });
        window.addEventListener("mouseup", (e) => {
            if (dragPointerId !== "mouse") return;
            dragPointerId = null;
            this._handleRowDragEnd();
        });

        // ── Touch (mobile) ──
        canvas.addEventListener("touchstart", (e) => {
            if (!this.rowDragActive || this.state !== State.PLAYING) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            e.preventDefault();
            dragPointerId = touch.identifier;
            this._handleRowDragStart(touch.clientX, touch.clientY);
        }, { passive: false });
        window.addEventListener("touchmove", (e) => {
            if (dragPointerId === null || dragPointerId === "mouse") return;
            const touch = [...e.changedTouches].find(t => t.identifier === dragPointerId);
            if (!touch) return;
            this._handleRowDragMove(touch.clientX, touch.clientY);
        }, { passive: true });
        window.addEventListener("touchend", (e) => {
            if (dragPointerId === null || dragPointerId === "mouse") return;
            const touch = [...e.changedTouches].find(t => t.identifier === dragPointerId);
            if (!touch) return;
            dragPointerId = null;
            this._handleRowDragEnd();
        }, { passive: true });
        window.addEventListener("touchcancel", (e) => {
            if (dragPointerId === null || dragPointerId === "mouse") return;
            dragPointerId = null;
            this.rowDragRow = -1;
            this.rowDragStartCol = -1;
            this.rowDragCurrentCol = -1;
            this.renderer.rowDragCells.clear();
        }, { passive: true });

        // Escape cancels row drag mode
        document.addEventListener("keydown", (e) => {
            if (!this.rowDragActive) return;
            if (e.code === "Escape") {
                e.preventDefault();
                this._cancelRowDragMode();
            }
        });
    }

    // ── Challenge methods ──

    _renderChallengesGrid() {
        const grid = this.els.challengesGrid;
        grid.innerHTML = "";
        this._stopChallengePreviewAnimations();

        for (const [key, meta] of Object.entries(CHALLENGE_META)) {
            const stats = this.profileMgr.getChallengeStats(key);
            const card = document.createElement("div");
            card.className = "challenge-card";
            card.innerHTML = `
                <div class="challenge-preview"><canvas></canvas></div>
                <div class="challenge-card-title">${meta.icon} ${meta.title}</div>
                <div class="challenge-card-desc">${meta.description}</div>
                <div class="challenge-card-stats">
                    <span>🏆 ${stats.highScore}</span>
                    <span>🎮 ${stats.gamesPlayed}</span>
                    <span>📝 ${(stats.uniqueWordsFound || []).length}</span>
                </div>
            `;
            card.addEventListener("click", () => {
                this._stopChallengePreviewAnimations();
                this.activeChallenge = key;
                this.els.challengeSetupName.textContent = `${meta.icon} ${meta.title}`;
                this._setupCategorySelector(key);
                this._showScreen("challengesetup");
            });
            grid.appendChild(card);

            // Start animated preview on the card's canvas
            const canvas = card.querySelector("canvas");
            this._startChallengePreview(canvas, key);
        }
    }

    _setupCategorySelector(challengeKey) {
        const sel = this.els.challengeCategorySelector;
        const wrap = this.els.challengeCategoryButtons;
        if (challengeKey !== CHALLENGE_TYPES.WORD_CATEGORY) {
            sel.classList.add("hidden");
            this._selectedCategoryKey = null;
            return;
        }
        sel.classList.remove("hidden");
        wrap.innerHTML = "";

        // Exclude adjectives from the selectable UI (it's internal-only)
        const playable = ["food", "animals", "sports", "nature", "technology"];
        let first = true;
        for (const catKey of playable) {
            const cat = WORD_CATEGORIES[catKey];
            if (!cat) continue;
            const tier = CATEGORY_TIERS[catKey] || { tier: 1, label: "" };
            const btn = document.createElement("button");
            btn.className = "category-pick-btn" + (first ? " selected" : "");
            btn.dataset.cat = catKey;
            const tierStars = "★".repeat(tier.tier) + "☆".repeat(3 - tier.tier);
            const tierText = tier.label ? `${tierStars} ${tier.label}` : tierStars;
            btn.innerHTML = `
                <span class="cat-icon">${cat.icon}</span>
                <span class="cat-label">${cat.label}</span>
                <span class="cat-tier">${tierText}</span>
            `;
            btn.addEventListener("click", () => {
                wrap.querySelectorAll(".category-pick-btn").forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
                this._selectedCategoryKey = catKey;
            });
            wrap.appendChild(btn);
            if (first) {
                this._selectedCategoryKey = catKey;
                first = false;
            }
        }
    }

    _startChallengePreview(canvas, challengeType) {
        const size = 160;
        canvas.width = size;
        canvas.height = size;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const ctx = canvas.getContext("2d");
        const gridSize = 5;
        const cellSize = size / gridSize;

        // ─── TARGET WORD preview ───────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.TARGET_WORD) {
            const target = "CAT";
            // Falling letters: each has col, y, letter, speed, settled row, glow phase
            const letters = [];
            const settled = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
            let nextDrop = 0;
            const dropQueue = [];
            // Pre-fill some random background letters
            for (let i = 0; i < 6; i++) {
                const r = 2 + Math.floor(Math.random() * 3);
                const c = Math.floor(Math.random() * gridSize);
                if (!settled[r][c]) settled[r][c] = { letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), glow: 0 };
            }
            // Schedule target letters dropping then random letters
            const targetCols = [1, 2, 3];
            for (let i = 0; i < target.length; i++) {
                dropQueue.push({ letter: target[i], col: targetCols[i], isTarget: true, delay: 20 + i * 25 });
            }
            for (let i = 0; i < 8; i++) {
                dropQueue.push({ letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), col: Math.floor(Math.random() * gridSize), isTarget: false, delay: 110 + i * 18 });
            }

            let tick = 0, cycle = 0;
            const draw = () => {
                tick++;
                const localTick = tick - cycle * 220;

                // Reset cycle
                if (localTick > 220) {
                    cycle++;
                    for (let r = 0; r < gridSize; r++) for (let c = 0; c < gridSize; c++) settled[r][c] = null;
                    letters.length = 0;
                    for (let i = 0; i < 6; i++) {
                        const r = 2 + Math.floor(Math.random() * 3);
                        const c = Math.floor(Math.random() * gridSize);
                        if (!settled[r][c]) settled[r][c] = { letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), glow: 0 };
                    }
                }

                // Spawn drops
                for (const dq of dropQueue) {
                    if (localTick === dq.delay) {
                        letters.push({ letter: dq.letter, col: dq.col, y: -cellSize, isTarget: dq.isTarget, speed: 2.5 });
                    }
                }

                // Update falling letters
                for (let i = letters.length - 1; i >= 0; i--) {
                    const fl = letters[i];
                    // Find landing row
                    let landRow = gridSize - 1;
                    for (let r = 0; r < gridSize; r++) {
                        if (settled[r][fl.col]) { landRow = r - 1; break; }
                    }
                    const landY = landRow * cellSize;
                    fl.y += fl.speed;
                    if (fl.y >= landY) {
                        fl.y = landY;
                        if (landRow >= 0) settled[landRow][fl.col] = { letter: fl.letter, glow: fl.isTarget ? 1 : 0 };
                        letters.splice(i, 1);
                    }
                }

                // Draw
                ctx.fillStyle = "#1a1a1a";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#2a2a2a";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        const s = settled[r][c];
                        if (s) {
                            if (s.glow) {
                                const pulse = 0.4 + 0.3 * Math.sin(tick * 0.1);
                                ctx.fillStyle = `rgba(255, 215, 0, ${pulse * 0.3})`;
                                ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                                ctx.fillStyle = "#ffd700";
                            } else {
                                ctx.fillStyle = "#aaa";
                            }
                            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(s.letter, x + cellSize / 2, y + cellSize / 2);
                        }
                    }
                }

                // Draw falling letters
                for (const fl of letters) {
                    const x = fl.col * cellSize;
                    ctx.fillStyle = fl.isTarget ? "#3a3520" : "#2a2a2a";
                    ctx.fillRect(x + 1, fl.y + 1, cellSize - 2, cellSize - 2);
                    if (fl.isTarget) {
                        ctx.strokeStyle = "#ffd700";
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x + 2, fl.y + 2, cellSize - 4, cellSize - 4);
                    }
                    ctx.fillStyle = fl.isTarget ? "#ffd700" : "#fff";
                    ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(fl.letter, x + cellSize / 2, fl.y + cellSize / 2);
                }

                // Target label at top
                const alpha = 0.6 + 0.3 * Math.sin(tick * 0.08);
                ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
                ctx.font = `bold ${Math.floor(size * 0.1)}px monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("🎯 " + target, size / 2, size * 0.08);

                // Grid lines
                ctx.strokeStyle = "#333";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── SPEED ROUND preview ──────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.SPEED_ROUND) {
            const settled = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
            // Pre-fill bottom rows
            for (let r = 3; r < gridSize; r++) for (let c = 0; c < gridSize; c++) {
                if (Math.random() < 0.6) settled[r][c] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            }
            const fallers = [];
            let tick = 0, speed = 1.5, spawnTimer = 0, spawnInterval = 22;

            const draw = () => {
                tick++;

                // Gradually speed up
                speed = 1.5 + tick * 0.008;
                if (spawnInterval > 6) spawnInterval = Math.max(6, 22 - Math.floor(tick / 30));

                // Spawn new fallers
                spawnTimer++;
                if (spawnTimer >= spawnInterval) {
                    spawnTimer = 0;
                    const col = Math.floor(Math.random() * gridSize);
                    fallers.push({ col, y: -cellSize, letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)) });
                }

                // Update fallers
                for (let i = fallers.length - 1; i >= 0; i--) {
                    fallers[i].y += speed;
                    if (fallers[i].y > size) fallers.splice(i, 1);
                }

                // Draw
                ctx.fillStyle = "#1a1a1a";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#2a2a2a";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        if (settled[r][c]) {
                            ctx.fillStyle = "#aaa";
                            ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText(settled[r][c], x + cellSize / 2, y + cellSize / 2);
                        }
                    }
                }

                // Draw fallers with speed trails
                for (const f of fallers) {
                    const x = f.col * cellSize;
                    // Motion trail
                    const trailLen = Math.min(speed * 4, cellSize);
                    const grad = ctx.createLinearGradient(x + cellSize / 2, f.y - trailLen, x + cellSize / 2, f.y);
                    grad.addColorStop(0, "rgba(255, 215, 0, 0)");
                    grad.addColorStop(1, "rgba(255, 215, 0, 0.3)");
                    ctx.fillStyle = grad;
                    ctx.fillRect(x + 4, f.y - trailLen, cellSize - 8, trailLen);

                    ctx.fillStyle = "#3a3520";
                    ctx.fillRect(x + 1, f.y + 1, cellSize - 2, cellSize - 2);
                    ctx.strokeStyle = "#ffd700";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(x + 2, f.y + 2, cellSize - 4, cellSize - 4);
                    ctx.fillStyle = "#ffd700";
                    ctx.font = `bold ${Math.floor(cellSize * 0.5)}px monospace`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(f.letter, x + cellSize / 2, f.y + cellSize / 2);
                }

                // Speed indicator
                const barW = size * 0.6;
                const barH = 6;
                const barX = (size - barW) / 2;
                const barY = size - 10;
                const pct = Math.min(1, (speed - 1.5) / 5);
                ctx.fillStyle = "#333";
                ctx.fillRect(barX, barY, barW, barH);
                const barGrad = ctx.createLinearGradient(barX, 0, barX + barW * pct, 0);
                barGrad.addColorStop(0, "#ffd700");
                barGrad.addColorStop(1, "#ff4444");
                ctx.fillStyle = barGrad;
                ctx.fillRect(barX, barY, barW * pct, barH);

                // Grid lines
                ctx.strokeStyle = "#333";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }

                // Reset cycle
                if (tick > 300) {
                    tick = 0; speed = 1.5; spawnInterval = 22; spawnTimer = 0;
                    fallers.length = 0;
                }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }

        // ─── WORD CATEGORY preview ────────────────────────────────
        if (challengeType === CHALLENGE_TYPES.WORD_CATEGORY) {
            const categories = [
                { icon: "🍕", label: "Food", words: ["CAKE", "RICE", "SOUP", "FISH"] },
                { icon: "🐾", label: "Animals", words: ["BEAR", "FROG", "HAWK", "DUCK"] },
                { icon: "⚽", label: "Sports", words: ["GOLF", "SWIM", "KICK", "RACE"] },
                { icon: "🌿", label: "Nature", words: ["TREE", "RAIN", "LAKE", "LEAF"] },
            ];
            let catIdx = 0, tick = 0, wordSlots = [], phase = "reveal"; // reveal → glow → fade

            const setupCategory = () => {
                const cat = categories[catIdx];
                wordSlots = cat.words.map((w, i) => ({
                    word: w,
                    row: 1 + i,
                    col: Math.floor((gridSize - w.length) / 2),
                    revealedCount: 0,
                    glowing: false,
                    alpha: 1,
                }));
                phase = "reveal";
            };
            setupCategory();

            const draw = () => {
                tick++;
                const cat = categories[catIdx];

                // Phase timing
                if (phase === "reveal") {
                    // Reveal letters one by one across all words
                    const revealTick = Math.floor(tick / 4);
                    let allDone = true;
                    for (const ws of wordSlots) {
                        const target = Math.min(ws.word.length, revealTick - ws.row * 2);
                        ws.revealedCount = Math.max(0, Math.min(ws.word.length, target));
                        if (ws.revealedCount < ws.word.length) allDone = false;
                    }
                    if (allDone) { phase = "glow"; tick = 0; }
                } else if (phase === "glow") {
                    for (const ws of wordSlots) ws.glowing = true;
                    if (tick > 60) { phase = "fade"; tick = 0; }
                } else if (phase === "fade") {
                    for (const ws of wordSlots) ws.alpha = Math.max(0, 1 - tick / 20);
                    if (tick > 25) {
                        catIdx = (catIdx + 1) % categories.length;
                        setupCategory();
                        tick = 0;
                    }
                }

                // Draw
                ctx.fillStyle = "#1a1a1a";
                ctx.fillRect(0, 0, size, size);

                for (let r = 0; r < gridSize; r++) {
                    for (let c = 0; c < gridSize; c++) {
                        const x = c * cellSize, y = r * cellSize;
                        ctx.fillStyle = "#2a2a2a";
                        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                    }
                }

                // Draw word slots
                for (const ws of wordSlots) {
                    for (let i = 0; i < ws.revealedCount; i++) {
                        const c = ws.col + i;
                        const x = c * cellSize, y = ws.row * cellSize;
                        if (ws.glowing) {
                            const pulse = 0.3 + 0.2 * Math.sin(tick * 0.12 + i);
                            ctx.fillStyle = `rgba(76, 175, 80, ${pulse * ws.alpha})`;
                            ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
                        }
                        ctx.globalAlpha = ws.alpha;
                        ctx.fillStyle = ws.glowing ? "#4caf50" : "#fff";
                        ctx.font = `bold ${Math.floor(cellSize * 0.45)}px monospace`;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(ws.word[i], x + cellSize / 2, y + cellSize / 2);
                        ctx.globalAlpha = 1;
                    }
                }

                // Category label at top
                const labelAlpha = phase === "fade" ? Math.max(0, 1 - tick / 15) : Math.min(1, tick / 10);
                ctx.globalAlpha = labelAlpha;
                ctx.fillStyle = "#4caf50";
                ctx.font = `bold ${Math.floor(size * 0.1)}px monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(`${cat.icon} ${cat.label}`, size / 2, size * 0.08);
                ctx.globalAlpha = 1;

                // Grid lines
                ctx.strokeStyle = "#333";
                ctx.lineWidth = 0.5;
                for (let r = 0; r <= gridSize; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellSize); ctx.lineTo(size, r * cellSize); ctx.stroke(); }
                for (let c = 0; c <= gridSize; c++) { ctx.beginPath(); ctx.moveTo(c * cellSize, 0); ctx.lineTo(c * cellSize, size); ctx.stroke(); }
            };
            draw();
            const id = setInterval(draw, 60);
            this._challengePreviewAnimations.push(id);
            return;
        }
    }

    _stopChallengePreviewAnimations() {
        for (const id of this._challengePreviewAnimations) clearInterval(id);
        this._challengePreviewAnimations = [];
    }

    _startChallengeGame() {
        this._stopChallengePreviewAnimations();
        this.gridSize = this.challengeGridSize;
        this.difficulty = "casual";

        const timeLimit = this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND
            ? 3 * 60 : CHALLENGE_TIME_LIMIT;
        this._beginNewGame(timeLimit);

        // After _beginNewGame sets up state, apply challenge specifics
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            this.targetWordsCompleted = 0;
            this._pickTargetWord();
            this.els.targetWordDisplay.classList.remove("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            this.fallInterval = 0.9;
            this.speedRoundBaseInterval = this.fallInterval;
            this.els.targetWordDisplay.classList.add("hidden");
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            this.categoryWordsFound = [];
            this._pickCategory(this._selectedCategoryKey);
            this.els.targetWordDisplay.classList.remove("hidden");
        }
    }

    _isChallengeBonusWord(word) {
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            return this.targetWord && word === this.targetWord;
        }
        if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            return this.activeCategorySet && this.activeCategorySet.has(word);
        }
        return false;
    }

    _pickTargetWord() {
        // Pick a random word from the dictionary that is 3-5 letters long
        const candidates = [];
        for (const word of DICTIONARY) {
            if (word.length >= 3 && word.length <= 5) candidates.push(word);
        }
        if (candidates.length === 0) return;
        this.targetWord = candidates[Math.floor(Math.random() * candidates.length)];
        this.els.targetWordText.textContent = this.targetWord;
    }

    _pickCategory(specificKey) {
        let pick;
        if (specificKey && WORD_CATEGORIES[specificKey]) {
            pick = specificKey;
        } else {
            const keys = Object.keys(WORD_CATEGORIES);
            if (keys.length === 0) return;
            do {
                pick = keys[Math.floor(Math.random() * keys.length)];
            } while (keys.length > 1 && pick === this.activeCategoryKey);
        }
        this.activeCategoryKey = pick;
        this.activeCategorySet = WORD_CATEGORIES[pick].words;
        const cat = WORD_CATEGORIES[pick];
        this.els.targetWordText.textContent = `${cat.icon} ${cat.label}`;
        // Update the label from "TARGET:" to "CATEGORY:"
        this.els.targetWordDisplay.querySelector(".target-label").textContent = "CATEGORY:";
    }

    _updateSpeedRound() {
        // Increase speed every 500 points
        if (this.activeChallenge !== CHALLENGE_TYPES.SPEED_ROUND) return;
        const speedUps = Math.floor(this.score / 500);
        this.fallInterval = Math.max(0.2, this.speedRoundBaseInterval - speedUps * 0.08);
    }

    _openChallengeTutorial() {
        if (!this.activeChallenge) return;
        const meta = CHALLENGE_META[this.activeChallenge];
        if (!meta) return;
        this.els.challengeTutorialTitle.textContent = `${meta.icon} ${meta.title}`;

        let tutorialText = "";
        if (this.activeChallenge === CHALLENGE_TYPES.TARGET_WORD) {
            tutorialText = "A target word appears at the top of the screen. Spelling the target word earns 2× points and a 200-point bonus! Non-target words earn reduced points. Finding no target words slashes your XP. Game lasts 7 minutes.";
        } else if (this.activeChallenge === CHALLENGE_TYPES.SPEED_ROUND) {
            tutorialText = "Blocks start falling at normal speed but get faster every 500 points! The fall speed keeps increasing until you can barely keep up. Game lasts 3 minutes — score as high as you can!";
        } else if (this.activeChallenge === CHALLENGE_TYPES.WORD_CATEGORY) {
            tutorialText = "Choose a category before starting. Words matching your category earn bonus points! Harder categories (Technology, Nature) earn even more points and XP. Longer, more complex words also score higher. Other words earn reduced points. Game lasts 7 minutes.";
        }
        this.els.challengeTutorialText.textContent = tutorialText;

        // Draw a small preview
        const canvas = this.els.challengeTutorialCanvas;
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, 200, 200);
        ctx.fillStyle = "#ffd700";
        ctx.font = "bold 60px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.icon, 100, 100);

        this.els.challengeTutorialOverlay.classList.add("active");
    }

    _closeChallengeTutorial() {
        this.els.challengeTutorialOverlay.classList.remove("active");
    }

    // ── Main loop ──
    _loop(timestamp) {
        const dt = this.lastTime ? Math.min((timestamp - this.lastTime) / 1000, 0.1) : 0;
        this.lastTime = timestamp;

        if (this.state === State.PLAYING) {
            // Periodic auto-save every 5 seconds
            this._autoSaveTimer += dt;
            if (this._autoSaveTimer >= 5) {
                this._autoSaveTimer = 0;
                this._saveGameState();
            }

            if (this.timeLimitSeconds > 0) {
                this.timeRemainingSeconds = Math.max(0, this.timeRemainingSeconds - dt);
                this._updateTimerDisplay();
                if (this.timeRemainingSeconds <= 0) {
                    this._gameOver("time");
                }
            }

            if (this.state !== State.PLAYING) {
                this.renderer.draw(this.grid, this.block, 0);
                requestAnimationFrame((t) => this._loop(t));
                return;
            }

            if (this.clearing) {
                this._processClearPhase(dt);
            } else if (this._shuffleAnimActive) {
                this._updateShuffleAnim(dt);
            } else if (this._wordPopupActive) {
                // Word popup is showing — freeze, don't fall or spawn
            } else if (this.freezeActive) {
                // Freeze bonus: count down timer, don't advance block falling
                this.freezeTimeRemaining -= dt;
                this.els.freezeTimer.textContent = Math.ceil(Math.max(0, this.freezeTimeRemaining));
                if (this.freezeTimeRemaining <= 0) {
                    this.freezeActive = false;
                    this.freezeTimeRemaining = 0;
                    this.els.freezeIndicator.classList.add("hidden");
                }
            } else if (this.rowDragActive) {
                // Row drag mode: freeze block falling while player selects a row
            } else if (this.block) {
                if (this.spawnFreezeTimer > 0) {
                    // Block sits at top for 2s before falling
                    this.spawnFreezeTimer -= dt;
                    this.block.visualRow = this.block.row;
                } else if (this.block.dropAnimating) {
                    const swipeDropSpeed = 18;
                    this.block.visualRow += swipeDropSpeed * dt;
                    if (this.block.visualRow >= this.block.row) {
                        this.block.visualRow = this.block.row;
                        this.block.dropAnimating = false;
                        this._landBlock();
                    }
                } else {
                    this.fallTimer += dt;
                    if (this.fallTimer >= this.fallInterval) {
                        this.fallTimer -= this.fallInterval;
                        // Try to move block down
                        const nextRow = this.block.row + 1;
                        if (nextRow < 0) {
                            // Still in buffer zone, always move down
                            this.block.row = nextRow;
                        } else if (nextRow < this.gridSize && this.grid.isEmpty(nextRow, this.block.col)) {
                            this.block.row = nextRow;
                        } else if (this.block.row < 0) {
                            // Block is in buffer and column below is full — hover, don't land
                            // Game over only if every column is full and no validated words to claim
                            if (this.grid.isGridFull() && this._validatedWordGroups.length === 0) {
                                this._gameOver();
                            }
                            // Otherwise just stay hovering at current buffer row
                        } else {
                            // Block is inside the grid and can't move down — land it
                            this.block.visualRow = this.block.row;
                            this._landBlock();
                        }
                    }
                    // Smooth visual interpolation
                    if (this.block) {
                        const t = this.fallTimer / this.fallInterval;
                        this.block.visualRow = this.block.row - 1 + t;
                        // Clamp to top of buffer zone
                        if (this.block.visualRow < -BUFFER_ROWS) this.block.visualRow = -BUFFER_ROWS;
                        // Clamp: don't show below actual row
                        if (this.block.visualRow > this.block.row) this.block.visualRow = this.block.row;
                    }
                }
            }

            // Render
            this.renderer.draw(this.grid, this.block, dt);
        } else if (this.state === State.PAUSED) {
            // Still draw but don't update
            this.renderer.draw(this.grid, this.block, 0);
        }

        requestAnimationFrame((t) => this._loop(t));
    }
}

// Handle window resize
let resizeTimeout;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const g = window._game;
        if (g && g.state !== State.MENU && g.state !== State.GAMEOVER && g.grid) {
            g.renderer.resize(g.grid.rows, g.grid.cols);
        }
        if (g && g.bgAnim) g.bgAnim._resize();
    }, 150);
});

// Prevent scrolling on touch devices
document.addEventListener("touchmove", (e) => {
    const target = e.target;
    const game = window._game;
    const isScrollablePanel = target.closest("#words-found-list, #track-list, #profiles-list, #playlist-tabs, #playlist-track-picker, .overlay-content, .modal-panel-body");
    if (isScrollablePanel) return;
    if (game?.state === State.PLAYING && target.closest("#play-screen")) {
        e.preventDefault();
    }
}, { passive: false });

// Auto-save when the user navigates away or closes the tab
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const g = window._game;
        if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
            g._saveGameState();
        }
    }
});
window.addEventListener("beforeunload", () => {
    const g = window._game;
    if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
        g._saveGameState();
    }
});

// ── Bootstrap ──
// Load track list + dictionary, then start the game
Promise.all([
    loadTrackList(),
    loadDictionary().catch((err) => {
        console.error("Dictionary initialization failed.", err);
        DICTIONARY = new Set();
        _buildHintSets();
    })
]).then(() => {
    window._game = new Game();
});
