/**
 * chance-engine.js — Controlled randomization engine using Chance.js
 * 
 * Replaces Math.random() throughout the application with seeded,
 * reproducible, and statistically controlled random generation.
 * 
 * Features:
 *   - Seeded randomization for reproducible game states
 *   - Weighted selection using Chance.js + weighted library
 *   - Letter frequency handling with deficit tracking
 *   - Grid-aware smart letter selection
 *   - Challenge-specific random engines
 */
import Chance from 'chance';
import weighted from 'weighted';

// ── Core Engine ──

/** Master chance instance (unseeded for general use) */
let _masterChance = new Chance();

/** Per-game seeded instances for reproducibility */
const _gameSeeds = new Map();

/**
 * Create a seeded random engine for a specific game session.
 * @param {string} gameId - Unique game identifier
 * @param {string|number} [seed] - Optional seed for reproducibility
 * @returns {Chance} Seeded Chance instance
 */
export function createGameEngine(gameId, seed) {
    const engine = seed != null ? new Chance(seed) : new Chance();
    _gameSeeds.set(gameId, engine);
    return engine;
}

/**
 * Get or create the random engine for a game session.
 * @param {string} gameId
 * @returns {Chance}
 */
export function getGameEngine(gameId) {
    if (!_gameSeeds.has(gameId)) return createGameEngine(gameId);
    return _gameSeeds.get(gameId);
}

/**
 * Destroy a game engine when the session ends.
 * @param {string} gameId
 */
export function destroyGameEngine(gameId) {
    _gameSeeds.delete(gameId);
}

/**
 * Get the master (unseeded) chance instance.
 * @returns {Chance}
 */
export function getMasterChance() {
    return _masterChance;
}

// ── Letter Frequency System ──

const LETTER_FREQ = {
    A: 12, B: 3, C: 4, D: 4, E: 14, F: 3, G: 3, H: 3, I: 10, J: 1,
    K: 2, L: 6, M: 4, N: 7, O: 10, P: 4, Q: 1, R: 8, S: 8, T: 8,
    U: 6, V: 2, W: 3, X: 1, Y: 3, Z: 1
};

const FREQ_TOTAL = Object.values(LETTER_FREQ).reduce((a, b) => a + b, 0);
const ALL_LETTERS = Object.keys(LETTER_FREQ);

/**
 * Letter generation state tracker — maintains history, counts, deficit tracking.
 */
class LetterTracker {
    constructor() {
        this.history = [];
        this.historyMax = 14;
        this.counts = {};
        this.totalPicks = 0;
        for (const ch of ALL_LETTERS) this.counts[ch] = 0;
    }

    commit(ch) {
        this.history.push(ch);
        if (this.history.length > this.historyMax) this.history.shift();
        this.counts[ch] = (this.counts[ch] || 0) + 1;
        this.totalPicks++;
        return ch;
    }

    get lastLetter() {
        return this.history.length > 0 ? this.history[this.history.length - 1] : null;
    }

    reset() {
        this.history = [];
        this.totalPicks = 0;
        for (const ch of ALL_LETTERS) this.counts[ch] = 0;
    }
}

/** Default global tracker (used by main game) */
const _globalTracker = new LetterTracker();

/** Per-game trackers */
const _gameTrackers = new Map();

export function getLetterTracker(gameId) {
    if (!gameId) return _globalTracker;
    if (!_gameTrackers.has(gameId)) _gameTrackers.set(gameId, new LetterTracker());
    return _gameTrackers.get(gameId);
}

export function destroyLetterTracker(gameId) {
    _gameTrackers.delete(gameId);
}

/**
 * Enhanced random letter selection using Chance.js + weighted library.
 * 
 * Multi-factor weighting:
 *   1. Base frequency from LETTER_FREQ
 *   2. Hard block on previous letter (no consecutive repeats)
 *   3. Aggressive cooldown for recent letters (6-letter window)
 *   4. Deficit balancing (underrepresented letters get boosted)
 *   5. Target word assistance (inject needed letters)
 *   6. Grid-aware helpful letter hints
 * 
 * @param {object} opts
 * @param {object} [opts.grid] - Current game grid (if applicable)
 * @param {string} [opts.targetWord] - Target word to assist with
 * @param {Function} [opts.findHelpfulLetters] - Grid helper function
 * @param {string} [opts.gameId] - Game session ID for per-game tracking
 * @param {Set} [opts.dictionary] - Dictionary for validation
 * @returns {string} Selected letter (A-Z)
 */
export function randomLetter(opts = {}) {
    const { grid, targetWord, findHelpfulLetters, gameId, dictionary } = opts;
    const tracker = getLetterTracker(gameId);
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    const prevLetter = tracker.lastLetter;

    // ── Target Word Assistance ──
    if (targetWord && targetWord.length >= 3) {
        const needed = {};
        for (const ch of targetWord) needed[ch] = (needed[ch] || 0) + 1;
        if (grid) {
            for (let r = 0; r < grid.rows; r++) {
                for (let c = 0; c < grid.cols; c++) {
                    const val = grid.get(r, c);
                    if (val && needed[val] && needed[val] > 0) needed[val]--;
                }
            }
        }
        const missingLetters = [];
        for (const [ch, count] of Object.entries(needed)) {
            for (let i = 0; i < count; i++) missingLetters.push(ch);
        }
        const assistPool = missingLetters.filter(ch => ch !== prevLetter);
        if (assistPool.length > 0) {
            const assistRate = Math.min(0.50, 0.20 + missingLetters.length * 0.10);
            if (engine.floating({ min: 0, max: 1 }) < assistRate) {
                return tracker.commit(engine.pickone(assistPool));
            }
        }
    }

    // ── Grid-aware helpful letter (≈25% chance) ──
    if (findHelpfulLetters && grid && engine.floating({ min: 0, max: 1 }) < 0.25) {
        const helpful = findHelpfulLetters(grid).filter(h => h.letter !== prevLetter);
        if (helpful.length > 0) {
            const items = helpful.map(h => h.letter);
            const weights = helpful.map(h => h.count);
            try {
                const picked = weighted.select(items, weights);
                return tracker.commit(picked);
            } catch (_) { /* fall through to main selection */ }
        }
    }

    // ── Main weighted random selection ──
    const weightMap = {};
    for (const ch of ALL_LETTERS) {
        if (ch === prevLetter) { weightMap[ch] = 0.001; continue; }

        let w = LETTER_FREQ[ch];

        // Strong cooldown for recent letters
        const histIdx = tracker.history.lastIndexOf(ch);
        if (histIdx !== -1) {
            const age = tracker.history.length - histIdx;
            if (age <= 2) w *= 0.001;
            else if (age <= 4) w *= 0.05;
            else if (age <= 6) w *= 0.20;
            else if (age <= 8) w *= 0.50;
            else w *= 0.80;
        }

        // Aggressive deficit/surplus balancing
        if (tracker.totalPicks > 8) {
            const expected = (LETTER_FREQ[ch] / FREQ_TOTAL) * tracker.totalPicks;
            const actual = tracker.counts[ch];
            const ratio = expected > 0 ? actual / expected : 0;
            if (ratio < 0.25) w *= 5.0;
            else if (ratio < 0.5) w *= 3.5;
            else if (ratio < 0.75) w *= 2.0;
            else if (ratio < 0.9) w *= 1.4;
            else if (ratio > 2.5) w *= 0.10;
            else if (ratio > 2.0) w *= 0.20;
            else if (ratio > 1.5) w *= 0.35;
            else if (ratio > 1.2) w *= 0.55;
        }

        // Never-seen guarantee
        if (tracker.totalPicks >= 20 && tracker.counts[ch] === 0) {
            w = Math.max(w, 5);
        }

        weightMap[ch] = Math.max(w, 0.01);
    }

    // Use weighted library for selection
    try {
        const items = Object.keys(weightMap);
        const weights = Object.values(weightMap);
        const picked = weighted.select(items, weights);
        return tracker.commit(picked);
    } catch (_) {
        // Fallback: use Chance.js weighted pick
        const total = Object.values(weightMap).reduce((a, b) => a + b, 0);
        let roll = engine.floating({ min: 0, max: total });
        for (const ch of ALL_LETTERS) {
            roll -= weightMap[ch];
            if (roll <= 0) return tracker.commit(ch);
        }
        return tracker.commit('E');
    }
}

// ── General Purpose Random Utilities ──

/**
 * Weighted random selection from an array of items.
 * @param {Array} items - Array of items to choose from
 * @param {Array<number>} weights - Corresponding weights
 * @param {string} [gameId] - Optional game session for seeded randomness
 * @returns {*} Selected item
 */
export function weightedPick(items, weights, gameId) {
    if (!items.length) return null;
    try {
        return weighted.select(items, weights);
    } catch (_) {
        const engine = gameId ? getGameEngine(gameId) : _masterChance;
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = engine.floating({ min: 0, max: total });
        for (let i = 0; i < items.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return items[i];
        }
        return items[items.length - 1];
    }
}

/**
 * Fisher-Yates shuffle using Chance.js for better entropy.
 * @param {Array} arr - Array to shuffle (mutated in place)
 * @param {string} [gameId] - Optional game session
 * @returns {Array} The shuffled array
 */
export function shuffle(arr, gameId) {
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    for (let i = arr.length - 1; i > 0; i--) {
        const j = engine.integer({ min: 0, max: i });
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Random integer in range [min, max] inclusive.
 */
export function randInt(min, max, gameId) {
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    return engine.integer({ min, max });
}

/**
 * Random float in range [min, max).
 */
export function randFloat(min, max, gameId) {
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    return engine.floating({ min, max, fixed: 8 });
}

/**
 * Random boolean with given probability of true.
 */
export function randBool(probability = 0.5, gameId) {
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    return engine.bool({ likelihood: probability * 100 });
}

/**
 * Pick one random item from an array.
 */
export function pickOne(arr, gameId) {
    if (!arr.length) return null;
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    return engine.pickone(arr);
}

/**
 * Pick N random items from an array (without replacement).
 */
export function pickN(arr, n, gameId) {
    const engine = gameId ? getGameEngine(gameId) : _masterChance;
    return engine.pickset(arr, Math.min(n, arr.length));
}

export { LETTER_FREQ, FREQ_TOTAL, ALL_LETTERS, LetterTracker };
