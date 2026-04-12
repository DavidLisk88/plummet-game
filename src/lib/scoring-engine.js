/**
 * scoring-engine.js — Advanced scoring and skill rating system
 * 
 * Uses Math.js for complex scoring formulas and OpenSkill.js for
 * TrueSkill-style competitive skill ratings.
 * 
 * Features:
 *   - Complex scoring formulas with Math.js expressions
 *   - OpenSkill ratings for competitive leaderboard placement
 *   - Multi-factor skill assessment
 *   - Cross-game-mode composite ratings
 *   - Rating confidence intervals
 */
import { create, all } from 'mathjs';
import { rating, rate, ordinal } from 'openskill';

// Create math.js instance with all functions
const math = create(all, {});

// ── Scoring Formulas ──

/**
 * Calculate word score using Math.js for precise formula evaluation.
 * 
 * Formula: base × complexity × streak × difficulty
 * where:
 *   base = wordLength × 10 × wordLength
 *   complexity = 1 + 0.15 × (wordLength - 3)^1.4  [if length ≥ 4]
 *   streak = min(3.0, 1 + (comboCount - 1) × 0.2)
 *   difficulty = tier.scoreMult
 * 
 * @param {object} params
 * @param {number} params.wordLength - Length of the word
 * @param {number} params.comboCount - Current combo streak
 * @param {object} params.letterValues - { A: 1, B: 3, ... }
 * @param {string} params.word - The actual word
 * @param {number} [params.difficultyMult=1] - Difficulty tier multiplier
 * @returns {{ total: number, base: number, complexityMult: number, letterBonus: number, streakMult: number }}
 */
export function calculateWordScore(params) {
    const { wordLength, comboCount = 0, letterValues = {}, word = '', difficultyMult = 1 } = params;

    // Base score using math.js for precision
    const base = math.evaluate('len * 10 * len', { len: wordLength });

    // Complexity multiplier for longer words (exponential growth)
    let complexityMult = 1;
    if (wordLength >= 4) {
        complexityMult = math.evaluate('1 + 0.15 * pow(len - 3, 1.4)', { len: wordLength });
    }

    // Letter rarity bonus
    let letterBonus = 0;
    for (const ch of word) {
        const val = letterValues[ch] || 1;
        if (val > 1) letterBonus += val * 3;
    }

    // Streak multiplier (capped at 3.0)
    const streakMult = comboCount > 0
        ? math.evaluate('min(3.0, 1 + (combo - 1) * 0.2)', { combo: comboCount })
        : 1;

    const total = Math.floor(base * complexityMult * streakMult * difficultyMult) + letterBonus;

    return { total, base, complexityMult, letterBonus, streakMult };
}

/**
 * Calculate word search word score.
 */
export function calculateWSWordScore(word, level) {
    const base = math.evaluate('len * 10 * len', { len: word.length });

    let complexityMult = 1;
    if (word.length >= 4) {
        complexityMult = math.evaluate('1 + 0.15 * pow(len - 3, 1.4)', { len: word.length });
    }

    const rarityMap = {
        Q: 10, Z: 10, X: 9, J: 8, K: 5, V: 4,
        W: 3, Y: 3, F: 3, B: 3, H: 3, G: 3,
        M: 2, P: 2, C: 2, D: 2, U: 2,
        L: 1, N: 1, R: 1, S: 1, T: 1,
        A: 0, E: 0, I: 0, O: 0,
    };
    let letterBonus = 0;
    for (const ch of word) letterBonus += (rarityMap[ch] || 0) * 3;

    const levelMult = math.evaluate('1 + 0.003 * min(level, 500)', { level });

    return Math.floor(base * complexityMult * levelMult) + letterBonus;
}

/**
 * Calculate XP earned from a game.
 */
export function calculateXP(params) {
    const { score, wordsFound = 0, maxCombo = 0, gameMode = 'classic', isSandbox = false } = params;

    let baseXP = math.evaluate(
        'floor(score * 0.1 + words * 5 + combo * 10)',
        { score, words: wordsFound, combo: maxCombo }
    );

    // Game mode multipliers
    const modeMults = {
        classic: 1.0,
        'target-word': 1.2,
        'speed-round': 1.3,
        'word-category': 1.1,
        'word-search': 1.15,
        'word-runner': 1.25,
    };
    baseXP = Math.floor(baseXP * (modeMults[gameMode] || 1.0));

    // Sandbox penalty
    if (isSandbox) baseXP = Math.floor(baseXP * 0.25);

    return Math.max(1, baseXP);
}

/**
 * Calculate coins earned from word completion.
 */
export function calculateCoins(wordLength, gameMode = 'classic') {
    const base = math.evaluate('max(1, floor(pow(len, 1.5) - 1))', { len: wordLength });
    const modeMults = { classic: 1.0, 'word-runner': 1.5, 'speed-round': 1.2 };
    return Math.floor(base * (modeMults[gameMode] || 1.0));
}

// ── OpenSkill Ratings ──

/**
 * Create a new player rating.
 * @returns {{ mu: number, sigma: number }}
 */
export function createRating() {
    return rating();
}

/**
 * Update ratings after a ranked match.
 * @param {Array<Array<{mu: number, sigma: number}>>} teams - Array of teams, each team is array of ratings
 * @param {number[]} [ranks] - Rank of each team (1 = first place). If omitted, order is rank.
 * @returns {Array<Array<{mu: number, sigma: number}>>} Updated ratings
 */
export function updateRatings(teams, ranks) {
    return rate(teams, { rank: ranks });
}

/**
 * Get the ordinal skill value (single number for leaderboard sorting).
 * Higher = better.
 * @param {{ mu: number, sigma: number }} playerRating
 * @returns {number}
 */
export function getOrdinal(playerRating) {
    return ordinal(playerRating);
}

/**
 * Process a batch of game results to update a player's OpenSkill rating.
 * Works by creating virtual "matches" against reference performance levels.
 * 
 * @param {{ mu: number, sigma: number }} currentRating - Player's current rating
 * @param {Array<{ score: number, percentile: number }>} results - Recent game results
 * @returns {{ mu: number, sigma: number, ordinal: number }}
 */
export function processGameResults(currentRating, results) {
    let playerRating = currentRating || rating();

    for (const result of results) {
        // Create virtual opponents at different skill levels
        // Score percentile determines rank: high percentile = player wins
        const opponentRating = rating();
        const percentile = Math.max(0, Math.min(100, result.percentile));

        if (percentile >= 50) {
            // Player performed better than average — player wins
            const [[updatedPlayer]] = updateRatings([[playerRating], [opponentRating]], [1, 2]);
            playerRating = updatedPlayer;
        } else {
            // Player performed below average — player loses
            const [[updatedPlayer]] = updateRatings([[playerRating], [opponentRating]], [2, 1]);
            playerRating = updatedPlayer;
        }
    }

    return {
        mu: playerRating.mu,
        sigma: playerRating.sigma,
        ordinal: getOrdinal(playerRating),
    };
}

// ── Multi-Factor Skill Assessment ──

const SKILL_WEIGHTS = {
    RAW_SCORE: 0.05,
    GRID_MASTERY: 0.20,
    DIFFICULTY: 0.15,
    TIME_PRESSURE: 0.18,
    CHALLENGE: 0.15,
    CONSISTENCY: 0.12,
    VERSATILITY: 0.10,
    PROGRESSION: 0.05,
};

/**
 * Compute composite skill rating using Math.js for all calculations.
 * Enhanced version of the existing skill-engine with precise math.
 * 
 * @param {object} playerData
 * @returns {{ skillRating: number, components: object, skillClass: string, openSkillOrdinal: number }}
 */
export function computeEnhancedSkillRating(playerData) {
    const { gameScores = [], highScores = [], challengeStats = [], openSkillRating, previousRating = 0 } = playerData;

    if (gameScores.length === 0) {
        return {
            skillRating: 0,
            components: Object.fromEntries(Object.keys(SKILL_WEIGHTS).map(k => [k.toLowerCase(), 0])),
            skillClass: 'low',
            openSkillOrdinal: openSkillRating ? getOrdinal(openSkillRating) : 0,
        };
    }

    const totalGames = gameScores.length;

    // 1. Raw Score Component (0-100)
    const topScoresByMode = {};
    for (const g of gameScores) {
        const key = `${g.game_mode}|${g.difficulty}|${g.grid_size}`;
        topScoresByMode[key] = Math.max(topScoresByMode[key] || 0, g.score);
    }
    const topScores = Object.values(topScoresByMode).sort((a, b) => b - a).slice(0, 20);
    const avgTopScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;
    const rawScore = math.evaluate('min(100, 25 * log(1 + max(0, avg) / 100))', { avg: avgTopScore });

    // 2. Grid Mastery (0-100)
    let gridNumerator = 0, gridCount = 0;
    for (const hs of highScores) {
        const gridWeight = math.evaluate('6 / gs', { gs: hs.grid_size });
        const scoreContrib = math.evaluate('25 * log(1 + hs / 200)', { hs: hs.high_score });
        const confidence = math.evaluate('min(1, gp / 3)', { gp: hs.games_played });
        gridNumerator += gridWeight * scoreContrib * confidence;
        gridCount++;
    }
    const gridMastery = math.evaluate(
        'min(100, gc > 0 ? (gn / gc) * 2.5 : 0)',
        { gn: gridNumerator, gc: gridCount }
    );

    // 3. Difficulty (0-100)
    const hardGames = gameScores.filter(g => g.difficulty === 'hard');
    const normalGames = gameScores.filter(g => g.difficulty === 'normal');
    let difficultyScore = 0;
    if (hardGames.length >= 3 && normalGames.length >= 3) {
        const hardAvg = hardGames.reduce((s, g) => s + g.score, 0) / hardGames.length;
        const normalAvg = normalGames.reduce((s, g) => s + g.score, 0) / normalGames.length;
        const ratio = normalAvg > 0 ? hardAvg / normalAvg : 0;
        difficultyScore = math.evaluate('min(100, ratio * 120)', { ratio });
    }

    // 4. Time Pressure (0-100)
    const timedGames = gameScores.filter(g => g.time_limit > 0);
    let timePressure = 0;
    if (timedGames.length >= 3) {
        const timedAvg = timedGames.reduce((s, g) => s + g.score, 0) / timedGames.length;
        timePressure = math.evaluate('min(100, 25 * log(1 + ta / 50))', { ta: timedAvg });
    }

    // 5. Challenge (0-100)
    let challengeScore = 0;
    if (challengeStats.length > 0) {
        const scores = challengeStats.map(cs => {
            const winRate = cs.games_played > 0 ? cs.wins / cs.games_played : 0;
            return math.evaluate('wr * 100 * min(1, gp / 5)', { wr: winRate, gp: cs.games_played });
        });
        challengeScore = Math.min(100, scores.reduce((a, b) => a + b, 0) / challengeStats.length);
    }

    // 6. Consistency (0-100)
    const recentScores = gameScores.slice(-20).map(g => g.score);
    let consistency = 50;
    if (recentScores.length >= 5) {
        const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const variance = recentScores.reduce((s, v) => s + (v - mean) ** 2, 0) / recentScores.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
        consistency = math.evaluate('min(100, max(0, 100 - cv * 120))', { cv });
    }

    // 7. Versatility (0-100)
    const modesPlayed = new Set(gameScores.map(g => g.game_mode)).size;
    const gridsPlayed = new Set(gameScores.map(g => g.grid_size)).size;
    const diffsPlayed = new Set(gameScores.map(g => g.difficulty)).size;
    const versatility = math.evaluate(
        'min(100, (modes * 20 + grids * 8 + diffs * 15))',
        { modes: modesPlayed, grids: gridsPlayed, diffs: diffsPlayed }
    );

    // 8. Progression (0-100)
    let progression = 50;
    if (gameScores.length >= 10) {
        const firstHalf = gameScores.slice(0, Math.floor(gameScores.length / 2));
        const secondHalf = gameScores.slice(Math.floor(gameScores.length / 2));
        const firstAvg = firstHalf.reduce((s, g) => s + g.score, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((s, g) => s + g.score, 0) / secondHalf.length;
        if (firstAvg > 0) {
            const improvement = (secondAvg - firstAvg) / firstAvg;
            progression = math.evaluate('min(100, max(0, 50 + imp * 200))', { imp: improvement });
        }
    }

    // Weighted composite
    const components = {
        rawScore, gridMastery, difficulty: difficultyScore,
        timePressure, challenge: challengeScore,
        consistency, versatility, progression,
    };

    let composite = 0;
    const componentKeys = {
        rawScore: 'RAW_SCORE', gridMastery: 'GRID_MASTERY', difficulty: 'DIFFICULTY',
        timePressure: 'TIME_PRESSURE', challenge: 'CHALLENGE',
        consistency: 'CONSISTENCY', versatility: 'VERSATILITY', progression: 'PROGRESSION',
    };

    for (const [key, weightKey] of Object.entries(componentKeys)) {
        composite += components[key] * SKILL_WEIGHTS[weightKey];
    }

    // Scale to 0-10,000
    const scaledRating = Math.round(composite * composite);

    // Confidence gate: need 50+ games for full rating
    const confidence = math.evaluate('min(1, gp / 50)', { gp: totalGames });
    let skillRating = Math.round(scaledRating * confidence);

    // Ratchet: never decrease from previous rating
    if (previousRating > 0 && skillRating < previousRating) {
        skillRating = previousRating;
    }

    const skillClass = skillRating >= 5000 ? 'high' : skillRating >= 1500 ? 'medium' : 'low';

    return {
        skillRating,
        components,
        skillClass,
        openSkillOrdinal: openSkillRating ? getOrdinal(openSkillRating) : skillRating / 100,
    };
}

// ── Utility Exports ──

export { math, rating as createOpenSkillRating, rate as rateMatch, ordinal as getSkillOrdinal };
