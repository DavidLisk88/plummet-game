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
// Each component has 4 phrase bands: elite (75+), strong (50-74), developing (25-49), early (0-24)
const COMPONENT_META = {
    raw_score: {
        label: 'Scoring Power',
        bands: {
            elite: [
                'A dominant scorer with consistently impressive point totals.',
                'Exceptional scoring ability that places them among the strongest in the game.',
                'Delivers elite-level points across game modes — scoring is a true weapon.',
            ],
            strong: [
                'Solid scoring output that forms a reliable foundation.',
                'Consistently puts up respectable numbers on the scoreboard.',
                'Above-average scoring that shows real competence.',
            ],
            developing: [
                'Scoring is building momentum — getting stronger with each session.',
                'Point totals are growing as game sense improves.',
                'Starting to find the bigger words and point multipliers.',
            ],
            early: [
                'Scoring output is in its early stages — plenty of ceiling to discover.',
                'Still learning what drives big scores — the upside is significant.',
                'Focus on longer words and combos to kickstart scoring growth.',
            ],
        },
    },
    grid_mastery: {
        label: 'Grid Mastery',
        bands: {
            elite: [
                'Masters tight grid spaces where every letter placement counts.',
                'Shows remarkable proficiency across all grid sizes — a genuine grid specialist.',
                'Thrives on smaller, more challenging grids that punish sloppy play.',
            ],
            strong: [
                'Comfortable across most grid sizes with solid spatial awareness.',
                'Handles grid variation well — no grid size feels like unfamiliar territory.',
                'Good grid instincts that translate into consistent play.',
            ],
            developing: [
                'Grid skills are progressing — pushing into smaller grids more often would accelerate growth.',
                'Showing comfort on mid-range grids with room to expand.',
                'Building the spatial awareness needed for tighter grid play.',
            ],
            early: [
                'Tends to stick to larger, more forgiving grids so far.',
                'Grid mastery is a wide-open growth area — try smaller grids to level up.',
                'Still mapping out how grid size impacts strategy.',
            ],
        },
    },
    difficulty: {
        label: 'Hard Mode',
        bands: {
            elite: [
                'A Hard Mode specialist who thrives under the 4+ letter requirement.',
                'Hard Mode performance is a standout strength — consistently excels on the hardest setting.',
                'Crushing it on Hard Mode where most players struggle.',
            ],
            strong: [
                'Handles Hard Mode with confidence and decent results.',
                'A regular Hard Mode player who produces competitive scores under pressure.',
                'Hard Mode is no stranger — showing real comfort at the higher difficulty.',
            ],
            developing: [
                'Dabbling in Hard Mode with promising early results.',
                'Starting to build a Hard Mode track record — the foundation is forming.',
                'Making the transition to Hard Mode play — scores will follow with persistence.',
            ],
            early: [
                'Primarily plays on Normal difficulty — Hard Mode awaits.',
                'Hard Mode remains relatively unexplored territory.',
                'Stepping into Hard Mode more often would be the single biggest rating booster.',
            ],
        },
    },
    time_pressure: {
        label: 'Time Pressure',
        bands: {
            elite: [
                'Performs brilliantly under the tightest time constraints.',
                'Short-timer games are where they truly shine — composure under pressure is elite.',
                'Clock management is exceptional — extracts maximum value from every second.',
            ],
            strong: [
                'Handles time pressure well with solid performance on shorter timers.',
                'Comfortable racing the clock — time-limited modes are a strength.',
                'Good speed and efficiency when the timer is ticking.',
            ],
            developing: [
                'Building comfort with time pressure — tighter timers are becoming more familiar.',
                'Shows potential under time constraints that will sharpen with practice.',
                'Starting to find rhythm in timed modes.',
            ],
            early: [
                'Gravitates toward longer time limits or untimed modes.',
                'Time pressure performance is the biggest unlock available right now.',
                'Shorter timers would be a great next challenge to tackle.',
            ],
        },
    },
    challenge: {
        label: 'Challenges',
        bands: {
            elite: [
                'Dominates across multiple challenge types — a true all-around competitor.',
                'Challenge modes bring out their best performance — thrives in specialized play.',
                'A feared name on the challenge leaderboards.',
            ],
            strong: [
                'A solid challenge competitor with strong showings across modes.',
                'Engages meaningfully with challenges and puts up competitive scores.',
                'Challenge experience is translating into real skill.',
            ],
            developing: [
                'Growing their challenge repertoire with each new attempt.',
                'Challenge participation is picking up — building valuable experience.',
                'The more challenges played, the faster this score will climb.',
            ],
            early: [
                'Challenge participation is limited — a major opportunity zone.',
                'Exploring challenges more would diversify their skill profile significantly.',
                'Has yet to fully discover what challenges offer — big upside here.',
            ],
        },
    },
    consistency: {
        label: 'Consistency',
        bands: {
            elite: [
                'One of the most consistent players around — rarely has an off game.',
                'Score variance is remarkably low, signaling true mastery and control.',
                'Delivers reliable, steady performance game after game.',
            ],
            strong: [
                'Puts up consistent numbers with only occasional variance.',
                'A dependable performer — you know roughly what to expect each game.',
                'Good game-to-game stability that reflects solid fundamentals.',
            ],
            developing: [
                'Some variance from game to game — consistency will sharpen with volume.',
                'Performance can swing between hot and cold sessions.',
                'Narrowing the gap between best and worst games.',
            ],
            early: [
                'Scores fluctuate substantially — natural at this stage of development.',
                'High variance suggests an evolving play style that hasn\'t settled yet.',
                'Consistency comes with experience — it will stabilize naturally.',
            ],
        },
    },
    versatility: {
        label: 'Versatility',
        bands: {
            elite: [
                'Explores every corner of the game with strong results — impressively well-rounded.',
                'A true generalist who can compete in any configuration.',
                'Plays across a wide variety of game setups and succeeds in all of them.',
            ],
            strong: [
                'Good breadth of experience across game modes and settings.',
                'Comfortable trying different configurations and adapting.',
                'A versatile player who doesn\'t shy away from variety.',
            ],
            developing: [
                'Starting to branch out from their comfort zone.',
                'Versatility is growing as they explore new configurations.',
                'A few more mode/grid combinations would round out this profile nicely.',
            ],
            early: [
                'Tends to specialize in a narrow set of configurations.',
                'Branching out to different modes, grids, and time limits would help significantly.',
                'More variety in game choices is the clearest path to a higher rating.',
            ],
        },
    },
    progression: {
        label: 'Growth Trend',
        bands: {
            elite: [
                'On a steep upward trajectory — improving at an impressive rate.',
                'Recent games show dramatic improvement over earlier sessions.',
                'Growth rate is exceptional — this player is leveling up fast.',
            ],
            strong: [
                'Clear positive trend — getting noticeably stronger over time.',
                'Recent performance is outpacing their overall track record.',
                'Steady improvement that shows dedication and learning.',
            ],
            developing: [
                'Growth has been moderate — consistency in practice will steepen the curve.',
                'Some improvement visible but not yet breaking away from the baseline.',
                'The learning curve is there — pushing harder difficulties could accelerate it.',
            ],
            early: [
                'Improvement has plateaued or is too early to measure.',
                'Recent performance is roughly flat — finding new strategies could help.',
                'Growth hasn\'t kicked in yet — it often takes 20+ games to see a real trend.',
            ],
        },
    },
};

/**
 * Generate a natural-language analysis of a player's strengths and weaknesses.
 * 
 * Uses enriched server data when available:
 * - percentiles: per-component percentile within their class
 * - class_averages: average scores for their class (peer comparison)
 * - delta: recent performance change vs previous games
 * - notables: personal bests, streaks, milestones
 * 
 * @param {Object} data - Player analysis data (from get_player_analysis_data RPC or local)
 * @returns {string} HTML-formatted analysis text
 */
export function generatePlayerAnalysis(data) {
    if (!data || !data.components) return '';

    const { components, skill_class, skill_rating, username, games_played, level,
            percentiles, class_averages, players_in_class, delta, notables } = data;
    const classInfo = getClassInfo(skill_class);
    const seed = hashCode(username || 'player');

    // Sort components by score to find strengths and weaknesses
    const sorted = Object.entries(components)
        .map(([key, value]) => ({ key, value, meta: COMPONENT_META[key] }))
        .filter(c => c.meta)
        .sort((a, b) => b.value - a.value);

    const strengths = sorted.filter(c => c.value >= 45).slice(0, 3);
    const weaknesses = sorted.filter(c => c.value < 35).slice(-3).reverse();

    let html = '';

    // ── Opening line (class-aware + master) ──
    html += `<div class="analysis-section">`;
    if (skill_class === 'master') {
        html += `<p class="analysis-lead">A master-class player at the absolute pinnacle — near-perfect across every dimension.</p>`;
    } else if (skill_class === 'high') {
        html += `<p class="analysis-lead">An elite-level player demonstrating mastery across multiple dimensions of the game.</p>`;
    } else if (skill_class === 'medium') {
        html += `<p class="analysis-lead">A solid competitor with clear strengths and identifiable areas for growth.</p>`;
    } else {
        html += `<p class="analysis-lead">A developing player building their skills — strong potential ahead.</p>`;
    }
    html += `</div>`;

    // ── Notable patterns (personal best, streak, milestone) ──
    if (notables) {
        const alerts = [];
        if (notables.new_personal_best) {
            alerts.push('🏆 <b>New personal best!</b> Set a new all-time high score in a recent game.');
        }
        if (notables.improvement_streak && notables.streak_length >= 3) {
            alerts.push(`🔥 <b>${notables.streak_length}-game improvement streak</b> — each game outscoring the last.`);
        }
        if (notables.games_to_milestone != null && notables.games_to_milestone <= 10) {
            alerts.push(`📍 <b>${notables.games_to_milestone} games</b> away from the ${notables.next_milestone}-game milestone.`);
        }
        if (alerts.length > 0) {
            html += `<div class="analysis-section analysis-notables">`;
            for (const alert of alerts) {
                html += `<p class="analysis-notable">${alert}</p>`;
            }
            html += `</div>`;
        }
    }

    // ── Recent trend (delta) ──
    if (delta && games_played >= 15) {
        const pct = delta.score_change_pct || 0;
        if (Math.abs(pct) >= 5) {
            html += `<div class="analysis-section">`;
            if (pct >= 15) {
                html += `<p class="analysis-desc">📈 Scores are <b>up ${pct}%</b> recently — on a strong upward surge.</p>`;
            } else if (pct >= 5) {
                html += `<p class="analysis-desc">📈 Scores are <b>up ${pct}%</b> compared to earlier games — steady improvement.</p>`;
            } else if (pct <= -15) {
                html += `<p class="analysis-desc">📉 Scores are <b>down ${Math.abs(pct)}%</b> recently — could be experimenting or hitting a wall.</p>`;
            } else {
                html += `<p class="analysis-desc">📉 Scores have <b>dipped ${Math.abs(pct)}%</b> from their earlier pace.</p>`;
            }
            html += `</div>`;
        }
    }

    // ── Strengths with range-specific phrases + percentile + peer comparison ──
    if (strengths.length > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading strengths-heading">Strengths</h4><ul class="analysis-list">`;
        for (const s of strengths) {
            const phrase = _pickBandPhrase(s.meta, s.value, seed, s.key);
            const scoreBar = getScoreBar(s.value);
            let extra = '';
            // Percentile context
            if (percentiles && percentiles[s.key] != null) {
                extra += ` <span class="analysis-percentile">Top ${100 - percentiles[s.key]}% in ${_classLabel(skill_class)}</span>`;
            }
            // Peer comparison
            if (class_averages && class_averages[s.key] != null) {
                const diff = Math.round(s.value - class_averages[s.key]);
                if (diff > 0) {
                    extra += ` <span class="analysis-peer">+${diff} vs class avg</span>`;
                }
            }
            html += `<li><span class="analysis-label">${s.meta.label}</span> ${scoreBar}${extra}<br><span class="analysis-desc">${phrase}</span></li>`;
        }
        html += `</ul></div>`;
    }

    // ── Weaknesses with range-specific phrases + peer comparison ──
    if (weaknesses.length > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading weaknesses-heading">Areas to Improve</h4><ul class="analysis-list">`;
        for (const w of weaknesses) {
            const phrase = _pickBandPhrase(w.meta, w.value, seed, w.key);
            const scoreBar = getScoreBar(w.value);
            let extra = '';
            if (class_averages && class_averages[w.key] != null) {
                const diff = Math.round(w.value - class_averages[w.key]);
                if (diff < 0) {
                    extra += ` <span class="analysis-peer">${diff} vs class avg</span>`;
                }
            }
            html += `<li><span class="analysis-label">${w.meta.label}</span> ${scoreBar}${extra}<br><span class="analysis-desc">${phrase}</span></li>`;
        }
        html += `</ul></div>`;
    }

    // ── Cross-component insights ──
    const crossInsights = _getCrossInsights(components, seed);
    if (crossInsights.length > 0) {
        html += `<div class="analysis-section"><h4 class="analysis-heading insights-heading">Insights</h4>`;
        for (const insight of crossInsights) {
            html += `<p class="analysis-desc analysis-cross-insight">${insight}</p>`;
        }
        html += `</div>`;
    }

    // ── Key stats summary ──
    if (games_played > 0) {
        html += `<div class="analysis-section analysis-stats">`;
        html += `<span class="analysis-stat">Level ${level || 1}</span>`;
        html += `<span class="analysis-stat">${games_played} games</span>`;
        html += `<span class="analysis-stat">Rating: ${(skill_rating || 0).toFixed(1)}</span>`;
        if (data.class_rank && players_in_class > 1) {
            html += `<span class="analysis-stat">#${data.class_rank} of ${players_in_class} in ${_classLabel(skill_class)}</span>`;
        } else if (players_in_class > 1) {
            html += `<span class="analysis-stat">${players_in_class} in ${_classLabel(skill_class)}</span>`;
        }
        html += `</div>`;
    }

    return html;
}

/**
 * Pick a phrase from the correct band (elite/strong/developing/early)
 * based on the component score. Uses seeded selection for consistency.
 */
function _pickBandPhrase(meta, value, seed, key) {
    let band;
    if (value >= 75) band = 'elite';
    else if (value >= 50) band = 'strong';
    else if (value >= 25) band = 'developing';
    else band = 'early';

    const phrases = meta.bands[band];
    return phrases[Math.abs(seed + hashCode(key)) % phrases.length];
}

/**
 * Detect meaningful cross-component patterns.
 * Returns an array of insight strings (0-2 max).
 */
function _getCrossInsights(c, seed) {
    const insights = [];

    // High difficulty + low consistency = pushing limits
    if (c.difficulty >= 50 && c.consistency < 30) {
        insights.push('💡 High difficulty play with variable results — pushing into hard territory where consistency hasn\'t caught up yet. The scores will stabilize with more reps.');
    }
    // High consistency + low versatility = comfort zone
    else if (c.consistency >= 60 && c.versatility < 25) {
        insights.push('💡 Very consistent but in a narrow lane — branching out to new modes and grids could unlock the next tier of overall rating.');
    }

    // High time pressure + high scoring = clutch player
    if (c.time_pressure >= 55 && c.raw_score >= 55) {
        insights.push('💡 A clutch performer who scores big even under the clock — the rarest and most valuable combination.');
    }
    // High volume(challenge) + low progression = plateau
    else if (c.challenge >= 50 && c.progression < 25) {
        insights.push('💡 Lots of challenge experience but growth has flattened — try harder difficulties or unfamiliar modes to reignite improvement.');
    }

    // High grid mastery + high difficulty = technical master
    if (c.grid_mastery >= 60 && c.difficulty >= 60 && insights.length < 2) {
        insights.push('💡 Excels on hard mode with tight grids — a technical master who thrives where margins are thinnest.');
    }

    // High versatility + high consistency = all-rounder
    if (c.versatility >= 55 && c.consistency >= 55 && insights.length < 2) {
        insights.push('💡 Consistent across a wide variety of modes — the hallmark of a truly well-rounded player.');
    }

    // High progression + low everything else = fast learner
    if (c.progression >= 65 && (c.raw_score + c.grid_mastery + c.difficulty) / 3 < 35 && insights.length < 2) {
        insights.push('💡 Improving rapidly despite still-developing skills — this growth rate suggests the ratings will climb fast.');
    }

    return insights.slice(0, 2);
}

/**
 * Friendly class label for display
 */
function _classLabel(cls) {
    return { master: 'Master', high: 'High', medium: 'Medium', low: 'Low' }[cls] || 'Low';
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
    const v = Math.round(value);
    const color = v >= 60 ? '#4ade80' : v >= 35 ? '#fbbf24' : '#f87171';
    return `<span class="analysis-bar-wrap"><span class="analysis-bar-track"><span class="analysis-bar-fill" style="width:${v}%;background:${color}"></span></span><span class="analysis-score">${v}</span></span>`;
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
        avg_words_per_game,
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
        if (avg_words_per_game != null) html += `<span class="ws-stat-item"><b>${avg_words_per_game.toFixed(1)}</b> avg words/game</span>`;
        html += `<span class="ws-stat-item"><b>${(skill_rating || 0).toFixed(1)}</b> rating</span>`;
        html += `</div></div>`;
    }

    // ── Consistency insight ──
    // score_consistency from SQL = 1 - min(1, stddev/avg)
    //   → 1.0 = perfectly consistent, 0.0 = max variance
    if (score_consistency != null && games_played >= 3) {
        html += `<div class="analysis-section">`;
        const cons = score_consistency;
        if (cons >= 0.85) {
            html += `<p class="analysis-desc">Remarkably consistent — scores barely fluctuate between games.</p>`;
        } else if (cons >= 0.65) {
            html += `<p class="analysis-desc">Solid consistency with tight score ranges across sessions.</p>`;
        } else if (cons >= 0.45) {
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
        // breakdown is an array: [{category, games, high_score, best_words}, ...]
        if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
            html += `<div class="analysis-section"><h4 class="analysis-heading ws-heading">Category Breakdown</h4>`;
            html += `<div class="analysis-ws-grid">`;
            const sorted = [...breakdown].sort((a, b) => (b.games || 0) - (a.games || 0)).slice(0, 6);
            for (const cat of sorted) {
                const name = cat.category || 'Unknown';
                const games = cat.games || 0;
                html += `<span class="ws-stat-item"><b>${games}</b> ${name}</span>`;
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
            if (data.avg_words_per_game != null) html += `<span class="ws-stat-item"><b>${data.avg_words_per_game.toFixed(1)}</b> avg words/run</span>`;
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

/**
 * Extract chart-ready stats from challenge analysis data.
 * Returns { labels: string[], values: number[], color: string } for bar chart rendering.
 */
export function extractChallengeChartData(data) {
    if (!data || !data.challenge_type) return null;

    const ct = data.challenge_type;
    const labels = [];
    const values = [];

    // Base stats always present
    if (data.high_score != null && data.high_score > 0) {
        labels.push('High Score');
        values.push(data.high_score);
    }
    if (data.avg_score != null && data.avg_score > 0) {
        labels.push('Avg Score');
        values.push(Math.round(data.avg_score));
    }
    if (data.games_played != null && data.games_played > 0) {
        labels.push('Games');
        values.push(data.games_played);
    }
    if (data.best_combo != null && data.best_combo > 0) {
        labels.push('Best Combo');
        values.push(data.best_combo);
    }

    // Challenge-specific
    if (ct === 'target-word') {
        if (data.target_word_level != null) {
            labels.push('TW Level');
            values.push(data.target_word_level);
        }
        if (data.avg_targets_per_game != null) {
            labels.push('Avg Targets');
            values.push(Number(data.avg_targets_per_game));
        }
    }
    if (ct === 'speed-round') {
        if (data.avg_words_per_minute != null) {
            labels.push('Words/Min');
            values.push(Number(data.avg_words_per_minute));
        }
        if (data.best_words_in_game != null) {
            labels.push('Best Words');
            values.push(data.best_words_in_game);
        }
    }
    if (ct === 'word-category') {
        if (data.avg_category_words != null) {
            labels.push('Avg Cat Words');
            values.push(Number(data.avg_category_words));
        }
        if (data.best_category_words != null) {
            labels.push('Best Cat Words');
            values.push(data.best_category_words);
        }
    }
    if (ct === 'word-search') {
        const ws = data.word_search;
        if (ws) {
            if (ws.avg_completion_rate != null) {
                labels.push('Completion %');
                values.push(Math.round((ws.avg_completion_rate || 0) * 100));
            }
            if (ws.perfect_clear_rate != null) {
                labels.push('Perfect %');
                values.push(Math.round((ws.perfect_clear_rate || 0) * 100));
            }
            if (ws.highest_level) {
                labels.push('Highest Level');
                values.push(ws.highest_level);
            }
        }
    }
    if (ct === 'word-runner') {
        if (data.avg_words_per_game != null) {
            labels.push('Avg Words/Run');
            values.push(Number(data.avg_words_per_game.toFixed ? data.avg_words_per_game.toFixed(1) : data.avg_words_per_game));
        }
    }

    if (labels.length < 2) return null;

    const colorMap = {
        'target-word': '#f472b6',
        'speed-round': '#fbbf24',
        'word-category': '#34d399',
        'word-search': '#60a5fa',
        'word-runner': '#a78bfa',
    };

    return { labels, values, color: colorMap[ct] || '#60a5fa' };
}

/**
 * Extract recent scores array from challenge data for trend mini-chart.
 * Returns { scores: number[], color: string } or null.
 */
export function extractRecentScores(data) {
    if (!data?.recent_scores || !Array.isArray(data.recent_scores) || data.recent_scores.length < 3) return null;

    const scores = data.recent_scores.slice(0, 15).reverse(); // oldest → newest

    const colorMap = {
        'target-word': '#f472b6',
        'speed-round': '#fbbf24',
        'word-category': '#34d399',
        'word-search': '#60a5fa',
        'word-runner': '#a78bfa',
    };

    return { scores, color: colorMap[data.challenge_type] || '#60a5fa' };
}

