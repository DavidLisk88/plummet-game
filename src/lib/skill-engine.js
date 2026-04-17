/**
 * skill-engine.js — Advanced multi-factor skill rating calculation
 * 
 * This mirrors the server-side compute_profile_skill() PostgreSQL function
 * but runs client-side for instant previews and offline mode.
 * 
 * The skill rating is a composite score from 0-100 built from 8 weighted factors
 * that emphasize actual skill over raw grinding:
 * 
 *   Factor               | Weight | Measures
 *   ─────────────────────┼────────┼──────────────────────────────────
 *   Grid Mastery         | 20%    | Performance on smaller, harder grids
 *   Time Pressure        | 18%    | Scores under short time constraints
 *   Difficulty           | 15%    | Hard mode performance ratio
 *   Challenge            | 15%    | Performance across challenge types
 *   Consistency          | 12%    | Low variance in recent scores
 *   Versatility          | 10%    | Breadth of game configurations played
 *   Raw Score            | 5%     | Overall scoring ability (diminishing returns)
 *   Progression          | 5%     | Improvement trend over time
 * 
 * Class thresholds (0-50,000 scale):
 *   Master Class: 33000+ skill rating
 *   High Class:   16500-32999
 *   Medium Class: 5000-16499
 *   Low Class:    0-4999
 *
 * Games-played confidence gate:
 *   Rating is scaled by min(1, gamesPlayed / 50).
 *   Needs 50+ games for full rating.
 */

const WEIGHTS = {
    RAW_SCORE: 0.05,
    GRID_MASTERY: 0.20,
    DIFFICULTY: 0.15,
    TIME_PRESSURE: 0.18,
    CHALLENGE: 0.15,
    CONSISTENCY: 0.12,
    VERSATILITY: 0.10,
    PROGRESSION: 0.05,
};

const CLASS_THRESHOLDS = {
    MASTER: 33000,
    HIGH: 16500,
    MEDIUM: 5000,
};

/**
 * Compute the full skill rating from game history data.
 * 
 * @param {Object} playerData - All the data needed for calculation
 * @param {Array} playerData.gameScores - All game_scores rows for this profile
 * @param {Array} playerData.highScores - All profile_high_scores rows
 * @param {Array} playerData.challengeStats - All profile_challenge_stats rows
 * @param {number} [playerData.previousRating=0] - Previous skill rating (ratchet: never goes down)
 * @returns {Object} { skillRating, components, skillClass }
 */
export function computeSkillRating(playerData) {
    const { gameScores = [], highScores = [], challengeStats = [], previousRating = 0 } = playerData;

    if (gameScores.length === 0) {
        return {
            skillRating: 0,
            components: {
                rawScore: 0,
                gridMastery: 0,
                difficulty: 0,
                timePressure: 0,
                challenge: 0,
                consistency: 0,
                versatility: 0,
                progression: 0,
            },
            skillClass: 'low',
        };
    }

    const totalGames = gameScores.length;

    // ═══ 1. RAW SCORE COMPONENT (0-100) ═══
    // Weighted average of top scores across all modes, log-scaled
    const topScoresByMode = {};
    for (const g of gameScores) {
        const key = `${g.game_mode}|${g.difficulty}|${g.grid_size}`;
        topScoresByMode[key] = Math.max(topScoresByMode[key] || 0, g.score);
    }
    const topScores = Object.values(topScoresByMode).sort((a, b) => b - a).slice(0, 20);
    const avgTopScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;
    const rawScore = clamp(25 * Math.log(1 + Math.max(0, avgTopScore) / 100), 0, 100);

    // ═══ 2. GRID MASTERY COMPONENT (0-100) ═══
    // Smaller grid = harder = more weight  (3x3 weight=2.0, 8x8 weight=0.75)
    let gridNumerator = 0, gridCount = 0;
    for (const hs of highScores) {
        const gridWeight = 6 / hs.grid_size;
        const scoreContrib = 25 * Math.log(1 + hs.high_score / 200);
        const confidence = Math.min(1, hs.games_played / 3);
        gridNumerator += gridWeight * scoreContrib * confidence;
        gridCount++;
    }
    const gridMastery = clamp(gridCount > 0 ? (gridNumerator / gridCount) * 2.5 : 0, 0, 100);

    // ═══ 3. DIFFICULTY COMPONENT (0-100) ═══
    const hardGames = gameScores.filter(g => g.difficulty === 'hard');
    const hardAvgScore = hardGames.length > 0
        ? hardGames.reduce((a, g) => a + g.score, 0) / hardGames.length
        : 0;
    const hardRatio = hardGames.length / totalGames;
    const difficulty = clamp(
        (25 * Math.log(1 + hardAvgScore / 150)) * 0.7 + (hardRatio * 100) * 0.3,
        0, 100
    );

    // ═══ 4. TIME PRESSURE COMPONENT (0-100) ═══
    // Shorter timers = exponentially more weight
    const timedHighScores = highScores.filter(
        hs => hs.game_mode === 'timed' && hs.time_limit_seconds
    );
    let timeNumerator = 0, timeCount = 0;
    for (const hs of timedHighScores) {
        const timeWeight = 300 / Math.max(hs.time_limit_seconds, 60);
        const scoreContrib = 20 * Math.log(1 + hs.high_score / 100);
        const confidence = Math.min(1, hs.games_played / 2);
        timeNumerator += timeWeight * scoreContrib * confidence;
        timeCount++;
    }
    const timePressure = clamp(timeCount > 0 ? (timeNumerator / timeCount) * 3 : 0, 0, 100);

    // ═══ 5. CHALLENGE COMPONENT (0-100) ═══
    const challengeWeights = {
        'speed-round': 1.75,
        'target-word': 1.5,
        'word-category': 1.3,
        'word-search': 2.0,
        'word-runner': 1.8,
    };
    let chalNumerator = 0, chalCount = 0;
    let wsBlend = 0;
    for (const cs of challengeStats) {
        const weight = challengeWeights[cs.challenge_type] || 1.0;
        const scoreContrib = 20 * Math.log(1 + cs.high_score / 150);
        const confidence = Math.min(1, cs.games_played / 3);
        chalNumerator += weight * scoreContrib * confidence;
        chalCount++;

        // WS-specific: compute a skill blend from completion/speed if available
        if (cs.challenge_type === 'word-search' && cs.games_played >= 5) {
            // Use win_rate as proxy for completion_rate (target_words_completed / words in level)
            const completionRate = Math.min(1, cs.win_rate || 0);
            // Use avg_score as proxy for speed efficiency
            const speedScore = Math.min(100, (cs.avg_score || 0) / 10);
            const wsSkill = (completionRate * 60 + speedScore * 0.4);
            const wsConf = Math.min(1, cs.games_played / 15);
            wsBlend = wsSkill * wsConf * 2.0; // 2x multiplier for WS excellence
        }
    }
    let challenge = clamp(chalCount > 0 ? (chalNumerator / chalCount) * 3 : 0, 0, 100);
    // Blend WS skill into challenge component (up to 40% boost)
    if (wsBlend > 0) {
        challenge = clamp(challenge * 0.6 + wsBlend * 0.4, 0, 100);
    }

    // ═══ 6. CONSISTENCY COMPONENT (0-100) ═══
    // Low coefficient of variation in last 30 games
    const recent30 = [...gameScores]
        .sort((a, b) => new Date(b.played_at) - new Date(a.played_at))
        .slice(0, 30)
        .map(g => g.score);
    let consistency = 0;
    if (recent30.length >= 3) {
        const mean = recent30.reduce((a, b) => a + b, 0) / recent30.length;
        if (mean >= 10) {
            const variance = recent30.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / recent30.length;
            const stddev = Math.sqrt(variance);
            const cv = stddev / mean; // coefficient of variation
            consistency = clamp(100 - cv * 100, 0, 100);
        }
    }

    // ═══ 7. VERSATILITY COMPONENT (0-100) ═══
    // Number of unique (mode, grid, difficulty, time, challenge) combos
    const configSet = new Set();
    for (const g of gameScores) {
        configSet.add(`${g.game_mode}|${g.grid_size}|${g.difficulty}|${g.time_limit_seconds || 0}|${g.challenge_type || ''}`);
    }
    const uniqueConfigs = configSet.size;
    const highScoreConfigs = highScores.filter(hs => hs.high_score > 500).length;
    const versatility = clamp(
        (uniqueConfigs / 30) * 50 + (highScoreConfigs / 10) * 50,
        0, 100
    );

    // ═══ 8. PROGRESSION COMPONENT (0-100) ═══
    // Compares average of last 10 games vs previous 10 games
    let progression = 30; // baseline for new players
    if (gameScores.length >= 5) {
        const sorted = [...gameScores].sort((a, b) => new Date(b.played_at) - new Date(a.played_at));
        const recent10 = sorted.slice(0, 10).map(g => g.score);
        const older10 = sorted.slice(10, 20).map(g => g.score);

        if (older10.length > 0) {
            const recentAvg = recent10.reduce((a, b) => a + b, 0) / recent10.length;
            const olderAvg = older10.reduce((a, b) => a + b, 0) / older10.length;
            const improvement = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
            // Sigmoid mapping: 0% improvement → 50, big improvement → 100, decline → 0
            progression = clamp(
                50 + 50 * (1 / (1 + Math.exp(-3 * improvement))) - 25,
                0, 100
            );
        }
    }

    // ═══ FINAL WEIGHTED SKILL RATING ═══
    let skillRating =
        rawScore * WEIGHTS.RAW_SCORE +
        gridMastery * WEIGHTS.GRID_MASTERY +
        difficulty * WEIGHTS.DIFFICULTY +
        timePressure * WEIGHTS.TIME_PRESSURE +
        challenge * WEIGHTS.CHALLENGE +
        consistency * WEIGHTS.CONSISTENCY +
        versatility * WEIGHTS.VERSATILITY +
        progression * WEIGHTS.PROGRESSION;

    // ═══ EXPAND TO 0-50000 SCALE ═══
    // Cubic curve matching server-side: 50000 * (x/100)^3
    skillRating = 50000.0 * Math.pow(skillRating / 100.0, 3.0);

    // ═══ GAMES-PLAYED CONFIDENCE GATE ═══
    // Scale down rating for players with few games (full at 50 games)
    skillRating = skillRating * Math.min(1, totalGames / 50);

    // ═══ RATCHET: NEVER DECREASE ═══
    // Skill rating should only ever go up or stay the same
    if (previousRating > 0 && skillRating < previousRating) {
        skillRating = previousRating;
    }

    // ═══ DETERMINE CLASS ═══
    let skillClass = 'low';
    if (skillRating >= CLASS_THRESHOLDS.MASTER) skillClass = 'master';
    else if (skillRating >= CLASS_THRESHOLDS.HIGH) skillClass = 'high';
    else if (skillRating >= CLASS_THRESHOLDS.MEDIUM) skillClass = 'medium';

    return {
        skillRating: Math.round(skillRating * 100) / 100,
        components: {
            rawScore: round2(rawScore),
            gridMastery: round2(gridMastery),
            difficulty: round2(difficulty),
            timePressure: round2(timePressure),
            challenge: round2(challenge),
            consistency: round2(consistency),
            versatility: round2(versatility),
            progression: round2(progression),
        },
        skillClass,
    };
}

/**
 * Get the display info for a skill class.
 */
export function getClassInfo(skillClass) {
    switch (skillClass) {
        case 'high':
            return { label: 'High Class', color: '#FFD700', icon: '👑', bgColor: 'rgba(255,215,0,0.15)' };
        case 'medium':
            return { label: 'Medium Class', color: '#C0C0C0', icon: '⚔️', bgColor: 'rgba(192,192,192,0.15)' };
        case 'low':
        default:
            return { label: 'Low Class', color: '#CD7F32', icon: '🛡️', bgColor: 'rgba(205,127,50,0.15)' };
    }
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function round2(val) {
    return Math.round(val * 100) / 100;
}
