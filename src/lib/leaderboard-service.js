/**
 * leaderboard-service.js — Leaderboard data fetching and caching
 * 
 * Bridges the Supabase backend with the UI layer.
 * Handles caching, pagination, and the AI analysis dropdown generation.
 */
import {
    getLeaderboard, getChallengeLeaderboard, getMyRank, getMyChallengeRank,
    getPlayerAnalysisData, getChallengeAnalysisData, isLocalMode,
} from './supabase.js';
import { generatePlayerAnalysis, generateChallengeAnalysis } from './player-analysis.js';

// ── Cache (in-memory, clears on page reload) ──
const _cache = new Map(); // key → { data, fetchedAt }

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _getCached(key) {
    const entry = _cache.get(key);
    if (entry && entry.fetchedAt > Date.now() - CACHE_TTL) return entry.data;
    return null;
}

function _setCache(key, data) {
    _cache.set(key, { data, fetchedAt: Date.now() });
}

/**
 * Get the main leaderboard.
 * @param {Object} opts
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @param {string|null} opts.classFilter - 'master', 'high', 'medium', 'low', or null for all
 * @param {boolean} opts.forceRefresh
 * @returns {Promise<Array>}
 */
export async function fetchMainLeaderboard({ limit = 50, offset = 0, classFilter = null, forceRefresh = false } = {}) {
    if (isLocalMode) return [];

    const cacheKey = `main_${limit}_${offset}_${classFilter}`;
    if (!forceRefresh) {
        const cached = _getCached(cacheKey);
        if (cached) return cached;
    }

    const data = await getLeaderboard(limit, offset, classFilter);
    _setCache(cacheKey, data);
    return data;
}

/**
 * Get a challenge-specific leaderboard.
 * @param {string} challengeType - 'target-word', 'speed-round', 'word-category'
 * @param {Object} opts
 * @returns {Promise<Array>}
 */
export async function fetchChallengeLeaderboard(challengeType, { limit = 50, offset = 0, classFilter = null, forceRefresh = false } = {}) {
    if (isLocalMode) return [];

    const cacheKey = `challenge_${challengeType}_${limit}_${offset}_${classFilter}`;
    if (!forceRefresh) {
        const cached = _getCached(cacheKey);
        if (cached) return cached;
    }

    const data = await getChallengeLeaderboard(challengeType, limit, offset, classFilter);
    _setCache(cacheKey, data);
    return data;
}

/**
 * Get the current user's rank info.
 * @returns {Promise<Object|null>}
 */
export async function fetchMyRank(forceRefresh = false) {
    if (isLocalMode) return null;

    const cacheKey = 'myRank';
    if (!forceRefresh) {
        const cached = _getCached(cacheKey);
        if (cached !== null) return cached;
    }

    const data = await getMyRank();
    _setCache(cacheKey, data);
    return data;
}

/**
 * Get the current user's rank for a specific challenge type.
 * @param {string} challengeType
 * @returns {Promise<Object|null>}
 */
export async function fetchMyChallengeRank(challengeType, forceRefresh = false) {
    if (isLocalMode) return null;

    const cacheKey = `myChallengeRank_${challengeType}`;
    if (!forceRefresh) {
        const cached = _getCached(cacheKey);
        if (cached !== null) return cached;
    }

    const data = await getMyChallengeRank(challengeType);
    _setCache(cacheKey, data);
    return data;
}

/**
 * Get the AI analysis text for a player on the leaderboard.
 * Generates it client-side from the component scores if not cached.
 * 
 * @param {Object} entry - A leaderboard row
 * @param {string|null} challengeType - null for main board, or challenge type string
 * @returns {Promise<string>} HTML analysis text
 */
export async function fetchPlayerAnalysis(entry, challengeType = null) {
    if (!entry) return '';

    // If the server already has analysis text, use it
    if (entry.analysis_text) return entry.analysis_text;

    // Check cache
    const profileId = entry.profile_id;
    const analysisCacheKey = challengeType
        ? `analysis_${profileId}_${challengeType}`
        : `analysis_${profileId}`;
    const cachedAnalysis = _getCached(analysisCacheKey);
    if (cachedAnalysis) return cachedAnalysis;

    let html = '';

    if (challengeType) {
        // ── Challenge-specific analysis ──
        let challengeData = null;
        if (!isLocalMode && profileId) {
            try {
                challengeData = await getChallengeAnalysisData(profileId, challengeType);
            } catch (e) {
                console.warn('[leaderboard] Could not fetch challenge analysis data:', e);
            }
        }
        if (!challengeData) {
            // Minimal fallback from the leaderboard entry itself
            challengeData = {
                username: entry.username,
                challenge_type: challengeType,
                skill_rating: entry.skill_rating || 0,
                skill_class: entry.skill_class || 'low',
                high_score: entry.high_score || 0,
                games_played: entry.games_played || 0,
            };
        }
        html = generateChallengeAnalysis(challengeData);
    } else {
        // ── Main leaderboard analysis ──
        let analysisData = null;
        if (!isLocalMode && profileId) {
            try {
                analysisData = await getPlayerAnalysisData(profileId);
            } catch (e) {
                console.warn('[leaderboard] Could not fetch analysis data:', e);
            }
        }

        // Fall back to generating from the leaderboard row's components
        if (!analysisData) {
            analysisData = {
                username: entry.username,
                skill_class: entry.skill_class,
                skill_rating: entry.skill_rating,
                games_played: 0,
                level: 0,
                components: {
                    raw_score: entry.raw_score_component || 0,
                    grid_mastery: entry.grid_mastery_component || 0,
                    difficulty: entry.difficulty_component || 0,
                    time_pressure: entry.time_pressure_component || 0,
                    challenge: entry.challenge_component || 0,
                    consistency: entry.consistency_component || 0,
                    versatility: entry.versatility_component || 0,
                    progression: entry.progression_component || 0,
                },
            };
        }
        html = generatePlayerAnalysis(analysisData);
    }

    _setCache(analysisCacheKey, html);
    return html;
}

/**
 * Clear all cached leaderboard data.
 */
export function clearLeaderboardCache() {
    _cache.clear();
}
