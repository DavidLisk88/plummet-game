/**
 * player-analysis.js — Generates natural-language player strength/weakness analysis
 * 
 * This system produces insightful, human-sounding analysis text for each player
 * on the leaderboard. It reads the skill component scores and game data to
 * identify patterns, strengths, and areas for improvement.
 * 
 * The output looks like expert commentary — no AI attribution is shown.
 */

import { getClassInfo } from './skill-engine.js';

// Component labels and descriptions for analysis
const COMPONENT_META = {
    raw_score: {
        label: 'Scoring Power',
        strongPhrases: [
            'Consistently delivers high scores across game modes',
            'A dominant scorer with impressive point totals',
            'Exceptional scoring ability that sets them apart',
        ],
        weakPhrases: [
            'Scoring output could see improvement with practice',
            'Point totals are modest — there\'s room to grow',
            'Still building up scoring momentum',
        ],
    },
    grid_mastery: {
        label: 'Grid Mastery',
        strongPhrases: [
            'Thrives on smaller, more challenging grids',
            'Masters tight grid spaces where every letter placement counts',
            'Shows remarkable skill on constrained grid sizes',
        ],
        weakPhrases: [
            'Tends to stick to larger, more forgiving grids',
            'Could push into smaller grid sizes for a real challenge',
            'Grid versatility is an area for development',
        ],
    },
    difficulty: {
        label: 'Hard Mode',
        strongPhrases: [
            'Excels under Hard Mode\'s punishing 4+ letter requirement',
            'A Hard Mode specialist who embraces the challenge',
            'Hard Mode performance is a standout strength',
        ],
        weakPhrases: [
            'Primarily plays on Normal difficulty',
            'Hard Mode remains relatively unexplored territory',
            'Stepping into Hard Mode more often would boost their ranking',
        ],
    },
    time_pressure: {
        label: 'Time Pressure',
        strongPhrases: [
            'Performs brilliantly under tight time constraints',
            'Short-timer games are where they truly shine',
            'Handles time pressure with composure and efficiency',
        ],
        weakPhrases: [
            'Gravitates toward longer time limits',
            'Performance drops noticeably under shorter timers',
            'Building speed and efficiency under pressure is the next frontier',
        ],
    },
    challenge: {
        label: 'Challenges',
        strongPhrases: [
            'Dominates across multiple challenge types',
            'Challenge modes bring out their best performance',
            'A well-rounded challenge competitor',
        ],
        weakPhrases: [
            'Challenge participation is limited',
            'Has yet to fully explore the challenge game modes',
            'Engaging more with challenges would strengthen their profile',
        ],
    },
    consistency: {
        label: 'Consistency',
        strongPhrases: [
            'Delivers reliable, steady performance game after game',
            'One of the most consistent players — rarely has an off game',
            'Score variance is remarkably low, showing true mastery',
        ],
        weakPhrases: [
            'Performance can be unpredictable from game to game',
            'Score fluctuations suggest an inconsistent play style',
            'Stabilizing performance would elevate their ranking significantly',
        ],
    },
    versatility: {
        label: 'Versatility',
        strongPhrases: [
            'Plays across a wide variety of game configurations',
            'Impressively well-rounded — no mode feels unfamiliar',
            'Explores every corner of the game with strong results',
        ],
        weakPhrases: [
            'Tends to specialize in a narrow set of configurations',
            'Branching out to different modes and grids would help',
            'Versatility is limited — a broader approach would pay dividends',
        ],
    },
    progression: {
        label: 'Growth Trend',
        strongPhrases: [
            'On a clear upward trajectory — improving rapidly',
            'Recent games show marked improvement over earlier sessions',
            'Getting stronger with every session',
        ],
        weakPhrases: [
            'Improvement has plateaued recently',
            'Recent performance is similar to earlier results',
            'Finding new strategies could reignite their growth curve',
        ],
    },
};

/**
 * Generate a natural-language analysis of a player's strengths and weaknesses.
 * 
 * @param {Object} data - Player analysis data (from get_player_analysis_data RPC or local)
 * @param {Object} data.components - The 8 skill component scores (0-100 each)
 * @param {string} data.skill_class - 'high', 'medium', or 'low'
 * @param {number} data.skill_rating - Overall skill rating
 * @param {string} data.username - Player's display name
 * @param {number} data.games_played - Total games played
 * @param {number} data.level - Current level
 * @returns {string} HTML-formatted analysis text
 */
export function generatePlayerAnalysis(data) {
    if (!data || !data.components) return '';

    const { components, skill_class, skill_rating, username, games_played, level } = data;
    const classInfo = getClassInfo(skill_class);

    // Sort components by score to find strengths and weaknesses
    const sorted = Object.entries(components)
        .map(([key, value]) => ({ key, value, meta: COMPONENT_META[key] }))
        .filter(c => c.meta) // skip unknown keys
        .sort((a, b) => b.value - a.value);

    const strengths = sorted.filter(c => c.value >= 45).slice(0, 3);
    const weaknesses = sorted.filter(c => c.value < 35).slice(-3).reverse();

    // Pick random phrases using a seeded approach (username hash for consistency)
    const seed = hashCode(username || 'player');

    let html = '';

    // Opening line
    html += `<div class="analysis-section">`;
    if (skill_class === 'high') {
        html += `<p class="analysis-lead">An elite-level player demonstrating mastery across multiple dimensions of the game.</p>`;
    } else if (skill_class === 'medium') {
        html += `<p class="analysis-lead">A solid competitor with clear strengths and identifiable areas for growth.</p>`;
    } else {
        html += `<p class="analysis-lead">A developing player building their skills — strong potential ahead.</p>`;
    }
    html += `</div>`;

    // Strengths
    if (strengths.length > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading strengths-heading">Strengths</h4><ul class="analysis-list">`;
        for (const s of strengths) {
            const phrases = s.meta.strongPhrases;
            const phrase = phrases[Math.abs(seed + hashCode(s.key)) % phrases.length];
            const scoreBar = getScoreBar(s.value);
            html += `<li><span class="analysis-label">${s.meta.label}</span> ${scoreBar}<br><span class="analysis-desc">${phrase}</span></li>`;
        }
        html += `</ul></div>`;
    }

    // Weaknesses
    if (weaknesses.length > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading weaknesses-heading">Areas to Improve</h4><ul class="analysis-list">`;
        for (const w of weaknesses) {
            const phrases = w.meta.weakPhrases;
            const phrase = phrases[Math.abs(seed + hashCode(w.key)) % phrases.length];
            const scoreBar = getScoreBar(w.value);
            html += `<li><span class="analysis-label">${w.meta.label}</span> ${scoreBar}<br><span class="analysis-desc">${phrase}</span></li>`;
        }
        html += `</ul></div>`;
    }

    // Key stats summary
    if (games_played > 0) {
        html += `<div class="analysis-section analysis-stats">`;
        html += `<span class="analysis-stat">Level ${level || 1}</span>`;
        html += `<span class="analysis-stat">${games_played} games</span>`;
        html += `<span class="analysis-stat">Rating: ${(skill_rating || 0).toFixed(1)}</span>`;
        html += `</div>`;
    }

    // Word Search specific analysis
    const ws = data.word_search;
    if (ws && ws.games_played >= 3) {
        html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Word Search Performance</h4>`;
        html += `<div class="analysis-ws-grid">`;

        const compRate = (ws.avg_completion_rate * 100).toFixed(0);
        const perfectRate = (ws.perfect_clear_rate * 100).toFixed(0);
        const speedUsed = (ws.avg_time_efficiency * 100).toFixed(0);
        const wsRating = (ws.skill_rating || 0).toFixed(1);

        html += `<span class="ws-stat-item"><b>${compRate}%</b> avg completion</span>`;
        html += `<span class="ws-stat-item"><b>${perfectRate}%</b> perfect clears</span>`;
        html += `<span class="ws-stat-item"><b>${100 - speedUsed}%</b> speed efficiency</span>`;
        html += `<span class="ws-stat-item"><b>${ws.highest_level || 1}</b> highest level</span>`;
        if (ws.total_bonus_words > 0) {
            html += `<span class="ws-stat-item"><b>${ws.total_bonus_words}</b> bonus words found</span>`;
        }
        if (ws.fastest_clear != null) {
            const mins = Math.floor(ws.fastest_clear / 60);
            const secs = Math.round(ws.fastest_clear % 60);
            html += `<span class="ws-stat-item"><b>${mins}:${secs.toString().padStart(2, '0')}</b> fastest clear</span>`;
        }
        html += `</div>`;

        // WS insight phrase
        const wsInsight = getWsInsight(ws, seed);
        if (wsInsight) {
            html += `<p class="analysis-desc ws-insight">${wsInsight}</p>`;
        }

        html += `</div>`;
    }

    return html;
}

/**
 * Generate a short one-line summary for compact display.
 */
export function generateShortSummary(components) {
    if (!components) return '';
    const sorted = Object.entries(components)
        .map(([key, value]) => ({ key, value, label: COMPONENT_META[key]?.label || key }))
        .filter(c => COMPONENT_META[c.key])
        .sort((a, b) => b.value - a.value);

    const best = sorted[0];
    if (!best) return '';
    return `Best at: ${best.label}`;
}

function getScoreBar(value) {
    const filled = Math.round(value / 10);
    const empty = 10 - filled;
    const color = value >= 60 ? '#4ade80' : value >= 35 ? '#fbbf24' : '#f87171';
    return `<span class="analysis-bar" style="color:${color}">${'█'.repeat(filled)}${'░'.repeat(empty)}</span> <span class="analysis-score">${Math.round(value)}</span>`;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + c;
        hash |= 0;
    }
    return hash;
}

function getWsInsight(ws, seed) {
    const comp = ws.avg_completion_rate || 0;
    const speed = 1 - (ws.avg_time_efficiency || 1);
    const perfect = ws.perfect_clear_rate || 0;
    const bonus = ws.total_bonus_words || 0;
    const level = ws.highest_level || 1;

    const insights = [];

    if (perfect >= 0.7 && speed >= 0.5) {
        insights.push('A word search machine — fast clears with near-perfect accuracy.');
        insights.push('Exceptional pattern recognition: finds every word and does it quickly.');
    } else if (perfect >= 0.6) {
        insights.push('Consistently clears the board — a thorough and methodical searcher.');
        insights.push('High perfect-clear rate shows impressive attention to detail.');
    } else if (speed >= 0.6) {
        insights.push('Lightning-fast scanning speed — trades some completeness for blazing pace.');
        insights.push('A speed-first approach that prioritizes rapid word discovery.');
    } else if (comp >= 0.85) {
        insights.push('Rarely misses a word — a patient, thorough word hunter.');
        insights.push('Strong completion rate shows excellent spatial awareness.');
    } else if (bonus >= 20) {
        insights.push('A vocabulary powerhouse — regularly spots bonus words hidden in the grid.');
        insights.push('Keen eye for bonus words reveals deep vocabulary knowledge.');
    } else if (level >= 50) {
        insights.push('Pushing into advanced word search territory with larger, harder grids.');
    } else if (comp < 0.5) {
        insights.push('Still developing word search skills — focus on finding all placed words before time runs out.');
    } else {
        insights.push('Building a solid word search foundation with room to grow.');
    }

    return insights[Math.abs(seed) % insights.length];
}

// ════════════════════════════════════════
// CHALLENGE-SPECIFIC ANALYSIS
// ════════════════════════════════════════

/**
 * Generate analysis HTML specific to a challenge type.
 * `data` comes from the `get_challenge_analysis_data` RPC and contains
 * challenge-specific fields depending on the type.
 */
export function generateChallengeAnalysis(data) {
    if (!data) return '';

    const {
        challenge_type,
        username,
        skill_rating,
        skill_class,
        high_score,
        games_played,
        avg_score,
        score_consistency,
        best_combo,
        avg_words,
        recent_trend,
        recent_scores,
    } = data;

    const seed = hashCode(username || 'player');
    let html = '';

    // ── Opening blurb based on class + challenge type ──
    const challengeNames = {
        'target-word': 'Target Word',
        'speed-round': 'Speed Round',
        'word-category': 'Word Category',
        'word-search': 'Word Search',
        'word-runner': 'Word Runner',
    };
    const name = challengeNames[challenge_type] || 'Challenge';

    html += `<div class="analysis-section">`;
    if (games_played < 3) {
        html += `<p class="analysis-lead">Still early days in ${name} — play more games to unlock deeper insights.</p>`;
    } else if (skill_class === 'high') {
        html += `<p class="analysis-lead">A top-tier ${name} competitor with commanding performance metrics.</p>`;
    } else if (skill_class === 'medium') {
        html += `<p class="analysis-lead">A capable ${name} player showing solid fundamentals and room to push higher.</p>`;
    } else {
        html += `<p class="analysis-lead">Building ${name} skills — the foundation is there, keep pushing.</p>`;
    }
    html += `</div>`;

    // ── Core stats grid ──
    if (games_played > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading strengths-heading">Performance</h4>`;
        html += `<div class="analysis-ws-grid">`;
        html += `<span class="ws-stat-item"><b>${games_played}</b> games played</span>`;
        html += `<span class="ws-stat-item"><b>${(high_score || 0).toLocaleString()}</b> high score</span>`;
        if (avg_score != null) html += `<span class="ws-stat-item"><b>${Math.round(avg_score).toLocaleString()}</b> avg score</span>`;
        if (best_combo != null && best_combo > 0) html += `<span class="ws-stat-item"><b>${best_combo}x</b> best combo</span>`;
        if (avg_words != null) html += `<span class="ws-stat-item"><b>${avg_words.toFixed(1)}</b> avg words/game</span>`;
        html += `<span class="ws-stat-item"><b>${(skill_rating || 0).toFixed(1)}</b> rating</span>`;
        html += `</div></div>`;
    }

    // ── Consistency insight ──
    if (score_consistency != null && games_played >= 3) {
        html += `<div class="analysis-section">`;
        const cons = score_consistency;
        if (cons <= 0.15) {
            html += `<p class="analysis-desc">Remarkably consistent — scores barely fluctuate between games.</p>`;
        } else if (cons <= 0.35) {
            html += `<p class="analysis-desc">Solid consistency with tight score ranges across sessions.</p>`;
        } else if (cons <= 0.55) {
            html += `<p class="analysis-desc">Moderate variance — some games pop off while others are more subdued.</p>`;
        } else {
            html += `<p class="analysis-desc">High variance scorer — capable of explosive games but not always hitting that peak.</p>`;
        }
        html += `</div>`;
    }

    // ── Trend ──
    if (recent_trend != null && games_played >= 5) {
        html += `<div class="analysis-section">`;
        if (recent_trend > 1.1) {
            html += `<p class="analysis-desc">📈 On a strong upward trend — recent games are outperforming overall averages.</p>`;
        } else if (recent_trend >= 0.9) {
            html += `<p class="analysis-desc">📊 Holding steady — performing right around their career average.</p>`;
        } else {
            html += `<p class="analysis-desc">📉 Recent scores are dipping below the norm — could be experimenting or hitting a wall.</p>`;
        }
        html += `</div>`;
    }

    // ── Challenge-specific sections ──
    _appendChallengeSpecific(html, data, seed);
    const specific = _getChallengeSpecificHtml(data, seed);
    if (specific) html += specific;

    return html;
}

function _getChallengeSpecificHtml(data, seed) {
    const ct = data.challenge_type;
    let html = '';

    if (ct === 'target-word') {
        const twLevel = data.target_word_level;
        const avgTargets = data.avg_targets_per_game;
        if (twLevel != null || avgTargets != null) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Target Word Stats</h4>`;
            html += `<div class="analysis-ws-grid">`;
            if (twLevel != null) html += `<span class="ws-stat-item"><b>Level ${twLevel}</b> current target level</span>`;
            if (avgTargets != null) html += `<span class="ws-stat-item"><b>${avgTargets.toFixed(1)}</b> avg targets/game</span>`;
            html += `</div>`;

            const insights = [];
            if (avgTargets >= 5) {
                insights.push('A target word machine — consistently hitting high numbers of targets per game.');
                insights.push('Exceptional focus on the target: rarely lets one slip by.');
            } else if (avgTargets >= 3) {
                insights.push('Solid target word completion rate — finding and claiming targets reliably.');
                insights.push('Good target awareness — could push for even faster target claims.');
            } else {
                insights.push('Target word completion is developing — focus on building words that contain the target.');
                insights.push('Room to improve target acquisition — try planning around the target word early.');
            }
            html += `<p class="analysis-desc ws-insight">${insights[Math.abs(seed) % insights.length]}</p>`;
            html += `</div>`;
        }
    }

    if (ct === 'speed-round') {
        const wpm = data.avg_words_per_minute;
        if (wpm != null) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Speed Stats</h4>`;
            html += `<div class="analysis-ws-grid">`;
            html += `<span class="ws-stat-item"><b>${wpm.toFixed(1)}</b> words per minute</span>`;
            html += `</div>`;

            const insights = [];
            if (wpm >= 8) {
                insights.push('Blazing word output — fingers fly across the grid with remarkable speed.');
                insights.push('Top-tier pace that puts serious pressure on the clock.');
            } else if (wpm >= 4) {
                insights.push('A respectable pace — consistently finding words under time pressure.');
                insights.push('Solid speed but there\'s another gear to find.');
            } else {
                insights.push('Building speed — practice quick pattern recognition to boost words per minute.');
                insights.push('Speed will come with repetition — focus on spotting short words fast.');
            }
            html += `<p class="analysis-desc ws-insight">${insights[Math.abs(seed) % insights.length]}</p>`;
            html += `</div>`;
        }
    }

    if (ct === 'word-category') {
        const breakdown = data.category_breakdown;
        if (breakdown && typeof breakdown === 'object' && Object.keys(breakdown).length > 0) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Category Breakdown</h4>`;
            html += `<div class="analysis-ws-grid">`;
            const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]).slice(0, 6);
            for (const [cat, count] of sorted) {
                html += `<span class="ws-stat-item"><b>${count}</b> ${cat}</span>`;
            }
            html += `</div>`;
            html += `<p class="analysis-desc ws-insight">${sorted.length >= 3 ? 'Well-rounded category knowledge with breadth across multiple domains.' : 'Still exploring categories — try different word groups to broaden your range.'}</p>`;
            html += `</div>`;
        }
    }

    if (ct === 'word-search') {
        // Re-use the WS section from main analysis
        const ws = data.word_search;
        if (ws && (ws.games_played || 0) >= 3) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Word Search Performance</h4>`;
            html += `<div class="analysis-ws-grid">`;
            const compRate = ((ws.avg_completion_rate || 0) * 100).toFixed(0);
            const perfectRate = ((ws.perfect_clear_rate || 0) * 100).toFixed(0);
            const speedUsed = ((ws.avg_time_efficiency || 0) * 100).toFixed(0);
            html += `<span class="ws-stat-item"><b>${compRate}%</b> avg completion</span>`;
            html += `<span class="ws-stat-item"><b>${perfectRate}%</b> perfect clears</span>`;
            html += `<span class="ws-stat-item"><b>${100 - Number(speedUsed)}%</b> speed efficiency</span>`;
            if (ws.highest_level) html += `<span class="ws-stat-item"><b>${ws.highest_level}</b> highest level</span>`;
            if (ws.total_bonus_words) html += `<span class="ws-stat-item"><b>${ws.total_bonus_words}</b> bonus words</span>`;
            html += `</div>`;
            const wsInsight = getWsInsight(ws, seed);
            if (wsInsight) html += `<p class="analysis-desc ws-insight">${wsInsight}</p>`;
            html += `</div>`;
        }
    }

    if (ct === 'word-runner') {
        if (data.games_played >= 1) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Word Runner Stats</h4>`;
            html += `<div class="analysis-ws-grid">`;
            if (data.high_score != null) html += `<span class="ws-stat-item"><b>${data.high_score.toLocaleString()}</b> high score</span>`;
            if (data.avg_words != null) html += `<span class="ws-stat-item"><b>${data.avg_words.toFixed(1)}</b> avg words/run</span>`;
            if (data.best_combo != null && data.best_combo > 0) html += `<span class="ws-stat-item"><b>${data.best_combo}x</b> best word streak</span>`;
            html += `</div>`;

            const insights = [];
            if ((data.high_score || 0) >= 2000) {
                insights.push('A distance demon — pushing deep into the procedural world with exceptional reflexes.');
                insights.push('Elite runner who makes the ever-increasing speed look effortless.');
            } else if ((data.high_score || 0) >= 800) {
                insights.push('Solid runner with good instincts — reading the terrain and snagging letters consistently.');
                insights.push('A capable platformer who balances letter collection with survival well.');
            } else {
                insights.push('Still finding the rhythm — focus on timing jumps early and learning spike patterns.');
                insights.push('Building runner confidence — try shorter word lengths first to bank easy points.');
            }
            html += `<p class="analysis-desc ws-insight">${insights[Math.abs(seed) % insights.length]}</p>`;
            html += `</div>`;
        }
    }

    return html;
}

// Placeholder kept as no-op — specific logic lives in _getChallengeSpecificHtml
function _appendChallengeSpecific() {}
