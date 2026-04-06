/**
 * difficulty-engine.js — Difficulty balancing using loot-table + weighted
 * 
 * Provides a unified difficulty system across all game modes:
 *   - Dynamic difficulty adjustment based on player performance
 *   - Loot tables for bonus/obstacle distribution
 *   - Weighted terrain generation for word-runner
 *   - Progressive challenge scaling
 *   - Per-game-mode difficulty curves
 */
import weighted from 'weighted';
import Chance from 'chance';

const _chance = new Chance();

// ── Difficulty Curves ──

/**
 * Difficulty tiers with associated parameters.
 * Each tier defines spawn rates, scoring multipliers, and constraints.
 */
const DIFFICULTY_TIERS = {
    BEGINNER: {
        id: 'beginner',
        range: [0, 15],
        letterFreqBoost: 1.5,
        bonusSpawnRate: 0.15,
        obstacleRate: 0.20,
        scoreMult: 1.0,
        fallSpeedMult: 1.0,
        wordLengthMax: 4,
        description: 'Learning the basics',
    },
    EASY: {
        id: 'easy',
        range: [16, 40],
        letterFreqBoost: 1.3,
        bonusSpawnRate: 0.12,
        obstacleRate: 0.30,
        scoreMult: 1.15,
        fallSpeedMult: 1.1,
        wordLengthMax: 5,
        description: 'Getting comfortable',
    },
    MEDIUM: {
        id: 'medium',
        range: [41, 70],
        letterFreqBoost: 1.1,
        bonusSpawnRate: 0.10,
        obstacleRate: 0.40,
        scoreMult: 1.35,
        fallSpeedMult: 1.25,
        wordLengthMax: 6,
        description: 'Real challenge',
    },
    HARD: {
        id: 'hard',
        range: [71, 90],
        letterFreqBoost: 0.9,
        bonusSpawnRate: 0.08,
        obstacleRate: 0.50,
        scoreMult: 1.6,
        fallSpeedMult: 1.45,
        wordLengthMax: 7,
        description: 'Expert territory',
    },
    EXTREME: {
        id: 'extreme',
        range: [91, 100],
        letterFreqBoost: 0.7,
        bonusSpawnRate: 0.05,
        obstacleRate: 0.60,
        scoreMult: 2.0,
        fallSpeedMult: 1.7,
        wordLengthMax: 8,
        description: 'Maximum difficulty',
    },
};

/**
 * Get the difficulty tier for a given difficulty level (0-100).
 */
export function getDifficultyTier(level) {
    const clamped = Math.max(0, Math.min(100, level));
    for (const tier of Object.values(DIFFICULTY_TIERS)) {
        if (clamped >= tier.range[0] && clamped <= tier.range[1]) return tier;
    }
    return DIFFICULTY_TIERS.MEDIUM;
}

// ── Loot Tables ──

/**
 * A loot table entry with item, weight, and optional constraints.
 */
class LootEntry {
    constructor(item, weight, constraints = {}) {
        this.item = item;
        this.weight = weight;
        this.minLevel = constraints.minLevel || 0;
        this.maxLevel = constraints.maxLevel || Infinity;
        this.cooldown = constraints.cooldown || 0;
        this._lastDropTick = -Infinity;
    }

    isAvailable(level, tick) {
        if (level < this.minLevel || level > this.maxLevel) return false;
        if (tick - this._lastDropTick < this.cooldown) return false;
        return true;
    }

    markDropped(tick) {
        this._lastDropTick = tick;
    }
}

/**
 * Loot table for selecting random items with weighted probability.
 * Supports level-gated entries and cooldowns.
 */
export class LootTable {
    constructor() {
        this.entries = [];
        this._tick = 0;
    }

    /**
     * Add an entry to the loot table.
     * @param {string} item - Item identifier
     * @param {number} weight - Base weight (higher = more likely)
     * @param {object} [constraints] - { minLevel, maxLevel, cooldown }
     */
    add(item, weight, constraints = {}) {
        this.entries.push(new LootEntry(item, weight, constraints));
        return this;
    }

    /**
     * Roll the loot table and get a result.
     * @param {number} [level=50] - Current difficulty level (0-100)
     * @returns {string|null} Selected item or null if nothing available
     */
    roll(level = 50) {
        this._tick++;
        const available = this.entries.filter(e => e.isAvailable(level, this._tick));
        if (available.length === 0) return null;

        const items = available.map(e => e.item);
        const weights = available.map(e => e.weight);

        try {
            const result = weighted.select(items, weights);
            const entry = available.find(e => e.item === result);
            if (entry) entry.markDropped(this._tick);
            return result;
        } catch {
            // Fallback: simple weighted pick
            const total = weights.reduce((a, b) => a + b, 0);
            let roll = Math.random() * total;
            for (let i = 0; i < items.length; i++) {
                roll -= weights[i];
                if (roll <= 0) {
                    available[i].markDropped(this._tick);
                    return items[i];
                }
            }
            return items[0];
        }
    }

    /**
     * Roll multiple times, returning unique results.
     * @param {number} count - Number of rolls
     * @param {number} [level=50]  
     * @returns {string[]}
     */
    rollMultiple(count, level = 50) {
        const results = [];
        const seen = new Set();
        for (let i = 0; i < count * 3 && results.length < count; i++) {
            const item = this.roll(level);
            if (item && !seen.has(item)) {
                seen.add(item);
                results.push(item);
            }
        }
        return results;
    }

    reset() {
        this._tick = 0;
        for (const e of this.entries) e._lastDropTick = -Infinity;
    }
}

// ── Pre-built Loot Tables ──

/** Bonus type loot table for the main falling-letter game */
export function createBonusLootTable() {
    const table = new LootTable();
    table.add('letter-pick', 30);
    table.add('bomb', 20);
    table.add('wildcard', 10, { minLevel: 10 });
    table.add('row-clear', 8, { minLevel: 20, cooldown: 3 });
    table.add('freeze', 6, { minLevel: 15, cooldown: 4 });
    table.add('shuffle', 5, { minLevel: 25, cooldown: 5 });
    table.add('score-2x', 4, { minLevel: 30, cooldown: 6 });
    return table;
}

/** Terrain phase loot table for word-runner */
export function createTerrainLootTable() {
    const table = new LootTable();
    table.add('open-run', 35);
    table.add('staircase', 25);
    table.add('gap-bridge', 20);
    table.add('sky-route', 20);
    return table;
}

/** Word search fill letter selection (avoids accidental words) */
export function createFillLetterWeights(neighborLetters) {
    // Reduce weight of letters that commonly form words with neighbors
    const commonPairs = {
        T: ['H', 'R', 'S'], S: ['H', 'T', 'E'], H: ['E', 'A', 'I'],
        E: ['R', 'S', 'D'], R: ['E', 'S', 'A'], A: ['T', 'N', 'R'],
        I: ['N', 'S', 'T'], N: ['G', 'E', 'D'], O: ['N', 'R', 'F'],
    };

    const weights = {};
    for (let i = 0; i < 26; i++) {
        const ch = String.fromCharCode(65 + i);
        weights[ch] = 1.0;
    }

    // Reduce weight for letters that commonly pair with neighbors
    for (const neighbor of neighborLetters) {
        const pairs = commonPairs[neighbor];
        if (pairs) {
            for (const ch of pairs) {
                weights[ch] = Math.max(0.1, (weights[ch] || 1.0) * 0.5);
            }
        }
    }

    // Boost uncommon letters to reduce accidental words
    for (const ch of ['Q', 'X', 'Z', 'J', 'K', 'V']) {
        weights[ch] = (weights[ch] || 1.0) * 2.0;
    }

    return weights;
}

// ── Dynamic Difficulty Adjustment ──

/**
 * Tracks player performance and adjusts difficulty dynamically.
 */
export class DynamicDifficulty {
    constructor(initialLevel = 30) {
        this.level = initialLevel;
        this.performanceWindow = [];
        this.windowSize = 10;
        this.adjustRate = 2;
        this.minLevel = 5;
        this.maxLevel = 100;
    }

    /**
     * Record a performance metric (0-100 where higher = better performance).
     * Difficulty adjusts to keep the player in the "flow zone" (~50-70).
     */
    recordPerformance(score) {
        this.performanceWindow.push(Math.max(0, Math.min(100, score)));
        if (this.performanceWindow.length > this.windowSize) {
            this.performanceWindow.shift();
        }
        this._adjust();
    }

    _adjust() {
        if (this.performanceWindow.length < 3) return;
        const avg = this.performanceWindow.reduce((a, b) => a + b, 0) / this.performanceWindow.length;

        // Target performance zone: 45-65
        if (avg > 65) {
            // Player doing too well — increase difficulty
            this.level = Math.min(this.maxLevel, this.level + this.adjustRate);
        } else if (avg < 45) {
            // Player struggling — decrease difficulty
            this.level = Math.max(this.minLevel, this.level - this.adjustRate);
        }
        // In the zone: no adjustment
    }

    getTier() {
        return getDifficultyTier(this.level);
    }

    /**
     * Get a performance score for common game events.
     */
    static scoreWordFound(wordLength, timeTaken, maxTime) {
        const lengthScore = Math.min(100, wordLength * 15);
        const timeScore = Math.max(0, 100 - (timeTaken / maxTime) * 100);
        return lengthScore * 0.6 + timeScore * 0.4;
    }

    static scoreWRLetterCollected(distanceTraveled, lettersCollected) {
        // More letters per distance = better performance
        if (distanceTraveled < 100) return 50;
        const rate = (lettersCollected / distanceTraveled) * 1000;
        return Math.min(100, rate * 20);
    }

    static scoreWSCompletion(timeUsed, timeBudget, wordsFound, totalWords) {
        const completionRate = wordsFound / Math.max(1, totalWords);
        const timeEfficiency = Math.max(0, 1 - timeUsed / timeBudget);
        return (completionRate * 70 + timeEfficiency * 30);
    }
}

// ── Word-Runner Terrain Weights ──

/**
 * Get weighted terrain generation parameters based on difficulty and distance.
 * @param {number} difficultyLevel - Current difficulty (0-100)
 * @param {number} distance - Distance traveled
 * @returns {object} Terrain generation parameters
 */
export function getTerrainWeights(difficultyLevel, distance) {
    const tier = getDifficultyTier(difficultyLevel);
    const distanceFactor = Math.min(1.0, distance / 10000);

    return {
        // Terrain phase probabilities
        openRun: Math.max(0.15, 0.35 - distanceFactor * 0.15),
        staircase: 0.25 + distanceFactor * 0.05,
        gapBridge: 0.20 + distanceFactor * 0.05,
        skyRoute: 0.20 + distanceFactor * 0.05,

        // Parameters within phases
        rockChance: tier.obstacleRate,
        letterCount: Math.max(1, 3 - Math.floor(difficultyLevel / 40)),
        platformWidth: Math.max(60, 100 - difficultyLevel * 0.3),
        gapWidth: Math.min(180, 60 + difficultyLevel * 0.8 + distanceFactor * 40),
        restGap: Math.max(0.2, 0.4 - distanceFactor * 0.15),
    };
}

export { DIFFICULTY_TIERS };
